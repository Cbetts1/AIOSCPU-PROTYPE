'use strict';
/**
 * procfs.js — AIOS /proc Filesystem v1.0.0
 *
 * Populates and maintains the /proc tree inside the AIOS VFS,
 * mirroring the structure of Linux's procfs.
 *
 * Files generated:
 *   /proc/version         — AIOS kernel version string
 *   /proc/uptime          — kernel uptime in seconds
 *   /proc/meminfo         — host memory info (from hostBridge if available)
 *   /proc/cpuinfo         — virtual CPU info
 *   /proc/loadavg         — synthetic load average
 *   /proc/env             — current AIOS environment (from envLoader)
 *   /proc/mounts          — virtual mount table
 *   /proc/<vPid>/         — per-process directory
 *   /proc/<vPid>/status   — process status file
 *   /proc/<vPid>/cmdline  — process command line
 *   /proc/<vPid>/stat     — numeric stat fields (Linux compat)
 *
 * Updates every UPDATE_INTERVAL_MS via setInterval.
 *
 * Zero external npm dependencies.
 */

const UPDATE_INTERVAL_MS = 5000;  // refresh every 5 seconds

// ---------------------------------------------------------------------------
// procfs factory
// ---------------------------------------------------------------------------
function createProcfs(vfs, kernel, processModel, hostBridge, envLoader) {
  let _interval = null;
  let _running  = false;

  function _ts() {
    return Math.floor(Date.now() / 1000);
  }

  function _safe(fn) {
    try { fn(); } catch (_) {}
  }

  // ---------------------------------------------------------------------------
  // _updateGlobal — refresh /proc top-level files
  // ---------------------------------------------------------------------------
  function _updateGlobal() {
    if (!vfs) return;

    const uptime = kernel ? kernel.uptime() : 0;
    const version = kernel ? kernel.version : '1.0.0';

    _safe(() => vfs.write('/proc/version',
      `AIOS UniKernel v${version} (Node.js ${process.version}) #1 ${new Date().toUTCString()}\n`
    ));

    _safe(() => vfs.write('/proc/uptime',
      `${uptime}.00 ${(uptime * 0.9).toFixed(2)}\n`
    ));

    // meminfo — use hostBridge if available, else synthetic
    if (hostBridge && typeof hostBridge.memInfo === 'function') {
      const m = hostBridge.memInfo();
      if (m && m.ok) {
        _safe(() => vfs.write('/proc/meminfo', [
          `MemTotal:     ${(m.totalMB * 1024).toFixed(0)} kB`,
          `MemFree:      ${((m.totalMB - m.usedMB) * 1024).toFixed(0)} kB`,
          `MemAvailable: ${((m.totalMB - m.usedMB) * 1024).toFixed(0)} kB`,
          `Buffers:      0 kB`,
          `Cached:       0 kB`,
          `SwapTotal:    0 kB`,
          `SwapFree:     0 kB`,
        ].join('\n') + '\n'));
      }
    } else {
      // Synthetic from Node.js process
      const heapUsed  = Math.round(process.memoryUsage().heapUsed  / 1024);
      const heapTotal = Math.round(process.memoryUsage().heapTotal / 1024);
      _safe(() => vfs.write('/proc/meminfo', [
        `MemTotal:     ${heapTotal} kB`,
        `MemFree:      ${heapTotal - heapUsed} kB`,
        `MemAvailable: ${heapTotal - heapUsed} kB`,
        `Buffers:      0 kB`,
        `Cached:       0 kB`,
        `SwapTotal:    0 kB`,
        `SwapFree:     0 kB`,
      ].join('\n') + '\n'));
    }

    // cpuinfo
    _safe(() => vfs.write('/proc/cpuinfo', [
      `processor   : 0`,
      `vendor_id   : AIOSCPU`,
      `model name  : AIOS Virtual CPU v1.0`,
      `cpu MHz     : 1000.000`,
      `cache size  : 64 KB`,
      `flags       : aios-isa fp syscall halt`,
      `bogomips    : 1000.00`,
    ].join('\n') + '\n'));

    // loadavg — synthetic (uptime-based)
    const load = (Math.random() * 0.3).toFixed(2);
    _safe(() => vfs.write('/proc/loadavg',
      `${load} ${(load * 0.9).toFixed(2)} ${(load * 0.8).toFixed(2)} 1/1 ${process.pid}\n`
    ));

    // mounts
    _safe(() => vfs.write('/proc/mounts', [
      'aios-rootfs / vfs rw,relatime 0 0',
      'proc /proc procfs rw,nosuid,nodev,noexec,relatime 0 0',
      'sysfs /sys sysfs rw,nosuid,nodev,noexec,relatime 0 0',
      'tmpfs /tmp tmpfs rw,nosuid,nodev 0 0',
      'tmpfs /run tmpfs rw,nosuid,nodev,mode=755 0 0',
    ].join('\n') + '\n'));

    // env — from envLoader
    if (envLoader && typeof envLoader.get === 'function') {
      const env = envLoader.get();
      const lines = Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
      _safe(() => vfs.write('/proc/env', lines));
    }
  }

  // ---------------------------------------------------------------------------
  // _updateProcesses — refresh per-process /proc/<vPid>/ directories
  // ---------------------------------------------------------------------------
  function _updateProcesses() {
    if (!vfs || !processModel) return;

    const procs = processModel.list();
    const seen  = new Set();

    for (const p of procs) {
      seen.add(String(p.vPid));
      const dir = `/proc/${p.vPid}`;

      _safe(() => vfs.mkdir(dir, { parents: true }));

      // status file
      _safe(() => {
        const proc = processModel.get(p.vPid);
        if (!proc) return;
        vfs.write(`${dir}/status`, proc.toStatus() + '\n');
      });

      // cmdline file
      _safe(() => {
        const proc = processModel.get(p.vPid);
        if (!proc) return;
        vfs.write(`${dir}/cmdline`, proc.toCmdline());
      });

      // stat file — simplified Linux /proc/[pid]/stat format
      const stateChar = { running: 'R', sleeping: 'S', stopped: 'T', zombie: 'Z', crashed: 'X', created: 'I' };
      const st = stateChar[p.state] || 'S';
      _safe(() => vfs.write(`${dir}/stat`,
        `${p.vPid} (${p.name}) ${st} 1 ${p.vPid} ${p.vPid} 0 -1 0 0 0 0 0 ${p.uptime * 100} 0 0 0 ${20 - p.priority} 0 0 0\n`
      ));
    }
  }

  // ---------------------------------------------------------------------------
  // update — full /proc refresh
  // ---------------------------------------------------------------------------
  function update() {
    _updateGlobal();
    _updateProcesses();
  }

  // ---------------------------------------------------------------------------
  // start / stop
  // ---------------------------------------------------------------------------
  function start() {
    if (_running) return;
    _running  = true;
    update();   // initial population
    _interval = setInterval(update, UPDATE_INTERVAL_MS);
    if (kernel) kernel.bus.emit('procfs:started', {});
  }

  function stop() {
    _running = false;
    if (_interval) {
      clearInterval(_interval);
      _interval = null;
    }
    if (kernel) kernel.bus.emit('procfs:stopped', {});
  }

  // ---------------------------------------------------------------------------
  // Router commands
  // ---------------------------------------------------------------------------
  const commands = {
    procfs: (args) => {
      const sub = (args[0] || 'status').toLowerCase();

      if (sub === 'update') {
        update();
        return { status: 'ok', result: '/proc updated.' };
      }

      if (sub === 'status') {
        return {
          status: 'ok',
          result: `ProcFS  running=${_running}  interval=${UPDATE_INTERVAL_MS}ms`,
        };
      }

      if (sub === 'cat' && args[1]) {
        if (!vfs) return { status: 'error', result: 'VFS not available' };
        const r = vfs.read(args[1]);
        return r.ok
          ? { status: 'ok', result: r.content }
          : { status: 'error', result: r.error || 'Not found' };
      }

      return { status: 'ok', result: 'Usage: procfs <status|update|cat <path>>' };
    },
  };

  return {
    name:    'procfs',
    version: '1.0.0',
    update,
    start,
    stop,
    isRunning: () => _running,
    commands,
  };
}

module.exports = { createProcfs };
