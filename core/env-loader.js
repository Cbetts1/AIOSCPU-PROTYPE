'use strict';
/**
 * env-loader.js — AIOS Environment Loader v1.0.0
 *
 * Builds and manages the AIOS shell environment.
 * Loads from:
 *   1. Built-in defaults (platform-aware)
 *   2. /etc/environment in the VFS
 *   3. /home/user/.profile in the VFS
 *
 * Exposes env to the terminal shell and writes a merged snapshot
 * to /proc/env in the VFS so other components can inspect it.
 *
 * Zero external npm dependencies.
 */

const nodeos = require('os');

// ---------------------------------------------------------------------------
// Environment Loader factory
// ---------------------------------------------------------------------------
function createEnvLoader(kernel, fs, hostBridge, identity) {
  let _env = Object.create(null);

  const _defaults = {
    AIOS_OS:      'AIOS UniKernel',
    AIOS_VERSION: '3.0.0',
    AIOS_KERNEL:  'aios-unikernel',
    HOME:         '/home/user',
    USER:         'aios',
    SHELL:        '/bin/aios-shell',
    TERM:         process.env.TERM || 'xterm-256color',
    LANG:         'en_US.UTF-8',
    LC_ALL:       'en_US.UTF-8',
    PATH:         '/bin:/usr/bin:/usr/local/bin',
    PS1:          'aios:\\w$ ',
    EDITOR:       'edit',
    PAGER:        'cat',
    TMPDIR:       '/tmp',
  };

  // ---------------------------------------------------------------------------
  // _parseEnvFile — parse KEY=VALUE file (shell syntax subset)
  // ---------------------------------------------------------------------------
  function _parseEnvFile(content) {
    const result = {};
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 1) continue;
      const key   = line.slice(0, eq).trim();
      let   value = line.slice(eq + 1).trim();
      // Strip surrounding quotes
      if (
        (value.startsWith('"')  && value.endsWith('"'))  ||
        (value.startsWith("'")  && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (key) result[key] = value;
    }
    return result;
  }

  // ---------------------------------------------------------------------------
  // _flush — write merged env to /proc/env in VFS
  // ---------------------------------------------------------------------------
  function _flush() {
    if (!fs) return;
    try {
      const content = Object.entries(_env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
      fs.write('/proc/env', content);
    } catch (_) {}
  }

  // ---------------------------------------------------------------------------
  // load — build the full environment
  // ---------------------------------------------------------------------------
  function load() {
    // 1. Built-in defaults
    Object.assign(_env, _defaults);

    // 2. Platform-specific additions
    if (hostBridge) {
      _env.AIOS_PLATFORM = hostBridge.platform.name;
      _env.AIOS_ROOT     = String(hostBridge.root.available);
      if (hostBridge.platform.isTermux) {
        _env.TERMUX_APP   = 'com.termux';
        _env.ANDROID_DATA = process.env.ANDROID_DATA || '/data';
        if (process.env.HOME) _env.HOST_HOME = process.env.HOME;
        if (process.env.PREFIX) _env.TERMUX_PREFIX = process.env.PREFIX;
      }
      if (hostBridge.platform.isMac) {
        _env.MACOS = 'true';
      }
    }

    // 3. Identity
    if (identity) {
      const m = identity.get();
      if (m) {
        _env.AIOS_ID   = m.id;
        _env.AIOS_ARCH = m.arch;
        _env.AIOS_BOOT = m.bootTime;
      }
    }

    // 4. Kernel
    if (kernel) {
      _env.AIOS_KERNEL_ID = kernel.id;
      _env.NODE_VERSION   = process.version;
      _env.NODE_PATH      = process.execPath;
    }

    // 5. /etc/environment from VFS
    if (fs) {
      const etcEnv = fs.read('/etc/environment');
      if (etcEnv.ok) Object.assign(_env, _parseEnvFile(etcEnv.content));

      // 6. /home/user/.profile
      const profile = fs.read('/home/user/.profile');
      if (profile.ok) Object.assign(_env, _parseEnvFile(profile.content));
    }

    _flush();

    if (kernel) kernel.bus.emit('env:loaded', { count: Object.keys(_env).length });

    return Object.assign({}, _env);
  }

  // ---------------------------------------------------------------------------
  // get / set / unset
  // ---------------------------------------------------------------------------
  function get(key) {
    return key ? _env[key] : Object.assign({}, _env);
  }

  function set(key, value) {
    if (!key || typeof key !== 'string') return;
    _env[key] = String(value);
    _flush();
    if (kernel) kernel.bus.emit('env:set', { key, value });
  }

  function unset(key) {
    delete _env[key];
    _flush();
    if (kernel) kernel.bus.emit('env:unset', { key });
  }

  // ---------------------------------------------------------------------------
  // Router commands
  // ---------------------------------------------------------------------------
  const commands = {
    env: (args) => {
      if (args[0] === 'set' && args[1] && args[2]) {
        set(args[1], args.slice(2).join(' '));
        return { status: 'ok', result: `Set ${args[1]}=${args.slice(2).join(' ')}` };
      }
      if (args[0] === 'get' && args[1]) {
        const v = get(args[1]);
        return { status: 'ok', result: v !== undefined ? `${args[1]}=${v}` : `${args[1]} not set` };
      }
      if (args[0] === 'unset' && args[1]) {
        unset(args[1]);
        return { status: 'ok', result: `Unset ${args[1]}` };
      }
      const lines = Object.entries(get()).map(([k, v]) => `${k}=${v}`);
      return { status: 'ok', result: lines.join('\n') };
    },

    export: (args) => {
      if (!args.length) return { status: 'error', result: 'Usage: export KEY=VALUE' };
      const joined = args.join(' ');
      const eq     = joined.indexOf('=');
      if (eq < 1) return { status: 'error', result: 'Usage: export KEY=VALUE' };
      const key   = joined.slice(0, eq).trim();
      const value = joined.slice(eq + 1);
      set(key, value);
      return { status: 'ok', result: `Exported ${key}` };
    },
  };

  return {
    name: 'env-loader',
    load,
    get,
    set,
    unset,
    commands,
  };
}

module.exports = { createEnvLoader };
