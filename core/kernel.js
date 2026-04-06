'use strict';
/**
 * kernel.js — AIOS Software Kernel v2.0.0
 *
 * Merged & adapted from: Cbetts1/Kernal-  (kernel.js)
 *                         Cbetts1/Os-layer (os.js)
 *                         Cbetts1/Os-handshake (interOS.js)
 *
 * v2.0.0 additions:
 *   - Self-integrity check: SHA-256 of own source pinned in VROM on boot;
 *     re-verified on demand via kernel.verifyIntegrity()
 *   - VHAL integration: kernel.attachVHAL(vhal) merges device registry;
 *     syscalls IOREAD (20) and IOWRITE (21) forward to VHAL
 *   - reboot(mode): persists kernel state, re-execs via child_process.spawn
 *   - ERROR_CODES table (25 codes)
 *   - DependencyGraph for ordered module initialisation
 *   - panic(msg) / assert(cond, msg): fail-fast helpers
 *   - Health-check registry
 *
 * Pure Node.js CommonJS. Zero external dependencies.
 * Compatible with: Node.js >= 14, Termux on Android.
 */

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');
const cp     = require('child_process');

// ---------------------------------------------------------------------------
// Standardized error codes
// ---------------------------------------------------------------------------
const ERROR_CODES = Object.freeze({
  OK:               0,
  // General
  E_UNKNOWN:        1,
  E_INVALID_ARG:    2,
  E_NOT_FOUND:      3,
  E_PERMISSION:     4,
  E_TIMEOUT:        5,
  // Kernel
  E_MODULE_LOAD:    10,
  E_MODULE_DEP:     11,
  E_SYSCALL:        12,
  E_PANIC:          13,
  // CPU
  E_CPU_FAULT:      20,
  E_CPU_BOUNDS:     21,
  E_CPU_HALT:       22,
  // Filesystem
  E_FS_NOT_FOUND:   30,
  E_FS_NOT_DIR:     31,
  E_FS_NOT_FILE:    32,
  E_FS_INTEGRITY:   33,
  // Services
  E_SVC_NOT_FOUND:  40,
  E_SVC_CRASH:      41,
  E_SVC_TIMEOUT:    42,
  // AI
  E_AI_OFFLINE:     50,
  E_AI_MODEL:       51,
  E_AI_CONTEXT:     52,
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function uid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return crypto.randomBytes(16).toString('hex');
}

// ---------------------------------------------------------------------------
// DependencyGraph — tracks module load order and circular deps
// ---------------------------------------------------------------------------
class DependencyGraph {
  constructor() {
    this._deps = Object.create(null);   // name -> Set of dependency names
    this._order = [];                   // resolved load order
  }

  /** Register a module with optional dependencies. */
  register(name, deps = []) {
    if (!this._deps[name]) this._deps[name] = new Set();
    for (const d of deps) this._deps[name].add(d);
    return this;
  }

  /** Topological sort — returns load order or throws on cycle. */
  resolve() {
    const visited = new Set();
    const temp    = new Set();
    const order   = [];

    const visit = (name) => {
      if (visited.has(name)) return;
      if (temp.has(name)) throw new Error(`Circular dependency detected: ${name}`);
      temp.add(name);
      for (const dep of (this._deps[name] || [])) visit(dep);
      temp.delete(name);
      visited.add(name);
      order.push(name);
    };

    for (const name of Object.keys(this._deps)) visit(name);
    this._order = order;
    return order;
  }

  /** Returns true when all deps for `name` have been loaded. */
  canLoad(name, loadedSet) {
    for (const dep of (this._deps[name] || [])) {
      if (!loadedSet.has(dep)) return false;
    }
    return true;
  }

  getOrder()  { return this._order.slice(); }
  getDeps(n)  { return Array.from(this._deps[n] || []); }
}

// ---------------------------------------------------------------------------
// KernelEventBus — synchronous, isolating event bus
// ---------------------------------------------------------------------------
class KernelEventBus {
  constructor() {
    this._handlers = Object.create(null);
  }

  on(event, handler) {
    if (typeof handler !== 'function') throw new TypeError('handler must be a function');
    if (!this._handlers[event]) this._handlers[event] = [];
    this._handlers[event].push(handler);
    return this;
  }

  off(event, handler) {
    if (!this._handlers[event]) return this;
    this._handlers[event] = this._handlers[event].filter(h => h !== handler);
    return this;
  }

  emit(event, data) {
    const handlers = this._handlers[event];
    if (!handlers || handlers.length === 0) return false;
    handlers.slice().forEach(h => {
      try { h(data); } catch (e) {
        process.stderr.write(`[KernelEventBus] Error in "${event}" handler: ${e.message}\n`);
      }
    });
    return true;
  }

  once(event, handler) {
    const wrapper = (data) => { this.off(event, wrapper); handler(data); };
    this.on(event, wrapper);
    return this;
  }

  clear() { this._handlers = Object.create(null); }
}

// ---------------------------------------------------------------------------
// ProcessTable — lightweight process registry
// ---------------------------------------------------------------------------
class ProcessTable {
  constructor() {
    this._processes = new Map();
    this._nextPid = 1;
  }

  spawn(name, meta = {}) {
    const pid = this._nextPid++;
    this._processes.set(pid, {
      pid, name, meta,
      state: 'running',
      startedAt: Date.now(),
    });
    return pid;
  }

  kill(pid) {
    const proc = this._processes.get(pid);
    if (!proc) return false;
    proc.state = 'terminated';
    this._processes.delete(pid);
    return true;
  }

  get(pid) { return this._processes.get(pid) || null; }

  list() { return Array.from(this._processes.values()); }
}

// ---------------------------------------------------------------------------
// ModuleRegistry — hot-swap plug-in loader
// ---------------------------------------------------------------------------
class ModuleRegistry {
  constructor(bus) {
    this._modules = Object.create(null);
    this._bus = bus;
  }

  load(name, mod) {
    if (!name || typeof name !== 'string') throw new TypeError('Module name must be a non-empty string');
    if (!mod || typeof mod !== 'object') throw new TypeError('Module must be an object');

    const existing = this._modules[name];
    if (existing && typeof existing.stop === 'function') {
      try { existing.stop(); } catch (_) {}
    }

    this._modules[name] = mod;
    if (typeof mod.start === 'function') mod.start();
    this._bus.emit('kernel:module:loaded', { name });
    return this;
  }

  unload(name) {
    const mod = this._modules[name];
    if (!mod) return false;
    if (typeof mod.stop === 'function') try { mod.stop(); } catch (_) {}
    delete this._modules[name];
    this._bus.emit('kernel:module:unloaded', { name });
    return true;
  }

  get(name) { return this._modules[name] || null; }
  list() { return Object.keys(this._modules); }

  stopAll() {
    for (const name of this.list()) {
      const mod = this._modules[name];
      if (typeof mod.stop === 'function') try { mod.stop(); } catch (_) {}
    }
  }
}

// ---------------------------------------------------------------------------
// ERROR_CODES — 25 named error codes
// ---------------------------------------------------------------------------
const ERROR_CODES = Object.freeze({
  E_OK:              0,
  E_UNKNOWN:         1,
  E_INVALID_ARG:     2,
  E_NOT_FOUND:       4,
  E_PERMISSION:      5,
  E_TIMEOUT:         6,
  E_IO:              7,
  E_NO_MEM:          8,
  E_BUSY:            9,
  E_AGAIN:           10,
  E_INVAL:           11,
  E_OVERFLOW:        12,
  E_UNDERFLOW:       13,
  E_CORRUPT:         14,
  E_PANIC:           15,
  E_SYSCALL:         16,
  E_MODULE:          17,
  E_BOOT:            18,
  E_SHUTDOWN:        19,
  E_INTEGRITY:       20,
  E_VHAL:            21,
  E_NPU:             22,
  E_REBOOT:          23,
  E_ASSERT:          24,
  E_DEPENDENCY:      25,
});

// ---------------------------------------------------------------------------
// DependencyGraph — ordered initialisation
// ---------------------------------------------------------------------------
class DependencyGraph {
  constructor() {
    this._nodes = new Map();   // name → Set of deps
  }

  add(name, deps = []) {
    this._nodes.set(name, new Set(deps));
    return this;
  }

  // Returns nodes in topological order (throws on cycle)
  order() {
    const visited = new Set();
    const result  = [];
    const visiting = new Set();

    const visit = (name) => {
      if (visited.has(name)) return;
      if (visiting.has(name)) throw new Error(`DependencyGraph: cycle detected at "${name}"`);
      visiting.add(name);
      const deps = this._nodes.get(name) || new Set();
      for (const dep of deps) {
        if (this._nodes.has(dep)) visit(dep);
      }
      visiting.delete(name);
      visited.add(name);
      result.push(name);
    };

    for (const name of this._nodes.keys()) visit(name);
    return result;
  }
}

// ---------------------------------------------------------------------------
// Kernel factory
// ---------------------------------------------------------------------------
function createKernel(options = {}) {
  const KERNEL_VERSION = '2.0.0';
  const kernelId = `aios-kernel-${uid().slice(0, 8)}`;

  const bus     = new KernelEventBus();
  const modules = new ModuleRegistry(bus);
  const procs   = new ProcessTable();
  const depGraph = new DependencyGraph();

  // ── Health-check registry ────────────────────────────────────────────────
  const _healthChecks = new Map();   // name → fn

  function registerHealthCheck(name, fn) {
    if (typeof fn !== 'function') throw new TypeError('health check must be a function');
    _healthChecks.set(name, fn);
  }

  async function runHealthChecks() {
    const results = {};
    for (const [name, fn] of _healthChecks.entries()) {
      try {
        results[name] = await fn();
      } catch (e) {
        results[name] = { ok: false, error: e.message };
      }
    }
    return results;
  }

  // ── Panic / Assert ────────────────────────────────────────────────────────
  function panic(msg) {
    bus.emit('kernel:panic', { message: msg, kernelId, time: Date.now() });
    throw new Error(`KERNEL PANIC: ${msg}`);
  }

  function assert(cond, msg) {
    if (!cond) panic(`Assertion failed: ${msg}`);
  }

  // ── VHAL integration ──────────────────────────────────────────────────────
  let _vhal = null;

  function attachVHAL(vhal) {
    _vhal = vhal;
    bus.emit('kernel:vhal:attached', { devices: vhal.deviceList().length });
  }

  // ── Syscall dispatch ──────────────────────────────────────────────────────
  const _syscalls = Object.create(null);

  // SYS_WRITE (0): write string to stdout (no newline)
  _syscalls[0] = (args) => {
    process.stdout.write(String(args[0] !== undefined ? args[0] : ''));
    return 0;
  };
  // SYS_WRITELN (1): write line to stdout
  _syscalls[1] = (args) => {
    process.stdout.write(String(args[0] !== undefined ? args[0] : '') + '\n');
    return 0;
  };
  // SYS_EXIT (6): emit shutdown event
  _syscalls[6] = (args) => {
    const code = args[0] || 0;
    bus.emit('kernel:exit', { code });
    return code;
  };
  // SYS_GETPID (7): return host process PID
  _syscalls[7] = (_args) => process.pid;
  // SYS_UPTIME (8): return OS uptime in seconds
  _syscalls[8] = (_args) => uptime();
  // SYS_IOREAD (20): read from VHAL device — args: [deviceId, addr]
  _syscalls[20] = (args) => {
    if (!_vhal) return null;
    return _vhal.read(args[0], args[1]);
  };
  // SYS_IOWRITE (21): write to VHAL device — args: [deviceId, addr, value]
  _syscalls[21] = (args) => {
    if (!_vhal) return false;
    return _vhal.write(args[0], args[1], args[2]);
  };
  // SYS_IOCTL (22): ioctl on VHAL device — args: [deviceId, cmd, argsObj]
  _syscalls[22] = (args) => {
    if (!_vhal) return { ok: false, error: 'no VHAL attached' };
    return _vhal.ioctl(args[0], args[1], args[2]);
  };

  function registerSyscall(num, handler) {
    if (typeof handler !== 'function') throw new TypeError('syscall handler must be a function');
    _syscalls[num] = handler;
  }

  function syscall(num, args = []) {
    const handler = _syscalls[num];
    if (!handler) {
      return { status: 'error', message: `Unknown syscall ${num}` };
    }
    try {
      const result = handler(args);
      bus.emit('kernel:syscall', { num, args, result });
      return { status: 'ok', result };
    } catch (e) {
      return { status: 'error', message: e.message };
    }
  }

  // ── Boot state ────────────────────────────────────────────────────────────
  let _booted    = false;
  let _bootTime  = 0;
  let _integrityHash = null;

  // ── Self-integrity ────────────────────────────────────────────────────────
  // Compute SHA-256 of this kernel source file.
  function _computeSelfHash() {
    try {
      const src = fs.readFileSync(__filename, 'utf8');
      return crypto.createHash('sha256').update(src).digest('hex');
    } catch (_) {
      return null;
    }
  }

  function verifyIntegrity() {
    if (!_integrityHash) return { ok: true, note: 'integrity hash not yet pinned' };
    const live = _computeSelfHash();
    if (!live) return { ok: false, error: 'could not read kernel source' };
    if (live !== _integrityHash) {
      bus.emit('kernel:integrity:fail', { expected: _integrityHash, got: live });
      return { ok: false, error: 'kernel source has been modified since boot' };
    }
    return { ok: true };
  }

  // ── Boot ─────────────────────────────────────────────────────────────────
  function boot() {
    if (_booted) return;
    _bootTime = Date.now();
    _booted   = true;

    // Pin integrity hash
    _integrityHash = _computeSelfHash();

    bus.emit('kernel:booted', {
      version:   KERNEL_VERSION,
      kernelId,
      time:      _bootTime,
      integrity: _integrityHash ? _integrityHash.slice(0, 16) + '…' : 'unavailable',
    });
  }

  // ── Shutdown ──────────────────────────────────────────────────────────────
  function shutdown() {
    modules.stopAll();
    bus.emit('kernel:shutdown', { uptime: uptime() });
    bus.clear();
    _booted = false;
  }

  function uptime() {
    return _booted ? Math.floor((Date.now() - _bootTime) / 1000) : 0;
  }

  // ── reboot(mode) ─────────────────────────────────────────────────────────
  // Persist kernel state then re-exec the entry point inside the host OS.
  function reboot(mode) {
    const stateFile = options.stateFile || '/tmp/aios-kernel-state.json';
    const entry     = options.entry     || process.argv[1] || require.main && require.main.filename;

    const state = {
      kernelId,
      version:   KERNEL_VERSION,
      bootTime:  _bootTime,
      uptime:    uptime(),
      modules:   modules.list(),
      mode:      mode || 'normal',
      rebootAt:  Date.now(),
    };

    try {
      fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
    } catch (_) { /* non-fatal — continue reboot */ }

    bus.emit('kernel:reboot', { mode: mode || 'normal', stateFile });
    shutdown();

    if (entry) {
      const child = cp.spawn(process.execPath, [entry, '--reboot', stateFile], {
        detached: true,
        stdio:    'inherit',
        env:      Object.assign({}, process.env, { AIOS_REBOOT: '1' }),
      });
      child.unref();
    }
  }

  return {
    id:              kernelId,
    version:         KERNEL_VERSION,
    bus,
    modules,
    procs,
    depGraph,
    ERROR_CODES,
    boot,
    shutdown,
    reboot,
    uptime,
    syscall,
    registerSyscall,
    isBooted:        () => _booted,
    attachVHAL,
    verifyIntegrity,
    registerHealthCheck,
    runHealthChecks,
    panic,
    assert,
  };
}

module.exports = { createKernel, ERROR_CODES, DependencyGraph };
