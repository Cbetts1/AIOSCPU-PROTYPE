'use strict';
/**
 * env-loader.js — AIOS OS Integration Layer Environment Loader v1.0.0
 *
 * Builds the complete AIOS runtime environment by layering sources in order:
 *   1. Built-in OS defaults
 *   2. /etc/environment (system-wide)
 *   3. /etc/profile (system profile)
 *   4. /etc/aios/environment (AIOS-specific overrides)
 *   5. /home/user/.profile (user profile)
 *   6. Platform-specific additions (Termux, macOS, Linux)
 *   7. Kernel / identity runtime values
 *
 * Provides three shell profiles:
 *   getLoginEnv()  — full login shell environment
 *   getSystemEnv() — minimal system shell (no user profile)
 *   getAIEnv()     — AI shell additions (AIOS_AI_MODE, AI_CONTEXT, etc.)
 *
 * Writes the merged environment to /proc/env in the VFS.
 *
 * Zero external npm dependencies.
 */

// ---------------------------------------------------------------------------
// EnvLoader factory
// ---------------------------------------------------------------------------
function createEnvLoader(kernel, vfs, hostBridge, identity) {
  let _env      = Object.create(null);
  let _loaded   = false;

  // ── Built-in defaults ────────────────────────────────────────────────────
  const _defaults = {
    AIOS_OS:         'AIOS UniKernel',
    AIOS_VERSION:    '3.0.0',
    AIOS_KERNEL:     'aios-unikernel',
    AIOS_PIVOTED:    'false',
    HOME:            '/home/user',
    USER:            'aios',
    LOGNAME:         'aios',
    SHELL:           '/bin/aios-shell',
    LOGIN_SHELL:     '/bin/aios-shell --login',
    AI_SHELL:        '/bin/aios-shell --ai-mode',
    TERM:            process.env.TERM || 'xterm-256color',
    COLORTERM:       'truecolor',
    LANG:            'en_US.UTF-8',
    LC_ALL:          'en_US.UTF-8',
    PATH:            '/bin:/usr/bin:/usr/local/bin',
    PS1:             'aios:\\w$ ',
    PS2:             '> ',
    EDITOR:          'edit',
    PAGER:           'cat',
    TMPDIR:          '/tmp',
    XDG_RUNTIME_DIR: '/run/user/1000',
    XDG_HOME:        '/home/user',
    XDG_DATA_HOME:   '/home/user/.local/share',
    XDG_CONFIG_HOME: '/home/user/.config',
    XDG_CACHE_HOME:  '/home/user/.cache',
  };

  // ── Parse KEY=VALUE env files ─────────────────────────────────────────────
  function _parseEnvFile(content) {
    const result = {};
    for (const rawLine of content.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || line.startsWith('export ') && !line.includes('=')) continue;

      // Handle "export KEY=VALUE"
      const stripped = line.startsWith('export ') ? line.slice(7).trim() : line;
      const eq = stripped.indexOf('=');
      if (eq < 1) continue;

      const key   = stripped.slice(0, eq).trim();
      let   value = stripped.slice(eq + 1).trim();

      // Strip surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (key && /^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        result[key] = value;
      }
    }
    return result;
  }

  // ── Flush to /proc/env ───────────────────────────────────────────────────
  function _flush() {
    if (!vfs) return;
    try {
      const content = Object.entries(_env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
      vfs.write('/proc/env', content);
    } catch (_) {}
  }

  // ── Read a VFS file and parse it ─────────────────────────────────────────
  function _loadVfsFile(path) {
    if (!vfs) return {};
    const r = vfs.read(path);
    if (r && r.ok) return _parseEnvFile(r.content);
    return {};
  }

  // ---------------------------------------------------------------------------
  // load — assemble the full environment
  // ---------------------------------------------------------------------------
  function load() {
    // 1. Defaults
    Object.assign(_env, _defaults);

    // 2. Platform-specific
    if (hostBridge) {
      _env.AIOS_PLATFORM = hostBridge.platform.name;
      _env.AIOS_ROOT     = String(hostBridge.root.available);
      if (hostBridge.platform.isTermux) {
        _env.TERMUX_APP       = 'com.termux';
        _env.ANDROID_DATA     = process.env.ANDROID_DATA || '/data';
        if (process.env.HOME)   _env.HOST_HOME      = process.env.HOME;
        if (process.env.PREFIX) _env.TERMUX_PREFIX   = process.env.PREFIX;
      }
      if (hostBridge.platform.isMac) {
        _env.MACOS = 'true';
      }
    }

    // 3. Identity
    if (identity) {
      const m = typeof identity.get === 'function' ? identity.get() : identity;
      if (m) {
        _env.AIOS_ID        = m.id        || '';
        _env.AIOS_ARCH      = m.arch      || process.arch;
        _env.AIOS_BOOT_TIME = m.bootTime  || new Date().toISOString();
        _env.AIOS_BOOT_COUNT = String(m.bootCount || 0);
      }
    }

    // 4. Kernel
    if (kernel) {
      _env.AIOS_KERNEL_ID = kernel.id;
      _env.NODE_VERSION   = process.version;
      _env.NODE_PATH      = process.execPath;
    }

    // 5. VFS sources (layered)
    Object.assign(_env, _loadVfsFile('/etc/environment'));
    Object.assign(_env, _loadVfsFile('/etc/profile'));
    Object.assign(_env, _loadVfsFile('/etc/aios/environment'));
    Object.assign(_env, _loadVfsFile('/home/user/.profile'));

    _loaded = true;
    _flush();

    if (kernel) kernel.bus.emit('env:loaded', { count: Object.keys(_env).length });

    return Object.assign({}, _env);
  }

  // ---------------------------------------------------------------------------
  // getLoginEnv — full login shell environment
  // ---------------------------------------------------------------------------
  function getLoginEnv() {
    if (!_loaded) load();
    return Object.assign({}, _env, {
      SHLVL:          '1',
      LOGIN_SHELL:    _env.LOGIN_SHELL || '/bin/aios-shell --login',
      AIOS_SHELL_MODE: 'login',
    });
  }

  // ---------------------------------------------------------------------------
  // getSystemEnv — minimal system shell (no user profile)
  // ---------------------------------------------------------------------------
  function getSystemEnv() {
    const sys = {};
    const systemKeys = [
      'AIOS_OS', 'AIOS_VERSION', 'AIOS_KERNEL', 'AIOS_ID', 'AIOS_PLATFORM',
      'PATH', 'HOME', 'SHELL', 'TERM', 'LANG', 'LC_ALL', 'TMPDIR',
      'AIOS_KERNEL_ID', 'NODE_VERSION', 'AIOS_PIVOTED',
    ];
    if (!_loaded) load();
    for (const k of systemKeys) {
      if (_env[k] !== undefined) sys[k] = _env[k];
    }
    sys.AIOS_SHELL_MODE = 'system';
    return sys;
  }

  // ---------------------------------------------------------------------------
  // getAIEnv — AI shell additions
  // ---------------------------------------------------------------------------
  function getAIEnv() {
    if (!_loaded) load();
    return Object.assign({}, _env, {
      AIOS_SHELL_MODE:  'ai',
      AIOS_AI_MODE:     'true',
      AI_CONTEXT:       'interactive',
      AI_PERSONALITY:   'AIOS',
      AI_MEMORY_FILE:   '/home/user/.aios_history',
      AI_MODEL:         'aios-built-in',
    });
  }

  // ---------------------------------------------------------------------------
  // get / set / unset
  // ---------------------------------------------------------------------------
  function get(key) {
    if (!_loaded) load();
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
  // export — set and persist to /home/user/.profile in VFS
  // ---------------------------------------------------------------------------
  function exportVar(key, value) {
    set(key, value);
    if (vfs) {
      const r = vfs.read('/home/user/.profile');
      const existing = (r && r.ok) ? r.content : '';
      const line = `export ${key}="${value}"`;
      if (!existing.includes(`export ${key}=`)) {
        vfs.append('/home/user/.profile', line + '\n');
      } else {
        // Update existing line
        const updated = existing.split('\n').map(l =>
          l.startsWith(`export ${key}=`) ? line : l
        ).join('\n');
        vfs.write('/home/user/.profile', updated);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Router commands
  // ---------------------------------------------------------------------------
  const commands = {
    env: (args) => {
      if (!_loaded) load();

      if (args[0] === 'set' && args[1] && args[2] !== undefined) {
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
      if (args[0] === 'reload') {
        _loaded = false;
        load();
        return { status: 'ok', result: `Environment reloaded (${Object.keys(_env).length} vars)` };
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
      exportVar(key, value);
      return { status: 'ok', result: `Exported ${key}` };
    },
  };

  return {
    name:         'env-loader',
    version:      '1.0.0',
    load,
    get,
    set,
    unset,
    exportVar,
    getLoginEnv,
    getSystemEnv,
    getAIEnv,
    isLoaded:     () => _loaded,
    commands,
  };
}

module.exports = { createEnvLoader };
