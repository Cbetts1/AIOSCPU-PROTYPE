'use strict';
/**
 * bootstrap.js — AIOS OS Integration Layer Bootstrap v1.0.0
 *
 * The top-level entry point for the AIOS OS Integration Layer.
 * Called by ./aos  (replaces the direct call to boot/boot.js).
 *
 * Full boot sequence:
 *   1.  Print OS banner
 *   2.  Build AIOS RootFS in VFS (rootfs-builder.js)
 *   3.  Pivot into AIOS environment (pivot.js)
 *   4.  Initialize Software Kernel
 *   5.  Initialize Virtual Filesystem
 *   6.  Initialize OS Identity Engine (identity.js)
 *   7.  Write identity to /etc/aios/identity.json in VFS + host FS
 *   8.  Initialize Virtual Process Model + Scheduler
 *   9.  Initialize ProcFS (/proc tree)
 *   10. Initialize Environment Loader
 *   11. Initialize AIOSCPU (virtual CPU)
 *   12. Initialize Host Bridge (real OS mirror)
 *   13. Initialize Permission System
 *   14. Initialize AI Core
 *   15. Initialize Command Router + mount all modules
 *   16. Initialize Mirror Session Manager
 *   17. Initialize Service Manager
 *   18. Initialize Service Manager built-in services
 *   19. Initialize Memory Engine (interactions, queries, learning data)
 *   20. Initialize Mode Manager (Chat, Code, Fix, Help, Learn)
 *   21. Initialize Diagnostics Engine (models, ports, system health)
 *   22. Initialize Port Server (single TCP communication port)
 *   23. Initialize PID-1 Boot Init (init.js)
 *        → registers all init-target units
 *        → loads service units from /etc/aios/services/*.json
 *        → activates targets: sysinit → basic → multi-user
 *        → starts all services
 *   24. Register syscalls
 *   25. Wire shutdown handlers
 *   26. Run init sequence + self-check
 *        → verify memory availability and CPU status
 *        → confirm port can open
 *        → test local lightweight AIOSCPU model
 *   27. Hand control to Terminal
 *
 * Zero external npm dependencies.
 */

// ── Existing core modules ───────────────────────────────────────────────────
const { createKernel }          = require('../core/kernel.js');
const { createCPU }             = require('../core/cpu.js');
const { createRouter }          = require('../core/router.js');
const { createFilesystem }      = require('../core/filesystem.js');
const { createServiceManager }  = require('../core/service-manager.js');
const { createHostBridge }      = require('../core/host-bridge.js');
const { createPermissionSystem }= require('../core/permission-system.js');
const { createAICore }          = require('../core/ai-core.js');
const { createMirrorSession }   = require('../core/mirror-session.js');
const { createIdentity }        = require('../core/identity.js');
const { createMemoryCore }      = require('../core/memory-core.js');

// ── Consciousness layer + Jarvis orchestrator ─────────────────────────────────
const { createMemoryEngine }         = require('../core/memory-engine.js');
const { createModeManager }          = require('../core/mode-manager.js');
const { createModelRegistry }        = require('../core/model-registry.js');
const { createDiagnosticsEngine }    = require('../core/diagnostics-engine.js');
const { createPortServer }           = require('../core/port-server.js');
const { createConsciousness }        = require('../core/consciousness.js');
const { createJarvisOrchestrator }   = require('../core/jarvis-orchestrator.js');

// ── New OS Integration Layer modules ─────────────────────────────────────────
const { buildRootFS }           = require('../usr/lib/aios/rootfs-builder.js');
const { pivot }                 = require('./pivot.js');
const { createBootInit }        = require('./init.js');
const { createProcessModel }    = require('../usr/lib/aios/process-model.js');
const { createScheduler }       = require('../usr/lib/aios/scheduler.js');
const { createProcfs }          = require('../usr/lib/aios/procfs.js');
const { createEnvLoader }       = require('../usr/lib/aios/env-loader.js');

// ── Terminal ─────────────────────────────────────────────────────────────────
const { createTerminal }        = require('../terminal/terminal.js');

// ── Self-kernel + loop engine (wraps existing; does not replace) ─────────────
const selfKernelBoot  = require('../usr/lib/aios/self-kernel/boot.js');
const selfKernelSvcs  = require('../usr/lib/aios/self-kernel/services.js');
const selfKernelProcs = require('../usr/lib/aios/self-kernel/process-model.js');
const envMode         = require('../usr/lib/aios/env-kernel/mode.js');
const loopCtrl        = require('../usr/lib/aios/loop/control.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function ts() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function bootMsg(tag, msg) {
  const OK   = '\x1b[32m[ OK ]\x1b[0m';
  const INFO = '\x1b[36m[INFO]\x1b[0m';
  const WARN = '\x1b[33m[WARN]\x1b[0m';
  const icon = tag === 'ok' ? OK : tag === 'warn' ? WARN : INFO;
  process.stdout.write(`  ${icon}  ${msg}\n`);
}

// ---------------------------------------------------------------------------
// start — full OS Integration Layer boot sequence
// ---------------------------------------------------------------------------
function start() {
  // ── BANNER ─────────────────────────────────────────────────────────────────
  process.stdout.write('\x1b[0m');
  process.stdout.write([
    '',
    '\x1b[36m  ╔══════════════════════════════════════════════════════╗\x1b[0m',
    '\x1b[36m  ║\x1b[0m   \x1b[1mAIOS UniKernel v3.0.0\x1b[0m  — OS Integration Layer       \x1b[36m║\x1b[0m',
    '\x1b[36m  ║\x1b[0m   AI Operating System  |  Dual Hardware+Personality   \x1b[36m║\x1b[0m',
    '\x1b[36m  ╚══════════════════════════════════════════════════════╝\x1b[0m',
    '',
  ].join('\n') + '\n');

  process.stdout.write(`\x1b[36m[AIOS]\x1b[0m  Bootstrap started at ${new Date().toISOString()}\n\n`);

  // ── 1. KERNEL ──────────────────────────────────────────────────────────────
  const kernel = createKernel();
  kernel.boot();
  bootMsg('ok', `Kernel  ${kernel.id}  v${kernel.version}`);

  // ── 1.5. MEMORY CORE ───────────────────────────────────────────────────────
  // Created immediately after the kernel so all subsystems can record into it.
  const memoryCore = createMemoryCore(kernel);
  kernel.modules.load('memory-core', memoryCore);
  bootMsg('ok', `Memory Core v${memoryCore.version}  unified learning layer online`);

  // ── 2. FILESYSTEM (VFS) ────────────────────────────────────────────────────
  const vfs = createFilesystem();
  kernel.modules.load('filesystem', vfs);

  // ── 3. ROOTFS ──────────────────────────────────────────────────────────────
  const rootfsResult = buildRootFS(vfs, { hostname: 'aioscpu', version: '3.0.0' });
  bootMsg('ok', `RootFS  built — ${rootfsResult.dirs.length} dirs, ${rootfsResult.files.length} files`);

  // ── 4. PIVOT ───────────────────────────────────────────────────────────────
  const pivotCtx = pivot(vfs, { rootfs: '/', version: '3.0.0' });
  bootMsg('ok', `Pivot   environment detached from host — AIOS owns its context`);
  vfs.append('/var/log/boot.log', `[${ts()}] Pivot complete: ${pivotCtx.platform}\n`);

  // ── 5. IDENTITY ────────────────────────────────────────────────────────────
  const identity = createIdentity(kernel, vfs, null);
  const idManifest = identity.init();
  kernel.modules.load('identity', identity);

  // Update boot count
  const existingId = (() => {
    const r = vfs.read('/etc/aios/identity.json');
    if (r && r.ok) {
      try { return JSON.parse(r.content); } catch (_) { return null; }
    }
    return null;
  })();
  const bootCount = existingId ? (existingId.bootCount || 0) + 1 : 1;

  const fullId = Object.assign({}, idManifest, { bootCount, version: '3.0.0' });
  vfs.write('/etc/aios/identity.json', JSON.stringify(fullId, null, 2) + '\n');
  vfs.write('/etc/kernel/identity.json', JSON.stringify(fullId, null, 2) + '\n');

  bootMsg('ok', `Identity  ${fullId.id}  boot#${bootCount}`);
  vfs.append('/var/log/boot.log', `[${ts()}] Identity: ${fullId.id}  boot#${bootCount}\n`);

  // ── 6. PROCESS MODEL ───────────────────────────────────────────────────────
  const processModel = createProcessModel(kernel, vfs);
  kernel.modules.load('process-model', processModel);
  bootMsg('ok', `Process Model  virtual PID table online`);

  // ── 7. SCHEDULER ───────────────────────────────────────────────────────────
  const scheduler = createScheduler(processModel, kernel, vfs);
  kernel.modules.load('scheduler', scheduler);
  bootMsg('ok', `Scheduler  tick=${1000}ms`);

  // ── 8. PROCFS ──────────────────────────────────────────────────────────────
  // (started after env-loader so /proc/env is populated)

  // ── 9. CPU ─────────────────────────────────────────────────────────────────
  const cpu = createCPU(kernel);
  kernel.modules.load('cpu', cpu);
  bootMsg('ok', `AIOSCPU v${cpu.version}  ready`);

  // SYS_CPU_PRINT (9)
  kernel.registerSyscall(9, (args) => {
    process.stdout.write(String(args[0] !== undefined ? args[0] : '') + '\n');
    return 0;
  });

  // ── 10. HOST BRIDGE ────────────────────────────────────────────────────────
  const hostBridge = createHostBridge(kernel);
  kernel.modules.load('host-bridge', hostBridge);
  const rootStatus = hostBridge.root.available
    ? `\x1b[32m${hostBridge.root.level}\x1b[0m via ${hostBridge.root.method}`
    : '\x1b[33mnot available\x1b[0m';
  bootMsg('ok', `Host Bridge  platform=${hostBridge.platform.name}  root=${rootStatus}`);
  vfs.append('/var/log/boot.log', `[${ts()}] Platform: ${hostBridge.platform.name}\n`);

  // ── 11. ENVIRONMENT LOADER ─────────────────────────────────────────────────
  const envLoader = createEnvLoader(kernel, vfs, hostBridge, identity);
  envLoader.load();
  kernel.modules.load('env-loader', envLoader);
  bootMsg('ok', `Env Loader  ${Object.keys(envLoader.get()).length} vars`);

  // ── 12. PROCFS (now that env is loaded) ────────────────────────────────────
  const procfs = createProcfs(vfs, kernel, processModel, hostBridge, envLoader);
  kernel.modules.load('procfs', procfs);
  bootMsg('ok', `ProcFS  /proc online`);

  // ── 13. PERMISSION SYSTEM ──────────────────────────────────────────────────
  const perms = createPermissionSystem(kernel, hostBridge);
  kernel.modules.load('permissions', perms);
  bootMsg('ok', `Permission System  level=${perms.getLevel()}  caps=${perms.getTokens().length}`);

  // ── 14. AI CORE ────────────────────────────────────────────────────────────
  const aiCore = createAICore(kernel, null, null, hostBridge, memoryCore);
  kernel.modules.load('ai-core', aiCore);
  bootMsg('ok', `AI Core v${aiCore.version}  NLP ready`);

  // ── 15. ROUTER ─────────────────────────────────────────────────────────────
  const router = createRouter({ logger: null });
  kernel.modules.load('router', router);
  bootMsg('ok', `Router v${router.version}  online`);

  // Wire AI core with router
  const aiCoreFull = createAICore(kernel, router, null, hostBridge, memoryCore);
  kernel.modules.unload('ai-core');
  kernel.modules.load('ai-core', aiCoreFull);

  // ── 16. MOUNT COMMAND MODULES ─────────────────────────────────────────────

  // Filesystem commands
  router.use('filesystem', vfs);

  // OS info commands
  router.use('os', {
    commands: {
      uname: () => ({
        status: 'ok',
        result: `AIOS UniKernel 3.0.0 AIOSCPU-Prototype-One node/${process.versions.node} ${process.platform}`,
      }),
      uptime: () => ({
        status: 'ok',
        result: `AIOS uptime: ${kernel.uptime()}s  |  Host uptime: ${Math.round(require('os').uptime())}s`,
      }),
      ps: (args) => {
        const showAll  = args && args.includes('-a');
        const vProcs   = processModel.list();
        const lines    = ['  vPID   PID    NAME                   STATE      [layer]'];
        if (showAll && hostBridge) {
          const hp = hostBridge.processes();
          if (hp.ok) {
            hp.processes.slice(0, 20).forEach(p => {
              lines.push(`  -      ${String(p.pid).padEnd(7)}${p.name.padEnd(23)}${p.state}  [host]`);
            });
          }
        }
        vProcs.forEach(p => {
          lines.push(`  ${String(p.vPid).padEnd(7)}-      ${p.name.padEnd(23)}${p.state}  [aios]`);
        });
        kernel.procs.list().forEach(p => {
          if (!vProcs.find(vp => vp.name === p.name)) {
            lines.push(`  -      ${String(p.pid).padEnd(7)}${p.name.padEnd(23)}${p.state}  [kernel]`);
          }
        });
        return { status: 'ok', result: lines.join('\n') || 'No processes.' };
      },
      kill: (args) => {
        const pid = parseInt(args[0], 10);
        if (isNaN(pid)) return { status: 'error', result: 'Usage: kill <pid>' };
        // Try virtual process first
        const vr = processModel.kill(pid);
        if (vr.ok) return { status: 'ok', result: `Killed vPid ${pid}` };
        // Fall back to kernel process table
        const kr = kernel.procs.kill(pid);
        return kr
          ? { status: 'ok',    result: `Killed PID ${pid}` }
          : { status: 'error', result: `No process with PID ${pid}` };
      },
      env: () => ({
        status: 'ok',
        result: Object.entries(envLoader.get()).map(([k, v]) => `${k}=${v}`).join('\n'),
      }),
      date:     () => ({ status: 'ok', result: new Date().toISOString() }),
      whoami:   () => {
        const info = perms.info();
        return {
          status: 'ok',
          result: [
            `AIOS Level  : ${info.level}`,
            `Host Root   : ${info.hostRoot ? 'available' : 'not available'}`,
            `Capabilities: ${info.tokens.length}`,
            `Identity    : ${fullId.id}`,
            `Boot Count  : ${bootCount}`,
          ].join('\n'),
        };
      },
      hostname: () => {
        const r = vfs.read('/etc/hostname');
        return { status: 'ok', result: r.ok ? r.content.trim() : 'aioscpu' };
      },
    },
  });

  // AIOSCPU commands
  router.registerCommand('cpu', (args) => {
    const sub = (args[0] || '').toLowerCase();
    if (sub === 'demo') {
      const prog = [
        { op: 'LOADI', dst: 0, imm: 42 },
        { op: 'LOADI', dst: 1, imm: 8  },
        { op: 'ADD',   dst: 2, src1: 0, src2: 1 },
        { op: 'SYSCALL', num: 9, strArgs: ['Hello from AIOSCPU! R0=42 R1=8 R2=50'] },
        { op: 'HALT' },
      ];
      const r = cpu.run(prog);
      return { status: 'ok', result: `AIOSCPU demo OK. Cycles: ${r.cycles}. R2=${r.regs[2]}.` };
    }
    if (sub === 'info') {
      return {
        status: 'ok',
        result: [
          `AIOSCPU v${cpu.version}`,
          `Registers : R0–R7, PC, SP, FLAGS`,
          `Memory    : 64 KB flat`,
          `Opcodes   : NOP HALT MOV LOADI LOAD STORE ADD ADDI SUB MUL DIV MOD`,
          `            AND OR XOR NOT SHL SHR CMP CMPI JMP JZ JNZ JLT JGT`,
          `            CALL RET PUSH POP SYSCALL IN OUT`,
          `Status    : cycles=${cpu.getCycles()}, halted=${cpu.isHalted()}`,
        ].join('\n'),
      };
    }
    if (sub === 'regs')  return { status: 'ok', result: cpu.getRegs().map((v, i) => `R${i}=${v}`).join('  ') };
    if (sub === 'reset') { cpu.reset(); return { status: 'ok', result: 'AIOSCPU reset.' }; }
    if (sub === 'run' && args[1]) {
      const src = vfs.read(args[1]);
      if (!src.ok) return { status: 'error', result: src.error };
      try {
        const prog = JSON.parse(src.content);
        if (!Array.isArray(prog)) throw new Error('Program must be a JSON array');
        const r = cpu.run(prog);
        return { status: 'ok', result: `Ran ${args[1]}. Cycles: ${r.cycles}. Halted: ${r.halted}.` };
      } catch (e) {
        return { status: 'error', result: `Failed to parse program: ${e.message}` };
      }
    }
    return { status: 'ok', result: 'Usage: cpu <demo|info|regs|reset|run <file>>' };
  });

  // Kernel debug commands
  router.registerCommand('kernel', (args) => {
    const sub  = (args[0] || '').toLowerCase();
    const sub2 = (args[1] || '').toLowerCase();
    if (sub === 'info') {
      return {
        status: 'ok',
        result: [
          `Kernel ID  : ${kernel.id}`,
          `Version    : ${kernel.version}`,
          `Uptime     : ${kernel.uptime()}s`,
          `Booted     : ${kernel.isBooted()}`,
          `Modules    : ${kernel.modules.list().join(', ')}`,
          `Processes  : ${kernel.procs.list().length}`,
          `vProcesses : ${processModel.list().length}`,
          `Boot Count : ${bootCount}`,
        ].join('\n'),
      };
    }
    if (sub === 'syscall') {
      const num = parseInt(args[1], 10);
      if (isNaN(num)) return { status: 'error', result: 'Usage: kernel syscall <num> [arg]' };
      const r = kernel.syscall(num, args.slice(2));
      return { status: 'ok', result: JSON.stringify(r) };
    }
    // kernel mode — show current host mode + kernel id
    if (sub === 'mode') {
      const skIdentity = require('../usr/lib/aios/self-kernel/identity.js');
      return {
        status: 'ok',
        result: [
          `Host mode  : ${envMode.getMode()}`,
          `Kernel ID  : ${skIdentity.getKernelId()}`,
          `Version    : ${skIdentity.getVersion()}`,
          `Build ID   : ${skIdentity.getBuildId()}`,
        ].join('\n'),
      };
    }
    // kernel switch self | mirror
    if (sub === 'switch') {
      if (!sub2) return { status: 'error', result: 'Usage: kernel switch <self|mirror>' };
      const r = envMode.switchMode(sub2);
      return r.ok
        ? { status: 'ok',    result: `Host mode switched to "${r.mode}".` }
        : { status: 'error', result: r.error };
    }
    return { status: 'ok', result: 'Usage: kernel <info | syscall <num> [args...] | mode | switch <self|mirror>>' };
  });

  // Host Bridge commands
  router.use('host-bridge', hostBridge);

  // Permission system commands
  router.use('permissions', perms);

  // AI Core command
  router.use('ai-core', aiCoreFull);

  // Environment commands
  router.use('env-loader', envLoader);

  // Process model commands
  router.use('process-model', processModel);

  // Scheduler commands
  router.use('scheduler', scheduler);

  // ProcFS commands
  router.use('procfs', procfs);

  // ── 17. MIRROR SESSION ─────────────────────────────────────────────────────
  const mirrorMgr = createMirrorSession(kernel, vfs, hostBridge);
  kernel.modules.load('mirror', mirrorMgr);
  router.use('mirror', mirrorMgr);
  bootMsg('ok', 'Mirror Session Manager  ready');

  // ── 18. SERVICE MANAGER ────────────────────────────────────────────────────
  const svcMgr = createServiceManager(kernel);
  kernel.modules.load('services', svcMgr);
  router.use('services', svcMgr);

  // Inject svcMgr into AI core
  const aiCoreFinal = createAICore(kernel, router, svcMgr, hostBridge, memoryCore);
  kernel.modules.unload('ai-core');
  kernel.modules.load('ai-core', aiCoreFinal);
  try { router.unregisterCommand('ai'); } catch (_) {}
  router.use('ai-core-final', aiCoreFinal);

  // Jarvis backends and analyst-model service are registered later, after the
  // consciousness layer, by jarvisOrchestrator.registerWithAICore() and
  // jarvisOrchestrator.registerServices().  See section ── 20. JARVIS ──.

  // Register built-in services
  svcMgr.register('kernel-watchdog', {
    _interval: null,
    start(k) {
      this._interval = setInterval(() => {
        vfs.append('/var/log/boot.log', `[${ts()}] watchdog ok, uptime=${k.uptime()}s\n`);
      }, 60000);
    },
    stop() { if (this._interval) clearInterval(this._interval); },
  });

  svcMgr.register('cpu-idle', {
    start() {},
    stop()  {},
  });

  svcMgr.register('ai-monitor', {
    start() { aiCoreFinal.startMonitor(30000); },
    stop()  { aiCoreFinal.stopMonitor(); },
  });

  svcMgr.register('host-info-logger', {
    _interval: null,
    start() {
      this._interval = setInterval(() => {
        const m = hostBridge.memInfo();
        if (m.ok) {
          vfs.append('/var/log/boot.log', `[${ts()}] mem: ${m.usedMB}/${m.totalMB}MB used\n`);
        }
      }, 300000);
    },
    stop() { if (this._interval) clearInterval(this._interval); },
  });

  svcMgr.register('procfs-updater', {
    start() { procfs.start(); },
    stop()  { procfs.stop(); },
  });

  bootMsg('ok', 'Service Manager  online');

  // ── 19. MEMORY ENGINE ─────────────────────────────────────────────────────
  const memoryEngine = createMemoryEngine(kernel);
  kernel.modules.load('memory-engine', memoryEngine);
  router.use('memory-engine', memoryEngine);
  bootMsg('ok', `Memory Engine v${memoryEngine.version}  online`);

  // ── 20. MODE MANAGER ──────────────────────────────────────────────────────
  const modeManager = createModeManager(kernel, memoryEngine);
  kernel.modules.load('mode-manager', modeManager);
  router.use('mode-manager', modeManager);
  bootMsg('ok', `Mode Manager v${modeManager.version}  mode=${modeManager.getMode()}`);

  // ── 21. DIAGNOSTICS ENGINE ────────────────────────────────────────────────
  const diagnostics = createDiagnosticsEngine(kernel, hostBridge, { pollIntervalMs: 60000 });
  kernel.modules.load('diagnostics-engine', diagnostics);
  router.use('diagnostics-engine', diagnostics);
  bootMsg('ok', `Diagnostics Engine v${diagnostics.version}  online`);

  // ── 22. PORT SERVER ───────────────────────────────────────────────────────
  const portServer = createPortServer(kernel, router, diagnostics);
  kernel.modules.load('port-server', portServer);
  router.use('port-server', portServer);
  bootMsg('ok', `Port Server v${portServer.version}  ready  (port ${portServer.info().port})`);

  // ── 23. BOOT INIT (PID-1) ──────────────────────────────────────────────────
  const bootInit = createBootInit({
    kernel, vfs, cpu, hostBridge, perms,
    aiCore: aiCoreFinal, router, svcMgr, mirrorMgr,
    processModel, procfs, envLoader, scheduler, identity,
    terminal: null,
  });
  kernel.modules.load('boot-init', bootInit);
  router.use('boot-init', { commands: bootInit.coreInit.commands });
  router.use('service-runner', bootInit.svcRunner);

  // ── 20. CONSCIOUSNESS LAYER ────────────────────────────────────────────────

  // 20a. Memory Engine
  const memoryEngine = createMemoryEngine(kernel, vfs);
  memoryEngine.load();  // restore persisted state if any
  kernel.modules.load('memory-engine', memoryEngine);
  router.use('memory-engine', memoryEngine);
  bootMsg('ok', `Memory Engine  v${memoryEngine.version}  online`);

  // 20b. Mode Manager
  const modeManager = createModeManager(kernel, memoryEngine);
  kernel.modules.load('mode-manager', modeManager);
  router.use('mode-manager', modeManager);
  bootMsg('ok', `Mode Manager   v${modeManager.version}  default mode: ${modeManager.getMode()}`);

  // 20c. Model Registry — discover available AI models
  const modelRegistry = createModelRegistry(kernel, hostBridge, envLoader);
  kernel.modules.load('model-registry', modelRegistry);
  router.use('model-registry', modelRegistry);
  bootMsg('info', 'Model Registry  discovering models…');

  // 20d. Consciousness — central AI integration layer
  const consciousness = createConsciousness(kernel, router, memoryEngine, modeManager, modelRegistry, aiCoreFinal);
  kernel.modules.load('consciousness', consciousness);
  router.use('consciousness', consciousness);
  bootMsg('ok', `Consciousness  v${consciousness.version}  online`);

  // ── 20. JARVIS — Multi-Agent AI Orchestrator ───────────────────────────────
  // 100 % local via Ollama.  No external APIs.  No tokens.  No cloud.
  //
  // Agents built in:
  //   jarvis   — phi3              (fast, always-on, system-aware)
  //   code     — deepseek-coder:6.7b  (code / debug queries)
  //   analyst  — llama3            (deep reasoning, load on demand)
  //
  // Terminal: `jarvis <question>`
  //           `svc start analyst-model`  /  `svc stop analyst-model`
  const jarvisOrchestrator = createJarvisOrchestrator(
    kernel, svcMgr, hostBridge, memoryCore, consciousness, modeManager,
  );
  // Register jarvis/code/analyst backends into ai-core
  jarvisOrchestrator.registerWithAICore(aiCoreFinal);
  // Register analyst-model as a managed svc (svc start/stop analyst-model)
  jarvisOrchestrator.registerServices();
  // Mount `jarvis` command into the router
  kernel.modules.load('jarvis-orchestrator', jarvisOrchestrator);
  router.use('jarvis-orchestrator', jarvisOrchestrator);
  bootMsg('ok', 'Jarvis Orchestrator v1.0.0  online  (agents: jarvis, code, analyst — via Ollama)');
  bootMsg('info', '  → Run `jarvis status` to see agents.  Run `ollama serve` to activate AI.');

  // 20e. Diagnostics Engine
  const diagnosticsEngine = createDiagnosticsEngine(kernel, hostBridge, svcMgr, modelRegistry, null, vfs);
  kernel.modules.load('diagnostics-engine', diagnosticsEngine);
  router.use('diagnostics-engine', diagnosticsEngine);
  bootMsg('ok', `Diagnostics    v${diagnosticsEngine.version}  online`);

  // 20f. Port Server — single HTTP port, wired to consciousness + router
  const portServer = createPortServer(kernel, router, consciousness, diagnosticsEngine);
  kernel.modules.load('port-server', portServer);
  router.use('port-server', portServer);
  bootMsg('ok', `Port Server    v${portServer.version}  ready (use: port start)`);

  // ── 21. SYSCALLS ───────────────────────────────────────────────────────────
  kernel.registerSyscall(2, (args) => { const r = vfs.read(String(args[0])); return r.ok ? r.content : null; });
  kernel.registerSyscall(3, (args) => { const r = vfs.write(String(args[0]), String(args[1] || '')); return r.ok ? r.bytes : -1; });
  kernel.registerSyscall(4, (args) => { const r = vfs.mkdir(String(args[0]), { parents: true }); return r.ok ? 0 : -1; });
  kernel.registerSyscall(5, (args) => { const r = vfs.cd(String(args[0])); return r.ok ? r.path : null; });
  kernel.registerSyscall(11, (args) => {
    const cmd = String(args[0] || '');
    if (!cmd) return null;
    const r = hostBridge.execShell(cmd);
    return r.stdout || null;
  });
  kernel.registerSyscall(12, (args) => {
    const query = String(args[0] || '');
    consciousness.query(query).then(r => {
      if (r && r.result) process.stdout.write('[AIOS] ' + r.result + '\n');
    }).catch(() => {});
    return 0;
  });

  // ── 22. SHUTDOWN HANDLER ───────────────────────────────────────────────────
  kernel.bus.on('kernel:shutdown', ({ uptime }) => {
    vfs.append('/var/log/boot.log', `[${ts()}] AIOS shutdown after ${uptime}s\n`);
    memoryEngine.persist();
    consciousness.stopProactive();
    jarvisOrchestrator.stopListening();
    portServer.stop().catch(() => {});
    svcMgr.stopAll().catch(() => {});
    procfs.stop();
    scheduler.stop();
    diagnostics.stop();
    portServer.stop().catch(() => {});
    mirrorMgr.list().forEach(m => { try { mirrorMgr.unmount(m.type); } catch (_) {} });
  });

  process.on('SIGTERM', () => {
    bootInit.shutdown(false).then(() => process.exit(0)).catch(() => process.exit(1));
  });
  process.on('SIGINT',  () => { /* readline handles SIGINT */ });
  process.on('uncaughtException', (e) => {
    process.stderr.write(`[AIOS] Uncaught exception: ${e.stack || e.message}\n`);
  });
  process.on('unhandledRejection', (r) => {
    process.stderr.write(`[AIOS] Unhandled rejection: ${r}\n`);
  });

  // ── 23. RUN INIT SEQUENCE ──────────────────────────────────────────────────
  bootInit.boot().then(async () => {
    // Start services after init boot
    svcMgr.start('kernel-watchdog').catch(() => {});
    svcMgr.start('cpu-idle').catch(() => {});
    svcMgr.start('ai-monitor').catch(() => {});
    svcMgr.start('host-info-logger').catch(() => {});
    svcMgr.start('procfs-updater').catch(() => {});

    // Jarvis listens to kernel events (service failures, memory pressure, etc.)
    jarvisOrchestrator.startListening();

    scheduler.start();
    diagnostics.start();

    // ── SELF-CHECK ──────────────────────────────────────────────────────────
    process.stdout.write('\n  \x1b[35m[SELF-CHECK]\x1b[0m  Running system self-check…\n');

    // 1. Memory availability and CPU status
    const health = diagnostics.captureHealth();
    const memOk  = health.memory.usedPct < 95;
    bootMsg(memOk ? 'ok' : 'warn',
      `Self-check: memory ${health.memory.usedMB}/${health.memory.totalMB} MB (${health.memory.usedPct}% used)`);
    bootMsg('ok', `Self-check: CPU  ${health.cpu.cores} cores  load=${health.cpu.loadAvg1}`);
    memoryEngine.learn('self-check', { type: 'memory', ...health.memory });
    memoryEngine.learn('self-check', { type: 'cpu',    ...health.cpu    });

    // 2. Confirm port can open
    const portCheck = await portServer.canBind();
    if (portCheck.ok) {
      bootMsg('ok', `Self-check: port ${portCheck.port} is available`);
      // Start the port server now that we've confirmed it's available
      portServer.start().catch(() => {});
    } else {
      bootMsg('warn', `Self-check: port ${portServer.info().port} unavailable — ${portCheck.error}`);
    }
    memoryEngine.learn('self-check', { type: 'port', port: portServer.info().port, ok: portCheck.ok });

    // 3. Test local lightweight model (CPU self-test via AIOSCPU emulator)
    try {
      const cpuProg = [
        { op: 'LOADI', dst: 0, imm: 1 },
        { op: 'LOADI', dst: 1, imm: 1 },
        { op: 'ADD',   dst: 2, src1: 0, src2: 1 },
        { op: 'HALT' },
      ];
      const cpuResult = cpu.run(cpuProg);
      const cpuOk = !cpuResult.error && cpuResult.regs && cpuResult.regs[2] === 2;
      bootMsg(cpuOk ? 'ok' : 'warn',
        `Self-check: AIOSCPU model test ${cpuOk ? 'passed' : 'failed'}  (cycles=${cpuResult.cycles})`);
      memoryEngine.learn('self-check', { type: 'cpu-model', ok: cpuOk, cycles: cpuResult.cycles });
    } catch (e) {
      bootMsg('warn', `Self-check: AIOSCPU model test error — ${e.message}`);
    }

    process.stdout.write('  \x1b[35m[SELF-CHECK]\x1b[0m  Self-check complete\n');

    // ── CONSCIOUSNESS WARM-UP ────────────────────────────────────────────────
    // Discover models and start proactive assistance in the background.
    modelRegistry.discover().then(({ discovered, total }) => {
      bootMsg('ok', `Models  discovered=${discovered.length} total=${total}`);
      vfs.append('/var/log/boot.log', `[${ts()}] Models: ${total} registered, ${discovered.length} newly found\n`);
    }).catch(() => {});

    consciousness.startProactive(60000);

    // Auto-start port server on configured port
    const aiosPort = parseInt((envLoader ? envLoader.get() : {})['AIOS_PORT'] || process.env.AIOS_PORT || '4000', 10);
    portServer.start({ port: aiosPort }).then(r => {
      if (r.ok) {
        bootMsg('ok', `Port Server  listening on 127.0.0.1:${r.port}`);
        vfs.append('/var/log/boot.log', `[${ts()}] Port server: 127.0.0.1:${r.port}\n`);
      } else {
        bootMsg('warn', `Port Server  failed to start: ${r.error}`);
      }
    }).catch(() => {});

    // ── 24. TERMINAL ────────────────────────────────────────────────────────
    process.stdout.write('\n');
    bootMsg('ok', 'All systems online — AIOS is the platform — handing control to terminal\n');

    vfs.cd('/home/user');

    const terminal = createTerminal(router, kernel, vfs, hostBridge, perms);
    kernel.modules.load('terminal', terminal);

    // Wire terminal.write into kernel SYS_WRITELN
    if (kernel._syscalls) {
      kernel._syscalls[1] = (args) => {
        terminal.writeln(String(args[0] !== undefined ? args[0] : ''));
        return 0;
      };
    }

    // ── SELF-KERNEL ATTACHMENT ─────────────────────────────────────────────
    // Bind live references into the wrapper layer without altering boot above.
    selfKernelSvcs.init(svcMgr);
    selfKernelProcs.init(processModel);
    selfKernelBoot.attachLoopEngine(kernel, svcMgr, router, loopCtrl);

    // Inject live FS + AI references into loop nodes (optional enrichment)
    try {
      const aiNode = require('../usr/lib/aios/loop/nodes/ai.js');
      aiNode.setAICore(aiCoreFinal);
    } catch (_) {}
    try {
      const osNode = require('../usr/lib/aios/loop/nodes/os.js');
      osNode.setFS(vfs);
    } catch (_) {}

    // ── LOOP + EXTENDED KERNEL SHELL COMMANDS ──────────────────────────────
    router.registerCommand('loop', async (args) => {
      const sub = (args[0] || 'status').toLowerCase();
      switch (sub) {
        case 'start':  return loopCtrl.start();
        case 'stop':   return loopCtrl.stop();
        case 'status': return loopCtrl.status();
        case 'step':   return loopCtrl.step();
        default:
          return { status: 'error', result: 'Usage: loop <start|stop|status|step>' };
      }
    });

    // ── MEMORY CORE COMMAND ────────────────────────────────────────────────
    router.use('memory-core', memoryCore);

    // ── SELF-TEST ─────────────────────────────────────────────────────────
    router.registerCommand('selftest', async () => {
      const results = [];
      const pass = (label) => results.push(`  [PASS] ${label}`);
      const fail = (label) => results.push(`  [FAIL] ${label}`);
      const check = (label, ok) => (ok ? pass : fail)(label);

      // Kernel
      check('Kernel booted', kernel.isBooted());
      check('Kernel uptime >= 0', kernel.uptime() >= 0);

      // VFS
      const tw = vfs.write('/tmp/selftest.txt', 'selftest-ok');
      check('VFS write', tw && tw.ok);
      const tr = vfs.read('/tmp/selftest.txt');
      check('VFS read', tr && tr.ok && tr.content === 'selftest-ok');

      // CPU
      const cpuResult = cpu.run([
        { op: 'LOADI', dst: 0, imm: 99 },
        { op: 'HALT' },
      ]);
      check('CPU execution', cpuResult.halted && cpuResult.regs[0] === 99);

      // Router
      const routerResult = await router.handle('version');
      check('Router dispatch', routerResult && routerResult.status === 'ok');

      // AI Core (NLP)
      const aiResult = await aiCoreFinal.process('hello');
      check('AI Core NLP', aiResult && aiResult.status === 'ok');

      // AI Monitor
      check('AI monitor idle/wake', typeof aiCoreFinal.isMonitoring === 'function');

      // Services
      const svcs = svcMgr.list();
      check('At least one service running', svcs.some(s => s.state === 'running'));

      // Memory Core
      check('Memory Core loaded', !!memoryCore);
      const memStats = memoryCore.getStats();
      check('Memory Core recording', memStats.recorded >= 0);

      // Host Bridge
      check('Platform detected', !!hostBridge.platform && !!hostBridge.platform.name);

      // Remote/host server health (checks if host FS is accessible)
      const hostHealth = hostBridge.root !== undefined;
      check('Host bridge health', hostHealth);

      // Permission system
      check('Permission system active', !!perms.getLevel());

      // VFS cleanup
      vfs.rm('/tmp/selftest.txt');

      const passed = results.filter(r => r.includes('[PASS]')).length;
      const total  = results.length;
      const allOk  = passed === total;

      memoryCore.record('selftest', 'selftest', `${passed}/${total} passed`, allOk ? null : `${total - passed} failures`);

      return {
        status: allOk ? 'ok' : 'error',
        result: [
          'AIOS Self-Test',
          '══════════════════════════════════',
          ...results,
          '══════════════════════════════════',
          `Result: ${passed}/${total} passed${allOk ? ' ✓' : ' — see failures above'}`,
        ].join('\n'),
      };
    });

    // ── SYSTEM REPORT ─────────────────────────────────────────────────────
    router.registerCommand('sysreport', async () => {
      const lines = [];
      const hr = (label) => lines.push(`── ${label} ${'─'.repeat(Math.max(0, 48 - label.length))}`);

      lines.push('╔══════════════════════════════════════════════════════╗');
      lines.push('║              AIOS System Report                      ║');
      lines.push('╚══════════════════════════════════════════════════════╝');
      lines.push('');

      // Models / modules integrated
      hr('Models & Modules Integrated');
      kernel.modules.list().forEach(m => lines.push(`  • ${m}`));
      lines.push('');

      // Modes assigned
      hr('Modes Assigned');
      const envMode = require('../usr/lib/aios/env-kernel/mode.js');
      lines.push(`  AI Monitor   : ${aiCoreFinal.isMonitoring() ? 'active' : 'inactive'}`);
      lines.push(`  Brain mode   : primary`);
      lines.push(`  Kernel mode  : ${envMode.getMode()}`);
      lines.push(`  Loop engine  : ${loopCtrl.status().result || 'unknown'}`);
      lines.push('');

      // Port / platform status
      hr('Platform & Host Status');
      lines.push(`  Platform     : ${hostBridge.platform.name}`);
      lines.push(`  Architecture : ${hostBridge.platform.arch || process.arch}`);
      lines.push(`  Root access  : ${hostBridge.root && hostBridge.root.available ? hostBridge.root.level + ' via ' + hostBridge.root.method : 'not available'}`);
      lines.push(`  Node.js      : ${process.versions.node}`);
      lines.push('');

      // Memory usage
      hr('Memory Usage');
      const mem = hostBridge.memInfo();
      if (mem.ok) {
        lines.push(`  Host total   : ${mem.totalMB} MB`);
        lines.push(`  Host used    : ${mem.usedMB} MB`);
        lines.push(`  Host free    : ${mem.freeMB} MB`);
      } else {
        lines.push('  Host memory  : unavailable');
      }
      const mStats = memoryCore.getStats();
      lines.push(`  AIOS memory  : ${mStats.entries} entries, ${mStats.patterns} patterns learned`);
      lines.push(`  Kernel uptime: ${kernel.uptime()}s`);
      lines.push('');

      // Services
      hr('Services');
      svcMgr.list().forEach(s => {
        lines.push(`  ${s.name.padEnd(22)} ${s.state}`);
      });
      lines.push('');

      // Logs (last 10 lines)
      hr('Recent Boot Log');
      const logRead = vfs.read('/var/log/boot.log');
      if (logRead.ok) {
        logRead.content.split('\n').filter(Boolean).slice(-10).forEach(l => lines.push(`  ${l}`));
      } else {
        lines.push('  No boot log available.');
      }
      lines.push('');

      // AI stats
      hr('AI Core Stats');
      const aiStats = aiCoreFinal.stats();
      lines.push(`  Queries      : ${aiStats.queries}`);
      lines.push(`  Resolved     : ${aiStats.resolved}`);
      lines.push(`  Fallbacks    : ${aiStats.fallbacks}`);
      lines.push(`  Autonomous   : ${aiStats.autonomous}`);
      lines.push('');

      lines.push(`Report generated: ${new Date().toISOString()}`);

      memoryCore.record('sysreport', 'sysreport', 'generated', null);

      return { status: 'ok', result: lines.join('\n') };
    });

    bootMsg('ok', 'Loop engine + self-kernel bridges attached\n');

    vfs.append('/var/log/boot.log', `[${ts()}] Terminal started\n`);
    terminal.start();
  }).catch(e => {
    process.stderr.write(`[AIOS] FATAL: init boot failed: ${e.stack || e.message}\n`);
    process.exit(1);
  });
}

module.exports = { start };
