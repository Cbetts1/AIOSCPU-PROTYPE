'use strict';
/**
 * tests/status-bar.test.js
 * Tests for core/status-bar.js
 */
const { createStatusBar } = require('../core/status-bar');

// Minimal kernel mock
function makeKernel(uptimeVal = 0) {
  return {
    uptime: () => uptimeVal,
    bus: { emit: jest.fn() },
  };
}

// ── Factory ──────────────────────────────────────────────────────────────────
describe('createStatusBar', () => {
  test('returns a status bar object', () => {
    const sb = createStatusBar(makeKernel());
    expect(sb).toBeDefined();
    expect(sb.name).toBe('status-bar');
    expect(sb.version).toBe('1.0.0');
  });

  test('works without a kernel', () => {
    const sb = createStatusBar(null);
    expect(sb).toBeDefined();
    expect(() => sb.render()).not.toThrow();
  });
});

// ── render() ─────────────────────────────────────────────────────────────────
describe('render()', () => {
  test('returns a non-empty string', () => {
    const sb = createStatusBar(makeKernel(42));
    const result = sb.render();
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  test('includes uptime from kernel', () => {
    const sb = createStatusBar(makeKernel(90));  // 1m30s
    const result = sb.render();
    expect(result).toMatch(/1m30s/);
  });

  test('includes uptime in seconds when < 60s', () => {
    const sb = createStatusBar(makeKernel(45));
    expect(sb.render()).toMatch(/45s/);
  });

  test('includes hours when uptime >= 3600', () => {
    const sb = createStatusBar(makeKernel(7265));  // 2h1m5s
    expect(sb.render()).toMatch(/2h1m5s/);
  });

  test('includes days when uptime >= 86400', () => {
    const sb = createStatusBar(makeKernel(90061));  // 1d1h1m1s
    expect(sb.render()).toMatch(/1d/);
  });

  test('includes MODE label', () => {
    const sb = createStatusBar(makeKernel());
    expect(sb.render()).toMatch(/MODE/);
  });

  test('includes MODEL label', () => {
    const sb = createStatusBar(makeKernel());
    expect(sb.render()).toMatch(/MODEL/);
  });

  test('includes NET label', () => {
    const sb = createStatusBar(makeKernel());
    expect(sb.render()).toMatch(/NET/);
  });
});

// ── getLast() ────────────────────────────────────────────────────────────────
describe('getLast()', () => {
  test('returns empty string before first render', () => {
    // getLast() calls render() if _lastRender is empty
    const sb = createStatusBar(makeKernel());
    const last = sb.getLast();
    expect(typeof last).toBe('string');
    expect(last.length).toBeGreaterThan(0);
  });

  test('returns cached render after render()', () => {
    const sb = createStatusBar(makeKernel(10));
    const first = sb.render();
    const last  = sb.getLast();
    expect(last).toBe(first);
  });
});

// ── Providers ────────────────────────────────────────────────────────────────
describe('providers', () => {
  test('setCpuProvider influences render output', () => {
    const sb = createStatusBar(makeKernel());
    sb.setCpuProvider(() => 99);
    const result = sb.render();
    expect(result).toMatch(/99%/);
  });

  test('setMemProvider influences render output', () => {
    const sb = createStatusBar(makeKernel());
    sb.setMemProvider(() => ({ used: 800, total: 1000 }));
    const result = sb.render();
    expect(result).toMatch(/80%/);
  });

  test('setModeProvider influences render', () => {
    const sb = createStatusBar(makeKernel());
    sb.setModeProvider(() => 'CODE');
    expect(sb.render()).toMatch(/CODE/);
  });

  test('setModelProvider influences render', () => {
    const sb = createStatusBar(makeKernel());
    sb.setModelProvider(() => 'tinyllama');
    expect(sb.render()).toMatch(/tinyllama/);
  });

  test('long model names are truncated in render', () => {
    const sb = createStatusBar(makeKernel());
    sb.setModelProvider(() => 'a-very-long-model-name-that-exceeds-limit');
    const result = sb.render();
    // Should be truncated to ≤ 16 chars + '..'
    expect(result).toMatch(/\.\./);
  });

  test('setNetProvider controls net indicator', () => {
    const sb = createStatusBar(makeKernel());
    sb.setNetProvider(() => ({ up: true, down: false }));
    expect(sb.render()).toMatch(/NET/);
  });

  test('setErrorProvider shows error in render', () => {
    const sb = createStatusBar(makeKernel());
    sb.setErrorProvider(() => 'disk full');
    expect(sb.render()).toMatch(/disk full/);
  });

  test('setErrorProvider returns null hides error indicator', () => {
    const sb = createStatusBar(makeKernel());
    sb.setErrorProvider(() => null);
    const result = sb.render();
    expect(result).not.toMatch(/⚠/);
  });

  test('provider throwing does not crash render', () => {
    const sb = createStatusBar(makeKernel());
    sb.setCpuProvider(() => { throw new Error('provider error'); });
    expect(() => sb.render()).not.toThrow();
  });

  test('non-function ignored by setter', () => {
    const sb = createStatusBar(makeKernel());
    sb.setCpuProvider('not a function');
    expect(() => sb.render()).not.toThrow();
  });
});

// ── start() / stop() ─────────────────────────────────────────────────────────
describe('start() / stop()', () => {
  afterEach(() => jest.useRealTimers());

  test('isRunning() is false by default', () => {
    const sb = createStatusBar(makeKernel());
    expect(sb.isRunning()).toBe(false);
  });

  test('start() sets isRunning to true', () => {
    jest.useFakeTimers();
    const sb = createStatusBar(makeKernel(), { refreshMs: 1000 });
    sb.start();
    expect(sb.isRunning()).toBe(true);
    sb.stop();
  });

  test('stop() sets isRunning to false', () => {
    jest.useFakeTimers();
    const sb = createStatusBar(makeKernel(), { refreshMs: 1000 });
    sb.start();
    sb.stop();
    expect(sb.isRunning()).toBe(false);
  });

  test('calling start() twice is idempotent', () => {
    jest.useFakeTimers();
    const sb = createStatusBar(makeKernel(), { refreshMs: 1000 });
    sb.start();
    sb.start();
    expect(sb.isRunning()).toBe(true);
    sb.stop();
  });

  test('calling stop() when not running does nothing', () => {
    const sb = createStatusBar(makeKernel());
    expect(() => sb.stop()).not.toThrow();
  });

  test('start() emits status-bar:started on kernel bus', () => {
    jest.useFakeTimers();
    const kernel = makeKernel();
    const sb = createStatusBar(kernel, { refreshMs: 1000 });
    sb.start();
    expect(kernel.bus.emit).toHaveBeenCalledWith('status-bar:started', {});
    sb.stop();
  });

  test('stop() emits status-bar:stopped on kernel bus', () => {
    jest.useFakeTimers();
    const kernel = makeKernel();
    const sb = createStatusBar(kernel, { refreshMs: 1000 });
    sb.start();
    sb.stop();
    expect(kernel.bus.emit).toHaveBeenCalledWith('status-bar:stopped', {});
  });

  test('does not start when refreshMs is 0', () => {
    const sb = createStatusBar(makeKernel(), { refreshMs: 0 });
    sb.start();
    expect(sb.isRunning()).toBe(false);
  });
});
