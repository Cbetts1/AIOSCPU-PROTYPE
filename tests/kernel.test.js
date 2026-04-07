'use strict';

const { createKernel } = require('../core/kernel');

describe('Kernel', () => {
  let kernel;

  beforeEach(() => {
    kernel = createKernel();
  });

  afterEach(() => {
    kernel.shutdown();
  });

  describe('createKernel', () => {
    test('returns kernel object with expected properties', () => {
      expect(kernel).toBeDefined();
      expect(kernel.id).toMatch(/^aios-kernel-/);
      expect(kernel.version).toBe('4.0.0');
      expect(kernel.bus).toBeDefined();
      expect(kernel.modules).toBeDefined();
      expect(kernel.procs).toBeDefined();
      expect(typeof kernel.boot).toBe('function');
      expect(typeof kernel.shutdown).toBe('function');
      expect(typeof kernel.uptime).toBe('function');
      expect(typeof kernel.syscall).toBe('function');
      expect(typeof kernel.registerSyscall).toBe('function');
      expect(typeof kernel.isBooted).toBe('function');
    });

    test('generates unique kernel IDs', () => {
      const k2 = createKernel();
      expect(kernel.id).not.toBe(k2.id);
      k2.shutdown();
    });
  });

  describe('KernelEventBus', () => {
    test('emits and receives events', () => {
      const handler = jest.fn();
      kernel.bus.on('test-event', handler);
      kernel.bus.emit('test-event', { foo: 'bar' });
      expect(handler).toHaveBeenCalledWith({ foo: 'bar' });
    });

    test('returns false when no handlers exist', () => {
      expect(kernel.bus.emit('nonexistent-event', {})).toBe(false);
    });

    test('returns true when handlers exist', () => {
      kernel.bus.on('test', () => {});
      expect(kernel.bus.emit('test', {})).toBe(true);
    });

    test('removes handler with off()', () => {
      const handler = jest.fn();
      kernel.bus.on('test', handler);
      kernel.bus.off('test', handler);
      kernel.bus.emit('test', {});
      expect(handler).not.toHaveBeenCalled();
    });

    test('once() handler fires only once', () => {
      const handler = jest.fn();
      kernel.bus.once('test', handler);
      kernel.bus.emit('test', { a: 1 });
      kernel.bus.emit('test', { a: 2 });
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ a: 1 });
    });

    test('multiple handlers on same event', () => {
      const h1 = jest.fn();
      const h2 = jest.fn();
      kernel.bus.on('test', h1);
      kernel.bus.on('test', h2);
      kernel.bus.emit('test', 'data');
      expect(h1).toHaveBeenCalledWith('data');
      expect(h2).toHaveBeenCalledWith('data');
    });

    test('handler errors do not break other handlers', () => {
      const h1 = jest.fn(() => { throw new Error('fail'); });
      const h2 = jest.fn();
      kernel.bus.on('test', h1);
      kernel.bus.on('test', h2);
      const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => {});
      kernel.bus.emit('test', {});
      expect(h2).toHaveBeenCalled();
      stderrSpy.mockRestore();
    });

    test('clear() removes all handlers', () => {
      const handler = jest.fn();
      kernel.bus.on('test', handler);
      kernel.bus.clear();
      kernel.bus.emit('test', {});
      expect(handler).not.toHaveBeenCalled();
    });

    test('on() throws for non-function handler', () => {
      expect(() => kernel.bus.on('test', 'not-a-function')).toThrow(TypeError);
    });

    test('off() is safe for non-existent event', () => {
      expect(() => kernel.bus.off('nonexistent', () => {})).not.toThrow();
    });
  });

  describe('ProcessTable', () => {
    test('spawn returns incrementing PIDs', () => {
      const pid1 = kernel.procs.spawn('process1');
      const pid2 = kernel.procs.spawn('process2');
      expect(pid1).toBe(1);
      expect(pid2).toBe(2);
    });

    test('get retrieves spawned process', () => {
      const pid = kernel.procs.spawn('test', { role: 'worker' });
      const proc = kernel.procs.get(pid);
      expect(proc).toBeDefined();
      expect(proc.name).toBe('test');
      expect(proc.state).toBe('running');
      expect(proc.meta.role).toBe('worker');
      expect(proc.startedAt).toBeGreaterThan(0);
    });

    test('get returns null for non-existent PID', () => {
      expect(kernel.procs.get(999)).toBeNull();
    });

    test('kill terminates and removes a process', () => {
      const pid = kernel.procs.spawn('test');
      expect(kernel.procs.kill(pid)).toBe(true);
      expect(kernel.procs.get(pid)).toBeNull();
    });

    test('kill returns false for non-existent PID', () => {
      expect(kernel.procs.kill(999)).toBe(false);
    });

    test('list returns all running processes', () => {
      kernel.procs.spawn('a');
      kernel.procs.spawn('b');
      const list = kernel.procs.list();
      expect(list).toHaveLength(2);
      expect(list[0].name).toBe('a');
      expect(list[1].name).toBe('b');
    });
  });

  describe('ModuleRegistry', () => {
    test('load and get a module', () => {
      const mod = { name: 'test-mod' };
      kernel.modules.load('test', mod);
      expect(kernel.modules.get('test')).toBe(mod);
    });

    test('list loaded modules', () => {
      kernel.modules.load('modA', { name: 'A' });
      kernel.modules.load('modB', { name: 'B' });
      expect(kernel.modules.list()).toEqual(expect.arrayContaining(['modA', 'modB']));
    });

    test('unload removes a module', () => {
      kernel.modules.load('test', { name: 'test' });
      expect(kernel.modules.unload('test')).toBe(true);
      expect(kernel.modules.get('test')).toBeNull();
    });

    test('unload returns false for non-existent module', () => {
      expect(kernel.modules.unload('nonexistent')).toBe(false);
    });

    test('calls start() on module load', () => {
      const start = jest.fn();
      kernel.modules.load('test', { name: 'test', start });
      expect(start).toHaveBeenCalled();
    });

    test('calls stop() on module unload', () => {
      const stop = jest.fn();
      kernel.modules.load('test', { name: 'test', stop });
      kernel.modules.unload('test');
      expect(stop).toHaveBeenCalled();
    });

    test('calls stop() on existing module when replacing', () => {
      const stop = jest.fn();
      kernel.modules.load('test', { name: 'test', stop });
      kernel.modules.load('test', { name: 'test2' });
      expect(stop).toHaveBeenCalled();
    });

    test('emits kernel:module:loaded event', () => {
      const handler = jest.fn();
      kernel.bus.on('kernel:module:loaded', handler);
      kernel.modules.load('test', { name: 'test' });
      expect(handler).toHaveBeenCalledWith({ name: 'test' });
    });

    test('stopAll stops all modules', () => {
      const stop1 = jest.fn();
      const stop2 = jest.fn();
      kernel.modules.load('a', { stop: stop1 });
      kernel.modules.load('b', { stop: stop2 });
      kernel.modules.stopAll();
      expect(stop1).toHaveBeenCalled();
      expect(stop2).toHaveBeenCalled();
    });

    test('load throws for invalid name', () => {
      expect(() => kernel.modules.load('', {})).toThrow(TypeError);
      expect(() => kernel.modules.load(null, {})).toThrow(TypeError);
    });

    test('load throws for non-object module', () => {
      expect(() => kernel.modules.load('test', null)).toThrow(TypeError);
      expect(() => kernel.modules.load('test', 'string')).toThrow(TypeError);
    });
  });

  describe('Syscall dispatch', () => {
    test('SYS_EXIT (6) emits kernel:exit', () => {
      kernel.boot();
      const handler = jest.fn();
      kernel.bus.on('kernel:exit', handler);
      const result = kernel.syscall(6, [0]);
      expect(result.status).toBe('ok');
      expect(handler).toHaveBeenCalledWith({ code: 0 });
    });

    test('SYS_GETPID (7) returns process PID', () => {
      kernel.boot();
      const result = kernel.syscall(7, []);
      expect(result.status).toBe('ok');
      expect(result.result).toBe(process.pid);
    });

    test('SYS_UPTIME (8) returns uptime', () => {
      kernel.boot();
      const result = kernel.syscall(8, []);
      expect(result.status).toBe('ok');
      expect(typeof result.result).toBe('number');
    });

    test('unknown syscall returns error', () => {
      const result = kernel.syscall(999, []);
      expect(result.status).toBe('error');
      expect(result.message).toMatch(/Unknown syscall/);
    });

    test('registerSyscall adds custom syscall', () => {
      kernel.registerSyscall(100, (args) => args[0] * 2);
      const result = kernel.syscall(100, [21]);
      expect(result.status).toBe('ok');
      expect(result.result).toBe(42);
    });

    test('registerSyscall throws for non-function handler', () => {
      expect(() => kernel.registerSyscall(100, 'not-a-function')).toThrow(TypeError);
    });

    test('syscall emits kernel:syscall event', () => {
      const handler = jest.fn();
      kernel.bus.on('kernel:syscall', handler);
      kernel.registerSyscall(100, () => 42);
      kernel.syscall(100, [1, 2]);
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ num: 100, result: 42 }));
    });

    test('syscall catches handler errors gracefully', () => {
      kernel.registerSyscall(100, () => { throw new Error('boom'); });
      const result = kernel.syscall(100, []);
      expect(result.status).toBe('error');
      expect(result.message).toBe('boom');
    });
  });

  describe('Boot / Shutdown / Uptime', () => {
    test('isBooted() returns false before boot', () => {
      expect(kernel.isBooted()).toBe(false);
    });

    test('boot() sets booted state', () => {
      kernel.boot();
      expect(kernel.isBooted()).toBe(true);
    });

    test('boot() emits kernel:booted event', () => {
      const handler = jest.fn();
      kernel.bus.on('kernel:booted', handler);
      kernel.boot();
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        version: '4.0.0',
        kernelId: kernel.id,
      }));
    });

    test('boot() is idempotent', () => {
      const handler = jest.fn();
      kernel.bus.on('kernel:booted', handler);
      kernel.boot();
      kernel.boot();
      expect(handler).toHaveBeenCalledTimes(1);
    });

    test('uptime() returns 0 when not booted', () => {
      expect(kernel.uptime()).toBe(0);
    });

    test('uptime() returns >= 0 when booted', () => {
      kernel.boot();
      expect(kernel.uptime()).toBeGreaterThanOrEqual(0);
    });

    test('shutdown() resets booted state', () => {
      kernel.boot();
      kernel.shutdown();
      expect(kernel.isBooted()).toBe(false);
    });

    test('shutdown() emits kernel:shutdown event', () => {
      kernel.boot();
      const handler = jest.fn();
      kernel.bus.on('kernel:shutdown', handler);
      kernel.shutdown();
      expect(handler).toHaveBeenCalled();
    });
  });
});
