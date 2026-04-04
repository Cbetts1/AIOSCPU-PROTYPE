'use strict';
/**
 * service-manager.js — AIOS Service Manager v1.0.0
 *
 * Created for: AIOSCPU Prototype One
 * Manages named background services with lifecycle hooks: start, stop, status.
 *
 * Pure Node.js CommonJS. Zero external dependencies.
 */

// ---------------------------------------------------------------------------
// Service states
// ---------------------------------------------------------------------------
const STATE = Object.freeze({
  STOPPED:  'stopped',
  STARTING: 'starting',
  RUNNING:  'running',
  STOPPING: 'stopping',
  FAILED:   'failed',
});

// ---------------------------------------------------------------------------
// ServiceManager factory
// ---------------------------------------------------------------------------
function createServiceManager(kernel) {
  const _services  = new Map();  // name → service descriptor
  const _bus       = kernel ? kernel.bus : null;

  function _emit(event, data) {
    if (_bus) _bus.emit(event, data);
  }

  function _log(msg) {
    if (kernel) kernel.syscall(1, [`[SvcMgr] ${msg}`]);
  }

  // ---------------------------------------------------------------------------
  // register — define a service without starting it
  // ---------------------------------------------------------------------------
  function register(name, descriptor) {
    if (typeof name !== 'string' || name.trim() === '') {
      throw new TypeError('Service name must be a non-empty string');
    }
    if (typeof descriptor !== 'object' || descriptor === null) {
      throw new TypeError('Service descriptor must be an object');
    }
    _services.set(name, {
      name,
      state:       STATE.STOPPED,
      descriptor,
      startedAt:   null,
      stoppedAt:   null,
      error:       null,
    });
    _emit('service:registered', { name });
  }

  // ---------------------------------------------------------------------------
  // start — bring a service up
  // ---------------------------------------------------------------------------
  async function start(name) {
    const svc = _services.get(name);
    if (!svc) return { ok: false, error: `Service "${name}" not registered` };
    if (svc.state === STATE.RUNNING) return { ok: true, note: 'already running' };

    svc.state = STATE.STARTING;
    svc.error = null;
    _emit('service:starting', { name });
    _log(`Starting ${name}…`);

    try {
      if (typeof svc.descriptor.start === 'function') {
        await svc.descriptor.start(kernel);
      }
      svc.state     = STATE.RUNNING;
      svc.startedAt = Date.now();
      _emit('service:started', { name });
      _log(`${name} started`);
      return { ok: true };
    } catch (e) {
      svc.state = STATE.FAILED;
      svc.error = e.message;
      _emit('service:failed', { name, error: e.message });
      _log(`${name} FAILED: ${e.message}`);
      return { ok: false, error: e.message };
    }
  }

  // ---------------------------------------------------------------------------
  // stop — shut a service down
  // ---------------------------------------------------------------------------
  async function stop(name) {
    const svc = _services.get(name);
    if (!svc) return { ok: false, error: `Service "${name}" not registered` };
    if (svc.state === STATE.STOPPED) return { ok: true, note: 'already stopped' };

    svc.state = STATE.STOPPING;
    _emit('service:stopping', { name });
    _log(`Stopping ${name}…`);

    try {
      if (typeof svc.descriptor.stop === 'function') {
        await svc.descriptor.stop(kernel);
      }
      svc.state     = STATE.STOPPED;
      svc.stoppedAt = Date.now();
      _emit('service:stopped', { name });
      _log(`${name} stopped`);
      return { ok: true };
    } catch (e) {
      svc.state = STATE.FAILED;
      svc.error = e.message;
      _emit('service:failed', { name, error: e.message });
      return { ok: false, error: e.message };
    }
  }

  // ---------------------------------------------------------------------------
  // restart
  // ---------------------------------------------------------------------------
  async function restart(name) {
    await stop(name);
    return start(name);
  }

  // ---------------------------------------------------------------------------
  // status / list
  // ---------------------------------------------------------------------------
  function status(name) {
    const svc = _services.get(name);
    if (!svc) return { ok: false, error: `Service "${name}" not registered` };
    return {
      ok:        true,
      name:      svc.name,
      state:     svc.state,
      startedAt: svc.startedAt,
      stoppedAt: svc.stoppedAt,
      error:     svc.error,
    };
  }

  function list() {
    return Array.from(_services.values()).map(s => ({
      name:  s.name,
      state: s.state,
      error: s.error || null,
    }));
  }

  // ---------------------------------------------------------------------------
  // stopAll — called during OS shutdown
  // ---------------------------------------------------------------------------
  async function stopAll() {
    const names = Array.from(_services.keys());
    for (const name of names) {
      const svc = _services.get(name);
      if (svc && svc.state === STATE.RUNNING) {
        await stop(name);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Router command module interface
  // ---------------------------------------------------------------------------
  const commands = {
    svc: async (args) => {
      const [action, name] = args;
      if (!action) return { status: 'error', result: 'Usage: svc <start|stop|restart|status|list> [name]' };
      switch (action.toLowerCase()) {
        case 'list': {
          const svcs = list();
          if (!svcs.length) return { status: 'ok', result: 'No services registered.' };
          const out = svcs.map(s => `  ${s.state.padEnd(10)} ${s.name}${s.error ? ` [ERR: ${s.error}]` : ''}`).join('\n');
          return { status: 'ok', result: out };
        }
        case 'status': {
          if (!name) return { status: 'error', result: 'Usage: svc status <name>' };
          const r = status(name);
          return r.ok ? { status: 'ok', result: JSON.stringify(r, null, 2) } : { status: 'error', result: r.error };
        }
        case 'start': {
          if (!name) return { status: 'error', result: 'Usage: svc start <name>' };
          const r = await start(name);
          return r.ok ? { status: 'ok', result: `Service "${name}" started.` } : { status: 'error', result: r.error };
        }
        case 'stop': {
          if (!name) return { status: 'error', result: 'Usage: svc stop <name>' };
          const r = await stop(name);
          return r.ok ? { status: 'ok', result: `Service "${name}" stopped.` } : { status: 'error', result: r.error };
        }
        case 'restart': {
          if (!name) return { status: 'error', result: 'Usage: svc restart <name>' };
          const r = await restart(name);
          return r.ok ? { status: 'ok', result: `Service "${name}" restarted.` } : { status: 'error', result: r.error };
        }
        default:
          return { status: 'error', result: `Unknown svc action: "${action}"` };
      }
    },
  };

  return {
    name:    'service-manager',
    STATE,
    register,
    start,
    stop,
    restart,
    status,
    list,
    stopAll,
    commands,
  };
}

module.exports = { createServiceManager, STATE };
