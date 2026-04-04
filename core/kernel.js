'use strict';
/**
 * kernel.js — AIOS Software Kernel v1.0.0
 *
 * Merged & adapted from: Cbetts1/Kernal-  (kernel.js)
 *                         Cbetts1/Os-layer (os.js)
 *                         Cbetts1/Os-handshake (interOS.js)
 *
 * Pure Node.js CommonJS. Zero external dependencies.
 * Compatible with: Node.js >= 14, Termux on Android.
 */

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function uid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return crypto.randomBytes(16).toString('hex');
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
  const KERNEL_VERSION = '1.0.0';
  const kernelId = `aios-kernel-${uid().slice(0, 8)}`;

  const bus     = new KernelEventBus();
  const modules = new ModuleRegistry(bus);
  const procs   = new ProcessTable();

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
    bus,
    modules,
    procs,
    boot,
    shutdown,
    uptime,
    syscall,
    registerSyscall,
    isBooted:       () => _booted,
  };
}

module.exports = { createKernel };
