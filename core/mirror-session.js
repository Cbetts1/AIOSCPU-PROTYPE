'use strict';
/**
 * mirror-session.js — AIOS OS Mirror Manager v2.0.0
 *
 * Bridges the host OS into AIOS Lite's namespace.
 * Creates named "mirror sessions" that map real host resources into AIOS.
 *
 * Mirror types:
 *   root     — mounts host filesystem root into AIOS VFS at /host
 *   proc     — syncs real process list into AIOS process table
 *   pkg      — exposes host package manager (pkg/apt/brew) through AIOS
 *   storage  — maps Android /storage/emulated/0 into AIOS at /sdcard
 *   home     — maps real $HOME into AIOS at /host-home
 *
 * Each mirror can be:
 *   - Mounted on demand
 *   - Polled on a tick interval
 *   - Unmounted cleanly
 *
 * Zero external npm dependencies.
 */

const nodefs   = require('fs');
const nodepath = require('path');

// ---------------------------------------------------------------------------
// Mirror types definition
// ---------------------------------------------------------------------------
const MIRROR_TYPES = Object.freeze({
  root:    { description: 'Host filesystem root → /host',       aiosMount: '/host'       },
  proc:    { description: 'Real process list → AIOS proc table', aiosMount: '/proc-live'  },
  storage: { description: 'Android storage → /sdcard',           aiosMount: '/sdcard'     },
  home:    { description: 'Real $HOME → /host-home',             aiosMount: '/host-home'  },
  pkg:     { description: 'Host package manager passthrough',    aiosMount: null          },
});

// ---------------------------------------------------------------------------
// MirrorSession factory
// ---------------------------------------------------------------------------
function createMirrorSession(kernel, aiosFs, hostBridge) {
  // Active mirrors: name → session descriptor
  const _mirrors = new Map();

  function _emit(event, data) {
    if (kernel) kernel.bus.emit(event, data);
  }

  // ---------------------------------------------------------------------------
  // _populateFsNode — recursively list a real dir and mirror into AIOS VFS
  // Limited to MAX_DEPTH levels to avoid explosion on large filesystems.
  // ---------------------------------------------------------------------------
  function _populateFsNode(realPath, aiosPath, maxDepth, depth) {
    if (depth > maxDepth) return;
    if (!hostBridge) return;

    const stat = hostBridge.hostfs.stat(realPath);
    if (!stat.ok) return;

    if (stat.isDir) {
      aiosFs.mkdir(aiosPath, { parents: true });
      const ls = hostBridge.hostfs.ls(realPath);
      if (!ls.ok) return;
      for (const entry of ls.entries.slice(0, 200)) {  // cap per dir
        const rp = nodepath.join(realPath, entry.name);
        const ap = aiosPath + '/' + entry.name;
        if (entry.type === 'dir') {
          _populateFsNode(rp, ap, maxDepth, depth + 1);
        } else if (entry.type === 'file') {
          // Only mirror small files (< 64 KB) to keep AIOS VFS lightweight
          try {
            const rs = hostBridge.hostfs.stat(rp);
            if (rs.ok && rs.size < 65536) {
              const content = hostBridge.hostfs.read(rp);
              if (content.ok) aiosFs.write(ap, content.content);
            } else {
              // Placeholder stub for large files
              aiosFs.write(ap, `[mirror stub: ${rp} (${(rs.ok ? rs.size : '?')} bytes)]\n`);
            }
          } catch (_) {}
        }
      }
    } else {
      const content = hostBridge.hostfs.read(realPath);
      if (content.ok) aiosFs.write(aiosPath, content.content);
    }
  }

  // ---------------------------------------------------------------------------
  // mount — create and activate a mirror
  // ---------------------------------------------------------------------------
  function mount(type, options) {
    if (!(type in MIRROR_TYPES)) {
      return { ok: false, error: `Unknown mirror type: "${type}". Options: ${Object.keys(MIRROR_TYPES).join(', ')}` };
    }
    if (_mirrors.has(type)) {
      return { ok: true, note: `Mirror "${type}" already active.` };
    }

    const meta    = MIRROR_TYPES[type];
    const session = {
      type,
      mountedAt:  Date.now(),
      aiosMount:  meta.aiosMount,
      description: meta.description,
      tickInterval: null,
      lastSync:   null,
    };

    let ok = false;
    let error = null;

    switch (type) {
      case 'root': {
        if (!hostBridge || !aiosFs) { error = 'host-bridge or filesystem not available'; break; }
        aiosFs.mkdir('/host', { parents: true });
        // Mirror top-level host dirs (shallow, max 2 levels)
        const topDirs = ['etc', 'usr', 'bin', 'var', 'tmp', 'home', 'data'];
        for (const d of topDirs) {
          const realDir = '/' + d;
          if (nodefs.existsSync(realDir)) {
            _populateFsNode(realDir, '/host/' + d, 2, 0);
          }
        }
        session.lastSync = new Date().toISOString();
        ok = true;
        break;
      }

      case 'proc': {
        if (!hostBridge) { error = 'host-bridge not available'; break; }
        if (!aiosFs)     { error = 'filesystem not available';  break; }
        const procs = hostBridge.processes();
        if (!procs.ok) { error = procs.error; break; }
        aiosFs.mkdir('/proc-live', { parents: true });
        // Write a summary file
        const lines = procs.processes.map(p =>
          `${String(p.pid).padEnd(7)} ${String(p.name).padEnd(20)} ${p.state}`
        );
        aiosFs.write('/proc-live/snapshot', `# Live process snapshot\n${lines.join('\n')}\n`);
        // Also sync each process into kernel proc table
        if (kernel) {
          for (const p of procs.processes.slice(0, 50)) {
            if (!kernel.procs.get(p.pid)) {
              // Mirror real PID into AIOS process table (read-only annotation)
              kernel.procs._processes.set(p.pid, {
                pid: p.pid, name: p.name, meta: { mirror: 'proc', state: p.state },
                state: p.state === 'S' ? 'sleeping' : p.state === 'R' ? 'running' : p.state,
                startedAt: Date.now(),
              });
            }
          }
        }
        session.lastSync = new Date().toISOString();
        ok = true;
        break;
      }

      case 'storage': {
        const storagePaths = [
          '/storage/emulated/0',   // Android primary
          process.env.EXTERNAL_STORAGE,
          process.env.HOME ? nodepath.join(process.env.HOME, 'storage', 'shared') : null, // Termux
        ].filter(Boolean);

        let realStorage = null;
        for (const p of storagePaths) {
          if (nodefs.existsSync(p)) { realStorage = p; break; }
        }

        if (!realStorage) { error = 'Android storage path not found'; break; }
        if (!aiosFs)      { error = 'filesystem not available'; break; }

        aiosFs.mkdir('/sdcard', { parents: true });
        _populateFsNode(realStorage, '/sdcard', 1, 0);  // shallow mirror
        session.realPath  = realStorage;
        session.lastSync  = new Date().toISOString();
        ok = true;
        break;
      }

      case 'home': {
        const realHome = process.env.HOME || nodepath.join('/root');
        if (!nodefs.existsSync(realHome)) { error = 'HOME path not found'; break; }
        if (!aiosFs) { error = 'filesystem not available'; break; }

        aiosFs.mkdir('/host-home', { parents: true });
        _populateFsNode(realHome, '/host-home', 2, 0);
        session.realPath  = realHome;
        session.lastSync  = new Date().toISOString();
        ok = true;
        break;
      }

      case 'pkg': {
        // No VFS mount needed — pkg commands go straight through host-bridge
        if (!hostBridge) { error = 'host-bridge not available'; break; }
        ok = true;
        break;
      }
    }

    if (!ok) {
      return { ok: false, error: error || 'Mount failed' };
    }

    _mirrors.set(type, session);
    _emit('mirror:mounted', { type, aiosMount: meta.aiosMount });

    return {
      ok:      true,
      type,
      aiosMount: meta.aiosMount,
      description: meta.description,
    };
  }

  // ---------------------------------------------------------------------------
  // unmount — remove a mirror session
  // ---------------------------------------------------------------------------
  function unmount(type) {
    const session = _mirrors.get(type);
    if (!session) return { ok: false, error: `Mirror "${type}" not active` };

    if (session.tickInterval) clearInterval(session.tickInterval);

    // Clean up AIOS VFS mount point if applicable
    if (session.aiosMount && aiosFs) {
      aiosFs.rm(session.aiosMount, { recursive: true });
    }

    _mirrors.delete(type);
    _emit('mirror:unmounted', { type });
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // sync — refresh an existing mirror
  // ---------------------------------------------------------------------------
  function sync(type) {
    if (!_mirrors.has(type)) {
      return { ok: false, error: `Mirror "${type}" not active. Use: mirror ${type}` };
    }
    const session = _mirrors.get(type);
    // Re-mount refreshes the mirror
    unmount(type);
    const result = mount(type, {});
    if (result.ok) {
      const s = _mirrors.get(type);
      if (s) s.lastSync = new Date().toISOString();
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // startPolling — auto-refresh a mirror on a tick
  // ---------------------------------------------------------------------------
  function startPolling(type, intervalMs) {
    const session = _mirrors.get(type);
    if (!session) return { ok: false, error: `Mirror "${type}" not active` };
    if (session.tickInterval) clearInterval(session.tickInterval);
    session.tickInterval = setInterval(() => sync(type), intervalMs || 60000);
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // list — show all active mirrors
  // ---------------------------------------------------------------------------
  function list() {
    return Array.from(_mirrors.values()).map(s => ({
      type:        s.type,
      description: s.description,
      aiosMount:   s.aiosMount,
      lastSync:    s.lastSync,
      polling:     !!s.tickInterval,
    }));
  }

  // ---------------------------------------------------------------------------
  // Router command module interface
  // ---------------------------------------------------------------------------
  const commands = {
    mirror: (args) => {
      const sub = (args[0] || '').toLowerCase();

      if (!sub || sub === 'list') {
        const active = list();
        if (!active.length) {
          return {
            status: 'ok',
            result: [
              'No active mirrors.',
              '',
              'Available mirror types:',
              ...Object.entries(MIRROR_TYPES).map(([k, v]) => `  mirror ${k.padEnd(10)} — ${v.description}`),
            ].join('\n'),
          };
        }
        const out = active.map(m =>
          `  ${m.type.padEnd(10)} ${(m.aiosMount || 'n/a').padEnd(15)} synced: ${m.lastSync || 'never'}${m.polling ? ' [polling]' : ''}`
        );
        return { status: 'ok', result: `Active mirrors:\n${out.join('\n')}` };
      }

      if (sub === 'sync') {
        const type = args[1];
        if (!type) return { status: 'error', result: 'Usage: mirror sync <type>' };
        const r = sync(type);
        return r.ok ? { status: 'ok', result: `Mirror "${type}" synced.` } : { status: 'error', result: r.error };
      }

      if (sub === 'unmount' || sub === 'remove') {
        const type = args[1];
        if (!type) return { status: 'error', result: 'Usage: mirror unmount <type>' };
        const r = unmount(type);
        return r.ok ? { status: 'ok', result: `Mirror "${type}" unmounted.` } : { status: 'error', result: r.error };
      }

      // Otherwise: treat sub as a mirror type to mount
      if (sub in MIRROR_TYPES) {
        const r = mount(sub, {});
        if (r.ok) {
          const out = [`Mirror "${sub}" mounted.`];
          if (r.aiosMount) out.push(`Accessible at: ${r.aiosMount}`);
          out.push(r.description);
          return { status: 'ok', result: out.join('\n') };
        }
        return { status: 'error', result: `Failed to mount "${sub}": ${r.error}` };
      }

      return {
        status: 'error',
        result: `Unknown mirror type: "${sub}". Options: ${Object.keys(MIRROR_TYPES).join(', ')} | list | sync | unmount`,
      };
    },
  };

  return {
    name:         'mirror-session',
    version:      '2.0.0',
    MIRROR_TYPES,
    mount,
    unmount,
    sync,
    startPolling,
    list,
    commands,
  };
}

module.exports = { createMirrorSession, MIRROR_TYPES };
