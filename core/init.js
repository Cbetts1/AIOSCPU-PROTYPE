'use strict';
/**
 * init.js — AIOS Init System v1.0.0
 *
 * The AIOS PID-1 equivalent.
 * Manages the OS boot sequence through defined targets, analogous to
 * systemd targets or traditional SysV runlevels.
 *
 * Targets (executed in order):
 *   sysinit    — Kernel, VFS, hardware detection, identity
 *   basic      — Environment, capabilities, core services
 *   multi-user — Full AI stack, terminal, service mesh
 *
 * Each registered unit declares which target it belongs to.
 * The init system activates targets sequentially and tracks unit states.
 * Failed units are logged but do not block the boot (degraded mode).
 *
 * Zero external npm dependencies.
 */

// ---------------------------------------------------------------------------
// Target constants (analogous to systemd targets)
// ---------------------------------------------------------------------------
const TARGETS = Object.freeze({
  SYSINIT:    'sysinit',      // Early kernel init
  BASIC:      'basic',        // Basic system services
  MULTI_USER: 'multi-user',   // Full multi-user operation
  GRAPHICAL:  'graphical',    // GUI layer (future)
  SHUTDOWN:   'shutdown',     // Shutdown sequence
  REBOOT:     'reboot',       // Reboot sequence
  RESCUE:     'rescue',       // Single-user rescue mode
});

// Boot target activation order
const TARGET_ORDER = [TARGETS.SYSINIT, TARGETS.BASIC, TARGETS.MULTI_USER];

// ---------------------------------------------------------------------------
// Init factory
// ---------------------------------------------------------------------------
function createInit(kernel, stateEngine) {
  let _currentTarget = null;
  const _units       = new Map();  // name → unit descriptor + runtime state
  const _bootLog     = [];

  function _log(msg) {
    const entry = { ts: new Date().toISOString(), msg };
    _bootLog.push(entry);
    if (_bootLog.length > 200) _bootLog.shift();
    if (kernel) kernel.syscall(0, [`[init] ${msg}\n`]);
  }

  // ---------------------------------------------------------------------------
  // registerUnit — declare a unit (does not start it)
  // ---------------------------------------------------------------------------
  function registerUnit(name, descriptor) {
    if (typeof name !== 'string' || !name.trim()) throw new TypeError('Unit name required');
    if (typeof descriptor !== 'object' || !descriptor) throw new TypeError('Descriptor must be an object');
    _units.set(name, {
      name,
      descriptor,
      state:     'inactive',
      startedAt: null,
      error:     null,
      target:    descriptor.target || TARGETS.MULTI_USER,
    });
  }

  // ---------------------------------------------------------------------------
  // startUnit — activate a single unit
  // ---------------------------------------------------------------------------
  async function startUnit(name) {
    const unit = _units.get(name);
    if (!unit) return { ok: false, error: `Unit not found: ${name}` };
    if (unit.state === 'active') return { ok: true };

    unit.state     = 'activating';
    unit.startedAt = Date.now();

    try {
      if (typeof unit.descriptor.start === 'function') {
        await unit.descriptor.start(kernel);
      }
      unit.state = 'active';
      if (kernel) kernel.bus.emit('init:unit:started', { name });
      return { ok: true };
    } catch (e) {
      unit.state = 'failed';
      unit.error = e.message;
      if (kernel) kernel.bus.emit('init:unit:failed', { name, error: e.message });
      _log(`Unit ${name} FAILED: ${e.message}`);
      return { ok: false, error: e.message };
    }
  }

  // ---------------------------------------------------------------------------
  // stopUnit — deactivate a single unit
  // ---------------------------------------------------------------------------
  async function stopUnit(name) {
    const unit = _units.get(name);
    if (!unit || unit.state !== 'active') return { ok: false, error: `Unit not active: ${name}` };

    try {
      if (typeof unit.descriptor.stop === 'function') {
        await unit.descriptor.stop();
      }
      unit.state = 'inactive';
      if (kernel) kernel.bus.emit('init:unit:stopped', { name });
      return { ok: true };
    } catch (e) {
      unit.state = 'failed';
      unit.error = e.message;
      return { ok: false, error: e.message };
    }
  }

  // ---------------------------------------------------------------------------
  // activateTarget — start all units belonging to a target
  // ---------------------------------------------------------------------------
  async function activateTarget(target) {
    _currentTarget = target;
    _log(`Entering target: ${target}`);
    if (kernel) kernel.bus.emit('init:target', { target });

    const targetUnits = Array.from(_units.values()).filter(u => u.target === target);
    for (const unit of targetUnits) {
      await startUnit(unit.name);
    }

    return { ok: true, target, units: targetUnits.length };
  }

  // ---------------------------------------------------------------------------
  // boot — run the full boot sequence through all targets
  // ---------------------------------------------------------------------------
  async function boot() {
    _log('Init system starting (PID 1 equivalent)');

    if (stateEngine) stateEngine.transition('BOOTING');

    for (const target of TARGET_ORDER) {
      const r = await activateTarget(target);
      _log(`Target ${target} complete — ${r.units} units`);
    }

    if (stateEngine) stateEngine.transition('RUNNING');

    _log('Boot complete. All targets reached. OS is operational.');
    if (kernel) {
      kernel.bus.emit('init:boot:complete', {
        target:   TARGETS.MULTI_USER,
        units:    _units.size,
        bootTime: Date.now(),
      });
    }

    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // shutdown — stop all active units in reverse order
  // ---------------------------------------------------------------------------
  async function shutdown(reboot = false) {
    _log(`Shutdown initiated (reboot=${reboot})`);
    _currentTarget = reboot ? TARGETS.REBOOT : TARGETS.SHUTDOWN;

    if (stateEngine) stateEngine.transition('SHUTDOWN');

    const active = Array.from(_units.values())
      .filter(u => u.state === 'active')
      .reverse();

    for (const unit of active) {
      await stopUnit(unit.name).catch(e => _log(`Stop error for ${unit.name}: ${e.message}`));
    }

    if (kernel) kernel.bus.emit('init:shutdown', { reboot });
    _log('Shutdown complete.');
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // unitList — return status of all registered units
  // ---------------------------------------------------------------------------
  function unitList() {
    return Array.from(_units.values()).map(u => ({
      name:    u.name,
      state:   u.state,
      target:  u.target,
      error:   u.error,
      uptime:  u.startedAt ? Math.floor((Date.now() - u.startedAt) / 1000) : 0,
    }));
  }

  // ---------------------------------------------------------------------------
  // Router commands
  // ---------------------------------------------------------------------------
  const commands = {
    init: (args) => {
      const sub = (args[0] || 'status').toLowerCase();

      if (sub === 'status') {
        const units   = unitList();
        const active  = units.filter(u => u.state === 'active').length;
        const failed  = units.filter(u => u.state === 'failed').length;
        const lines   = units.map(u => {
          const icon = { active: '●', failed: '✗', inactive: '○', activating: '◌' }[u.state] || '?';
          const err  = u.error ? `  [ERR: ${u.error}]` : '';
          const up   = u.uptime ? `  ${u.uptime}s` : '';
          return `  ${icon}  ${u.name.padEnd(32)} [${u.target}]${up}${err}`;
        });
        return {
          status: 'ok',
          result: [
            `Init System  target: ${_currentTarget || 'none'}`,
            `Units: ${units.length} total  ${active} active  ${failed} failed`,
            '',
            ...lines,
          ].join('\n'),
        };
      }

      if (sub === 'start' && args[1]) {
        startUnit(args[1])
          .then(r => kernel && kernel.syscall(1, [`[init] ${args[1]}: ${r.ok ? 'started' : r.error}`]))
          .catch(() => {});
        return { status: 'ok', result: `Starting unit: ${args[1]}` };
      }

      if (sub === 'stop' && args[1]) {
        stopUnit(args[1])
          .then(r => kernel && kernel.syscall(1, [`[init] ${args[1]}: ${r.ok ? 'stopped' : r.error}`]))
          .catch(() => {});
        return { status: 'ok', result: `Stopping unit: ${args[1]}` };
      }

      if (sub === 'log') {
        const n = parseInt(args[1], 10) || 30;
        return {
          status: 'ok',
          result: _bootLog.slice(-n).map(l => `[${l.ts.slice(11, 19)}] ${l.msg}`).join('\n') || '(empty)',
        };
      }

      return { status: 'ok', result: 'Usage: init <status|start <unit>|stop <unit>|log [n]>' };
    },
  };

  return {
    name:          'init',
    TARGETS,
    registerUnit,
    startUnit,
    stopUnit,
    activateTarget,
    boot,
    shutdown,
    unitList,
    currentTarget: () => _currentTarget,
    commands,
  };
}

module.exports = { createInit, TARGETS };
