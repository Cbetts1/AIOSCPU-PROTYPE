'use strict';
/**
 * service-runner.js — AIOS Service Runner v1.0.0
 *
 * Loads service unit definitions from /etc/aios/services/*.json in the VFS,
 * converts them to live service descriptors, and registers them with the
 * AIOS Service Manager.
 *
 * Service unit JSON schema:
 * {
 *   "name":          "my-service",          // required
 *   "description":   "...",                 // optional
 *   "target":        "multi-user",          // init target
 *   "command":       "svc-handler-key",     // maps to a built-in handler
 *   "restartPolicy": "on-failure",          // no | on-failure | always
 *   "maxRestarts":   3,                     // 0 = unlimited
 *   "restartDelay":  5000,                  // ms before restart attempt
 *   "interval":      60000,                 // ms (for interval-based services)
 *   "enabled":       true,
 *   "env":           { "KEY": "VALUE" },    // per-service env overrides
 *   "dependsOn":     ["other-service"]      // start order hint
 * }
 *
 * Restart policies:
 *   "no"          — never restart automatically
 *   "on-failure"  — restart only on non-zero exit / crash
 *   "always"      — restart unconditionally after stop
 *
 * Zero external npm dependencies.
 */

const RESTART_POLICIES = Object.freeze({
  NO:         'no',
  ON_FAILURE: 'on-failure',
  ALWAYS:     'always',
});

// ---------------------------------------------------------------------------
// ServiceRunner factory
// ---------------------------------------------------------------------------
function createServiceRunner(vfs, kernel, svcManager) {
  const _loaded   = new Map();  // name → { unit, descriptor, restartCount }
  const _timers   = new Map();  // name → interval/timeout handle

  function _emit(event, data) {
    if (kernel) kernel.bus.emit(event, data);
  }

  function _log(msg) {
    if (vfs) {
      try { vfs.append('/var/log/services.log',
        `[${new Date().toISOString().slice(11, 19)}] ${msg}\n`
      ); } catch (_) {}
    }
  }

  // ---------------------------------------------------------------------------
  // _buildDescriptor — convert a JSON unit into a live service descriptor
  // ---------------------------------------------------------------------------
  function _buildDescriptor(unit, context) {
    const restartPolicy = unit.restartPolicy || RESTART_POLICIES.NO;
    const maxRestarts   = unit.maxRestarts   !== undefined ? unit.maxRestarts : 3;
    const restartDelay  = unit.restartDelay  !== undefined ? unit.restartDelay : 5000;
    const state         = { restartCount: 0 };

    // Resolve the start/stop functions from context (injected by bootstrap.js)
    const handler = context ? context[unit.command] : null;

    const descriptor = {
      description: unit.description || unit.name,

      async start(kernelRef) {
        _log(`Starting ${unit.name}…`);

        if (unit.interval && unit.interval > 0) {
          // Interval-based service — run handler on a timer
          if (typeof handler === 'function') {
            _timers.set(unit.name, setInterval(() => {
              Promise.resolve().then(() => handler(kernelRef, unit.env || {})).catch(e => {
                _log(`${unit.name} interval error: ${e.message}`);
                _maybeRestart(unit, state, restartPolicy, maxRestarts, restartDelay, kernelRef);
              });
            }, unit.interval));
          }
        } else if (typeof handler === 'function') {
          // One-shot or long-running handler
          try {
            await handler(kernelRef, unit.env || {});
          } catch (e) {
            _log(`${unit.name} start error: ${e.message}`);
            _maybeRestart(unit, state, restartPolicy, maxRestarts, restartDelay, kernelRef);
            throw e;
          }
        }
      },

      async stop() {
        _log(`Stopping ${unit.name}…`);
        const timer = _timers.get(unit.name);
        if (timer) {
          clearInterval(timer);
          clearTimeout(timer);
          _timers.delete(unit.name);
        }
        state.restartCount = 0;
      },
    };

    return descriptor;
  }

  // ---------------------------------------------------------------------------
  // _maybeRestart — handle crash recovery per restart policy
  // ---------------------------------------------------------------------------
  function _maybeRestart(unit, state, policy, max, delay, kernelRef) {
    if (policy === RESTART_POLICIES.NO) return;
    if (max > 0 && state.restartCount >= max) {
      _log(`${unit.name} exceeded max restarts (${max}), giving up`);
      _emit('service-runner:max-restarts', { name: unit.name });
      return;
    }

    state.restartCount++;
    _log(`${unit.name} will restart in ${delay}ms (attempt ${state.restartCount})`);
    _emit('service-runner:restart-scheduled', { name: unit.name, attempt: state.restartCount });

    setTimeout(() => {
      if (svcManager) {
        svcManager.restart(unit.name).catch(e => {
          _log(`${unit.name} restart failed: ${e.message}`);
        });
      }
    }, delay);
  }

  // ---------------------------------------------------------------------------
  // loadFromVFS — scan /etc/aios/services/ in VFS and load all .json units
  // ---------------------------------------------------------------------------
  function loadFromVFS(context) {
    if (!vfs) return { ok: false, error: 'VFS not available', loaded: 0 };

    const dirResult = vfs.ls('/etc/aios/services');
    if (!dirResult || !dirResult.ok) return { ok: true, loaded: 0 };

    let loaded = 0;
    const files = Array.isArray(dirResult.entries)
      ? dirResult.entries.filter(e => e.name && e.name.endsWith('.json'))
      : [];

    for (const entry of files) {
      const path = `/etc/aios/services/${entry.name}`;
      const r    = vfs.read(path);
      if (!r || !r.ok) continue;

      let unit;
      try {
        unit = JSON.parse(r.content);
      } catch (e) {
        _log(`Failed to parse ${path}: ${e.message}`);
        continue;
      }

      if (!unit.name || typeof unit.name !== 'string') {
        _log(`Skipping ${path}: missing "name" field`);
        continue;
      }

      if (unit.enabled === false) {
        _log(`${unit.name}: disabled, skipping`);
        continue;
      }

      const descriptor = _buildDescriptor(unit, context);
      _loaded.set(unit.name, { unit, descriptor, restartCount: 0 });

      if (svcManager) {
        try {
          svcManager.register(unit.name, descriptor);
          loaded++;
          _log(`Loaded service unit: ${unit.name}`);
        } catch (e) {
          _log(`Could not register ${unit.name}: ${e.message}`);
        }
      }
    }

    _emit('service-runner:loaded', { count: loaded });
    return { ok: true, loaded };
  }

  // ---------------------------------------------------------------------------
  // registerUnit — manually register a single unit object
  // ---------------------------------------------------------------------------
  function registerUnit(unit, context) {
    if (!unit || !unit.name) throw new TypeError('Unit must have a name');
    const descriptor = _buildDescriptor(unit, context);
    _loaded.set(unit.name, { unit, descriptor, restartCount: 0 });
    if (svcManager) svcManager.register(unit.name, descriptor);
    _log(`Registered unit: ${unit.name}`);
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // startAll — start all loaded (enabled) units in dependency order
  // ---------------------------------------------------------------------------
  async function startAll() {
    const sorted = Array.from(_loaded.values())
      .sort((a, b) => {
        // Units with dependsOn go after their dependencies
        const bDepsA = (b.unit.dependsOn || []).includes(a.unit.name);
        const aDepsB = (a.unit.dependsOn || []).includes(b.unit.name);
        if (bDepsA) return -1;
        if (aDepsB) return 1;
        return 0;
      });

    let started = 0;
    for (const { unit } of sorted) {
      if (svcManager) {
        const r = await svcManager.start(unit.name).catch(e => ({ ok: false, error: e.message }));
        if (r.ok) started++;
        else _log(`Failed to start ${unit.name}: ${r.error}`);
      }
    }
    return { ok: true, started, total: sorted.length };
  }

  // ---------------------------------------------------------------------------
  // stopAll
  // ---------------------------------------------------------------------------
  async function stopAll() {
    if (svcManager) await svcManager.stopAll();
    for (const [, timer] of _timers) {
      clearInterval(timer);
      clearTimeout(timer);
    }
    _timers.clear();
  }

  // ---------------------------------------------------------------------------
  // list
  // ---------------------------------------------------------------------------
  function list() {
    return Array.from(_loaded.values()).map(({ unit }) => ({
      name:          unit.name,
      description:   unit.description || '',
      restartPolicy: unit.restartPolicy || RESTART_POLICIES.NO,
      enabled:       unit.enabled !== false,
      target:        unit.target || 'multi-user',
    }));
  }

  // ---------------------------------------------------------------------------
  // Router commands
  // ---------------------------------------------------------------------------
  const commands = {
    units: (args) => {
      const sub = (args[0] || 'list').toLowerCase();

      if (sub === 'list') {
        const all = list();
        if (!all.length) return { status: 'ok', result: 'No service units loaded.' };
        const header = '  NAME                   TARGET        RESTART';
        const lines  = all.map(u =>
          `  ${u.name.padEnd(23)}${u.target.padEnd(14)}${u.restartPolicy}`
        );
        return { status: 'ok', result: [header, ...lines].join('\n') };
      }

      if (sub === 'show' && args[1]) {
        const entry = _loaded.get(args[1]);
        if (!entry) return { status: 'error', result: `Unit not found: ${args[1]}` };
        return { status: 'ok', result: JSON.stringify(entry.unit, null, 2) };
      }

      return { status: 'ok', result: 'Usage: units <list|show <name>>' };
    },
  };

  return {
    name:         'service-runner',
    version:      '1.0.0',
    RESTART_POLICIES,
    loadFromVFS,
    registerUnit,
    startAll,
    stopAll,
    list,
    commands,
  };
}

module.exports = { createServiceRunner, RESTART_POLICIES };
