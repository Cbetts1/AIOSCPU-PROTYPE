'use strict';
/**
 * tests/boot-splash.test.js
 * Tests for core/boot-splash.js
 */
const { createBootSplash } = require('../core/boot-splash');

// ── Factory ──────────────────────────────────────────────────────────────────
describe('createBootSplash', () => {
  test('returns a splash object with expected API', () => {
    const s = createBootSplash();
    expect(s).toBeDefined();
    expect(s.name).toBe('boot-splash');
    expect(s.version).toBe('4.0.0');
    expect(typeof s.render).toBe('function');
    expect(typeof s.show).toBe('function');
    expect(typeof s.complete).toBe('function');
    expect(typeof s.log).toBe('function');
    expect(typeof s.toggleLog).toBe('function');
    expect(typeof s.getLog).toBe('function');
    expect(typeof s.clearLog).toBe('function');
    expect(typeof s.isShown).toBe('function');
  });

  test('accepts version option', () => {
    const s = createBootSplash({ version: '9.8.7' });
    const output = s.render();
    expect(output).toMatch(/9\.8\.7/);
  });

  test('showBootLog defaults to false', () => {
    const s = createBootSplash();
    expect(s.isLogVisible()).toBe(false);
  });

  test('showBootLog option sets initial visibility', () => {
    const s = createBootSplash({ showBootLog: true });
    expect(s.isLogVisible()).toBe(true);
  });
});

// ── render() ─────────────────────────────────────────────────────────────────
describe('render()', () => {
  test('returns a non-empty string', () => {
    const s = createBootSplash();
    const r = s.render();
    expect(typeof r).toBe('string');
    expect(r.length).toBeGreaterThan(0);
  });

  test('contains AIOSCPU in logo lines', () => {
    const s = createBootSplash();
    const r = s.render();
    expect(r).toMatch(/AIOSCPU/);
  });

  test('contains version string', () => {
    const s = createBootSplash({ version: '2.3.4' });
    const r = s.render();
    expect(r).toMatch(/2\.3\.4/);
  });

  test('frame top is present', () => {
    const s = createBootSplash();
    const r = s.render();
    expect(r).toMatch(/╔/);
    expect(r).toMatch(/╗/);
  });

  test('frame bottom is present', () => {
    const s = createBootSplash();
    const r = s.render();
    expect(r).toMatch(/╚/);
    expect(r).toMatch(/╝/);
  });

  test('frame separator is present', () => {
    const s = createBootSplash();
    const r = s.render();
    expect(r).toMatch(/╠/);
  });

  test('frame uses vertical bars', () => {
    const s = createBootSplash();
    const r = s.render();
    expect(r).toMatch(/║/);
  });

  test('contains boot log toggle hint', () => {
    const s = createBootSplash();
    const r = s.render();
    expect(r).toMatch(/toggleLog/);
  });
});

// ── isShown() ────────────────────────────────────────────────────────────────
describe('isShown()', () => {
  test('is false before show()', () => {
    const s = createBootSplash();
    expect(s.isShown()).toBe(false);
  });

  test('is true after show()', () => {
    const s = createBootSplash();
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = jest.fn();
    try {
      s.show();
      expect(s.isShown()).toBe(true);
    } finally {
      process.stdout.write = origWrite;
    }
  });
});

// ── log() ─────────────────────────────────────────────────────────────────────
describe('log()', () => {
  test('appends entries to log', () => {
    const s = createBootSplash();
    s.log('Kernel loaded', 'ok');
    s.log('Warning: low mem', 'warn');
    const entries = s.getLog();
    expect(entries).toHaveLength(2);
    expect(entries[0].message).toBe('Kernel loaded');
    expect(entries[0].level).toBe('ok');
    expect(entries[1].message).toBe('Warning: low mem');
    expect(entries[1].level).toBe('warn');
  });

  test('default log level is info', () => {
    const s = createBootSplash();
    s.log('test msg');
    const entries = s.getLog();
    expect(entries[0].level).toBe('info');
  });

  test('each entry has a timestamp', () => {
    const s = createBootSplash();
    s.log('hello');
    const entry = s.getLog()[0];
    expect(typeof entry.ts).toBe('string');
    expect(entry.ts.length).toBeGreaterThan(0);
  });
});

// ── clearLog() ────────────────────────────────────────────────────────────────
describe('clearLog()', () => {
  test('empties the log', () => {
    const s = createBootSplash();
    s.log('a');
    s.log('b');
    s.clearLog();
    expect(s.getLog()).toHaveLength(0);
  });
});

// ── toggleLog() ───────────────────────────────────────────────────────────────
describe('toggleLog()', () => {
  test('toggles visibility from false to true', () => {
    const s = createBootSplash({ showBootLog: false });
    const result = s.toggleLog();
    expect(result).toBe(true);
    expect(s.isLogVisible()).toBe(true);
  });

  test('toggles visibility from true to false', () => {
    const s = createBootSplash({ showBootLog: true });
    const result = s.toggleLog();
    expect(result).toBe(false);
    expect(s.isLogVisible()).toBe(false);
  });

  test('calling twice returns to original state', () => {
    const s = createBootSplash({ showBootLog: false });
    s.toggleLog();
    s.toggleLog();
    expect(s.isLogVisible()).toBe(false);
  });
});

// ── setLogVisible() ──────────────────────────────────────────────────────────
describe('setLogVisible()', () => {
  test('sets visible to true', () => {
    const s = createBootSplash();
    s.setLogVisible(true);
    expect(s.isLogVisible()).toBe(true);
  });

  test('sets visible to false', () => {
    const s = createBootSplash({ showBootLog: true });
    s.setLogVisible(false);
    expect(s.isLogVisible()).toBe(false);
  });
});

// ── complete() ────────────────────────────────────────────────────────────────
describe('complete()', () => {
  test('writes to stdout without throwing', () => {
    const s = createBootSplash();
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = jest.fn();
    try {
      expect(() => s.complete('Done!')).not.toThrow();
    } finally {
      process.stdout.write = origWrite;
    }
  });

  test('uses default message when none provided', () => {
    const s = createBootSplash();
    const origWrite = process.stdout.write.bind(process.stdout);
    const written = [];
    process.stdout.write = jest.fn(chunk => written.push(chunk));
    try {
      s.complete();
      const output = written.join('');
      expect(output).toMatch(/System ready\./);
    } finally {
      process.stdout.write = origWrite;
    }
  });
});

// ── Frame helpers ─────────────────────────────────────────────────────────────
describe('frame helpers', () => {
  test('_frameTop contains ╔ and ╗', () => {
    const s = createBootSplash();
    const t = s._frameTop();
    expect(t).toMatch(/╔/);
    expect(t).toMatch(/╗/);
  });

  test('_frameBottom contains ╚ and ╝', () => {
    const s = createBootSplash();
    const t = s._frameBottom();
    expect(t).toMatch(/╚/);
    expect(t).toMatch(/╝/);
  });

  test('_frameSep contains ╠ and ╣', () => {
    const s = createBootSplash();
    const t = s._frameSep();
    expect(t).toMatch(/╠/);
    expect(t).toMatch(/╣/);
  });
});
