'use strict';
/**
 * kernel.js — AIOS Software Kernel v1.1.0
 *
 * Merged & adapted from: Cbetts1/Kernal-  (kernel.js)
 *                         Cbetts1/Os-layer (os.js)
 *                         Cbetts1/Os-handshake (interOS.js)
 *
 * v1.1.0 additions:
 *   - Standardized ERROR_CODES table
 *   - Module dependency graph with load-order enforcement
 *   - Fail-fast logic (panic / assert)
 *   - Service health-check registry
 *
 * Pure Node.js CommonJS. Zero external dependencies.
 * Compatible with: Node.js >= 14, Termux on Android.
 */

const crypto = require('crypto');

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
// Kernel factory
// ---------------------------------------------------------------------------
function createKernel(options = {}) {
  const KERNEL_VERSION = '1.1.0';
  const kernelId = `aios-kernel-${uid().slice(0, 8)}`;

  const bus     = new KernelEventBus();
  const modules = new ModuleRegistry(bus);
  const procs   = new ProcessTable();
  const depGraph = new DependencyGraph();

  // Service health-check registry: name -> { interval, check(), lastStatus }
  const _healthChecks = Object.create(null);
  const _healthTimers = Object.create(null);

  // ---------------------------------------------------------------------------
  // Fail-fast / panic helpers
  // ---------------------------------------------------------------------------
  function panic(message, code = ERROR_CODES.E_PANIC) {
    const msg = `[KERNEL PANIC] ${message} (code=${code})`;
    bus.emit('kernel:panic', { message, code, time: Date.now() });
    process.stderr.write(msg + '\n');
    throw Object.assign(new Error(msg), { kernelCode: code, isPanic: true });
  }

  function assert(condition, message, code = ERROR_CODES.E_INVALID_ARG) {
    if (!condition) panic(message, code);
  }

  // ---------------------------------------------------------------------------
  // Service health checks
  // ---------------------------------------------------------------------------
  function registerHealthCheck(name, checkFn, intervalMs = 30000) {
    if (typeof checkFn !== 'function') throw new TypeError('checkFn must be a function');
    _healthChecks[name] = { check: checkFn, intervalMs, lastStatus: null, lastCheck: 0 };
    return { name };
  }

  function runHealthCheck(name) {
    const entry = _healthChecks[name];
    if (!entry) return { ok: false, error: `No health check registered: ${name}` };
    try {
      const result = entry.check();
      entry.lastStatus = result;
      entry.lastCheck  = Date.now();
      bus.emit('kernel:health:check', { name, result });
      return { ok: true, name, result };
    } catch (e) {
      entry.lastStatus = { healthy: false, error: e.message };
      entry.lastCheck  = Date.now();
      bus.emit('kernel:health:fail', { name, error: e.message });
      return { ok: false, name, error: e.message };
    }
  }

  function runAllHealthChecks() {
    return Object.keys(_healthChecks).map(n => runHealthCheck(n));
  }

  function getHealthStatus() {
    const out = {};
    for (const [n, entry] of Object.entries(_healthChecks)) {
      out[n] = { lastStatus: entry.lastStatus, lastCheck: entry.lastCheck };
    }
    return out;
  }

  function startHealthMonitoring() {
    for (const [name, entry] of Object.entries(_healthChecks)) {
      if (_healthTimers[name]) continue;
      const t = setInterval(() => runHealthCheck(name), entry.intervalMs);
      if (t.unref) t.unref();
      _healthTimers[name] = t;
    }
  }

  function stopHealthMonitoring() {
    for (const [name, t] of Object.entries(_healthTimers)) {
      clearInterval(t);
      delete _healthTimers[name];
    }
  }

  // Syscall dispatch table — augmented by cpu.js and other modules
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

  let _booted = false;
  let _bootTime = 0;

  function boot() {
    if (_booted) return;
    _bootTime = Date.now();
    _booted = true;
    bus.emit('kernel:booted', { version: KERNEL_VERSION, kernelId, time: _bootTime });
  }

  function shutdown() {
    modules.stopAll();
    bus.emit('kernel:shutdown', { uptime: uptime() });
    bus.clear();
    _booted = false;
  }

  function uptime() {
    return _booted ? Math.floor((Date.now() - _bootTime) / 1000) : 0;
  }

  return {
    id:             kernelId,
    version:        KERNEL_VERSION,
    ERROR_CODES,
    bus,
    modules,
    procs,
    depGraph,
    boot,
    shutdown,
    uptime,
    syscall,
    registerSyscall,
    isBooted:       () => _booted,
    // Fail-fast
    panic,
    assert,
    // Health checks
    registerHealthCheck,
    runHealthCheck,
    runAllHealthChecks,
    getHealthStatus,
    startHealthMonitoring,
    stopHealthMonitoring,
  };
}

module.exports = { createKernel, ERROR_CODES };
