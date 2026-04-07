'use strict';
/**
 * permission-system.js — AIOS Permission System v4.0.0
 *
 * Implements a tiered privilege system inside AIOS Lite.
 * Works on any device — real root is optional.
 *
 * Privilege Levels (lowest → highest):
 *   user      — default, can run standard AIOS commands
 *   operator  — can manage services, read host info
 *   admin     — can run host shell commands, modify host filesystem
 *   root      — full AIOS control; if host root available, host root too
 *
 * Capability Tokens:
 *   Each sensitive action requires a capability token.
 *   Tokens are granted when privilege is escalated and revoked on demotion.
 *
 * Real root integration:
 *   If the host-bridge detects real root (su / sudo / uid=0), the
 *   permission system unlocks the "host:root" capability automatically.
 *
 * Zero external npm dependencies.
 */

// ---------------------------------------------------------------------------
// Privilege levels
// ---------------------------------------------------------------------------
const LEVELS = Object.freeze({
  user:     0,
  operator: 1,
  admin:    2,
  root:     3,
});

// ---------------------------------------------------------------------------
// Capability definitions
// ---------------------------------------------------------------------------
const CAPS = Object.freeze({
  // Standard capabilities (user level)
  'fs:read':          0,   // Read AIOS VFS
  'fs:write':         0,   // Write AIOS VFS
  'cpu:run':          0,   // Run AIOSCPU programs
  'svc:read':         0,   // Read service status

  // Operator capabilities
  'svc:manage':       1,   // Start/stop/restart services
  'host:read':        1,   // Read host filesystem / system info
  'net:read':         1,   // Read network info

  // Admin capabilities
  'host:shell':       2,   // Execute host shell commands
  'host:write':       2,   // Write to host filesystem
  'mirror:mount':     2,   // Mount OS mirrors

  // Root capabilities
  'host:root':        3,   // Execute commands as root on host
  'kernel:debug':     3,   // Low-level kernel inspection
  'permission:grant': 3,   // Grant/revoke capabilities to others
});

// ---------------------------------------------------------------------------
// PermissionSystem factory
// ---------------------------------------------------------------------------
function createPermissionSystem(kernel, hostBridge) {
  // Current session state
  let _level    = 'user';
  let _tokens   = new Set();     // granted capability tokens
  let _sudoActive = false;       // temporary sudo escalation

  // Host root available?
  const _hostRoot = hostBridge ? hostBridge.root.available : false;

  // Audit log
  const _auditLog = [];

  function _audit(action, detail) {
    const entry = { ts: new Date().toISOString(), level: _level, action, detail };
    _auditLog.push(entry);
    if (_auditLog.length > 500) _auditLog.shift();
    if (kernel) kernel.bus.emit('permission:audit', entry);
  }

  // ---------------------------------------------------------------------------
  // Recompute capability tokens from current level
  // ---------------------------------------------------------------------------
  function _recomputeTokens() {
    _tokens = new Set();
    const levelNum = LEVELS[_level] || 0;
    for (const [cap, minLevel] of Object.entries(CAPS)) {
      if (levelNum >= minLevel) {
        _tokens.add(cap);
      }
    }
    // Host root capability only if real root is available
    if (_level === 'root' && _hostRoot) {
      _tokens.add('host:root');
    }
    if (kernel) kernel.bus.emit('permission:tokens-updated', { level: _level, tokens: [..._tokens] });
  }

  // Initialise tokens
  _recomputeTokens();

  // ---------------------------------------------------------------------------
  // has — check if a capability is currently granted
  // ---------------------------------------------------------------------------
  function has(capability) {
    return _tokens.has(capability);
  }

  // ---------------------------------------------------------------------------
  // require — assert a capability; throws if not granted
  // ---------------------------------------------------------------------------
  function require(capability, context) {
    if (!has(capability)) {
      const msg = `Permission denied: requires capability "${capability}" (current level: ${_level})`;
      _audit('denied', { capability, context });
      const err = new Error(msg);
      err.code  = 'EPERM';
      throw err;
    }
    return true;
  }

  // ---------------------------------------------------------------------------
  // escalate — raise privilege level
  // ---------------------------------------------------------------------------
  function escalate(targetLevel) {
    if (!(targetLevel in LEVELS)) {
      return { ok: false, error: `Unknown level: "${targetLevel}"` };
    }
    if (LEVELS[targetLevel] < LEVELS[_level]) {
      return { ok: false, error: `Cannot escalate down — use demote()` };
    }
    if (targetLevel === 'root' && !_hostRoot && targetLevel !== _level) {
      // Allow AIOS-root even without host root (AIOS internal only)
    }
    const prev = _level;
    _level = targetLevel;
    _recomputeTokens();
    _audit('escalate', { from: prev, to: targetLevel });
    if (kernel) kernel.bus.emit('permission:escalated', { from: prev, to: targetLevel });
    return { ok: true, level: _level };
  }

  // ---------------------------------------------------------------------------
  // demote — lower privilege level
  // ---------------------------------------------------------------------------
  function demote(targetLevel) {
    if (!(targetLevel in LEVELS)) {
      return { ok: false, error: `Unknown level: "${targetLevel}"` };
    }
    const prev = _level;
    _level = targetLevel;
    _recomputeTokens();
    _sudoActive = false;
    _audit('demote', { from: prev, to: targetLevel });
    if (kernel) kernel.bus.emit('permission:demoted', { from: prev, to: targetLevel });
    return { ok: true, level: _level };
  }

  // ---------------------------------------------------------------------------
  // sudo — temporarily become root for one command
  // ---------------------------------------------------------------------------
  function sudo(commandFn) {
    const prev = _level;
    escalate('root');
    _sudoActive = true;
    _audit('sudo', { command: commandFn.name || '(anonymous)' });
    try {
      const result = commandFn();
      return result;
    } finally {
      _level = prev;
      _sudoActive = false;
      _recomputeTokens();
    }
  }

  // ---------------------------------------------------------------------------
  // grant / revoke — add or remove a specific capability token manually
  // (requires permission:grant capability)
  // ---------------------------------------------------------------------------
  function grant(capability) {
    if (!has('permission:grant')) {
      return { ok: false, error: 'Requires "permission:grant" capability (root only)' };
    }
    if (!(capability in CAPS)) {
      return { ok: false, error: `Unknown capability: "${capability}"` };
    }
    _tokens.add(capability);
    _audit('grant', { capability });
    return { ok: true };
  }

  function revoke(capability) {
    if (!has('permission:grant')) {
      return { ok: false, error: 'Requires "permission:grant" capability (root only)' };
    }
    _tokens.delete(capability);
    _audit('revoke', { capability });
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // info — current session state
  // ---------------------------------------------------------------------------
  function info() {
    return {
      level:      _level,
      levelNum:   LEVELS[_level],
      hostRoot:   _hostRoot,
      sudoActive: _sudoActive,
      tokens:     [..._tokens].sort(),
    };
  }

  // ---------------------------------------------------------------------------
  // Router command module interface
  // ---------------------------------------------------------------------------
  const commands = {
    whoami: (_args) => {
      const i = info();
      return {
        status: 'ok',
        result: [
          `AIOS User Level : ${i.level}`,
          `Host Root       : ${i.hostRoot ? 'available' : 'not available'}`,
          `Capabilities    : ${i.tokens.length}`,
        ].join('\n'),
      };
    },

    capabilities: (_args) => {
      const tokens = [..._tokens].sort();
      if (!tokens.length) return { status: 'ok', result: 'No capabilities granted.' };
      const out = tokens.map(t => {
        const minLevel = CAPS[t] !== undefined ? Object.keys(LEVELS).find(k => LEVELS[k] === CAPS[t]) : '?';
        return `  ${t.padEnd(22)} (min: ${minLevel})`;
      }).join('\n');
      return { status: 'ok', result: `Granted capabilities (level: ${_level}):\n${out}` };
    },

    su: (args) => {
      const target = args[0] || 'root';
      if (!['user', 'operator', 'admin', 'root'].includes(target)) {
        return { status: 'error', result: `Unknown level: "${target}". Options: user, operator, admin, root` };
      }
      const r = escalate(target);
      return r.ok
        ? { status: 'ok',    result: `Switched to ${target}.` }
        : { status: 'error', result: r.error };
    },

    sudo: (args) => {
      if (!args.length) return { status: 'error', result: 'Usage: sudo <command> [args...]' };
      const prev = _level;
      escalate('root');
      _sudoActive = true;
      _audit('sudo-cmd', { args });
      // We return a marker that the terminal will use to re-run the inner command at root
      const result = { status: 'ok', result: `[sudo] Running as root: ${args.join(' ')}`, _sudoCmd: args, _sudoPrev: prev };
      return result;
    },
  };

  return {
    name:     'permission-system',
    version:  '4.0.0',
    LEVELS,
    CAPS,
    has,
    require,
    escalate,
    demote,
    sudo,
    grant,
    revoke,
    info,
    getLevel:  () => _level,
    getTokens: () => [..._tokens],
    auditLog:  () => _auditLog.slice(),
    commands,
  };
}

module.exports = { createPermissionSystem, LEVELS, CAPS };
