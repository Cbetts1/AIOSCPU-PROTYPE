'use strict';
/**
 * scheduler.js — AIOS Task Scheduler v2.0.0
 *
 * Cron-style and interval task scheduler built into AIOS.
 * Jobs are stored in /etc/cron/ in the AIOS VFS for persistence.
 *
 * Cron expression format: "min hour day month weekday"
 *   *  = every
 *   5  = exact value
 *   star/5 = every 5
 *   1-5 = range
 *
 * Zero external npm dependencies.
 */

// ---------------------------------------------------------------------------
// Cron expression parser
// ---------------------------------------------------------------------------
function _matchField(field, value) {
  if (field === '*') return true;
  if (field.startsWith('*/')) {
    const step = parseInt(field.slice(2), 10);
    return value % step === 0;
  }
  if (field.includes('-')) {
    const [lo, hi] = field.split('-').map(Number);
    return value >= lo && value <= hi;
  }
  if (field.includes(',')) {
    return field.split(',').some(f => _matchField(f.trim(), value));
  }
  return parseInt(field, 10) === value;
}

function _cronMatches(expr, date) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return false;
  const [min, hour, day, month, weekday] = parts;
  return (
    _matchField(min,     date.getMinutes())  &&
    _matchField(hour,    date.getHours())    &&
    _matchField(day,     date.getDate())     &&
    _matchField(month,   date.getMonth()+1)  &&
    _matchField(weekday, date.getDay())
  );
}

// ---------------------------------------------------------------------------
// Scheduler factory
// ---------------------------------------------------------------------------
function createScheduler(kernel, filesystem, shell) {
  const _jobs    = new Map();   // name → job descriptor
  let   _ticker  = null;        // master 1-minute interval
  let   _running = false;

  function _emit(event, data) {
    if (kernel) kernel.bus.emit(event, data);
  }

  function _log(msg) {
    if (filesystem) filesystem.append('/var/log/cron.log', '[' + new Date().toISOString() + '] ' + msg + '\n');
  }

  // ---------------------------------------------------------------------------
  // addJob — register a job
  // type: 'cron'  → spec is "min hour day month weekday"
  //       'interval' → spec is milliseconds (number or string)
  //       'once'     → spec is Date or timestamp
  // ---------------------------------------------------------------------------
  function addJob(name, type, spec, handler, opts) {
    if (!name || typeof name !== 'string') throw new TypeError('Job name required');
    if (typeof handler !== 'function' && typeof handler !== 'string') {
      throw new TypeError('handler must be a function or AIOS shell command string');
    }

    const job = {
      name,
      type,
      spec,
      handler,
      opts:      opts || {},
      enabled:   true,
      lastRun:   null,
      nextRun:   null,
      runCount:  0,
      lastError: null,
      _interval: null,
    };

    // For interval jobs, start immediately
    if (type === 'interval') {
      const ms = typeof spec === 'number' ? spec : parseInt(spec, 10);
      job._interval = setInterval(() => _runJob(job), ms);
      if (typeof job._interval.unref === 'function') job._interval.unref();
      job.nextRun = new Date(Date.now() + ms).toISOString();
    }

    // For once jobs
    if (type === 'once') {
      const when = spec instanceof Date ? spec : new Date(spec);
      const delay = when.getTime() - Date.now();
      if (delay > 0) {
        job._interval = setTimeout(() => {
          _runJob(job);
          _jobs.delete(name);
        }, delay);
        job.nextRun = when.toISOString();
      }
    }

    _jobs.set(name, job);

    // Persist to VFS
    _persistJob(job);
    _emit('scheduler:job-added', { name, type, spec });
    return job;
  }

  // ---------------------------------------------------------------------------
  // _runJob — execute a job
  // ---------------------------------------------------------------------------
  async function _runJob(job) {
    if (!job.enabled) return;
    job.lastRun  = new Date().toISOString();
    job.runCount++;
    _log('Running job: ' + job.name);
    _emit('scheduler:job-start', { name: job.name });

    try {
      if (typeof job.handler === 'function') {
        await job.handler();
      } else if (typeof job.handler === 'string' && shell) {
        // Shell command string — run through AIOS shell
        await shell.runScript(job.handler, []);
      }
      job.lastError = null;
      _log('Job completed: ' + job.name);
      _emit('scheduler:job-done', { name: job.name, runCount: job.runCount });
    } catch (e) {
      job.lastError = e.message;
      _log('Job FAILED: ' + job.name + ' — ' + e.message);
      _emit('scheduler:job-error', { name: job.name, error: e.message });
    }
  }

  // ---------------------------------------------------------------------------
  // _tick — called every minute, runs matching cron jobs
  // ---------------------------------------------------------------------------
  function _tick() {
    const now = new Date();
    for (const [, job] of _jobs) {
      if (!job.enabled) continue;
      if (job.type === 'cron' && _cronMatches(job.spec, now)) {
        _runJob(job);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // _persistJob — save job definition to VFS
  // ---------------------------------------------------------------------------
  function _persistJob(job) {
    if (!filesystem) return;
    filesystem.mkdir('/etc/cron', { parents: true });
    const data = JSON.stringify({
      name: job.name, type: job.type, spec: job.spec,
      handler: typeof job.handler === 'string' ? job.handler : '[function]',
      enabled: job.enabled,
    }, null, 2);
    filesystem.write('/etc/cron/' + job.name + '.json', data);
  }

  // ---------------------------------------------------------------------------
  // start / stop the master ticker
  // ---------------------------------------------------------------------------
  function start() {
    if (_running) return;
    _running = true;
    // Align to next minute
    const now   = Date.now();
    const delay = 60000 - (now % 60000);
    const _startTimer = setTimeout(() => {
      _tick();
      _ticker = setInterval(_tick, 60000);
      if (typeof _ticker.unref === 'function') _ticker.unref();
    }, delay);
    if (typeof _startTimer.unref === 'function') _startTimer.unref();
    _log('Scheduler started');
    _emit('scheduler:started', {});
  }

  function stop() {
    _running = false;
    if (_ticker) { clearInterval(_ticker); _ticker = null; }
    for (const [, job] of _jobs) {
      if (job._interval) {
        clearInterval(job._interval);
        clearTimeout(job._interval);
        job._interval = null;
      }
    }
    _log('Scheduler stopped');
    _emit('scheduler:stopped', {});
  }

  // ---------------------------------------------------------------------------
  // removeJob, enableJob, disableJob, runNow
  // ---------------------------------------------------------------------------
  function removeJob(name) {
    const job = _jobs.get(name);
    if (!job) return { ok: false, error: 'Job not found: ' + name };
    if (job._interval) { clearInterval(job._interval); clearTimeout(job._interval); }
    _jobs.delete(name);
    if (filesystem) {
      try { filesystem.rm('/etc/cron/' + name + '.json'); } catch(_) {}
    }
    _emit('scheduler:job-removed', { name });
    return { ok: true };
  }

  function enableJob(name)  {
    const job = _jobs.get(name);
    if (!job) return { ok: false, error: 'Job not found' };
    job.enabled = true; _persistJob(job);
    return { ok: true };
  }

  function disableJob(name) {
    const job = _jobs.get(name);
    if (!job) return { ok: false, error: 'Job not found' };
    job.enabled = false; _persistJob(job);
    return { ok: true };
  }

  async function runNow(name) {
    const job = _jobs.get(name);
    if (!job) return { ok: false, error: 'Job not found' };
    await _runJob(job);
    return { ok: true };
  }

  function listJobs() {
    return Array.from(_jobs.values()).map(j => ({
      name:      j.name,
      type:      j.type,
      spec:      j.spec,
      enabled:   j.enabled,
      lastRun:   j.lastRun,
      runCount:  j.runCount,
      lastError: j.lastError,
    }));
  }

  // ---------------------------------------------------------------------------
  // Router command module interface
  // ---------------------------------------------------------------------------
  const commands = {
    cron: async (args) => {
      const sub = (args[0] || '').toLowerCase();

      if (!sub || sub === 'list') {
        const jobs = listJobs();
        if (!jobs.length) return { status: 'ok', result: 'No scheduled jobs.' };
        const out = jobs.map(j =>
          '  ' + (j.enabled ? '●' : '○') + '  ' +
          j.name.padEnd(20) + j.type.padEnd(10) +
          'runs:' + String(j.runCount).padEnd(6) +
          (j.lastError ? ' [ERR]' : '')
        );
        return { status: 'ok', result: 'Scheduled jobs:\n' + out.join('\n') };
      }

      if (sub === 'add') {
        // cron add <name> <type> <spec> <handler>
        // e.g.: cron add backup interval 3600000 "sh /etc/scripts/backup.sh"
        const [, name, type, spec, ...handlerParts] = args;
        const handler = handlerParts.join(' ');
        if (!name || !type || !spec || !handler) {
          return { status: 'error', result: 'Usage: cron add <name> <cron|interval|once> <spec> <handler>' };
        }
        addJob(name, type, spec, handler);
        return { status: 'ok', result: 'Job "'+ name +'" added (' + type + ')' };
      }

      if (sub === 'remove' || sub === 'rm') {
        const r = removeJob(args[1]);
        return r.ok ? { status: 'ok', result: 'Job removed.' } : { status: 'error', result: r.error };
      }

      if (sub === 'run') {
        const r = await runNow(args[1]);
        return r.ok ? { status: 'ok', result: 'Job ran.' } : { status: 'error', result: r.error };
      }

      if (sub === 'enable')  {
        const r = enableJob(args[1]);
        return r.ok ? { status: 'ok', result: 'Enabled.' } : { status: 'error', result: r.error };
      }
      if (sub === 'disable') {
        const r = disableJob(args[1]);
        return r.ok ? { status: 'ok', result: 'Disabled.' } : { status: 'error', result: r.error };
      }

      return { status: 'error', result: 'Usage: cron <list|add|remove|run|enable|disable>' };
    },
  };

  return {
    name:       'scheduler',
    version:    '2.0.0',
    addJob,
    removeJob,
    enableJob,
    disableJob,
    runNow,
    listJobs,
    start,
    stop,
    commands,
  };
}

module.exports = { createScheduler };
