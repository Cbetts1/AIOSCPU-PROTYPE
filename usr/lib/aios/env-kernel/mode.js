'use strict';
/**
 * env-kernel/mode.js — AIOS Environment Kernel Mode Selector v1.0.0
 *
 * Decides between:
 *   mode = "self"   — AIOS has its own RootFS (aios-root or configured path)
 *   mode = "mirror" — AIOS runs on top of the host FS (root→/host, home→/host-home)
 *
 * Selection rules (in priority order):
 *   1. AIOS_MODE env var  (AIOS_MODE=self | AIOS_MODE=mirror)
 *   2. Existence of /aios-root  or the path in AIOS_ROOT env var
 *   3. Fallback to "mirror"
 *
 * Exposed API:
 *   getMode()       — returns "self" or "mirror"
 *   isSelfHost()    — true when mode === "self"
 *   isMirrorHost()  — true when mode === "mirror"
 *   switchMode(m)   — override mode at runtime ("self" | "mirror")
 *   getRootFSPath() — resolved RootFS path when in self mode
 */

const nodefs   = require('fs');
const nodepath = require('path');

const AIOS_ROOT_DEFAULT = '/aios-root';

let _overrideMode = null;

// ---------------------------------------------------------------------------
// Internal detection
// ---------------------------------------------------------------------------
function _detectMode() {
  // 1. Explicit env-var override
  const envMode = (process.env.AIOS_MODE || '').toLowerCase().trim();
  if (envMode === 'self' || envMode === 'mirror') return envMode;

  // 2. AIOS RootFS existence
  const rootPath = process.env.AIOS_ROOT || AIOS_ROOT_DEFAULT;
  try {
    if (nodefs.existsSync(rootPath)) {
      const stat = nodefs.statSync(rootPath);
      if (stat.isDirectory()) return 'self';
    }
  } catch (_) {}

  // 3. Default: mirror
  return 'mirror';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function getMode() {
  if (_overrideMode) return _overrideMode;
  return _detectMode();
}

function isSelfHost() {
  return getMode() === 'self';
}

function isMirrorHost() {
  return getMode() === 'mirror';
}

/**
 * Override the mode at runtime.
 * When switching to "self", verifies that a RootFS path is accessible.
 * Returns { ok, mode, error? }.
 */
function switchMode(m) {
  const target = String(m || '').toLowerCase().trim();
  if (target !== 'self' && target !== 'mirror') {
    return { ok: false, error: `Unknown mode "${m}". Use "self" or "mirror".` };
  }

  if (target === 'self') {
    const rootPath = process.env.AIOS_ROOT || AIOS_ROOT_DEFAULT;
    try {
      if (!nodefs.existsSync(rootPath)) {
        return {
          ok:    false,
          error: `Cannot switch to self mode — RootFS path "${rootPath}" does not exist.`,
        };
      }
    } catch (e) {
      return { ok: false, error: `Cannot switch to self mode — ${e.message}` };
    }
  }

  _overrideMode = target;
  return { ok: true, mode: target };
}

function getRootFSPath() {
  return process.env.AIOS_ROOT || AIOS_ROOT_DEFAULT;
}

/** Reset any runtime override (re-detect from environment). */
function resetMode() {
  _overrideMode = null;
}

module.exports = { getMode, isSelfHost, isMirrorHost, switchMode, getRootFSPath, resetMode };
