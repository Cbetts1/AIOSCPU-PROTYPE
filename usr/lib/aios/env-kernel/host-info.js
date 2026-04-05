'use strict';
/**
 * env-kernel/host-info.js — AIOS Environment Kernel Host Info v1.0.0
 *
 * Detects the runtime platform and exposes a summary of host capabilities.
 * Wraps the existing core/host-bridge.js detection logic where available;
 * falls back to pure Node.js built-ins when the host bridge is not yet loaded.
 *
 * Exposed API:
 *   getPlatform()     — returns platform string: "termux" | "android" | "linux" | "macos" | "windows" | "unknown"
 *   getHostSummary()  — returns a plain object with host details
 */

const nodeos = require('os');
const nodefs = require('fs');

// ---------------------------------------------------------------------------
// Platform detection (pure Node.js — no external deps)
// ---------------------------------------------------------------------------
function _detectPlatform() {
  const platform = process.platform;

  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'macos';

  // Termux runs on Android but reports linux; check common Termux markers
  if (platform === 'linux') {
    try {
      if (
        process.env.PREFIX && process.env.PREFIX.includes('com.termux') ||
        nodefs.existsSync('/data/data/com.termux') ||
        nodefs.existsSync('/data/data/com.termux.nix') ||
        (process.env.HOME || '').includes('com.termux')
      ) {
        return 'termux';
      }
      // Check for Android without Termux
      if (
        nodefs.existsSync('/system/build.prop') ||
        nodefs.existsSync('/proc/1/cgroup') && (() => {
          try {
            return nodefs.readFileSync('/proc/1/cgroup', 'utf8').includes('android');
          } catch (_) { return false; }
        })()
      ) {
        return 'android';
      }
    } catch (_) {}
    return 'linux';
  }

  return 'unknown';
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

function getPlatform() {
  return _detectPlatform();
}

function getHostSummary() {
  const platform = _detectPlatform();
  return {
    platform,
    arch:        process.arch,
    nodeVersion: process.version,
    hostname:    nodeos.hostname(),
    cpus:        nodeos.cpus().length,
    totalMemMB:  Math.floor(nodeos.totalmem() / 1024 / 1024),
    freeMemMB:   Math.floor(nodeos.freemem() / 1024 / 1024),
    uptime:      Math.floor(nodeos.uptime()),
    homedir:     nodeos.homedir(),
    tmpdir:      nodeos.tmpdir(),
    pid:         process.pid,
    env: {
      PREFIX: process.env.PREFIX || null,
      TERM:   process.env.TERM   || null,
      SHELL:  process.env.SHELL  || null,
      LANG:   process.env.LANG   || null,
    },
  };
}

module.exports = { getPlatform, getHostSummary };
