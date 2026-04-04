# AIOS Lite — Developer Guide

**Document:** DEVELOPER.md  
**Version:** 1.0.0  
**Project:** AIOSCPU Prototype One

---

## Table of Contents

1. [Project Structure](#1-project-structure)
2. [How the OS Boots](#2-how-the-os-boots)
3. [Module Conventions](#3-module-conventions)
4. [Adding a New Command](#4-adding-a-new-command)
5. [Adding a New Service](#5-adding-a-new-service)
6. [Writing AIOSCPU Programs](#6-writing-aioscpu-programs)
7. [Filesystem API](#7-filesystem-api)
8. [Kernel Syscall API](#8-kernel-syscall-api)
9. [Event Bus](#9-event-bus)
10. [Running on Termux](#10-running-on-termux)
11. [Running on Desktop](#11-running-on-desktop)
12. [Repo Audit Summary](#12-repo-audit-summary)

---

## 1. Project Structure

```
AIOSCPU-PROTYPE/
│
├── aos                        # Entry point — run this to boot AIOS
│
├── boot/
│   └── boot.js                # Boot orchestrator: wires all modules together
│
├── core/
│   ├── kernel.js              # Kernel: event bus, process table, syscalls, modules
│   ├── cpu.js                 # AIOSCPU v1.0 virtual processor + ISA
│   ├── router.js              # Command router: dispatches CLI input to handlers
│   ├── filesystem.js          # In-memory POSIX-like VFS
│   └── service-manager.js     # Service lifecycle: register/start/stop/restart
│
├── terminal/
│   └── terminal.js            # Interactive readline REPL (the user-facing shell)
│
├── docs/
│   ├── AIOSCPU-SPEC.md        # Full CPU / ISA specification
│   └── DEVELOPER.md           # This file
│
└── package.json               # Zero external dependencies
```

---

## 2. How the OS Boots

`./aos` → `boot/boot.js → start()`

The boot sequence runs in strict order:

```
1.  kernel.boot()              — starts event bus, syscall table, process table
2.  createFilesystem()         — builds in-memory VFS, scaffolds /home /etc /var /tmp
3.  createCPU(kernel)          — wires AIOSCPU into kernel syscall bridge
4.  createRouter()             — mounts filesystem + OS command modules
5.  createServiceManager()     — registers & starts built-in services
6.  terminal.start()           — launches readline REPL, hands control to user
```

Each module is also registered in `kernel.modules` so any module can look up
another at runtime via `kernel.modules.get('filesystem')`.

---

## 3. Module Conventions

Every pluggable module must follow this interface so it works with both the
kernel module registry and the router's `use()` system:

```js
const myModule = {
  name:    'my-module',        // string identifier
  version: '1.0.0',           // semver string

  // Optional: called by kernel.modules.load()
  start() { /* initialise */ },
  stop()  { /* teardown   */ },

  // Optional: exposed to router.use() — keys become CLI commands
  commands: {
    mycommand: (args, context) => {
      return { status: 'ok', result: 'Hello from mycommand!' };
      // or: return Promise.resolve({ status: 'ok', result: '...' });
    },
  },

  // Optional: called when router.use() mounts this module
  onMount(router) { /* self-configure with router */ },
  onUnmount(router) { /* cleanup */ },
};
```

---

## 4. Adding a New Command

### Method A — Direct registration

```js
// In boot/boot.js or any module file:
router.registerCommand('greet', (args) => {
  const name = args[0] || 'World';
  return { status: 'ok', result: `Hello, ${name}!` };
});
```

### Method B — Mount a module

```js
const greetModule = {
  commands: {
    greet: (args) => ({ status: 'ok', result: `Hello, ${args[0] || 'World'}!` }),
    bye:   (args) => ({ status: 'ok', result: `Goodbye, ${args[0] || 'World'}!` }),
  },
};
router.use('greeter', greetModule);
```

Commands are case-insensitive. The handler receives:
- `args` — string array (everything after the command name)
- `context` — `{ terminal, kernel, filesystem }` object

### Returning results

Always return (or resolve to) an object:

```js
{ status: 'ok',    result: 'some output string' }   // success
{ status: 'error', result: 'error message'      }   // error (shown in red)
```

---

## 5. Adding a New Service

```js
// 1. Define the service descriptor
const myService = {
  _timer: null,

  async start(kernel) {
    this._timer = setInterval(() => {
      // do periodic work
    }, 5000);
  },

  async stop(kernel) {
    if (this._timer) clearInterval(this._timer);
  },
};

// 2. Register it with the service manager
svcMgr.register('my-service', myService);

// 3. Start it
await svcMgr.start('my-service');

// 4. Manage it from the terminal
//   svc list
//   svc status my-service
//   svc stop   my-service
//   svc start  my-service
//   svc restart my-service
```

---

## 6. Writing AIOSCPU Programs

Programs are arrays of instruction objects. Load and run them through the CPU:

```js
const { createCPU } = require('./core/cpu.js');
const cpu = createCPU(kernel);

const program = [
  { op: 'LOADI',   dst: 0, imm: 10 },         // R0 = 10
  { op: 'LOADI',   dst: 1, imm: 32 },         // R1 = 32
  { op: 'ADD',     dst: 2, src1: 0, src2: 1 },// R2 = 42
  { op: 'SYSCALL', num: 9, strArgs: ['R2 = 42'] }, // print
  { op: 'HALT' },
];

const result = cpu.run(program);
console.log(result.regs[2]); // 42
```

From the terminal, run the built-in demo:

```
aios:/home/user$ cpu demo
Hello from AIOSCPU! R0=42 R1=8 R2(sum)=50
AIOSCPU demo executed. Cycles: 5. R2=50.
```

See `docs/AIOSCPU-SPEC.md` for the full ISA reference.

---

## 7. Filesystem API

The VFS is a pure in-memory object tree. All paths are Unix-style.

```js
const { createFilesystem } = require('./core/filesystem.js');
const fs = createFilesystem();

fs.mkdir('/data/logs', { parents: true });
fs.write('/data/logs/app.log', 'started\n');
fs.append('/data/logs/app.log', 'event: user login\n');

const r = fs.read('/data/logs/app.log');
console.log(r.content);   // "started\nevent: user login\n"

fs.ls('/data/logs');       // { ok: true, entries: [...] }
fs.stat('/data/logs');     // { ok: true, type:'dir', children:1, ... }
fs.mv('/data/logs', '/var/logs');
fs.rm('/var/logs/app.log');
fs.tree('/var');
```

### Terminal VFS commands

```
pwd          — print working directory
cd <path>    — change directory
mkdir <path> — make directory  (mkdir -p for parents)
ls [path]    — list directory
touch <path> — create empty file
cat <path>   — read file
write <path> <content>  — write file
rm <path>    — remove file/directory  (rm -r for recursive)
stat <path>  — file/directory metadata
cp <src> <dst>
mv <src> <dst>
tree [path]  — recursive listing
```

---

## 8. Kernel Syscall API

Register a custom syscall:

```js
// In boot/boot.js after kernel.boot():
kernel.registerSyscall(20, (args) => {
  const msg = String(args[0] || '');
  // do something
  return msg.toUpperCase();
});
```

Call a syscall from JS:

```js
const result = kernel.syscall(20, ['hello']);
console.log(result); // { status: 'ok', result: 'HELLO' }
```

Call a syscall from AIOSCPU:

```js
{ op: 'SYSCALL', num: 20, strArgs: ['hello'] }
```

---

## 9. Event Bus

The kernel event bus (`kernel.bus`) lets modules communicate without tight coupling.

```js
// Subscribe
kernel.bus.on('my:event', (data) => {
  console.log('Got event:', data);
});

// Publish
kernel.bus.emit('my:event', { value: 42 });

// One-shot
kernel.bus.once('kernel:shutdown', () => {
  console.log('Cleaning up…');
});
```

### Built-in kernel events

| Event                   | Payload                          |
|-------------------------|----------------------------------|
| `kernel:booted`         | `{ version, kernelId, time }`    |
| `kernel:shutdown`       | `{ uptime }`                     |
| `kernel:exit`           | `{ code }`                       |
| `kernel:syscall`        | `{ num, args, result }`          |
| `kernel:module:loaded`  | `{ name }`                       |
| `kernel:module:unloaded`| `{ name }`                       |
| `cpu:ready`             | `{ version }`                    |
| `cpu:cycle-limit`       | `{ cycles }`                     |
| `service:started`       | `{ name }`                       |
| `service:stopped`       | `{ name }`                       |
| `service:failed`        | `{ name, error }`                |

---

## 10. Running on Termux

### First-time setup

```bash
# 1. Install Termux from F-Droid (recommended) or Play Store
# 2. Install Node.js inside Termux
pkg update && pkg install nodejs

# 3. Clone this repo (or transfer the folder)
# Option A — git clone
pkg install git
git clone https://github.com/Cbetts1/AIOSCPU-PROTYPE.git
cd AIOSCPU-PROTYPE

# Option B — transfer folder manually via adb / file manager
# then: cd /path/to/AIOSCPU-PROTYPE

# 4. Make the entry script executable
chmod +x aos

# 5. Boot AIOS Lite
./aos
```

### No internet required
Once the repo is on the device, AIOS Lite runs **completely offline**.
There are no npm packages to install and no network calls at runtime.

### Termux tips

- Use `termux-clipboard-set` and `termux-clipboard-get` to move text.
- Use `tmux` (via `pkg install tmux`) to keep sessions alive.
- The `clear` command works inside the AIOS terminal.

---

## 11. Running on Desktop

```bash
# Requires Node.js >= 14

node aos
# or
npm start
```

---

## 12. Repo Audit Summary

| Source Repo              | Status    | What was used / done                                    |
|--------------------------|-----------|----------------------------------------------------------|
| `Kernal-`                | ✅ Merged | `kernel.js` → `core/kernel.js` (CJS rewrite)            |
| `Router`                 | ✅ Merged | `router.js` → `core/router.js` (UMD→CJS)                |
| `Os-layer`               | ✅ Merged | `os.js` boot concept → `boot/boot.js`                   |
| `Os-handshake`           | ✅ Merged | `interOS.js` handshake pattern → kernel event bus        |
| `Digtail-Web-CPU`        | ✅ Merged | ISA spec (`cpu/isa_spec.md`) → `core/cpu.js` JS reimpl  |
| `Terminal`               | ✅ Merged | Shell session concept → `terminal/terminal.js` (no HTTP)|
| `Files-system`           | ✅ Replaced | Was empty → `core/filesystem.js` (full VFS)            |
| `Backend-file-system-`   | ✅ Replaced | Was empty → `core/filesystem.js`                       |
| `NEW-ATTEMPT`            | ✅ Referenced | C kernel concepts (scheduler, eventbus) absorbed       |
| `PROJECT`                | ✅ Referenced | Docs/scripts reviewed; no code ported (doc-only repo)  |
| `AIOS`                   | ✅ Referenced | Python install scripts reviewed; architecture noted    |
| `AIOSCPU-PROTYPE`        | ✅ This repo | Final unified codebase lives here                      |

---

*AIOS Lite v1.0.0 — AIOSCPU Prototype One*
