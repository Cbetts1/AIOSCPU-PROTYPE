'use strict';
/**
 * boot.js — AIOS Lite Boot Sequence v2.0.0
 *
 * Full v2.0 boot order:
 *   1.  Kernel init
 *   2.  Filesystem init + default directory tree
 *   3.  AIOSCPU v1.0 CPU init
 *   4.  Host Bridge (real OS mirror, platform/root detection)
 *   5.  Permission System (AIOS capability layer)
 *   6.  AI Core (NLP agent + monitoring loop)
 *   7.  Router init
 *   8.  Mount all command modules (fs, os, cpu, host, permissions, ai, mirror, svc)
 *   9.  Mirror Session manager
 *   10. Service Manager + built-in services
 *   11. Register all syscalls
 *   12. Terminal REPL launch
 *
 * Entry point called by ./aos
 * Zero external npm dependencies.
 */

const { createKernel }          = require('../core/kernel.js');
const { createCPU }             = require('../core/cpu.js');
const { createRouter }          = require('../core/router.js');
const { createFilesystem }      = require('../core/filesystem.js');
const { createServiceManager }  = require('../core/service-manager.js');
const { createHostBridge }      = require('../core/host-bridge.js');
const { createPermissionSystem }= require('../core/permission-system.js');
const { createAICore }          = require('../core/ai-core.js');
const { createMirrorSession }   = require('../core/mirror-session.js');
const { createTerminal }        = require('../terminal/terminal.js');

// ── Self-kernel + loop engine (new layer — wraps existing, does not replace) ──
const selfKernelBoot    = require('../usr/lib/aios/self-kernel/boot.js');
const selfKernelSvcs    = require('../usr/lib/aios/self-kernel/services.js');
const selfKernelProcs   = require('../usr/lib/aios/self-kernel/process-model.js');
const envMode           = require('../usr/lib/aios/env-kernel/mode.js');
const loopCtrl          = require('../usr/lib/aios/loop/control.js');
const loopNodes         = require('../usr/lib/aios/loop/engine.js');

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
// Main boot
// ---------------------------------------------------------------------------
function start() {
  process.stdout.write('\x1b[0m');
  process.stdout.write('\n\x1b[36m[AIOS]\x1b[0m  Booting AIOS Lite v2.0.0…\n\n');

  // ── 1. KERNEL ─────────────────────────────────────────────────────────────
  const kernel = createKernel();
  kernel.boot();
  bootMsg('ok', `Kernel  ${kernel.id}  v${kernel.version}`);

  // ── 2. FILESYSTEM ─────────────────────────────────────────────────────────
  const fs = createFilesystem();

  // Default AIOS directory tree
  const dirs = [
    '/home', '/home/user', '/home/user/documents', '/home/user/downloads',
    '/var', '/var/log', '/var/run',
    '/etc',
    '/bin',
    '/tmp',
    '/proc',
    '/sys',
    '/host',          // host mirror mount point
    '/sdcard',        // Android storage mirror
    '/host-home',     // real $HOME mirror
  ];
  dirs.forEach(d => fs.mkdir(d, { parents: true }));

  fs.write('/etc/hostname',   'aioscpu-prototype-one\n');
  fs.write('/etc/os-release', 'NAME="AIOS Lite"\nVERSION="2.0.0"\nID=aios\nAIOS_FEATURES="ai,mirror,host-bridge"\n');
  fs.write('/etc/motd',       'Welcome to AIOS Lite v2.0.0 — AI-Operated OS\n');
  fs.write('/var/log/boot.log', `[${ts()}] AIOS Lite v2.0.0 boot started\n`);
  fs.write('/home/user/.profile', 'PATH=/bin:/usr/bin\nHOME=/home/user\nPS1="aios:$PWD$ "\n');

  fs.cd('/home/user');
  kernel.modules.load('filesystem', fs);
  bootMsg('ok', 'Filesystem (VFS) mounted at /');

  // ── 3. CPU ────────────────────────────────────────────────────────────────
  const cpu = createCPU(kernel);
  kernel.modules.load('cpu', cpu);
  bootMsg('ok', `AIOSCPU v${cpu.version}  ready`);

  // SYS_CPU_PRINT (9)
  kernel.registerSyscall(9, (args) => {
    process.stdout.write(String(args[0] !== undefined ? args[0] : '') + '\n');
    return 0;
  });

  // ── 4. HOST BRIDGE ────────────────────────────────────────────────────────
  const hostBridge = createHostBridge(kernel);
  kernel.modules.load('host-bridge', hostBridge);
  const rootStatus = hostBridge.root.available
    ? `\x1b[32m${hostBridge.root.level}\x1b[0m via ${hostBridge.root.method}`
    : '\x1b[33mnot available\x1b[0m';
  bootMsg('ok', `Host Bridge  platform=${hostBridge.platform.name}  root=${rootStatus}`);

  // Log platform info to boot log
  fs.append('/var/log/boot.log', `[${ts()}] Platform: ${hostBridge.platform.name}\n`);
  fs.append('/var/log/boot.log', `[${ts()}] Root: ${hostBridge.root.available ? hostBridge.root.level : 'none'}\n`);

  // ── 5. PERMISSION SYSTEM ──────────────────────────────────────────────────
  const perms = createPermissionSystem(kernel, hostBridge);
  kernel.modules.load('permissions', perms);
  bootMsg('ok', `Permission System  level=${perms.getLevel()}  caps=${perms.getTokens().length}`);

  // ── 6. AI CORE ────────────────────────────────────────────────────────────
  // Router is needed by AI core, but we create AI core before router
  // because it registers with the kernel bus first.
  // We inject the router reference after router creation below.
  const aiCore = createAICore(kernel, null, null, hostBridge);
  kernel.modules.load('ai-core', aiCore);
  bootMsg('ok', `AI Core v${aiCore.version}  NLP ready`);

  // ── 7. ROUTER ─────────────────────────────────────────────────────────────
  const router = createRouter({ logger: null });
  kernel.modules.load('router', router);
  bootMsg('ok', `Router v${router.version}  online`);

  // Inject router into AI core now that it exists
  aiCore._router = router;
  // Re-create with full dependencies (router + svcMgr injected after)
  const aiCoreFull = createAICore(kernel, router, null, hostBridge);
  kernel.modules.unload('ai-core');
  kernel.modules.load('ai-core', aiCoreFull);

  // ── 8. MOUNT ALL COMMAND MODULES ──────────────────────────────────────────

  // 8a. Filesystem commands (pwd, cd, ls, mkdir, cat, write, rm, stat, cp, mv, tree, touch)
  router.use('filesystem', fs);

  // 8b. OS info commands
  router.use('os', {
    commands: {
      uname: () => ({
        status: 'ok',
        result: `AIOS Lite 2.0.0 AIOSCPU-Prototype-One node/${process.versions.node} ${process.platform}`,
      }),
      uptime: () => ({
        status: 'ok',
        result: `AIOS uptime: ${kernel.uptime()}s  |  Host uptime: ${Math.round(require('os').uptime())}s`,
      }),
      ps: (args) => {
        // Merge AIOS processes + live host processes if -a flag
        const showAll = args && args.includes('-a');
        const aiosProcs = kernel.procs.list();
        const lines = ['  PID    NAME                   STATE'];

        if (showAll && hostBridge) {
          const hp = hostBridge.processes();
          if (hp.ok) {
            hp.processes.slice(0, 40).forEach(p => {
              lines.push(`  ${String(p.pid).padEnd(7)}${p.name.padEnd(23)}${p.state}  [host]`);
            });
          }
        }

        aiosProcs.forEach(p => {
          lines.push(`  ${String(p.pid).padEnd(7)}${p.name.padEnd(23)}${p.state}  [aios]`);
        });

        return { status: 'ok', result: lines.join('\n') || 'No processes.' };
      },
      kill: (args) => {
        const pid = parseInt(args[0], 10);
        if (isNaN(pid)) return { status: 'error', result: 'Usage: kill <pid>' };
        const ok = kernel.procs.kill(pid);
        return ok
          ? { status: 'ok',    result: `Killed PID ${pid}` }
          : { status: 'error', result: `No process with PID ${pid}` };
      },
      env: () => ({
        status: 'ok',
        result: [
          `AIOS_VERSION=2.0.0`,
          `KERNEL_ID=${kernel.id}`,
          `HOME=/home/user`,
          `PLATFORM=${process.platform}`,
          `NODE=${process.versions.node}`,
          `HOST_PLATFORM=${hostBridge.platform.name}`,
          `ROOT_AVAILABLE=${hostBridge.root.available}`,
          `AIOS_LEVEL=${perms.getLevel()}`,
        ].join('\n'),
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
          ].join('\n'),
        };
      },
      hostname: () => {
        const r = fs.read('/etc/hostname');
        return { status: 'ok', result: r.ok ? r.content.trim() : 'aioscpu' };
      },
    },
  });

  // 8c. AIOSCPU commands
  router.registerCommand('cpu', (args) => {
    const sub = (args[0] || '').toLowerCase();
    if (sub === 'demo') {
      const prog = [
        { op: 'LOADI',   dst: 0, imm: 42 },
        { op: 'LOADI',   dst: 1, imm: 8  },
        { op: 'ADD',     dst: 2, src1: 0, src2: 1 },
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
          `Stack     : 0x0100–0x01FF`,
          `Program   : 0x0200–0x3FFF`,
          `Opcodes   : NOP HALT MOV LOADI LOAD STORE LOADR STORER`,
          `            ADD ADDI SUB MUL DIV MOD`,
          `            AND OR XOR NOT SHL SHR`,
          `            CMP CMPI JMP JMPR JZ JNZ JLT JGT JLE JGE`,
          `            CALL RET PUSH POP SYSCALL IN OUT`,
          `Status    : cycles=${cpu.getCycles()}, halted=${cpu.isHalted()}`,
        ].join('\n'),
      };
    }
    if (sub === 'regs') {
      return { status: 'ok', result: cpu.getRegs().map((v, i) => `R${i}=${v}`).join('  ') };
    }
    if (sub === 'reset') {
      cpu.reset();
      return { status: 'ok', result: 'AIOSCPU reset.' };
    }
    if (sub === 'run' && args[1]) {
      // cpu run <path> — load and run a .aios program file from VFS
      const src = fs.read(args[1]);
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

  // 8d. Kernel debug commands
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
      const identity = require('../usr/lib/aios/self-kernel/identity.js');
      return {
        status: 'ok',
        result: [
          `Host mode  : ${envMode.getMode()}`,
          `Kernel ID  : ${identity.getKernelId()}`,
          `Version    : ${identity.getVersion()}`,
          `Build ID   : ${identity.getBuildId()}`,
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
    return { status: 'ok', result: 'Usage: kernel <info|syscall <num> [args...]|mode|switch <self|mirror>>' };
  });

  // 8e. Host Bridge commands (shell, df, free, ifconfig, sysinfo, pkg, termux)
  router.use('host-bridge', hostBridge);

  // 8f. Permission system commands (whoami overrides os.whoami, capabilities, su)
  router.use('permissions', perms);

  // 8g. AI Core command
  router.use('ai-core', aiCoreFull);

  // ── 9. MIRROR SESSION ─────────────────────────────────────────────────────
  const mirrorMgr = createMirrorSession(kernel, fs, hostBridge);
  kernel.modules.load('mirror', mirrorMgr);
  router.use('mirror', mirrorMgr);
  bootMsg('ok', 'Mirror Session Manager  ready');

  // ── 10. SERVICE MANAGER ───────────────────────────────────────────────────
  const svcMgr = createServiceManager(kernel);
  kernel.modules.load('services', svcMgr);
  router.use('services', svcMgr);

  // Inject svcMgr into AI core
  const aiCoreFinal = createAICore(kernel, router, svcMgr, hostBridge);
  kernel.modules.unload('ai-core');
  kernel.modules.load('ai-core', aiCoreFinal);
  // Re-register ai command with the fully wired AI core
  try { router.unregisterCommand('ai'); } catch (_) {}
  router.use('ai-core-final', aiCoreFinal);

  // ── Built-in services ─────────────────────────────────────────────────────
  svcMgr.register('kernel-watchdog', {
    _interval: null,
    start(k) {
      this._interval = setInterval(() => {
        fs.append('/var/log/boot.log', `[${ts()}] watchdog ok, uptime=${k.uptime()}s\n`);
      }, 60000);
    },
    stop() { if (this._interval) clearInterval(this._interval); },
  });

  svcMgr.register('cpu-idle', {
    start() {},
    stop()  {},
  });

  svcMgr.register('ai-monitor', {
    start() {
      // Start AI autonomous monitoring loop (30-second tick)
      aiCoreFinal.startMonitor(30000);
    },
    stop() {
      aiCoreFinal.stopMonitor();
    },
  });

  svcMgr.register('host-info-logger', {
    _interval: null,
    start() {
      // Log host memory info every 5 minutes
      this._interval = setInterval(() => {
        const m = hostBridge.memInfo();
        if (m.ok) {
          fs.append('/var/log/boot.log',
            `[${ts()}] mem: ${m.usedMB}/${m.totalMB}MB used\n`
          );
        }
      }, 300000);
    },
    stop() { if (this._interval) clearInterval(this._interval); },
  });

  bootMsg('ok', 'Service Manager  online');

  // Start services
  svcMgr.start('kernel-watchdog').catch(() => {});
  svcMgr.start('cpu-idle').catch(() => {});
  svcMgr.start('ai-monitor').catch(() => {});
  svcMgr.start('host-info-logger').catch(() => {});

  // ── 11. FILESYSTEM SYSCALLS ───────────────────────────────────────────────
  kernel.registerSyscall(2, (args) => {
    const r = fs.read(String(args[0]));
    return r.ok ? r.content : null;
  });
  kernel.registerSyscall(3, (args) => {
    const r = fs.write(String(args[0]), String(args[1] || ''));
    return r.ok ? r.bytes : -1;
  });
  kernel.registerSyscall(4, (args) => {
    const r = fs.mkdir(String(args[0]), { parents: true });
    return r.ok ? 0 : -1;
  });
  kernel.registerSyscall(5, (args) => {
    const r = fs.cd(String(args[0]));
    return r.ok ? r.path : null;
  });

  // SYS_SHELL (11): run a host shell command from CPU program
  kernel.registerSyscall(11, (args) => {
    const cmd = String(args[0] || '');
    if (!cmd) return null;
    const r = hostBridge.execShell(cmd);
    return r.stdout || null;
  });

  // SYS_AI (12): ask AI core a question from CPU program
  kernel.registerSyscall(12, (args) => {
    const query = String(args[0] || '');
    // Fire-and-forget from sync context — result goes to stdout
    aiCoreFinal.process(query).then(r => {
      if (r && r.result) process.stdout.write('[AI] ' + r.result + '\n');
    }).catch(() => {});
    return 0;
  });

  // ── 12. SHUTDOWN HANDLER ──────────────────────────────────────────────────
  kernel.bus.on('kernel:shutdown', ({ uptime }) => {
    fs.append('/var/log/boot.log', `[${ts()}] AIOS shutdown after ${uptime}s\n`);
    svcMgr.stopAll().catch(() => {});
    mirrorMgr.list().forEach(m => {
      try { mirrorMgr.unmount(m.type); } catch (_) {}
    });
  });

  process.on('SIGTERM', () => { kernel.shutdown(); process.exit(0); });
  process.on('SIGINT',  () => { /* readline handles SIGINT */ });
  process.on('uncaughtException', (e) => {
    process.stderr.write(`[AIOS] Uncaught exception: ${e.stack || e.message}\n`);
  });
  process.on('unhandledRejection', (r) => {
    process.stderr.write(`[AIOS] Unhandled rejection: ${r}\n`);
  });

  // ── 13. TERMINAL ──────────────────────────────────────────────────────────
  process.stdout.write('\n');
  bootMsg('ok', 'All systems online — handing control to terminal\n');

  const terminal = createTerminal(router, kernel, fs, hostBridge, perms);
  kernel.modules.load('terminal', terminal);

  // Wire terminal.write into kernel SYS_WRITELN so AI/CPU can print through it
  kernel._syscalls && (kernel._syscalls[1] = (args) => {
    terminal.writeln(String(args[0] !== undefined ? args[0] : ''));
    return 0;
  });

  // ── SELF-KERNEL ATTACHMENT ─────────────────────────────────────────────────
  // Bind live references into the wrapper layer without altering existing boot.
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
    osNode.setFS(fs);
  } catch (_) {}

  // ── LOOP SHELL COMMANDS ────────────────────────────────────────────────────
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

  bootMsg('ok', 'Loop engine + self-kernel bridges attached\n');

  terminal.start();
}

module.exports = { start };
