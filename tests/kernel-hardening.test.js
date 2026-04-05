'use strict';
/**
 * tests/kernel-hardening.test.js
 * Tests for Phase 1 kernel hardening features (v1.1.0)
 */
const { createKernel, ERROR_CODES } = require('../core/kernel');

// ── ERROR_CODES export ────────────────────────────────────────────────────────
describe('ERROR_CODES', () => {
  test('exported as frozen object', () => {
    expect(typeof ERROR_CODES).toBe('object');
    expect(Object.isFrozen(ERROR_CODES)).toBe(true);
  });

  test('has OK = 0', () => {
    expect(ERROR_CODES.OK).toBe(0);
  });

  test('has standard general codes', () => {
    expect(typeof ERROR_CODES.E_UNKNOWN).toBe('number');
    expect(typeof ERROR_CODES.E_INVALID_ARG).toBe('number');
    expect(typeof ERROR_CODES.E_NOT_FOUND).toBe('number');
    expect(typeof ERROR_CODES.E_PERMISSION).toBe('number');
    expect(typeof ERROR_CODES.E_TIMEOUT).toBe('number');
  });

  test('has kernel-specific codes', () => {
    expect(typeof ERROR_CODES.E_MODULE_LOAD).toBe('number');
    expect(typeof ERROR_CODES.E_PANIC).toBe('number');
    expect(typeof ERROR_CODES.E_SYSCALL).toBe('number');
  });

  test('has CPU codes', () => {
    expect(typeof ERROR_CODES.E_CPU_FAULT).toBe('number');
    expect(typeof ERROR_CODES.E_CPU_BOUNDS).toBe('number');
    expect(typeof ERROR_CODES.E_CPU_HALT).toBe('number');
  });

  test('has FS codes', () => {
    expect(typeof ERROR_CODES.E_FS_NOT_FOUND).toBe('number');
    expect(typeof ERROR_CODES.E_FS_INTEGRITY).toBe('number');
  });

  test('has service codes', () => {
    expect(typeof ERROR_CODES.E_SVC_NOT_FOUND).toBe('number');
    expect(typeof ERROR_CODES.E_SVC_CRASH).toBe('number');
  });

  test('has AI codes', () => {
    expect(typeof ERROR_CODES.E_AI_OFFLINE).toBe('number');
    expect(typeof ERROR_CODES.E_AI_MODEL).toBe('number');
  });

  test('codes are accessible via kernel.ERROR_CODES', () => {
    const k = createKernel();
    expect(k.ERROR_CODES).toBe(ERROR_CODES);
  });
});

// ── DependencyGraph ───────────────────────────────────────────────────────────
describe('depGraph', () => {
  test('kernel exposes depGraph', () => {
    const k = createKernel();
    expect(k.depGraph).toBeDefined();
    expect(typeof k.depGraph.register).toBe('function');
    expect(typeof k.depGraph.resolve).toBe('function');
    expect(typeof k.depGraph.canLoad).toBe('function');
  });

  test('register + resolve with no deps', () => {
    const k = createKernel();
    k.depGraph.register('modA');
    const order = k.depGraph.resolve();
    expect(order).toContain('modA');
  });

  test('resolve respects dependency order', () => {
    const k = createKernel();
    k.depGraph.register('modA');
    k.depGraph.register('modB', ['modA']);
    k.depGraph.register('modC', ['modB']);
    const order = k.depGraph.resolve();
    expect(order.indexOf('modA')).toBeLessThan(order.indexOf('modB'));
    expect(order.indexOf('modB')).toBeLessThan(order.indexOf('modC'));
  });

  test('resolve throws on circular dependency', () => {
    const k = createKernel();
    k.depGraph.register('modX', ['modY']);
    k.depGraph.register('modY', ['modX']);
    expect(() => k.depGraph.resolve()).toThrow(/[Cc]ircular/);
  });

  test('canLoad returns true when all deps loaded', () => {
    const k = createKernel();
    k.depGraph.register('modA');
    k.depGraph.register('modB', ['modA']);
    const loaded = new Set(['modA']);
    expect(k.depGraph.canLoad('modB', loaded)).toBe(true);
  });

  test('canLoad returns false when dep missing', () => {
    const k = createKernel();
    k.depGraph.register('modB', ['modA']);
    const loaded = new Set();
    expect(k.depGraph.canLoad('modB', loaded)).toBe(false);
  });

  test('getDeps returns dep array', () => {
    const k = createKernel();
    k.depGraph.register('m', ['a', 'b']);
    expect(k.depGraph.getDeps('m')).toEqual(expect.arrayContaining(['a', 'b']));
  });
});

// ── panic / assert ────────────────────────────────────────────────────────────
describe('panic / assert', () => {
  test('panic throws an error', () => {
    const k = createKernel();
    expect(() => k.panic('test panic')).toThrow();
  });

  test('panic error message contains message', () => {
    const k = createKernel();
    let msg = '';
    try { k.panic('boom'); } catch (e) { msg = e.message; }
    expect(msg).toMatch(/boom/);
  });

  test('panic emits kernel:panic event', () => {
    const k = createKernel();
    const events = [];
    k.bus.on('kernel:panic', e => events.push(e));
    try { k.panic('test', 99); } catch (_) {}
    expect(events).toHaveLength(1);
    expect(events[0].code).toBe(99);
  });

  test('panic error has isPanic=true', () => {
    const k = createKernel();
    let err;
    try { k.panic('x'); } catch (e) { err = e; }
    expect(err.isPanic).toBe(true);
  });

  test('assert does not throw when condition is true', () => {
    const k = createKernel();
    expect(() => k.assert(true, 'should not throw')).not.toThrow();
  });

  test('assert throws when condition is false', () => {
    const k = createKernel();
    expect(() => k.assert(false, 'assertion failed')).toThrow();
  });

  test('assert error contains message', () => {
    const k = createKernel();
    let msg = '';
    try { k.assert(false, 'bad state'); } catch (e) { msg = e.message; }
    expect(msg).toMatch(/bad state/);
  });
});

// ── Health checks ─────────────────────────────────────────────────────────────
describe('health checks', () => {
  test('registerHealthCheck returns name', () => {
    const k = createKernel();
    const r = k.registerHealthCheck('svc1', () => ({ healthy: true }));
    expect(r).toEqual({ name: 'svc1' });
  });

  test('registerHealthCheck throws on non-function', () => {
    const k = createKernel();
    expect(() => k.registerHealthCheck('bad', 'not a function')).toThrow(TypeError);
  });

  test('runHealthCheck runs the check and returns result', () => {
    const k = createKernel();
    k.registerHealthCheck('svc', () => ({ healthy: true, latency: 5 }));
    const r = k.runHealthCheck('svc');
    expect(r.ok).toBe(true);
    expect(r.result.healthy).toBe(true);
  });

  test('runHealthCheck emits kernel:health:check', () => {
    const k = createKernel();
    const events = [];
    k.bus.on('kernel:health:check', e => events.push(e));
    k.registerHealthCheck('svc', () => ({ healthy: true }));
    k.runHealthCheck('svc');
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('svc');
  });

  test('runHealthCheck returns error when check throws', () => {
    const k = createKernel();
    k.registerHealthCheck('bad', () => { throw new Error('crash'); });
    const r = k.runHealthCheck('bad');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/crash/);
  });

  test('runHealthCheck emits kernel:health:fail on throw', () => {
    const k = createKernel();
    const events = [];
    k.bus.on('kernel:health:fail', e => events.push(e));
    k.registerHealthCheck('bad', () => { throw new Error('oops'); });
    k.runHealthCheck('bad');
    expect(events).toHaveLength(1);
  });

  test('runHealthCheck returns ok:false for unknown name', () => {
    const k = createKernel();
    const r = k.runHealthCheck('nonexistent');
    expect(r.ok).toBe(false);
  });

  test('runAllHealthChecks runs all registered checks', () => {
    const k = createKernel();
    k.registerHealthCheck('a', () => ({ healthy: true }));
    k.registerHealthCheck('b', () => ({ healthy: true }));
    const results = k.runAllHealthChecks();
    expect(results).toHaveLength(2);
  });

  test('getHealthStatus returns last status for all checks', () => {
    const k = createKernel();
    k.registerHealthCheck('svc', () => ({ healthy: true }));
    k.runHealthCheck('svc');
    const status = k.getHealthStatus();
    expect(status.svc).toBeDefined();
    expect(status.svc.lastStatus.healthy).toBe(true);
    expect(typeof status.svc.lastCheck).toBe('number');
  });

  test('startHealthMonitoring / stopHealthMonitoring', () => {
    jest.useFakeTimers();
    const k = createKernel();
    const called = [];
    k.registerHealthCheck('svc', () => { called.push(1); return { healthy: true }; }, 100);
    k.startHealthMonitoring();
    jest.advanceTimersByTime(250);
    k.stopHealthMonitoring();
    expect(called.length).toBeGreaterThanOrEqual(2);
    jest.useRealTimers();
  });

  test('calling startHealthMonitoring twice is idempotent', () => {
    jest.useFakeTimers();
    const k = createKernel();
    k.registerHealthCheck('svc', () => ({ healthy: true }), 100);
    k.startHealthMonitoring();
    k.startHealthMonitoring();  // should not create duplicate timers
    k.stopHealthMonitoring();
    jest.useRealTimers();
  });
});

// ── kernel.version ────────────────────────────────────────────────────────────
describe('kernel version', () => {
  test('version is 1.1.0', () => {
    const k = createKernel();
    expect(k.version).toBe('1.1.0');
  });
});
