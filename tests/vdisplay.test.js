'use strict';

const { createVDisplay } = require('../core/vdisplay');

function makeKernel() {
  const _h = {};
  return {
    bus: {
      on:   (ev, fn) => { _h[ev] = fn; },
      emit: (ev, d)  => { if (_h[ev]) _h[ev](d); },
      _handlers: _h,
    },
  };
}

describe('VDisplay', () => {
  let kernel, vdisplay;

  beforeEach(() => {
    kernel   = makeKernel();
    vdisplay = createVDisplay({ cols: 40, rows: 10 }, kernel);
  });

  // ── factory ────────────────────────────────────────────────────────────────
  describe('createVDisplay', () => {
    test('returns vdisplay object with expected API', () => {
      expect(vdisplay.name).toBe('vdisplay');
      expect(vdisplay.version).toBe('4.0.0');
      expect(typeof vdisplay.print).toBe('function');
      expect(typeof vdisplay.render).toBe('function');
      expect(typeof vdisplay.clear).toBe('function');
      expect(typeof vdisplay.setStatusBar).toBe('function');
      expect(typeof vdisplay.setOverlay).toBe('function');
      expect(vdisplay.device).toBeDefined();
    });

    test('respects configured cols/rows', () => {
      expect(vdisplay.cols).toBe(40);
      expect(vdisplay.rows).toBe(10);
    });

    test('isTTY reflects stdout.isTTY', () => {
      // In Jest, stdout is not a TTY
      expect(vdisplay.isTTY).toBe(!!process.stdout.isTTY);
    });
  });

  // ── print ─────────────────────────────────────────────────────────────────
  describe('print', () => {
    test('print() emits display:frame event', () => {
      const events = [];
      kernel.bus.on('display:frame', d => events.push(d));
      vdisplay.print('Hello AIOS');
      expect(events).toHaveLength(1);
      expect(events[0].layer).toBe('console');
    });

    test('multiple prints accumulate in console buffer', () => {
      vdisplay.print('line1');
      vdisplay.print('line2');
      vdisplay.print('line3');
      // Should not throw; just tests internal consistency
    });
  });

  // ── clearConsole ───────────────────────────────────────────────────────────
  describe('clearConsole', () => {
    test('clearConsole() does not throw', () => {
      vdisplay.print('something');
      expect(() => vdisplay.clearConsole()).not.toThrow();
    });
  });

  // ── setStatusBar ───────────────────────────────────────────────────────────
  describe('setStatusBar', () => {
    test('does not throw', () => {
      expect(() => vdisplay.setStatusBar('CPU 5%  MEM 128MB  uptime 42s')).not.toThrow();
    });
  });

  // ── setOverlay / clearOverlay ─────────────────────────────────────────────
  describe('setOverlay / clearOverlay', () => {
    test('setOverlay accepts a string', () => {
      expect(() => vdisplay.setOverlay('System message')).not.toThrow();
    });

    test('setOverlay accepts an array', () => {
      expect(() => vdisplay.setOverlay(['Line 1', 'Line 2'])).not.toThrow();
    });

    test('clearOverlay does not throw', () => {
      vdisplay.setOverlay('test');
      expect(() => vdisplay.clearOverlay()).not.toThrow();
    });
  });

  // ── resize ────────────────────────────────────────────────────────────────
  describe('resize', () => {
    test('resize updates cols and rows', () => {
      vdisplay.resize(120, 48);
      expect(vdisplay.cols).toBe(120);
      expect(vdisplay.rows).toBe(48);
    });

    test('resize emits display:resize event', () => {
      const events = [];
      kernel.bus.on('display:resize', d => events.push(d));
      vdisplay.resize(100, 30);
      expect(events[0]).toMatchObject({ cols: 100, rows: 30 });
    });
  });

  // ── clear ─────────────────────────────────────────────────────────────────
  describe('clear', () => {
    test('clear() emits display:clear', () => {
      const events = [];
      kernel.bus.on('display:clear', d => events.push(d));
      vdisplay.clear();
      expect(events).toHaveLength(1);
    });
  });

  // ── render ────────────────────────────────────────────────────────────────
  describe('render', () => {
    test('render() does not throw in non-TTY mode', () => {
      vdisplay.print('render test');
      const origWrite = process.stdout.write.bind(process.stdout);
      process.stdout.write = () => true;
      expect(() => vdisplay.render()).not.toThrow();
      process.stdout.write = origWrite;
    });
  });

  // ── VHAL device descriptor ─────────────────────────────────────────────────
  describe('VHAL device', () => {
    test('device id is display-0', () => {
      expect(vdisplay.device.id).toBe('display-0');
      expect(vdisplay.device.type).toBe('display');
    });

    test('device.init() resolves ok', async () => {
      const r = await vdisplay.device.init();
      expect(r.ok).toBe(true);
    });

    test('device.read() returns display info', () => {
      const r = vdisplay.device.read(0);
      expect(r.cols).toBe(40);
      expect(r.rows).toBe(10);
    });

    test('device.ioctl print works', () => {
      const events = [];
      kernel.bus.on('display:frame', d => events.push(d));
      const r = vdisplay.device.ioctl('print', { line: 'ioctl print' });
      expect(r.ok).toBe(true);
      expect(events.length).toBeGreaterThan(0);
    });

    test('device.ioctl resize works', () => {
      const r = vdisplay.device.ioctl('resize', { cols: 80, rows: 24 });
      expect(r.ok).toBe(true);
      expect(vdisplay.cols).toBe(80);
    });

    test('device.write(addr, str) calls print', () => {
      const events = [];
      kernel.bus.on('display:frame', d => events.push(d));
      vdisplay.device.write(0, 'device write');
      expect(events.length).toBeGreaterThan(0);
    });

    test('device caps include ansi and layered', () => {
      expect(vdisplay.device.caps).toContain('ansi');
      expect(vdisplay.device.caps).toContain('layered');
    });
  });
});
