'use strict';
/**
 * init.js — AIOS PID-1 Boot Init v1.0.0
 *
 * The AIOS OS Integration Layer boot init system.
 * This module acts as PID 1 inside the AIOS environment.
 * It is called by bootstrap.js after the RootFS has been built and
 * the environment has been pivoted.
 *
 * Responsibilities:
 *   1. Activate boot targets in order (sysinit → basic → multi-user)
 *   2. Start each unit in dependency order within each target
 *   3. Enforce restart policies for failed units
 *   4. Emit clean operator-grade boot log entries
 *   5. Provide graceful shutdown and reboot sequences
 *   6. Hand control to the terminal after boot
 *
 * Uses:
 *   - core/init.js       (unit registration and target activation)
 *   - usr/lib/aios/init-targets.js  (target + unit definitions)
 *   - usr/lib/aios/service-runner.js (JSON service unit loading)
 *
 * Zero external npm dependencies.
 */

const { createInit, TARGETS: CORE_TARGETS } = require('../core/init.js');
const { TARGET_ORDER, getDependencyOrder, getTargetUnits } = require('../usr/lib/aios/init-targets.js');
const { createServiceRunner }               = require('../usr/lib/aios/service-runner.js');

// ---------------------------------------------------------------------------
// Boot log helper
// ---------------------------------------------------------------------------
function _bootLog(tag, msg) {
  const OK   = '\x1b[32m[ OK ]\x1b[0m';
  const FAIL = '\x1b[31m[FAIL]\x1b[0m';
  const INFO = '\x1b[36m[INFO]\x1b[0m';
  const WARN = '\x1b[33m[WARN]\x1b[0m';
  const icon = tag === 'ok'   ? OK
             : tag === 'fail' ? FAIL
             : tag === 'warn' ? WARN
             : INFO;
  process.stdout.write(`  ${icon}  ${msg}\n`);
}

function _ts() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ---------------------------------------------------------------------------
// createBootInit — factory
// ---------------------------------------------------------------------------
function createBootInit(context) {
  const {
    kernel,
    vfs,
    cpu,
    hostBridge,
    perms,
    aiCore,
    router,
    svcMgr,
    mirrorMgr,
    processModel,
    procfs,
    envLoader,
    scheduler,
    identity,
    terminal,
  } = context;

  const _coreInit    = createInit(kernel, null);
  const _svcRunner   = createServiceRunner(vfs, kernel, svcMgr);
  const _bootLog_vfs = (msg) => {
    if (vfs) vfs.append('/var/log/boot.log', `[${_ts()}] ${msg}\n`);
  };

  // Map unit names → start functions
  // These are the implementation stubs that the init-targets units reference.
  const _unitHandlers = {};

  // ── sysinit handlers ─────────────────────────────────────────────────────
  _unitHandlers['kernel.init'] = async () => {
    // Kernel is already booted by bootstrap.js; just register the unit.
    if (!kernel.isBooted()) kernel.boot();
  };

  _unitHandlers['filesystem.mount'] = async () => {
    // VFS is already initialized; confirm.
  };

  _unitHandlers['rootfs.build'] = async () => {
    // RootFS was built by bootstrap.js; confirm.
  };

  _unitHandlers['identity.init'] = async () => {
    if (identity && typeof identity.init === 'function') {
      identity.init();
    }
  };

  _unitHandlers['process-model.init'] = async () => {
    if (processModel) {
      // Spawn virtual representations of existing kernel modules
      processModel.spawn('kernel', { cmdline: '/core/kernel.js', priority: 0 });
      processModel.spawn('filesystem', { cmdline: '/core/filesystem.js', priority: 0 });
    }
  };

  _unitHandlers['procfs.init'] = async () => {
    if (procfs) procfs.start();
  };

  // ── basic handlers ────────────────────────────────────────────────────────
  _unitHandlers['env.load'] = async () => {
    if (envLoader) envLoader.load();
  };

  _unitHandlers['cpu.init'] = async () => {
    if (cpu && processModel) {
      processModel.spawn('aioscpu', { cmdline: '/core/cpu.js', priority: 0 });
    }
  };

  _unitHandlers['host-bridge.init'] = async () => {
    if (hostBridge && processModel) {
      processModel.spawn('host-bridge', { cmdline: '/core/host-bridge.js', priority: 1 });
    }
  };

  _unitHandlers['permissions.init'] = async () => {
    // Permissions already initialized in bootstrap.js
  };

  _unitHandlers['scheduler.init'] = async () => {
    if (scheduler) scheduler.start();
  };

  _unitHandlers['ai-core.init'] = async () => {
    if (aiCore && processModel) {
      processModel.spawn('ai-core', { cmdline: '/core/ai-core.js', priority: 1 });
    }
  };

  // ── multi-user handlers ───────────────────────────────────────────────────
  _unitHandlers['router.init'] = async () => {
    if (router && processModel) {
      processModel.spawn('router', { cmdline: '/core/router.js', priority: 1 });
    }
  };

  _unitHandlers['service-manager.init'] = async () => {
    if (svcMgr && processModel) {
      processModel.spawn('service-manager', { cmdline: '/core/service-manager.js', priority: 1 });
    }
  };

  _unitHandlers['services.start'] = async () => {
    // Load JSON service units from VFS
    const r = _svcRunner.loadFromVFS({});
    _bootLog_vfs(`Service units loaded: ${r.loaded}`);

    // Start all units
    await _svcRunner.startAll();
  };

  _unitHandlers['mirror.init'] = async () => {
    if (mirrorMgr && processModel) {
      processModel.spawn('mirror', { cmdline: '/core/mirror-session.js', priority: 2 });
    }
  };

  _unitHandlers['terminal.start'] = async () => {
    // Terminal is started by bootstrap.js after init.boot() returns
  };

  // ---------------------------------------------------------------------------
  // _registerUnits — register all built-in units with core init system
  // ---------------------------------------------------------------------------
  function _registerUnits() {
    for (const target of TARGET_ORDER) {
      const units = getDependencyOrder(getTargetUnits(target));
      for (const unitDef of units) {
        const handler = _unitHandlers[unitDef.name];
        _coreInit.registerUnit(unitDef.name, {
          target:      target,
          description: unitDef.description,
          start:       handler || (async () => {}),
          stop:        async () => {},
          restartPolicy:  unitDef.restartPolicy,
          crashRecovery:  unitDef.crashRecovery,
          maxRestarts:    unitDef.maxRestarts,
          restartDelay:   unitDef.restartDelay,
        });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // boot — run the full init sequence
  // ---------------------------------------------------------------------------
  async function boot() {
    process.stdout.write('\n');
    _bootLog('info', `AIOS Init System — PID 1 — ${new Date().toISOString()}`);
    _bootLog_vfs('Init system started (PID 1)');

    _registerUnits();

    for (const target of TARGET_ORDER) {
      process.stdout.write(`\n  \x1b[35m[TARGET]\x1b[0m  Entering target: ${target}\n`);
      _bootLog_vfs(`Entering target: ${target}`);

      const units = getDependencyOrder(getTargetUnits(target));
      let ok = 0; let failed = 0;

      for (const unitDef of units) {
        const result = await _coreInit.startUnit(unitDef.name);
        if (result.ok) {
          _bootLog('ok', unitDef.description || unitDef.name);
          _bootLog_vfs(`  [ OK ] ${unitDef.name}`);
          ok++;
        } else {
          _bootLog('warn', `${unitDef.description || unitDef.name}  [degraded: ${result.error}]`);
          _bootLog_vfs(`  [WARN] ${unitDef.name}: ${result.error}`);
          failed++;

          // Crash recovery
          if (unitDef.crashRecovery && unitDef.maxRestarts > 0) {
            let attempts = 0;
            while (attempts < unitDef.maxRestarts) {
              attempts++;
              await _delay(unitDef.restartDelay || 1000);
              const r2 = await _coreInit.startUnit(unitDef.name);
              if (r2.ok) {
                _bootLog('ok', `${unitDef.name} recovered (attempt ${attempts})`);
                _bootLog_vfs(`  [ OK ] ${unitDef.name} recovered`);
                failed--;
                ok++;
                break;
              }
            }
          }
        }
      }

      process.stdout.write(`  \x1b[35m[TARGET]\x1b[0m  ${target} complete — ${ok} ok, ${failed} degraded\n`);
      _bootLog_vfs(`Target ${target}: ${ok} ok, ${failed} degraded`);
    }

    process.stdout.write('\n');
    _bootLog('ok', 'All targets reached — OS operational');
    _bootLog_vfs('Boot sequence complete');
    kernel.bus.emit('init:boot:complete', { time: Date.now() });

    return { ok: true };
  }

  // ---------------------------------------------------------------------------
  // shutdown — graceful OS shutdown
  // ---------------------------------------------------------------------------
  async function shutdown(reboot = false) {
    process.stdout.write(`\n  \x1b[33m[SHUTDOWN]\x1b[0m  ${reboot ? 'Reboot' : 'Shutdown'} initiated…\n`);
    _bootLog_vfs(`Shutdown initiated (reboot=${reboot})`);

    // Stop procfs and scheduler first
    if (procfs)    procfs.stop();
    if (scheduler) scheduler.stop();

    // Stop all services
    if (svcMgr) await svcMgr.stopAll().catch(() => {});

    // Unmount mirrors
    if (mirrorMgr) {
      mirrorMgr.list().forEach(m => {
        try { mirrorMgr.unmount(m.type); } catch (_) {}
      });
    }

    // Write shutdown log
    if (vfs) {
      vfs.append('/var/log/boot.log', `[${_ts()}] System shutdown after ${kernel.uptime()}s\n`);
    }

    await _coreInit.shutdown(reboot);
    kernel.shutdown();

    _bootLog_vfs('Shutdown complete');
    process.stdout.write('  \x1b[33m[SHUTDOWN]\x1b[0m  Goodbye.\n\n');
  }

  // ---------------------------------------------------------------------------
  // status — return init status
  // ---------------------------------------------------------------------------
  function status() {
    return {
      target:    _coreInit.currentTarget(),
      units:     _coreInit.unitList(),
      services:  _svcRunner.list(),
    };
  }

  return {
    name:     'boot-init',
    boot,
    shutdown,
    status,
    svcRunner: _svcRunner,
    coreInit:  _coreInit,
  };
}

function _delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { createBootInit };
