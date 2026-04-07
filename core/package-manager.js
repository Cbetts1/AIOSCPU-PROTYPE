'use strict';
/**
 * package-manager.js — AIOS Package Manager (apm) v2.0.0
 *
 * Installs, removes, and manages AIOS packages.
 * A package is a JSON descriptor (.aipkg) stored in the AIOS VFS.
 *
 * Package format (JSON):
 * {
 *   "name": "my-package",
 *   "version": "1.0.0",
 *   "description": "...",
 *   "author": "...",
 *   "files": { "/path/in/vfs": "file contents..." },
 *   "scripts": { "/bin/my-script": "echo hello" },
 *   "commands": { "mycommand": "function body as AIOS shell string" },
 *   "services": { "my-svc": { "start": "sh /bin/my-script", "stop": "" } },
 *   "dependencies": ["other-package"],
 *   "install": "shell commands to run after install",
 *   "uninstall": "shell commands to run before remove"
 * }
 *
 * Package registry stored in /var/packages/registry.json
 * Installed packages stored in /var/packages/<name>/
 *
 * Zero external npm dependencies.
 */

function createPackageManager(kernel, filesystem, router, svcMgr, shell) {
  const REGISTRY_PATH = '/var/packages/registry.json';
  const PACKAGES_DIR  = '/var/packages';

  // Ensure dirs exist
  if (filesystem) {
    filesystem.mkdir(PACKAGES_DIR, { parents: true });
    filesystem.mkdir('/bin', { parents: true });
    filesystem.mkdir('/etc/packages', { parents: true });
  }

  // ── Registry helpers ────────────────────────────────────────────────────────
  function _loadRegistry() {
    if (!filesystem) return {};
    const r = filesystem.read(REGISTRY_PATH);
    if (!r.ok) return {};
    try { return JSON.parse(r.content); } catch(_) { return {}; }
  }

  function _saveRegistry(registry) {
    if (!filesystem) return;
    filesystem.write(REGISTRY_PATH, JSON.stringify(registry, null, 2));
  }

  function _emit(event, data) {
    if (kernel) kernel.bus.emit(event, data);
  }

  function _log(msg) {
    if (filesystem) filesystem.append('/var/log/apm.log', '[' + new Date().toISOString() + '] ' + msg + '\n');
    process.stdout.write('[apm] ' + msg + '\n');
  }

  // ── Install ─────────────────────────────────────────────────────────────────
  async function install(source) {
    let pkg;

    // Source can be: a VFS path to .aipkg, a JSON string, or a plain object
    if (typeof source === 'object' && source !== null) {
      pkg = source;
    } else if (typeof source === 'string') {
      let content = source;
      // Try to read from VFS
      if (filesystem && (source.startsWith('/') || source.includes('.aipkg'))) {
        const r = filesystem.read(source);
        if (r.ok) content = r.content;
      }
      try { pkg = JSON.parse(content); } catch(e) {
        return { ok: false, error: 'Invalid package format: ' + e.message };
      }
    } else {
      return { ok: false, error: 'Source must be a path, JSON string, or package object' };
    }

    // Validate required fields
    if (!pkg.name || typeof pkg.name !== 'string') {
      return { ok: false, error: 'Package must have a "name" field' };
    }
    if (!pkg.version) pkg.version = '0.0.1';

    const registry = _loadRegistry();

    // Check if already installed
    if (registry[pkg.name]) {
      _log('Package "' + pkg.name + '" already installed (v' + registry[pkg.name].version + '). Use apm upgrade to update.');
    }

    _log('Installing ' + pkg.name + ' v' + pkg.version + '...');
    _emit('apm:install-start', { name: pkg.name, version: pkg.version });

    const pkgDir = PACKAGES_DIR + '/' + pkg.name;
    if (filesystem) filesystem.mkdir(pkgDir, { parents: true });

    // 1. Write files into VFS
    if (pkg.files && typeof pkg.files === 'object') {
      for (const [path, content] of Object.entries(pkg.files)) {
        if (filesystem) {
          const dirPath = path.split('/').slice(0, -1).join('/');
          if (dirPath) filesystem.mkdir(dirPath, { parents: true });
          filesystem.write(path, String(content));
          _log('  Wrote file: ' + path);
        }
      }
    }

    // 2. Install scripts to /bin
    if (pkg.scripts && typeof pkg.scripts === 'object') {
      for (const [path, content] of Object.entries(pkg.scripts)) {
        if (filesystem) {
          filesystem.write(path, String(content));
          _log('  Installed script: ' + path);
        }
      }
    }

    // 3. Register router commands
    if (pkg.commands && typeof pkg.commands === 'object' && router) {
      for (const [cmdName, handlerSrc] of Object.entries(pkg.commands)) {
        const handlerStr = String(handlerSrc);
        router.registerCommand(cmdName, async (args) => {
          if (shell) {
            let captured = '';
            const orig = process.stdout.write.bind(process.stdout);
            process.stdout.write = (d) => { captured += String(d); return true; };
            try { await shell.runScript(handlerStr, args); } finally { process.stdout.write = orig; }
            return { status: 'ok', result: captured.trim() };
          }
          return { status: 'ok', result: '(shell not available)' };
        });
        _log('  Registered command: ' + cmdName);
      }
    }

    // 4. Register services
    if (pkg.services && typeof pkg.services === 'object' && svcMgr) {
      for (const [svcName, svcDef] of Object.entries(pkg.services)) {
        const startCmd = svcDef.start || '';
        const stopCmd  = svcDef.stop  || '';
        svcMgr.register(svcName, {
          async start() {
            if (startCmd && shell) await shell.runScript(startCmd, []);
          },
          async stop() {
            if (stopCmd && shell) await shell.runScript(stopCmd, []);
          },
        });
        if (svcDef.autostart) {
          svcMgr.start(svcName).catch(() => {});
        }
        _log('  Registered service: ' + svcName);
      }
    }

    // 5. Run install hook
    if (pkg.install && shell) {
      try {
        await shell.runScript(pkg.install, []);
        _log('  Install hook ran OK');
      } catch (e) {
        _log('  Install hook error: ' + e.message);
      }
    }

    // 6. Update registry
    registry[pkg.name] = {
      name:        pkg.name,
      version:     pkg.version,
      description: pkg.description || '',
      installedAt: new Date().toISOString(),
      pkgDir,
    };
    _saveRegistry(registry);

    // Save package descriptor
    if (filesystem) {
      filesystem.write(pkgDir + '/package.json', JSON.stringify(pkg, null, 2));
    }

    _emit('apm:install-done', { name: pkg.name, version: pkg.version });
    _log('Installed ' + pkg.name + ' v' + pkg.version + ' successfully.');
    return { ok: true, name: pkg.name, version: pkg.version };
  }

  // ── Remove ──────────────────────────────────────────────────────────────────
  async function remove(name) {
    const registry = _loadRegistry();
    if (!registry[name]) return { ok: false, error: 'Package "' + name + '" is not installed' };

    _log('Removing ' + name + '...');
    _emit('apm:remove-start', { name });

    const pkgDir = PACKAGES_DIR + '/' + name;

    // Load the descriptor to run uninstall hook and clean up
    if (filesystem) {
      const r = filesystem.read(pkgDir + '/package.json');
      if (r.ok) {
        let pkg;
        try { pkg = JSON.parse(r.content); } catch(_) {}
        if (pkg) {
          // Run uninstall hook
          if (pkg.uninstall && shell) {
            try { await shell.runScript(pkg.uninstall, []); } catch(_) {}
          }
          // Remove files
          if (pkg.files) {
            Object.keys(pkg.files).forEach(p => {
              try { filesystem.rm(p); } catch(_) {}
            });
          }
          if (pkg.scripts) {
            Object.keys(pkg.scripts).forEach(p => {
              try { filesystem.rm(p); } catch(_) {}
            });
          }
          // Unregister commands
          if (pkg.commands && router) {
            Object.keys(pkg.commands).forEach(c => {
              try { router.unregisterCommand(c); } catch(_) {}
            });
          }
          // Stop and unregister services
          if (pkg.services && svcMgr) {
            for (const svcName of Object.keys(pkg.services)) {
              try {
                await svcMgr.stop(svcName);
              } catch(_) {}
            }
          }
        }
      }
      // Remove package directory
      try { filesystem.rm(pkgDir, { recursive: true }); } catch(_) {}
    }

    delete registry[name];
    _saveRegistry(registry);
    _emit('apm:remove-done', { name });
    _log('Removed ' + name + '.');
    return { ok: true };
  }

  // ── Upgrade ─────────────────────────────────────────────────────────────────
  async function upgrade(source) {
    // Install the new version (install() handles overwrite)
    return install(source);
  }

  // ── List installed packages ──────────────────────────────────────────────────
  function list() {
    const registry = _loadRegistry();
    return Object.values(registry);
  }

  // ── Show package info ─────────────────────────────────────────────────────────
  function info(name) {
    const registry = _loadRegistry();
    const entry = registry[name];
    if (!entry) return { ok: false, error: 'Package "' + name + '" not installed' };
    return { ok: true, ...entry };
  }

  // ── Create a new package skeleton ─────────────────────────────────────────────
  function create(name, description) {
    if (!filesystem) return { ok: false, error: 'No filesystem' };
    const pkg = {
      name:        name || 'my-package',
      version:     '1.0.0',
      description: description || 'An AIOS package',
      author:      'aios-user',
      files:    (function(){ const f = {}; f['/home/user/' + (name||'my-package') + '/README.md'] = '# ' + (name||'my-package') + '\n\n' + (description||''); return f; }()),
      scripts:  {},
      commands: {},
      services: {},
      install:  'echo "' + (name||'pkg') + ' installed"',
      uninstall:'echo "' + (name||'pkg') + ' removed"',
    };
    const path = '/home/user/' + (name||'my-package') + '.aipkg';
    filesystem.write(path, JSON.stringify(pkg, null, 2));
    return { ok: true, path };
  }

  // ── Router command module interface ──────────────────────────────────────────
  const commands = {
    apm: async (args) => {
      const sub = (args[0] || '').toLowerCase();

      if (!sub || sub === 'list') {
        const pkgs = list();
        if (!pkgs.length) return { status: 'ok', result: 'No packages installed.\nUse: apm install <path.aipkg>' };
        const out = pkgs.map(p =>
          '  ' + p.name.padEnd(24) + 'v' + p.version.padEnd(12) + (p.description || '')
        );
        return { status: 'ok', result: 'Installed packages:\n' + out.join('\n') };
      }

      if (sub === 'install') {
        const src = args.slice(1).join(' ');
        if (!src) return { status: 'error', result: 'Usage: apm install <path.aipkg | JSON>' };
        const r = await install(src);
        return r.ok ? { status: 'ok', result: 'Installed ' + r.name + ' v' + r.version } : { status: 'error', result: r.error };
      }

      if (sub === 'remove' || sub === 'uninstall') {
        const name = args[1];
        if (!name) return { status: 'error', result: 'Usage: apm remove <name>' };
        const r = await remove(name);
        return r.ok ? { status: 'ok', result: 'Removed ' + name } : { status: 'error', result: r.error };
      }

      if (sub === 'upgrade') {
        const src = args.slice(1).join(' ');
        if (!src) return { status: 'error', result: 'Usage: apm upgrade <path.aipkg | JSON>' };
        const r = await upgrade(src);
        return r.ok ? { status: 'ok', result: 'Upgraded ' + r.name + ' to v' + r.version } : { status: 'error', result: r.error };
      }

      if (sub === 'info') {
        const name = args[1];
        if (!name) return { status: 'error', result: 'Usage: apm info <name>' };
        const r = info(name);
        if (!r.ok) return { status: 'error', result: r.error };
        return { status: 'ok', result: [
          'Name        : ' + r.name,
          'Version     : ' + r.version,
          'Description : ' + (r.description || ''),
          'Installed   : ' + r.installedAt,
          'Location    : ' + r.pkgDir,
        ].join('\n') };
      }

      if (sub === 'create') {
        const name = args[1], desc = args.slice(2).join(' ');
        const r = create(name, desc);
        return r.ok ? { status: 'ok', result: 'Package skeleton created at: ' + r.path } : { status: 'error', result: r.error };
      }

      return {
        status: 'ok',
        result: [
          'AIOS Package Manager (apm)',
          '',
          'Usage: apm <command>',
          '',
          'Commands:',
          '  list               List installed packages',
          '  install <src>      Install from .aipkg file path or JSON',
          '  remove  <name>     Remove a package',
          '  upgrade <src>      Upgrade to new version',
          '  info    <name>     Show package details',
          '  create  <name>     Create a new package skeleton',
        ].join('\n'),
      };
    },
  };

  return {
    name:    'package-manager',
    version: '4.0.0',
    install,
    remove,
    upgrade,
    list,
    info,
    create,
    commands,
  };
}

module.exports = { createPackageManager };
