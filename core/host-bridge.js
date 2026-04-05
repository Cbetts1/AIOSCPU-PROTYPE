'use strict';
/**
 * host-bridge.js — AIOS Host Bridge / Real OS Mirror v2.0.0
 *
 * Provides a live bridge between AIOS Lite and the real host operating system.
 * Works on: Termux (Android), Linux, macOS, WSL.
 *
 * Capabilities:
 *   - Execute real shell commands via child_process (spawnSync / execFileSync)
 *   - Read / write real host filesystem paths
 *   - Detect platform (Termux, Android, Linux, macOS, Windows/WSL)
 *   - Detect root availability (su / sudo / id -u == 0)
 *   - Bridge real process list (/proc or ps)
 *   - Real disk usage (df), memory (free / /proc/meminfo), network (ip / ifconfig)
 *   - Termux API hooks (battery, SMS, storage, notifications) when termux-api installed
 *
 * Zero external npm dependencies. Uses only Node.js built-ins.
 */

const cp        = require('child_process');
const nodefs    = require('fs');
const nodepath  = require('path');
const nodeos    = require('os');

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Run a command safely using spawnSync with an explicit args array.
 * Returns { ok, stdout, stderr, code }.
 */
function _run(cmd, args = [], opts = {}) {
  try {
    const result = cp.spawnSync(cmd, args, {
      encoding: 'utf8',
      timeout:  opts.timeout || 10000,
      env:      opts.env || process.env,
      cwd:      opts.cwd || undefined,
    });
    if (result.error) {
      return { ok: false, stdout: '', stderr: result.error.message, code: -1 };
    }
    return {
      ok:     result.status === 0,
      stdout: (result.stdout || '').trim(),
      stderr: (result.stderr || '').trim(),
      code:   result.status || 0,
    };
  } catch (e) {
    return { ok: false, stdout: '', stderr: e.message, code: -1 };
  }
}

/** Check if an executable exists on PATH. */
function _which(bin) {
  const r = _run('which', [bin]);
  return r.ok && r.stdout.length > 0;
}

// ---------------------------------------------------------------------------
// Platform detection
// ---------------------------------------------------------------------------
function _detectPlatform() {
  const p = process.platform;

  // Termux on Android: $PREFIX is set to /data/data/com.termux/files/usr
  const isTermux = !!(
    process.env.PREFIX && process.env.PREFIX.includes('com.termux')
  ) || nodefs.existsSync('/data/data/com.termux');

  const isAndroid = isTermux || nodefs.existsSync('/system/build.prop');
  const isWSL     = !!(
    process.env.WSL_DISTRO_NAME ||
    (p === 'linux' && nodefs.existsSync('/proc/version') &&
      nodefs.readFileSync('/proc/version', 'utf8').toLowerCase().includes('microsoft'))
  );
  const isMac     = p === 'darwin';
  const isLinux   = p === 'linux' && !isAndroid;
  const isWindows = p === 'win32';

  let name = 'Unknown';
  if (isTermux)   name = 'Termux/Android';
  else if (isAndroid) name = 'Android';
  else if (isWSL) name = 'WSL/Linux';
  else if (isMac) name = 'macOS';
  else if (isLinux) name = 'Linux';
  else if (isWindows) name = 'Windows';

  return { name, isTermux, isAndroid, isLinux, isMac, isWindows, isWSL, node: process.platform };
}

// ---------------------------------------------------------------------------
// Root detection
// ---------------------------------------------------------------------------
function _detectRoot() {
  // Quick check: process UID (works on Linux/macOS)
  if (typeof process.getuid === 'function' && process.getuid() === 0) {
    return { available: true, method: 'uid=0', level: 'real-root' };
  }

  // Try `id -u` — works on Termux without root
  const idResult = _run('id', ['-u']);
  if (idResult.ok && idResult.stdout === '0') {
    return { available: true, method: 'id-u=0', level: 'real-root' };
  }

  // Try `su -c id` — this is how you test for root on Android
  const suTest = _run('su', ['-c', 'id -u'], { timeout: 3000 });
  if (suTest.ok && suTest.stdout.includes('0')) {
    return { available: true, method: 'su', level: 'su-root' };
  }

  // Try `sudo -n true` — passwordless sudo
  const sudoTest = _run('sudo', ['-n', 'true'], { timeout: 3000 });
  if (sudoTest.ok) {
    return { available: true, method: 'sudo-n', level: 'sudo-root' };
  }

  return { available: false, method: 'none', level: 'user' };
}

// ---------------------------------------------------------------------------
// Host Bridge factory
// ---------------------------------------------------------------------------
function createHostBridge(kernel) {
  const platform   = _detectPlatform();
  const rootInfo   = _detectRoot();
  const termuxAPI  = platform.isTermux && _which('termux-battery-status');

  // Register in kernel event bus
  if (kernel) {
    kernel.bus.emit('host-bridge:ready', { platform: platform.name, root: rootInfo.available });
  }

  // ---------------------------------------------------------------------------
  // exec — run a real host shell command
  // ---------------------------------------------------------------------------
  function exec(command, args = [], opts = {}) {
    if (typeof command !== 'string' || command.trim() === '') {
      return { ok: false, stdout: '', stderr: 'No command provided', code: -1 };
    }
    const result = _run(command, args, opts);
    if (kernel) {
      kernel.bus.emit('host-bridge:exec', { command, args, ok: result.ok, code: result.code });
    }
    return result;
  }

  /**
   * execShell — run a full shell command string through sh -c
   * Use only for passthrough commands the user explicitly typed.
   */
  function execShell(commandString, opts = {}) {
    if (typeof commandString !== 'string' || commandString.trim() === '') {
      return { ok: false, stdout: '', stderr: 'No command provided', code: -1 };
    }
    const shell = platform.isWindows ? 'cmd.exe' : '/bin/sh';
    const flag  = platform.isWindows ? '/c' : '-c';
    const result = _run(shell, [flag, commandString], opts);
    if (kernel) {
      kernel.bus.emit('host-bridge:shell', { command: commandString, ok: result.ok });
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // Real filesystem access (host paths)
  // ---------------------------------------------------------------------------
  const hostfs = {
    read(filePath) {
      try {
        const content = nodefs.readFileSync(filePath, 'utf8');
        return { ok: true, content };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
    write(filePath, content) {
      try {
        nodefs.mkdirSync(nodepath.dirname(filePath), { recursive: true });
        nodefs.writeFileSync(filePath, content, 'utf8');
        return { ok: true };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
    ls(dirPath) {
      try {
        const entries = nodefs.readdirSync(dirPath, { withFileTypes: true });
        return {
          ok: true,
          entries: entries.map(e => ({
            name: e.name,
            type: e.isDirectory() ? 'dir' : e.isSymbolicLink() ? 'link' : 'file',
          })),
        };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
    exists(p) {
      return nodefs.existsSync(p);
    },
    stat(filePath) {
      try {
        const s = nodefs.statSync(filePath);
        return {
          ok: true,
          size: s.size,
          isDir: s.isDirectory(),
          isFile: s.isFile(),
          mtime: s.mtime.toISOString(),
          mode: s.mode.toString(8),
        };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },
  };

  // ---------------------------------------------------------------------------
  // Real process list
  // ---------------------------------------------------------------------------
  function processes() {
    // Try /proc first (Linux/Android) — no subprocess needed
    if (nodefs.existsSync('/proc')) {
      try {
        const pids = nodefs.readdirSync('/proc').filter(d => /^\d+$/.test(d));
        const procs = pids.map(pid => {
          try {
            const status = nodefs.readFileSync(`/proc/${pid}/status`, 'utf8');
            const name   = (status.match(/^Name:\s*(.+)$/m) || [])[1] || '?';
            const state  = (status.match(/^State:\s*(\S+)/m) || [])[1] || '?';
            return { pid: parseInt(pid, 10), name, state };
          } catch (_) {
            return null;
          }
        }).filter(Boolean);
        return { ok: true, processes: procs };
      } catch (e) {
        // fall through to ps
      }
    }
    // Fallback: ps
    const r = _run('ps', ['-eo', 'pid,comm,stat', '--no-headers']);
    if (!r.ok) return { ok: false, error: r.stderr };
    const procs = r.stdout.split('\n').filter(Boolean).map(line => {
      const parts = line.trim().split(/\s+/);
      return { pid: parseInt(parts[0], 10), name: parts[1] || '?', state: parts[2] || '?' };
    });
    return { ok: true, processes: procs };
  }

  // ---------------------------------------------------------------------------
  // Disk usage
  // ---------------------------------------------------------------------------
  function diskUsage(path) {
    const target = path || (platform.isTermux ? process.env.HOME : '/');
    // Try human-readable first; fall back to plain df for environments
    // (e.g. Android /bin/sh wrappers) that reject the -h flag.
    let r = _run('df', ['-h', target]);
    if (!r.ok) r = _run('df', [target]);
    if (!r.ok) return { ok: false, error: r.stderr };
    return { ok: true, output: r.stdout };
  }

  // ---------------------------------------------------------------------------
  // Memory info
  // ---------------------------------------------------------------------------
  function memInfo() {
    // Node.js built-in — always available
    const total = nodeos.totalmem();
    const free  = nodeos.freemem();
    const used  = total - free;

    // Try to get more detail from /proc/meminfo (Linux/Android)
    let detail = null;
    if (nodefs.existsSync('/proc/meminfo')) {
      try {
        detail = nodefs.readFileSync('/proc/meminfo', 'utf8').split('\n').slice(0, 8).join('\n');
      } catch (_) {}
    }

    return {
      ok: true,
      totalMB: Math.round(total / 1024 / 1024),
      freeMB:  Math.round(free  / 1024 / 1024),
      usedMB:  Math.round(used  / 1024 / 1024),
      detail,
    };
  }

  // ---------------------------------------------------------------------------
  // Network interfaces
  // ---------------------------------------------------------------------------
  function networkInfo() {
    // Node.js built-in networkInterfaces()
    const ifaces = nodeos.networkInterfaces();
    const lines = [];
    for (const [name, addrs] of Object.entries(ifaces)) {
      for (const addr of addrs) {
        lines.push(`${name.padEnd(12)} ${addr.family.padEnd(6)} ${addr.address}`);
      }
    }
    return { ok: true, output: lines.join('\n') || 'No interfaces found' };
  }

  // ---------------------------------------------------------------------------
  // CPU / system info
  // ---------------------------------------------------------------------------
  function systemInfo() {
    const cpus = nodeos.cpus();
    return {
      ok: true,
      hostname: nodeos.hostname(),
      arch:     nodeos.arch(),
      cpuModel: cpus.length ? cpus[0].model : 'unknown',
      cpuCores: cpus.length,
      uptime:   nodeos.uptime(),
      platform: platform.name,
      nodeVer:  process.version,
      root:     rootInfo,
    };
  }

  // ---------------------------------------------------------------------------
  // Root command execution (via su or sudo)
  // ---------------------------------------------------------------------------
  function execAsRoot(commandString) {
    if (!rootInfo.available) {
      return { ok: false, error: 'Root not available on this device' };
    }
    if (rootInfo.method === 'uid=0' || rootInfo.method === 'id-u=0') {
      // Already root
      return execShell(commandString);
    }
    if (rootInfo.method === 'su') {
      return _run('su', ['-c', commandString], { timeout: 15000 });
    }
    if (rootInfo.method === 'sudo-n') {
      return _run('sudo', ['-n', '--', '/bin/sh', '-c', commandString], { timeout: 15000 });
    }
    return { ok: false, error: 'No root method available' };
  }

  // ---------------------------------------------------------------------------
  // Termux API integration
  // ---------------------------------------------------------------------------
  const termux = {
    available: termuxAPI,

    battery() {
      if (!termuxAPI) return { ok: false, error: 'termux-api not installed' };
      const r = _run('termux-battery-status', []);
      return r.ok ? { ok: true, data: r.stdout } : { ok: false, error: r.stderr };
    },

    clipboard(text) {
      if (!termuxAPI) return { ok: false, error: 'termux-api not installed' };
      if (text !== undefined) {
        const r = _run('termux-clipboard-set', [text]);
        return { ok: r.ok, error: r.stderr || null };
      }
      const r = _run('termux-clipboard-get', []);
      return r.ok ? { ok: true, data: r.stdout } : { ok: false, error: r.stderr };
    },

    vibrate(durationMs) {
      if (!termuxAPI) return { ok: false, error: 'termux-api not installed' };
      const r = _run('termux-vibrate', ['-d', String(durationMs || 300)]);
      return { ok: r.ok };
    },

    notify(title, content) {
      if (!termuxAPI) return { ok: false, error: 'termux-api not installed' };
      const r = _run('termux-notification', ['--title', title, '--content', content]);
      return { ok: r.ok, error: r.stderr || null };
    },

    wifiInfo() {
      if (!termuxAPI) return { ok: false, error: 'termux-api not installed' };
      const r = _run('termux-wifi-connectioninfo', []);
      return r.ok ? { ok: true, data: r.stdout } : { ok: false, error: r.stderr };
    },
  };

  // ---------------------------------------------------------------------------
  // Package manager passthrough (pkg / apt / brew / apt-get)
  // ---------------------------------------------------------------------------
  function pkg(args) {
    let mgr;
    if (platform.isTermux && _which('pkg'))         mgr = 'pkg';
    else if (_which('apt'))                          mgr = 'apt';
    else if (_which('brew'))                         mgr = 'brew';
    else if (_which('apt-get'))                      mgr = 'apt-get';
    else return { ok: false, error: 'No supported package manager found' };

    const r = _run(mgr, args, { timeout: 60000 });
    return { ok: r.ok, output: r.stdout + (r.stderr ? '\n' + r.stderr : ''), code: r.code };
  }

  // ---------------------------------------------------------------------------
  // Router command module interface
  // ---------------------------------------------------------------------------
  const commands = {
    shell: (args) => {
      if (!args.length) return { status: 'error', result: 'Usage: shell <command> [args...]' };
      const r = execShell(args.join(' '));
      const out = [r.stdout, r.stderr].filter(Boolean).join('\n');
      return { status: r.ok ? 'ok' : 'error', result: out || `(exit ${r.code})` };
    },

    df: (_args) => {
      const r = diskUsage();
      return { status: r.ok ? 'ok' : 'error', result: r.ok ? r.output : r.error };
    },

    free: (_args) => {
      const m = memInfo();
      return {
        status: 'ok',
        result: [
          `Total : ${m.totalMB} MB`,
          `Used  : ${m.usedMB} MB`,
          `Free  : ${m.freeMB} MB`,
          m.detail ? '\n/proc/meminfo (first 8 lines):\n' + m.detail : '',
        ].filter(Boolean).join('\n'),
      };
    },

    ifconfig: (_args) => {
      const r = networkInfo();
      return { status: 'ok', result: r.output };
    },

    sysinfo: (_args) => {
      const s = systemInfo();
      return {
        status: 'ok',
        result: [
          `Hostname : ${s.hostname}`,
          `Platform : ${s.platform}`,
          `Arch     : ${s.arch}`,
          `CPU      : ${s.cpuModel} (${s.cpuCores} cores)`,
          `Uptime   : ${Math.round(s.uptime)}s`,
          `Node.js  : ${s.nodeVer}`,
          `Root     : ${s.root.available ? s.root.level + ' via ' + s.root.method : 'no'}`,
        ].join('\n'),
      };
    },

    pkg: async (args) => {
      if (!args.length) return { status: 'error', result: 'Usage: pkg <install|remove|list|update> [package]' };
      const r = pkg(args);
      return { status: r.ok ? 'ok' : 'error', result: r.output || r.error || `exit ${r.code}` };
    },

    termux: (args) => {
      const sub = args[0];
      if (!sub) return { status: 'ok', result: `termux-api available: ${termux.available}` };
      if (sub === 'battery') {
        const r = termux.battery();
        return { status: r.ok ? 'ok' : 'error', result: r.ok ? r.data : r.error };
      }
      if (sub === 'wifi') {
        const r = termux.wifiInfo();
        return { status: r.ok ? 'ok' : 'error', result: r.ok ? r.data : r.error };
      }
      if (sub === 'notify') {
        const title   = args[1] || 'AIOS';
        const content = args.slice(2).join(' ') || '';
        const r = termux.notify(title, content);
        return { status: r.ok ? 'ok' : 'error', result: r.ok ? 'Notification sent.' : r.error };
      }
      if (sub === 'vibrate') {
        const r = termux.vibrate(parseInt(args[1], 10) || 300);
        return { status: r.ok ? 'ok' : 'error', result: r.ok ? 'Vibrated.' : 'Failed.' };
      }
      return { status: 'error', result: 'Usage: termux <battery|wifi|notify|vibrate>' };
    },
  };

  return {
    name:        'host-bridge',
    version:     '2.0.0',
    platform,
    root:        rootInfo,
    termux,
    exec,
    execShell,
    execAsRoot,
    hostfs,
    processes,
    diskUsage,
    memInfo,
    networkInfo,
    systemInfo,
    pkg,
    commands,
  };
}

module.exports = { createHostBridge };
