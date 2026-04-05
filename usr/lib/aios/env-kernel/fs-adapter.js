'use strict';
/**
 * env-kernel/fs-adapter.js — AIOS Environment Kernel Filesystem Adapter v1.0.0
 *
 * Wraps all filesystem access for the self kernel.
 * Path mapping depends on the current host mode (from env-kernel/mode.js):
 *
 *   mirror mode:  /        → /host
 *                 /home    → /host-home
 *   self mode:    /        → AIOS RootFS (e.g. /aios-root)
 *
 * Exposed API:
 *   readFile(path)          — read a file; returns { ok, content, error? }
 *   writeFile(path, data)   — write a file; returns { ok, error? }
 *   listDir(path)           — list directory; returns { ok, entries[], error? }
 *   pathResolve(path)       — resolve logical path to real FS path
 */

const nodefs   = require('fs');
const nodepath = require('path');
const mode     = require('./mode.js');

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/**
 * Map a logical AIOS path to a real host FS path based on current mode.
 */
function pathResolve(logicalPath) {
  const p = String(logicalPath || '/');

  if (mode.isMirrorHost()) {
    // /home/... → /host-home/...
    if (p === '/home' || p.startsWith('/home/')) {
      const suffix = p.slice('/home'.length);
      return nodepath.join('/host-home', suffix || '/');
    }
    // everything else → /host/...
    return nodepath.join('/host', p);
  }

  // self mode → AIOS RootFS
  const rootFS = mode.getRootFSPath();
  return nodepath.join(rootFS, p);
}

// ---------------------------------------------------------------------------
// readFile
// ---------------------------------------------------------------------------
function readFile(path) {
  const real = pathResolve(path);
  try {
    const content = nodefs.readFileSync(real, 'utf8');
    return { ok: true, content };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ---------------------------------------------------------------------------
// writeFile
// ---------------------------------------------------------------------------
function writeFile(path, data) {
  const real = pathResolve(path);
  try {
    nodefs.mkdirSync(nodepath.dirname(real), { recursive: true });
    nodefs.writeFileSync(real, String(data || ''), 'utf8');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ---------------------------------------------------------------------------
// listDir
// ---------------------------------------------------------------------------
function listDir(path) {
  const real = pathResolve(path);
  try {
    const entries = nodefs.readdirSync(real, { withFileTypes: true }).map(d => ({
      name:  d.name,
      isDir: d.isDirectory(),
    }));
    return { ok: true, entries };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = { readFile, writeFile, listDir, pathResolve };
