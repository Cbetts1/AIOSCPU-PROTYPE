'use strict';
/**
 * scheduler.js — AIOS Virtual Process Scheduler v1.0.0
 *
 * Implements a tick-based, priority-aware round-robin scheduler
 * for AIOS virtual processes.
 *
 * Priority levels (lower = higher priority):
 *   HIGH   (0) — system processes, init, kernel services
 *   NORMAL (1) — standard user processes
 *   LOW    (2) — background tasks
 *
 * Each tick, the scheduler:
 *   1. Walks the run queue in priority order
 *   2. Calls each process's onTick handler (if registered)
 *   3. Updates per-process CPU time counter
 *   4. Promotes sleeping processes if their sleep deadline has passed
 *   5. Reaps zombie processes older than ZOMBIE_REAP_AGE
 *
 * This scheduler is intentionally cooperative (no preemption) since
 * all AIOS processes are Node.js functions running in a single thread.
 *
 * Zero external npm dependencies.
 */

const { PRIORITY, PROCESS_STATES } = require('./process-model.js');

const TICK_MS         = 1000;      // 1-second scheduler tick
const ZOMBIE_REAP_AGE = 30000;     // Reap zombies after 30 s

// ---------------------------------------------------------------------------
// Scheduler factory
// ---------------------------------------------------------------------------
function createScheduler(processModel, kernel, vfs) {
  const _tickHandlers = new Map();  // vPid → fn(proc)
  const _sleepQueue   = new Map();  // vPid → wakeAt (ms timestamp)
  const _cpuTime      = new Map();  // vPid → total ticks (integer)
  let   _ticker       = null;
  let   _running      = false;
  let   _totalTicks   = 0;

  function _emit(event, data) {
    if (kernel) kernel.bus.emit(event, data);
  }

  function _log(msg) {
    // Route to VFS log to keep boot output clean
    if (vfs) {
      try { vfs.append('/var/log/kernel.log', `[sched] ${msg}\n`); } catch (_) {}
    }
  }

  // ---------------------------------------------------------------------------
  // register — associate an onTick handler with a vPid
  // ---------------------------------------------------------------------------
  function register(vPid, onTick) {
    if (typeof onTick !== 'function') throw new TypeError('onTick must be a function');
    _tickHandlers.set(vPid, onTick);
    _cpuTime.set(vPid, 0);
  }

  // ---------------------------------------------------------------------------
  // unregister — remove tick handler when process exits
  // ---------------------------------------------------------------------------
  function unregister(vPid) {
    _tickHandlers.delete(vPid);
    _sleepQueue.delete(vPid);
  }

  // ---------------------------------------------------------------------------
  // sleepFor — put a virtual process to sleep for N milliseconds
  // ---------------------------------------------------------------------------
  function sleepFor(vPid, ms) {
    if (processModel) processModel.sleep(vPid);
    _sleepQueue.set(vPid, Date.now() + ms);
  }

  // ---------------------------------------------------------------------------
  // _tick — one scheduler cycle
  // ---------------------------------------------------------------------------
  function _tick() {
    _totalTicks++;
    const now = Date.now();

    if (!processModel) return;

    const procs = processModel.list();

    // 1. Wake sleeping processes whose deadline has passed
    for (const [vPid, wakeAt] of _sleepQueue) {
      if (now >= wakeAt) {
        _sleepQueue.delete(vPid);
        processModel.wake(vPid);
      }
    }

    // 2. Build priority-sorted run queue (RUNNING processes only)
    const runQueue = procs
      .filter(p => p.state === PROCESS_STATES.RUNNING)
      .sort((a, b) => a.priority - b.priority);

    // 3. Dispatch tick to each runnable process
    for (const p of runQueue) {
      const handler = _tickHandlers.get(p.vPid);
      if (handler) {
        try {
          handler(p, _totalTicks);
          _cpuTime.set(p.vPid, (_cpuTime.get(p.vPid) || 0) + 1);
        } catch (e) {
          _log(`Tick error in vPid ${p.vPid} (${p.name}): ${e.message}`);
        }
      }
    }

    // 4. Reap old zombie processes
    const zombies = procs.filter(p =>
      p.state === PROCESS_STATES.ZOMBIE || p.state === PROCESS_STATES.STOPPED
    );
    for (const z of zombies) {
      const proc = processModel.get(z.vPid);
      if (proc && proc.stopTime && (now - proc.stopTime) > ZOMBIE_REAP_AGE) {
        unregister(z.vPid);
        _emit('scheduler:reaped', { vPid: z.vPid, name: z.name });
      }
    }

    _emit('scheduler:tick', { tick: _totalTicks, runnable: runQueue.length });
  }

  // ---------------------------------------------------------------------------
  // start / stop
  // ---------------------------------------------------------------------------
  function start() {
    if (_running) return;
    _running = true;
    _ticker  = setInterval(_tick, TICK_MS);
    _log('Scheduler started');
    _emit('scheduler:started', { tickMs: TICK_MS });
  }

  function stop() {
    _running = false;
    if (_ticker) {
      clearInterval(_ticker);
      _ticker = null;
    }
    _log('Scheduler stopped');
    _emit('scheduler:stopped', {});
  }

  // ---------------------------------------------------------------------------
  // stats — return scheduler statistics
  // ---------------------------------------------------------------------------
  function stats() {
    const cpuStats = [];
    for (const [vPid, ticks] of _cpuTime) {
      const proc = processModel ? processModel.get(vPid) : null;
      cpuStats.push({
        vPid,
        name:     proc ? proc.name : '?',
        ticks,
        cpuPct:   _totalTicks > 0 ? Math.round((ticks / _totalTicks) * 100) : 0,
      });
    }
    return {
      running:    _running,
      totalTicks: _totalTicks,
      tickMs:     TICK_MS,
      processes:  cpuStats.sort((a, b) => b.ticks - a.ticks),
    };
  }

  // ---------------------------------------------------------------------------
  // Router commands
  // ---------------------------------------------------------------------------
  const commands = {
    sched: (args) => {
      const sub = (args[0] || 'stats').toLowerCase();

      if (sub === 'stats') {
        const s = stats();
        const lines = [
          `Scheduler  running=${s.running}  ticks=${s.totalTicks}  interval=${s.tickMs}ms`,
          '',
          '  vPID   NAME                   TICKS     CPU%',
          ...s.processes.map(p =>
            `  ${String(p.vPid).padEnd(7)}${p.name.padEnd(23)}${String(p.ticks).padEnd(10)}${p.cpuPct}%`
          ),
        ];
        return { status: 'ok', result: lines.join('\n') };
      }

      if (sub === 'start') { start(); return { status: 'ok', result: 'Scheduler started.' }; }
      if (sub === 'stop')  { stop();  return { status: 'ok', result: 'Scheduler stopped.' }; }

      if (sub === 'sleep' && args[1] && args[2]) {
        const vPid = parseInt(args[1], 10);
        const ms   = parseInt(args[2], 10);
        if (isNaN(vPid) || isNaN(ms)) return { status: 'error', result: 'Usage: sched sleep <vPid> <ms>' };
        sleepFor(vPid, ms);
        return { status: 'ok', result: `vPid ${vPid} sleeping for ${ms}ms` };
      }

      return { status: 'ok', result: 'Usage: sched <stats|start|stop|sleep <vPid> <ms>>' };
    },
  };

  return {
    name:       'scheduler',
    version:    '1.0.0',
    register,
    unregister,
    sleepFor,
    start,
    stop,
    stats,
    totalTicks: () => _totalTicks,
    isRunning:  () => _running,
    commands,
  };
}

module.exports = { createScheduler };
