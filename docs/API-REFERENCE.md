# AIOSCPU API Reference  v1.0.0

> **AIOSCPU Prototype One — JavaScript API Reference**
> All modules are CommonJS. Zero external runtime dependencies.

---

## Table of Contents

1. [Kernel](#1-kernel)
2. [CPU](#2-cpu)
3. [Filesystem](#3-filesystem)
4. [Router](#4-router)
5. [Service Manager](#5-service-manager)
6. [AI Core](#6-ai-core)
7. [AIOS AURA](#7-aios-aura)
8. [Status Bar](#8-status-bar)
9. [Boot Splash](#9-boot-splash)
10. [Memory Engine](#10-memory-engine)
11. [Mode Manager](#11-mode-manager)
12. [Health Monitor](#12-health-monitor)
13. [Port Server](#13-port-server)
14. [Error Codes](#14-error-codes)

---

## 1. Kernel

**Module:** `core/kernel.js`

```javascript
const { createKernel, ERROR_CODES } = require('./core/kernel');
const kernel = createKernel(options);
```

### Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| *(none currently)* | | | |

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `kernel.boot()` | `void` | Boot the kernel |
| `kernel.shutdown()` | `void` | Stop all modules, clear bus |
| `kernel.uptime()` | `number` | Seconds since boot |
| `kernel.isBooted()` | `boolean` | Whether kernel has booted |
| `kernel.syscall(num, args)` | `{status, result}` | Dispatch syscall |
| `kernel.registerSyscall(num, fn)` | `void` | Register a syscall handler |
| `kernel.panic(message, code)` | *throws* | Fail-fast kernel panic |
| `kernel.assert(cond, message, code)` | `void` | Assert or panic |
| `kernel.registerHealthCheck(name, fn, intervalMs)` | `{name}` | Register health check |
| `kernel.runHealthCheck(name)` | `{ok, name, result}` | Run one health check |
| `kernel.runAllHealthChecks()` | `Array` | Run all health checks |
| `kernel.getHealthStatus()` | `Object` | Last health status for all checks |
| `kernel.startHealthMonitoring()` | `void` | Start interval-based monitoring |
| `kernel.stopHealthMonitoring()` | `void` | Stop monitoring |

### Sub-objects

| Property | Type | Description |
|----------|------|-------------|
| `kernel.bus` | `KernelEventBus` | Event bus (`on`, `off`, `emit`, `once`, `clear`) |
| `kernel.modules` | `ModuleRegistry` | Module registry (`load`, `unload`, `get`, `list`) |
| `kernel.procs` | `ProcessTable` | Process table (`spawn`, `kill`, `get`, `list`) |
| `kernel.depGraph` | `DependencyGraph` | Dependency graph (`register`, `resolve`, `canLoad`) |
| `kernel.ERROR_CODES` | `Object` | Standardized error code constants |

### Events

| Event | Payload | Description |
|-------|---------|-------------|
| `kernel:booted` | `{version, kernelId, time}` | Kernel boot complete |
| `kernel:shutdown` | `{uptime}` | Kernel shutdown |
| `kernel:panic` | `{message, code, time}` | Kernel panic |
| `kernel:syscall` | `{num, args, result}` | Syscall dispatched |
| `kernel:module:loaded` | `{name}` | Module loaded |
| `kernel:module:unloaded` | `{name}` | Module unloaded |
| `kernel:health:check` | `{name, result}` | Health check ran |
| `kernel:health:fail` | `{name, error}` | Health check threw |

### Error Codes

```javascript
ERROR_CODES.OK             // 0
ERROR_CODES.E_UNKNOWN      // 1
ERROR_CODES.E_INVALID_ARG  // 2
ERROR_CODES.E_NOT_FOUND    // 3
ERROR_CODES.E_PERMISSION   // 4
ERROR_CODES.E_TIMEOUT      // 5
ERROR_CODES.E_MODULE_LOAD  // 10
ERROR_CODES.E_MODULE_DEP   // 11
ERROR_CODES.E_SYSCALL      // 12
ERROR_CODES.E_PANIC        // 13
ERROR_CODES.E_CPU_FAULT    // 20
ERROR_CODES.E_CPU_BOUNDS   // 21
ERROR_CODES.E_CPU_HALT     // 22
ERROR_CODES.E_FS_NOT_FOUND // 30
ERROR_CODES.E_FS_NOT_DIR   // 31
ERROR_CODES.E_FS_NOT_FILE  // 32
ERROR_CODES.E_FS_INTEGRITY // 33
ERROR_CODES.E_SVC_NOT_FOUND// 40
ERROR_CODES.E_SVC_CRASH    // 41
ERROR_CODES.E_SVC_TIMEOUT  // 42
ERROR_CODES.E_AI_OFFLINE   // 50
ERROR_CODES.E_AI_MODEL     // 51
ERROR_CODES.E_AI_CONTEXT   // 52
```

---

## 2. CPU

**Module:** `core/cpu.js`

```javascript
const { createCPU, OP } = require('./core/cpu');
const cpu = createCPU(kernel);  // kernel optional
```

### ISA Summary

- Registers: R0–R7, PC, SP, FLAGS
- Memory: 64 KB (Uint8Array)
- Stack: 0x0100–0x01FF
- Program: 0x0200–0x3FFF
- Data: 0x4000–0x7FFF
- Heap: 0x8000–0xFFFF

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `cpu.loadProgram(instructions)` | `void` | Load a program array |
| `cpu.step()` | `boolean` | Execute one instruction |
| `cpu.run(program?)` | `{halted, cycles, regs, flags}` | Run until HALT |
| `cpu.selfTest()` | `{passed, failed, allPassed, results}` | Run 10-assertion self-test |
| `cpu.reset()` | `void` | Reset all state |
| `cpu.getRegs()` | `number[]` | R0–R7 values |
| `cpu.getReg(n)` | `number` | Single register |
| `cpu.setReg(n, v)` | `void` | Set register |
| `cpu.getPC()` | `number` | Program counter |
| `cpu.getSP()` | `number` | Stack pointer |
| `cpu.getFlags()` | `number` | FLAGS register |
| `cpu.getMem(addr)` | `number` | Read memory byte |
| `cpu.setMem(addr, val)` | `void` | Write memory byte |
| `cpu.isHalted()` | `boolean` | HALT state |
| `cpu.isRunning()` | `boolean` | Running state |
| `cpu.getCycles()` | `number` | Cycle counter |

### Opcodes (OP table)

```javascript
OP.NOP, OP.HALT
OP.MOV, OP.LOADI, OP.LOAD, OP.STORE, OP.LOADR, OP.STORER
OP.ADD, OP.ADDI, OP.SUB, OP.MUL, OP.DIV, OP.MOD
OP.NEG, OP.ABS, OP.INC, OP.DEC          // v1.1 additions
OP.AND, OP.OR, OP.XOR, OP.NOT, OP.SHL, OP.SHR
OP.CMP, OP.CMPI
OP.JMP, OP.JMPR, OP.JZ, OP.JNZ, OP.JLT, OP.JGT, OP.JLE, OP.JGE
OP.CALL, OP.RET, OP.PUSH, OP.POP
OP.SYSCALL, OP.IN, OP.OUT
```

### Memory Bounds

Memory reads/writes outside `[0, 65535]` throw `RangeError` with `err.cpuCode = 'E_CPU_BOUNDS'`.

---

## 3. Filesystem

**Module:** `core/filesystem.js`

```javascript
const { createFilesystem } = require('./core/filesystem');
const fs = createFilesystem();
```

### Methods

All methods return `{ ok: boolean, ... }` objects.

| Method | Returns | Description |
|--------|---------|-------------|
| `fs.pwd()` | `string` | Current directory |
| `fs.cd(path)` | `{ok, path}` | Change directory |
| `fs.mkdir(path, {parents})` | `{ok, path}` | Create directory |
| `fs.ls(path)` | `{ok, entries}` | List directory |
| `fs.touch(path)` | `{ok, path}` | Create/update file |
| `fs.read(path)` | `{ok, content, path}` | Read file |
| `fs.write(path, content)` | `{ok, path, bytes}` | Write file |
| `fs.append(path, content)` | `{ok, path, bytes}` | Append to file |
| `fs.writeAtomic(path, content)` | `{ok, path, bytes}` | Atomic write |
| `fs.rm(path, {recursive})` | `{ok, path}` | Remove file/dir |
| `fs.stat(path)` | `{ok, type, size, ...}` | File info |
| `fs.cp(src, dst)` | `{ok, path}` | Copy file |
| `fs.mv(src, dst)` | `{ok, path}` | Move/rename |
| `fs.tree(path)` | `string` | Recursive tree |
| `fs.fsck(path)` | `{ok, checked, errors, clean}` | Integrity check |
| `fs.mount(point, device, fsType, opts)` | `{ok, mountPoint}` | Add mount entry |
| `fs.umount(point)` | `{ok, mountPoint}` | Remove mount entry |
| `fs.getMounts()` | `Array` | List mount table |
| `fs.snapshot()` | `string` | JSON snapshot of VFS |
| `fs.restore(json)` | `{ok}` | Restore from snapshot |
| `fs.persistTo(hostPath)` | `{ok, path}` | Save to host disk |
| `fs.loadFrom(hostPath)` | `{ok}` | Load from host disk |
| `fs.resolvePath(p)` | `string` | Resolve path to absolute |

---

## 4. Router

**Module:** `core/router.js`

```javascript
const { createRouter } = require('./core/router');
const router = createRouter(kernel);
router.use('fs', filesystem.commands);
const result = router.dispatch('ls /home');
```

---

## 5. Service Manager

**Module:** `core/service-manager.js`

```javascript
const { createServiceManager } = require('./core/service-manager');
const svcMgr = createServiceManager(kernel);
svcMgr.register('my-svc', { start() {}, stop() {} });
svcMgr.start('my-svc');
```

---

## 6. AI Core

**Module:** `core/ai-core.js`

```javascript
const { createAICore } = require('./core/ai-core');
const aiCore = createAICore(kernel, router, svcMgr, hostBridge, memoryCore);
```

### Methods

| Method | Description |
|--------|-------------|
| `aiCore.registerBackend(name, backend, opts)` | Register an LLM backend |
| `aiCore.setHealthMonitor(hm)` | Wire in health monitor |
| `aiCore.query(text, opts)` | Single-turn query |
| `aiCore.chat(messages, opts)` | Multi-turn chat |

---

## 7. AIOS AURA

**Module:** `core/aios-aura.js`

```javascript
const { createAIOSAURA } = require('./core/aios-aura');
const aiosAura = createAIOSAURA(kernel, router, svcMgr, aiCore);
```

- **AIOS** — always-on personality, phone-first models
- **AURA** — on-demand hardware intelligence, `svc start/stop aura`

---

## 8. Status Bar

**Module:** `core/status-bar.js`

```javascript
const { createStatusBar } = require('./core/status-bar');
const sb = createStatusBar(kernel, { refreshMs: 5000, barWidth: 6 });
```

### Methods

| Method | Description |
|--------|-------------|
| `sb.render()` | Return formatted status string |
| `sb.getLast()` | Return last rendered string |
| `sb.print()` | Print to stdout |
| `sb.start()` | Start auto-refresh timer |
| `sb.stop()` | Stop auto-refresh timer |
| `sb.isRunning()` | Whether auto-refresh is active |
| `sb.setCpuProvider(fn)` | Inject CPU% provider `() => 0..100` |
| `sb.setMemProvider(fn)` | Inject MEM provider `() => {used, total}` |
| `sb.setModeProvider(fn)` | Inject mode string provider |
| `sb.setModelProvider(fn)` | Inject model name provider |
| `sb.setNetProvider(fn)` | Inject network status provider |
| `sb.setErrorProvider(fn)` | Inject error message provider |

---

## 9. Boot Splash

**Module:** `core/boot-splash.js`

```javascript
const { createBootSplash } = require('./core/boot-splash');
const splash = createBootSplash({ version: '1.0.0', showBootLog: false });
```

### Methods

| Method | Returns | Description |
|--------|---------|-------------|
| `splash.render()` | `string` | Build splash string |
| `splash.show()` | `void` | Print splash to stdout |
| `splash.complete(message)` | `void` | Print completion banner |
| `splash.log(message, level)` | `void` | Add boot log entry (level: info/ok/warn/err) |
| `splash.toggleLog()` | `boolean` | Toggle log visibility |
| `splash.setLogVisible(bool)` | `boolean` | Set log visibility |
| `splash.isLogVisible()` | `boolean` | Current visibility state |
| `splash.getLog()` | `Array` | All log entries |
| `splash.clearLog()` | `void` | Clear log |
| `splash.isShown()` | `boolean` | Whether show() was called |

---

## 10. Memory Engine

**Module:** `core/memory-engine.js`

Stores interaction history, query results, and learned data.

```javascript
const { createMemoryEngine } = require('./core/memory-engine');
const mem = createMemoryEngine(kernel, filesystem);
```

---

## 11. Mode Manager

**Module:** `core/mode-manager.js`

Manages AI operating modes: `chat`, `code`, `fix`, `help`, `learn`.

```javascript
const { createModeManager } = require('./core/mode-manager');
const mm = createModeManager(kernel);
mm.setMode('code');
console.log(mm.getMode());  // 'code'
```

---

## 12. Health Monitor

**Module:** `core/health-monitor.js`

Monitors HTTP endpoints and TCP ports.

```javascript
const { createHealthMonitor } = require('./core/health-monitor');
const hm = createHealthMonitor(kernel);
hm.start();
```

Events emitted on kernel bus:
- `health:endpoint:down`
- `health:port:down`
- `health:memory:low`

---

## 13. Port Server

**Module:** `core/port-server.js`

Single TCP communication port for inter-process messaging.

```javascript
const { createPortServer } = require('./core/port-server');
const ps = createPortServer(kernel, { port: 7070 });
ps.start();
```

---

## 14. Error Codes

See [Kernel → Error Codes](#error-codes) section above.

All modules use `kernel.ERROR_CODES` for standardized numeric error codes.

Pattern:
```javascript
const { ERROR_CODES } = require('./core/kernel');
throw Object.assign(new Error('Not found'), { code: ERROR_CODES.E_NOT_FOUND });
```
