'use strict';
/**
 * self-kernel/identity.js — AIOS Self Kernel Identity Layer v1.0.0
 *
 * Wraps core/identity.js without changing its behavior.
 * Reads or creates /etc/aios/identity.json with stable identity fields.
 *
 * Exposed API:
 *   getIdentity()   — full identity manifest
 *   getKernelId()   — kernel UUID string
 *   getVersion()    — OS version string
 *   getBuildId()    — build ID (kernel UUID, alias)
 */

const nodefs   = require('fs');
const nodepath = require('path');
const crypto   = require('crypto');

// Canonical identity file location (repo-relative for portability)
const IDENTITY_FILE = nodepath.resolve(__dirname, '../../../../etc/aios/identity.json');

const DEFAULTS = {
  os_name:    'AIOS UniKernel',
  os_version: '3.0.0',
  kernel_id:  null,
  build_id:   null,
};

let _cached = null;

// ---------------------------------------------------------------------------
// Internal: load or generate identity.json
// ---------------------------------------------------------------------------
function _loadOrCreate() {
  if (_cached) return _cached;

  let data = {};
  try {
    if (nodefs.existsSync(IDENTITY_FILE)) {
      data = JSON.parse(nodefs.readFileSync(IDENTITY_FILE, 'utf8'));
    }
  } catch (_) {}

  // Ensure required fields
  if (!data.kernel_id && !data.id) {
    data.kernel_id = `aios-kernel-${crypto.randomBytes(8).toString('hex')}`;
  } else if (!data.kernel_id && data.id) {
    data.kernel_id = data.id;
  }

  if (!data.build_id) {
    data.build_id = data.kernel_id;
  }

  if (!data.os_name)    data.os_name    = data.name    || DEFAULTS.os_name;
  if (!data.os_version) data.os_version = data.version || DEFAULTS.os_version;

  _cached = data;
  return _cached;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Return the full identity manifest object. */
function getIdentity() {
  return _loadOrCreate();
}

/** Return the stable kernel ID string. */
function getKernelId() {
  return _loadOrCreate().kernel_id;
}

/** Return the OS version string. */
function getVersion() {
  return _loadOrCreate().os_version;
}

/** Return the build ID (alias of kernel_id). */
function getBuildId() {
  return _loadOrCreate().build_id || getKernelId();
}

/** Reload identity from disk (e.g. after a kernel upgrade). */
function reload() {
  _cached = null;
  return _loadOrCreate();
}

module.exports = { getIdentity, getKernelId, getVersion, getBuildId, reload };
