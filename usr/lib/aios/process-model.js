'use strict';
/**
 * process-model.js — AIOS Virtual Process Model v1.0.0
 *
 * Implements the AIOS virtual process layer:
 *   - Virtual PID (vPID) allocation, independent of host PIDs
 *   - Full process lifecycle: spawn, wait, kill, restart
 *   - Process metadata: name, state, command, priority, startTime, exitCode
 *   - Emits lifecycle events on the kernel bus
 *   - PID 1 is always "init" (the OS itself)
 *
 * States:
 *   created → running → stopped | crashed | zombie
 *                 ↑______________|  (on restart)
 *
 * Zero external npm dependencies.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PROCESS_STATES = Object.freeze({
  CREATED:  'created',
  RUNNING:  'running',
  SLEEPING: 'sleeping',
  STOPPED:  'stopped',
  ZOMBIE:   'zombie',
  CRASHED:  'crashed',
});

const PRIORITY = Object.freeze({
  HIGH:   0,
  NORMAL: 1,
  LOW:    2,
});

// ---------------------------------------------------------------------------
// VirtualProcess — a single virtual process entry
// ---------------------------------------------------------------------------
class VirtualProcess {
  constructor(vPid, name, opts = {}) {
    this.vPid       = vPid;
    this.name       = name;
    this.cmdline    = opts.cmdline    || name;
    this.priority   = opts.priority   !== undefined ? opts.priority : PRIORITY.NORMAL;
    this.state      = PROCESS_STATES.CREATED;
    this.startTime  = Date.now();
    this.stopTime   = null;
    this.exitCode   = null;
    this.restarts   = 0;
    this.meta       = opts.meta       || {};
    this._handler   = opts.handler    || null;  // optional async fn
    this._cleanup   = null;
  }

  uptime() {
    if (this.state === PROCESS_STATES.STOPPED || this.state === PROCESS_STATES.ZOMBIE) {
      return this.stopTime ? Math.floor((this.stopTime - this.startTime) / 1000) : 0;
    }
    return Math.floor((Date.now() - this.startTime) / 1000);
  }

  toStatus() {
    return [
      `Name:     ${this.name}`,
      `VPid:     ${this.vPid}`,
      `State:    ${this.state}`,
      `Priority: ${Object.keys(PRIORITY).find(k => PRIORITY[k] === this.priority) || this.priority}`,
      `Uptime:   ${this.uptime()}s`,
      `Restarts: ${this.restarts}`,
      `ExitCode: ${this.exitCode !== null ? this.exitCode : '-'}`,
    ].join('\n');
  }

  toCmdline() {
    return this.cmdline + '\0';
  }
}

// ---------------------------------------------------------------------------
// VirtualProcessModel factory
// ---------------------------------------------------------------------------
function createProcessModel(kernel, vfs) {
  const _procs   = new Map();  // vPid → VirtualProcess
  let   _nextPid = 1;

  function _emit(event, data) {
    if (kernel) kernel.bus.emit(event, data);
  }

  function _log(msg) {
    // Route to VFS log rather than stdout to keep boot output clean
    if (vfs) {
      try { vfs.append('/var/log/kernel.log', `[proc] ${msg}\n`); } catch (_) {}
    }
  }

  // ── PID 1: init ──────────────────────────────────────────────────────────
  const _initProc = new VirtualProcess(1, 'init', {
    cmdline:  '/boot/init.js',
    priority: PRIORITY.HIGH,
    meta:     { desc: 'AIOS PID-1 init process' },
  });
  _initProc.state = PROCESS_STATES.RUNNING;
  _procs.set(1, _initProc);
  _nextPid = 2;

  // ---------------------------------------------------------------------------
  // spawn — create and start a virtual process
  // ---------------------------------------------------------------------------
  function spawn(name, opts = {}) {
    const vPid = _nextPid++;
    const proc = new VirtualProcess(vPid, name, opts);
    _procs.set(vPid, proc);

    proc.state = PROCESS_STATES.RUNNING;
    proc.startTime = Date.now();

    _emit('process:spawned', { vPid, name, priority: proc.priority });
    _log(`[${vPid}] ${name} started`);

    // If an async handler is provided, run it
    if (typeof proc._handler === 'function') {
      Promise.resolve().then(() => proc._handler(proc)).then(() => {
        if (proc.state === PROCESS_STATES.RUNNING) _markStopped(proc, 0);
      }).catch(e => {
        _markCrashed(proc, e);
      });
    }

    // Also register in kernel's process table (keeps existing tooling working)
    if (kernel) kernel.procs.spawn(name, { vPid, ...opts.meta });

    return vPid;
  }

  // ---------------------------------------------------------------------------
  // kill — terminate a virtual process
  // ---------------------------------------------------------------------------
  function kill(vPid, signal = 'SIGTERM') {
    const proc = _procs.get(vPid);
    if (!proc) return { ok: false, error: `No process with vPid ${vPid}` };
    if (proc.vPid === 1) return { ok: false, error: 'Cannot kill PID 1 (init)' };
    if (proc.state === PROCESS_STATES.STOPPED || proc.state === PROCESS_STATES.ZOMBIE) {
      return { ok: false, error: `Process ${vPid} already stopped` };
    }

    _markStopped(proc, signal === 'SIGKILL' ? 137 : 0);
    _emit('process:killed', { vPid, name: proc.name, signal });
    _log(`[${vPid}] ${proc.name} killed (${signal})`);
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // wait — return a promise that resolves when the process exits
  // ---------------------------------------------------------------------------
  function wait(vPid, timeoutMs = 5000) {
    return new Promise((resolve) => {
      const proc = _procs.get(vPid);
      if (!proc) return resolve({ ok: false, error: 'Not found' });
      if (proc.state === PROCESS_STATES.STOPPED || proc.state === PROCESS_STATES.ZOMBIE) {
        return resolve({ ok: true, exitCode: proc.exitCode });
      }

      const deadline = Date.now() + timeoutMs;
      const interval = setInterval(() => {
        const p = _procs.get(vPid);
        if (!p || p.state === PROCESS_STATES.STOPPED || p.state === PROCESS_STATES.ZOMBIE) {
          clearInterval(interval);
          resolve({ ok: true, exitCode: p ? p.exitCode : null });
        } else if (Date.now() >= deadline) {
          clearInterval(interval);
          resolve({ ok: false, error: 'Timeout waiting for process' });
        }
      }, 100);
    });
  }

  // ---------------------------------------------------------------------------
  // restart — stop and re-spawn with same parameters
  // ---------------------------------------------------------------------------
  async function restart(vPid) {
    const proc = _procs.get(vPid);
    if (!proc) return { ok: false, error: `No process with vPid ${vPid}` };
    if (proc.vPid === 1) return { ok: false, error: 'Cannot restart PID 1 (init)' };

    const name    = proc.name;
    const opts    = { cmdline: proc.cmdline, priority: proc.priority, meta: proc.meta, handler: proc._handler };
    const restarts = proc.restarts + 1;

    // Kill if running
    if (proc.state === PROCESS_STATES.RUNNING || proc.state === PROCESS_STATES.SLEEPING) {
      _markStopped(proc, 0);
    }
    _procs.delete(vPid);

    // Spawn replacement with same vPid
    const newVPid = _nextPid++;
    const newProc = new VirtualProcess(newVPid, name, opts);
    newProc.restarts = restarts;
    newProc.state    = PROCESS_STATES.RUNNING;
    newProc.startTime = Date.now();
    _procs.set(newVPid, newProc);

    if (typeof newProc._handler === 'function') {
      Promise.resolve().then(() => newProc._handler(newProc)).then(() => {
        if (newProc.state === PROCESS_STATES.RUNNING) _markStopped(newProc, 0);
      }).catch(e => _markCrashed(newProc, e));
    }

    _emit('process:restarted', { oldVPid: vPid, newVPid, name, restarts });
    _log(`[${newVPid}] ${name} restarted (${restarts}x)`);
    return { ok: true, newVPid };
  }

  // ---------------------------------------------------------------------------
  // sleep / wake — mark sleeping (I/O wait etc.)
  // ---------------------------------------------------------------------------
  function sleep(vPid) {
    const proc = _procs.get(vPid);
    if (proc && proc.state === PROCESS_STATES.RUNNING) {
      proc.state = PROCESS_STATES.SLEEPING;
      _emit('process:sleeping', { vPid });
    }
  }

  function wake(vPid) {
    const proc = _procs.get(vPid);
    if (proc && proc.state === PROCESS_STATES.SLEEPING) {
      proc.state = PROCESS_STATES.RUNNING;
      _emit('process:awake', { vPid });
    }
  }

  // ---------------------------------------------------------------------------
  // get / list
  // ---------------------------------------------------------------------------
  function get(vPid) {
    return _procs.get(vPid) || null;
  }

  function list() {
    return Array.from(_procs.values()).map(p => ({
      vPid:     p.vPid,
      name:     p.name,
      cmdline:  p.cmdline,
      state:    p.state,
      priority: p.priority,
      uptime:   p.uptime(),
      restarts: p.restarts,
      exitCode: p.exitCode,
    }));
  }

  function getByName(name) {
    return Array.from(_procs.values()).find(p => p.name === name) || null;
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------
  function _markStopped(proc, exitCode) {
    proc.state    = PROCESS_STATES.STOPPED;
    proc.stopTime = Date.now();
    proc.exitCode = exitCode;
    _emit('process:stopped', { vPid: proc.vPid, name: proc.name, exitCode });
  }

  function _markCrashed(proc, err) {
    proc.state    = PROCESS_STATES.CRASHED;
    proc.stopTime = Date.now();
    proc.exitCode = 1;
    _emit('process:crashed', { vPid: proc.vPid, name: proc.name, error: err.message });
    _log(`[${proc.vPid}] ${proc.name} CRASHED: ${err.message}`);
  }

  // ---------------------------------------------------------------------------
  // Router commands
  // ---------------------------------------------------------------------------
  const commands = {
    vps: (args) => {
      const sub = (args[0] || 'list').toLowerCase();

      if (sub === 'list') {
        const all = list();
        if (!all.length) return { status: 'ok', result: 'No virtual processes.' };
        const header = '  vPID   NAME                   STATE      PRI   UPTIME  RESTARTS';
        const lines  = all.map(p => {
          const priLabel = Object.keys(PRIORITY).find(k => PRIORITY[k] === p.priority) || p.priority;
          return `  ${String(p.vPid).padEnd(7)}${p.name.padEnd(23)}${p.state.padEnd(11)}${String(priLabel).padEnd(6)}${String(p.uptime + 's').padEnd(8)}${p.restarts}`;
        });
        return { status: 'ok', result: [header, ...lines].join('\n') };
      }

      if (sub === 'status' && args[1]) {
        const vPid = parseInt(args[1], 10);
        const proc = isNaN(vPid) ? getByName(args[1]) : get(vPid);
        if (!proc) return { status: 'error', result: `Process not found: ${args[1]}` };
        return { status: 'ok', result: proc.toStatus() };
      }

      if (sub === 'kill' && args[1]) {
        const vPid = parseInt(args[1], 10);
        if (isNaN(vPid)) return { status: 'error', result: 'Usage: vps kill <vPid>' };
        const r = kill(vPid, args[2] || 'SIGTERM');
        return r.ok ? { status: 'ok', result: `Killed vPid ${vPid}` } : { status: 'error', result: r.error };
      }

      if (sub === 'restart' && args[1]) {
        const vPid = parseInt(args[1], 10);
        if (isNaN(vPid)) return { status: 'error', result: 'Usage: vps restart <vPid>' };
        restart(vPid).then(r => {
          if (kernel) kernel.syscall(0, [`[proc] restart ${vPid}: ${r.ok ? 'ok → ' + r.newVPid : r.error}\n`]);
        }).catch(() => {});
        return { status: 'ok', result: `Restarting vPid ${vPid}…` };
      }

      return { status: 'ok', result: 'Usage: vps <list|status <vPid|name>|kill <vPid>|restart <vPid>>' };
    },
  };

  return {
    name:          'process-model',
    PROCESS_STATES,
    PRIORITY,
    spawn,
    kill,
    wait,
    restart,
    sleep,
    wake,
    get,
    getByName,
    list,
    initProc:      () => _initProc,
    commands,
  };
}

module.exports = { createProcessModel, PROCESS_STATES, PRIORITY };
