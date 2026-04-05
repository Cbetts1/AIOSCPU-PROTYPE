'use strict';
/**
 * capability-engine.js — AIOS Capability Engine v1.0.0
 *
 * Implements a Linux-inspired capability model for the AIOS kernel.
 * Capabilities control what the OS and its processes are allowed to do
 * at the kernel level — analogous to Linux POSIX capabilities.
 *
 * Capability sets follow the Linux model:
 *   - Permitted   — capabilities the process may use
 *   - Effective   — capabilities currently active
 *   - Inheritable — capabilities passed to child processes
 *
 * AIOS extends standard Linux caps with AI-specific capabilities.
 *
 * Zero external npm dependencies.
 */

// ---------------------------------------------------------------------------
// Capability constants (Linux CAP_ names where applicable)
// ---------------------------------------------------------------------------
const CAPS = Object.freeze({
  // System administration
  SYS_ADMIN:    'cap_sys_admin',    // General system administration
  SYS_BOOT:     'cap_sys_boot',     // Reboot / shutdown
  SYS_MODULE:   'cap_sys_module',   // Load / unload kernel modules
  SYS_NICE:     'cap_sys_nice',     // Change process priority
  SYS_TIME:     'cap_sys_time',     // Set system time
  SYS_RAWIO:    'cap_sys_rawio',    // Raw I/O operations
  // Network
  NET_ADMIN:    'cap_net_admin',    // Network administration
  NET_RAW:      'cap_net_raw',      // Raw sockets
  NET_BIND:     'cap_net_bind',     // Bind to privileged ports (<1024)
  // File / DAC
  DAC_OVERRIDE: 'cap_dac_override', // Bypass DAC permission checks
  FOWNER:       'cap_fowner',       // Bypass ownership checks
  CHOWN:        'cap_chown',        // Change file ownership
  // Process
  KILL:         'cap_kill',         // Send signals to any process
  SETUID:       'cap_setuid',       // Set process UIDs
  SETGID:       'cap_setgid',       // Set process GIDs
  // Audit
  AUDIT_WRITE:  'cap_audit_write',  // Write audit records
  AUDIT_READ:   'cap_audit_read',   // Read audit records
  // AIOS-specific extensions
  AI_ADMIN:     'cap_ai_admin',     // Manage AI brain (switch, retrain)
  AI_WRITE:     'cap_ai_write',     // Write to AI state / decision log
  AI_MONITOR:   'cap_ai_monitor',   // Start / stop autonomous monitoring
  HOST_EXEC:    'cap_host_exec',    // Execute real host shell commands
  HOST_READ:    'cap_host_read',    // Read real host filesystem
  HOST_WRITE:   'cap_host_write',   // Write to real host filesystem
  DEBUG:        'cap_debug',        // Access built-in kernel debugger
  MODULE_LOAD:  'cap_module_load',  // Load / unload AIOS kernel modules
});

// ---------------------------------------------------------------------------
// Default capability sets per privilege level
// ---------------------------------------------------------------------------
const LEVEL_CAPS = {
  user: new Set([
    CAPS.HOST_READ,
    CAPS.AI_WRITE,
    CAPS.AUDIT_READ,
  ]),
  operator: new Set([
    CAPS.HOST_READ,
    CAPS.HOST_EXEC,
    CAPS.AI_WRITE,
    CAPS.AI_ADMIN,
    CAPS.AI_MONITOR,
    CAPS.SYS_NICE,
    CAPS.KILL,
    CAPS.AUDIT_READ,
    CAPS.AUDIT_WRITE,
    CAPS.DEBUG,
  ]),
  admin: new Set([
    CAPS.HOST_READ,
    CAPS.HOST_EXEC,
    CAPS.AI_WRITE,
    CAPS.AI_ADMIN,
    CAPS.AI_MONITOR,
    CAPS.SYS_NICE,
    CAPS.SYS_MODULE,
    CAPS.SYS_ADMIN,
    CAPS.KILL,
    CAPS.SETUID,
    CAPS.SETGID,
    CAPS.NET_ADMIN,
    CAPS.DAC_OVERRIDE,
    CAPS.FOWNER,
    CAPS.AUDIT_READ,
    CAPS.AUDIT_WRITE,
    CAPS.DEBUG,
    CAPS.MODULE_LOAD,
  ]),
  root: new Set(Object.values(CAPS)),
};

// ---------------------------------------------------------------------------
// Capability engine factory
// ---------------------------------------------------------------------------
function createCapabilityEngine(kernel, permSystem) {
  let _level = 'user';
  let _caps  = new Set(LEVEL_CAPS.user);
  const _processCaps = new Map(); // pid → Set<cap>

  function _syncFromPerms() {
    if (!permSystem) return;
    const newLevel = permSystem.getLevel();
    if (newLevel !== _level) {
      _level = newLevel;
      _caps  = new Set(LEVEL_CAPS[_level] || LEVEL_CAPS.user);
    }
  }

  // ---------------------------------------------------------------------------
  // has — check if the OS currently holds a capability
  // ---------------------------------------------------------------------------
  function has(cap) {
    _syncFromPerms();
    return _caps.has(cap);
  }

  // ---------------------------------------------------------------------------
  // check — assert capability (throws if missing)
  // ---------------------------------------------------------------------------
  function check(cap) {
    if (!has(cap)) throw new Error(`Permission denied: missing ${cap}`);
    return true;
  }

  // ---------------------------------------------------------------------------
  // grant / revoke — per-process capability management
  // ---------------------------------------------------------------------------
  function grant(pid, cap) {
    if (!_processCaps.has(pid)) _processCaps.set(pid, new Set());
    _processCaps.get(pid).add(cap);
    if (kernel) kernel.bus.emit('cap:granted', { pid, cap });
  }

  function revoke(pid, cap) {
    const pcaps = _processCaps.get(pid);
    if (pcaps) {
      pcaps.delete(cap);
      if (kernel) kernel.bus.emit('cap:revoked', { pid, cap });
    }
  }

  function processHas(pid, cap) {
    const pcaps = _processCaps.get(pid);
    return pcaps ? pcaps.has(cap) : false;
  }

  function list() {
    _syncFromPerms();
    return Array.from(_caps);
  }

  function listAll() {
    _syncFromPerms();
    return Object.entries(CAPS).map(([name, value]) => ({
      name,
      value,
      granted: _caps.has(value),
    }));
  }

  // ---------------------------------------------------------------------------
  // Router command module
  // ---------------------------------------------------------------------------
  const commands = {
    caps: (args) => {
      _syncFromPerms();
      const sub = (args[0] || 'list').toLowerCase();

      if (sub === 'list') {
        const all   = listAll();
        const lines = all.map(c =>
          `  ${(c.granted ? '✓' : '○').padEnd(3)}${c.value}`
        );
        return {
          status: 'ok',
          result: `Capabilities  (level: ${_level}  active: ${_caps.size}/${all.length})\n${lines.join('\n')}`,
        };
      }

      if (sub === 'check' && args[1]) {
        const want  = args[1].toLowerCase();
        const found = Object.values(CAPS).find(c => c === want || c.endsWith(`_${want}`));
        if (!found) return { status: 'error', result: `Unknown capability: ${args[1]}` };
        return { status: 'ok', result: `${found}: ${_caps.has(found) ? 'GRANTED' : 'DENIED'}` };
      }

      return {
        status: 'ok',
        result: [
          `Usage: caps [list|check <cap>]`,
          `Level : ${_level}`,
          `Active: ${_caps.size} capabilities`,
        ].join('\n'),
      };
    },
  };

  return {
    name:       'capability-engine',
    CAPS,
    has,
    check,
    grant,
    revoke,
    processHas,
    list,
    listAll,
    commands,
  };
}

module.exports = { createCapabilityEngine, CAPS };
