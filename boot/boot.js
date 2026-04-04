'use strict';
/**
 * boot.js — AIOS Lite Boot Sequence v1.0.0
 *
 * Orchestrates the full AIOSCPU Prototype One startup:
 *   1. Kernel init
 *   2. Filesystem init + default directory tree
 *   3. AIOSCPU v1.0 CPU init
 *   4. Router init + all command modules mounted
 *   5. Service Manager init
 *   6. InterOS handshake layer (loopback, single-node)
 *   7. Terminal REPL launch
 *
 * Entry point called by ./aos
 */

const path = require('path');

const { createKernel }         = require('../core/kernel.js');
const { createCPU }            = require('../core/cpu.js');
const { createRouter }         = require('../core/router.js');
const { createFilesystem }     = require('../core/filesystem.js');
const { createServiceManager } = require('../core/service-manager.js');
const { createTerminal }       = require('../terminal/terminal.js');

// ---------------------------------------------------------------------------
// Timing helper
// ---------------------------------------------------------------------------
function ts() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function bootMsg(tag, msg) {
  const OK   = '\x1b[32m[OK]\x1b[0m';
  const INFO = '\x1b[36m[  ]\x1b[0m';
  const icon = tag === 'ok' ? OK : INFO;
  process.stdout.write(`${icon}  ${msg}\n`);
}

// ---------------------------------------------------------------------------
// Main boot function
// ---------------------------------------------------------------------------
function start() {
  process.stdout.write('\x1b[0m');  // reset terminal colours

  // ── 1. KERNEL ────────────────────────────────────────────────────────────
  const kernel = createKernel();
  kernel.boot();
  bootMsg('ok', `Kernel ${kernel.id}  v${kernel.version}  …online`);

  // ── 2. FILESYSTEM ────────────────────────────────────────────────────────
  const fs = createFilesystem();
  // Scaffold default AIOS directory tree
  fs.mkdir('/home',              { parents: true });
  fs.mkdir('/home/user',         { parents: true });
  fs.mkdir('/var',               { parents: true });
  fs.mkdir('/var/log',           { parents: true });
  fs.mkdir('/etc',               { parents: true });
  fs.mkdir('/bin',               { parents: true });
  fs.mkdir('/tmp',               { parents: true });
  fs.mkdir('/proc',              { parents: true });
  fs.write('/etc/hostname',      'aioscpu-prototype-one\n');
  fs.write('/etc/os-release',    'NAME="AIOS Lite"\nVERSION="1.0.0"\nID=aios\n');
  fs.write('/var/log/boot.log',  `[${ts()}] AIOS Lite boot started\n`);
  fs.cd('/home/user');
  kernel.modules.load('filesystem', fs);
  bootMsg('ok', 'Filesystem (in-memory VFS)  …mounted at /');

  // ── 3. CPU ───────────────────────────────────────────────────────────────
  const cpu = createCPU(kernel);
  kernel.modules.load('cpu', cpu);
  bootMsg('ok', `AIOSCPU v${cpu.version}  …ready`);

  // Hook CPU PRINT syscall → kernel SYS_WRITELN
  kernel.registerSyscall(9, (args) => {
    // SYS_CPU_PRINT (9): print a string from CPU program
    process.stdout.write(String(args[0] !== undefined ? args[0] : '') + '\n');
    return 0;
  });

  // ── 4. ROUTER ────────────────────────────────────────────────────────────
  const router = createRouter({ logger: null });  // suppress internal logs
  kernel.modules.load('router', router);
  bootMsg('ok', `Router v${router.version}  …online`);

  // Mount filesystem commands
  router.use('filesystem', fs);

  // Mount OS-level commands
  router.use('os', {
    onMount(r) {},
    commands: {
      uname:   (_args) => ({
        status: 'ok',
        result: `AIOS Lite 1.0.0 AIOSCPU-Prototype-One node/${process.versions.node} ${process.platform}`,
      }),
      uptime:  (_args) => ({
        status: 'ok',
        result: `${kernel.uptime()}s`,
      }),
      ps:      (_args) => {
        const procs = kernel.procs.list();
        if (!procs.length) return { status: 'ok', result: 'No processes.' };
        const header = '  PID  NAME              STATE';
        const rows   = procs.map(p =>
          `  ${String(p.pid).padEnd(5)}${p.name.padEnd(18)}${p.state}`
        );
        return { status: 'ok', result: [header, ...rows].join('\n') };
      },
      kill: (args) => {
        const pid = parseInt(args[0], 10);
        if (isNaN(pid)) return { status: 'error', result: 'Usage: kill <pid>' };
        const ok = kernel.procs.kill(pid);
        return ok
          ? { status: 'ok',    result: `Killed PID ${pid}` }
          : { status: 'error', result: `No process with PID ${pid}` };
      },
      env: (_args) => ({
        status: 'ok',
        result: [
          `AIOS_VERSION=1.0.0`,
          `KERNEL_ID=${kernel.id}`,
          `HOME=/home/user`,
          `PLATFORM=${process.platform}`,
          `NODE=${process.versions.node}`,
        ].join('\n'),
      }),
      date:    (_args) => ({ status: 'ok', result: new Date().toISOString() }),
      whoami:  (_args) => ({ status: 'ok', result: 'aios-user' }),
      hostname:(_args) => {
        const r = fs.read('/etc/hostname');
        return { status: 'ok', result: r.ok ? r.content.trim() : 'aioscpu' };
      },
    },
  });

  // ── 5. SERVICE MANAGER ───────────────────────────────────────────────────
  const svcMgr = createServiceManager(kernel);
  kernel.modules.load('services', svcMgr);
  router.use('services', svcMgr);

  // Register built-in services
  svcMgr.register('kernel-watchdog', {
    _interval: null,
    start(k) {
      this._interval = setInterval(() => {
        fs.append('/var/log/boot.log', `[${ts()}] watchdog ok, uptime=${k.uptime()}s\n`);
      }, 60000);
    },
    stop() {
      if (this._interval) clearInterval(this._interval);
    },
  });

  svcMgr.register('cpu-idle', {
    start() {},
    stop() {},
  });

  bootMsg('ok', 'Service Manager  …online');

  // Start default services (fire-and-forget)
  svcMgr.start('kernel-watchdog').catch(() => {});
  svcMgr.start('cpu-idle').catch(() => {});

  // ── 6. CPU DEMO PROGRAM ──────────────────────────────────────────────────
  // Register a CPU 'run' command in the router
  router.registerCommand('cpu', (args) => {
    const sub = args[0];
    if (sub === 'demo') {
      // Hello World program using AIOSCPU ISA
      const prog = [
        { op: 'LOADI',   dst: 0, imm: 42 },        // R0 = 42
        { op: 'LOADI',   dst: 1, imm: 8  },         // R1 = 8
        { op: 'ADD',     dst: 2, src1: 0, src2: 1 },// R2 = R0 + R1 = 50
        { op: 'SYSCALL', num: 9, strArgs: ['Hello from AIOSCPU! R0=42 R1=8 R2(sum)=50'] },
        { op: 'HALT' },
      ];
      const result = cpu.run(prog);
      return {
        status: 'ok',
        result: `AIOSCPU demo executed. Cycles: ${result.cycles}. R2=${result.regs[2]}.`,
      };
    }
    if (sub === 'info') {
      return {
        status: 'ok',
        result: [
          `AIOSCPU v${cpu.version}`,
          `Registers: R0–R7, PC, SP, FLAGS`,
          `Memory   : 64 KB`,
          `Stack    : 0x0100–0x01FF`,
          `Program  : 0x0200–0x3FFF`,
          `Opcodes  : NOP HALT MOV LOADI LOAD STORE ADD SUB MUL DIV AND OR XOR NOT CMP JMP JZ JNZ CALL RET PUSH POP SYSCALL`,
          `Status   : cycles=${cpu.getCycles()}, halted=${cpu.isHalted()}`,
        ].join('\n'),
      };
    }
    if (sub === 'regs') {
      const regs = cpu.getRegs();
      return {
        status: 'ok',
        result: regs.map((v, i) => `R${i}=${v}`).join('  '),
      };
    }
    if (sub === 'reset') {
      cpu.reset();
      return { status: 'ok', result: 'AIOSCPU reset.' };
    }
    return {
      status: 'ok',
      result: 'Usage: cpu <demo|info|regs|reset>',
    };
  });

  // ── 7. KERNEL DEBUG COMMANDS ─────────────────────────────────────────────
  router.registerCommand('kernel', (args) => {
    const sub = args[0];
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
      const num  = parseInt(args[1], 10);
      const arg0 = args.slice(2).join(' ');
      if (isNaN(num)) return { status: 'error', result: 'Usage: kernel syscall <num> [arg]' };
      const r = kernel.syscall(num, [arg0]);
      return { status: 'ok', result: JSON.stringify(r) };
    }
    return { status: 'ok', result: 'Usage: kernel <info|syscall>' };
  });

  // ── 8. FILESYSTEM SYSCALLS ───────────────────────────────────────────────
  // SYS_FS_READ (2), SYS_FS_WRITE (3), SYS_FS_MKDIR (4), SYS_FS_CD (5)
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

  // ── 9. SHUTDOWN HANDLER ──────────────────────────────────────────────────
  kernel.bus.on('kernel:shutdown', ({ uptime }) => {
    fs.append('/var/log/boot.log', `[${ts()}] AIOS shutdown after ${uptime}s\n`);
    svcMgr.stopAll().catch(() => {});
  });

  process.on('SIGTERM', () => { kernel.shutdown(); process.exit(0); });
  process.on('uncaughtException', (e) => {
    process.stderr.write(`[AIOS] Uncaught: ${e.message}\n`);
  });

  bootMsg('ok', 'All modules online');
  process.stdout.write('\n');

  // ── 10. TERMINAL ─────────────────────────────────────────────────────────
  const terminal = createTerminal(router, kernel, fs);
  kernel.modules.load('terminal', terminal);
  terminal.start();
}

module.exports = { start };
