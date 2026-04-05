'use strict';
/**
 * module-loader.js — AIOS Dynamic Module Loader v1.0.0
 *
 * Supports loading AIOS extension modules from:
 *   - The host filesystem (dynamic require() of a CommonJS module)
 *   - The VFS (/lib/modules/*.json — metadata-only manifests)
 *
 * A host-filesystem module must export:
 *   { name, version, description?, commands: { cmdName: fn, … } }
 *
 * Modules register their commands with the router and are tracked
 * in the module registry. They can be unloaded (commands removed)
 * at runtime.
 *
 * Zero external npm dependencies.
 */

const nodefs   = require('fs');
const nodepath = require('path');

// ---------------------------------------------------------------------------
// Module Loader factory
// ---------------------------------------------------------------------------
function createModuleLoader(kernel, fs, router) {
  const _loaded = new Map(); // name → { manifest, source, path }

  // ---------------------------------------------------------------------------
  // _validate — ensure the module object has required fields
  // ---------------------------------------------------------------------------
  function _validate(mod) {
    if (!mod || typeof mod !== 'object')           throw new TypeError('Module must be an object');
    if (!mod.name    || typeof mod.name    !== 'string') throw new TypeError('Module must have a string name');
    if (!mod.version || typeof mod.version !== 'string') throw new TypeError('Module must have a string version');
    return true;
  }

  // ---------------------------------------------------------------------------
  // loadFromHost — require() a module from the real filesystem
  // ---------------------------------------------------------------------------
  function loadFromHost(filePath) {
    const abs = nodepath.resolve(filePath);
    if (!nodefs.existsSync(abs)) {
      return { ok: false, error: `File not found: ${abs}` };
    }
    try {
      const mod = require(abs); // eslint-disable-line import/no-dynamic-require
      _validate(mod);

      // Register commands with the router
      if (mod.commands && router) {
        for (const [cmd, fn] of Object.entries(mod.commands)) {
          if (typeof fn === 'function') {
            try { router.registerCommand(cmd, fn); } catch (_) {}
          }
        }
      }

      _loaded.set(mod.name, { manifest: mod, handle: mod, source: 'host', path: abs });
      if (kernel) kernel.bus.emit('module:loaded', { name: mod.name, version: mod.version, source: 'host' });
      return { ok: true, name: mod.name };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ---------------------------------------------------------------------------
  // loadFromVFS — load a JSON module manifest from the VFS
  // Metadata-only (no executable code). Used for documenting available modules.
  // ---------------------------------------------------------------------------
  function loadFromVFS(vfsPath) {
    if (!fs) return { ok: false, error: 'No filesystem available' };
    const r = fs.read(vfsPath);
    if (!r.ok) return { ok: false, error: r.error };
    try {
      const mod = JSON.parse(r.content);
      _validate(mod);
      _loaded.set(mod.name, { manifest: mod, handle: null, source: 'vfs', path: vfsPath });
      if (kernel) kernel.bus.emit('module:loaded', { name: mod.name, version: mod.version, source: 'vfs' });
      return { ok: true, name: mod.name };
    } catch (e) {
      return { ok: false, error: `Parse failed: ${e.message}` };
    }
  }

  // ---------------------------------------------------------------------------
  // unload — remove module and its router commands
  // ---------------------------------------------------------------------------
  function unload(name) {
    const entry = _loaded.get(name);
    if (!entry) return { ok: false, error: `Module not loaded: ${name}` };

    if (entry.handle && entry.handle.commands && router) {
      for (const cmd of Object.keys(entry.handle.commands)) {
        try { router.unregisterCommand(cmd); } catch (_) {}
      }
    }

    _loaded.delete(name);
    if (kernel) kernel.bus.emit('module:unloaded', { name });
    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // list / get
  // ---------------------------------------------------------------------------
  function list() {
    return Array.from(_loaded.values()).map(e => ({
      name:        e.manifest.name,
      version:     e.manifest.version,
      description: e.manifest.description || '',
      source:      e.source,
      path:        e.path,
    }));
  }

  function get(name) {
    const entry = _loaded.get(name);
    return entry ? entry.manifest : null;
  }

  // ---------------------------------------------------------------------------
  // scanVFS — auto-load all .json manifests in /lib/modules
  // ---------------------------------------------------------------------------
  function scanVFS() {
    if (!fs) return;
    const r = fs.ls('/lib/modules');
    if (!r.ok) return;
    for (const entry of r.entries) {
      if (entry.type === 'file' && entry.name.endsWith('.json')) {
        loadFromVFS(`/lib/modules/${entry.name}`);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Router commands
  // ---------------------------------------------------------------------------
  const commands = {
    modload: (args) => {
      if (!args[0]) return { status: 'error', result: 'Usage: modload <host-path|/vfs/path>' };
      const path = args[0];
      const r    = (path.startsWith('/lib/') || path.startsWith('/etc/'))
        ? loadFromVFS(path)
        : loadFromHost(path);
      return { status: r.ok ? 'ok' : 'error', result: r.ok ? `Loaded: ${r.name}` : r.error };
    },

    modunload: (args) => {
      if (!args[0]) return { status: 'error', result: 'Usage: modunload <name>' };
      const r = unload(args[0]);
      return { status: r.ok ? 'ok' : 'error', result: r.ok ? `Unloaded: ${args[0]}` : r.error };
    },

    modlist: (_args) => {
      const mods = list();
      if (!mods.length) return { status: 'ok', result: 'No dynamic modules loaded.' };
      const lines = mods.map(m =>
        `  ${m.name.padEnd(24)} v${m.version.padEnd(10)} [${m.source}]  ${m.description}`
      );
      return { status: 'ok', result: lines.join('\n') };
    },
  };

  return {
    name:         'module-loader',
    loadFromHost,
    loadFromVFS,
    unload,
    list,
    get,
    scanVFS,
    commands,
  };
}

module.exports = { createModuleLoader };
