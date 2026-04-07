'use strict';

const { createVRAM } = require('../core/vram');

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

describe('VRAM', () => {
  let kernel, vram;

  beforeEach(() => {
    kernel = makeKernel();
    vram   = createVRAM({ totalMB: 64, pressureThreshold: 0.80 }, kernel);
  });

  // ── factory ────────────────────────────────────────────────────────────────
  describe('createVRAM', () => {
    test('returns vram object with expected API', () => {
      expect(vram.name).toBe('vram');
      expect(vram.version).toBe('4.0.0');
      expect(typeof vram.allocate).toBe('function');
      expect(typeof vram.free).toBe('function');
      expect(typeof vram.info).toBe('function');
      expect(vram.device).toBeDefined();
    });

    test('totalMB reflects configured capacity', () => {
      expect(vram.totalMB).toBe(64);
    });
  });

  // ── allocate ───────────────────────────────────────────────────────────────
  describe('allocate', () => {
    test('allocates a named bank', () => {
      const r = vram.allocate('kernel', 4);
      expect(r.ok).toBe(true);
      expect(r.name).toBe('kernel');
      expect(r.mb).toBeGreaterThan(0);
    });

    test('emits ram:bank:allocated event', () => {
      const events = [];
      kernel.bus.on('ram:bank:allocated', d => events.push(d));
      vram.allocate('test', 2);
      expect(events).toHaveLength(1);
      expect(events[0].name).toBe('test');
    });

    test('reduces free memory after allocation', () => {
      const before = vram.info().freeMB;
      vram.allocate('x', 8);
      expect(vram.info().freeMB).toBeLessThan(before);
    });

    test('returns error when over capacity', () => {
      const r = vram.allocate('huge', 9999);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/insufficient/);
    });

    test('throws if bank name is empty', () => {
      expect(() => vram.allocate('', 4)).toThrow(TypeError);
    });

    test('throws if mb is not a positive number', () => {
      expect(() => vram.allocate('bad', -1)).toThrow(TypeError);
      expect(() => vram.allocate('bad', 0)).toThrow(TypeError);
    });

    test('throws if bank already exists', () => {
      vram.allocate('dup', 2);
      expect(() => vram.allocate('dup', 2)).toThrow(/already allocated/);
    });

    test('emits ram:pressure when threshold exceeded', () => {
      const pressure = [];
      kernel.bus.on('ram:pressure', d => pressure.push(d));
      vram.allocate('big', 52);   // 52/64 = 81% > 80% threshold
      expect(pressure.length).toBeGreaterThan(0);
      expect(pressure[0].pct).toBeGreaterThanOrEqual(80);
    });
  });

  // ── free ───────────────────────────────────────────────────────────────────
  describe('free', () => {
    test('frees a bank and returns true', () => {
      vram.allocate('temp', 4);
      expect(vram.free('temp')).toBe(true);
      expect(vram.bankInfo('temp')).toBeNull();
    });

    test('emits ram:bank:freed event', () => {
      const events = [];
      kernel.bus.on('ram:bank:freed', d => events.push(d));
      vram.allocate('free-me', 2);
      vram.free('free-me');
      expect(events[0].name).toBe('free-me');
    });

    test('restores free memory after freeing', () => {
      const before = vram.info().freeMB;
      vram.allocate('tmp', 8);
      vram.free('tmp');
      expect(vram.info().freeMB).toBe(before);
    });

    test('returns false for non-existent bank', () => {
      expect(vram.free('ghost')).toBe(false);
    });
  });

  // ── info ───────────────────────────────────────────────────────────────────
  describe('info', () => {
    test('returns memory stats', () => {
      const i = vram.info();
      expect(i.totalMB).toBe(64);
      expect(i.freeMB).toBe(64);
      expect(i.usedMB).toBe(0);
      expect(i.usedPct).toBe(0);
    });

    test('usedPct increases after allocation', () => {
      vram.allocate('a', 32);
      expect(vram.info().usedPct).toBeGreaterThan(0);
    });

    test('bankList returns all banks', () => {
      vram.allocate('b1', 4);
      vram.allocate('b2', 4);
      expect(vram.bankList()).toHaveLength(2);
    });
  });

  // ── VHAL device descriptor ─────────────────────────────────────────────────
  describe('VHAL device', () => {
    test('device id is vram-0', () => {
      expect(vram.device.id).toBe('vram-0');
      expect(vram.device.type).toBe('memory');
    });

    test('device.init() resolves ok', async () => {
      const r = await vram.device.init();
      expect(r.ok).toBe(true);
      expect(r.totalMB).toBe(64);
    });

    test('device.read() returns info object', () => {
      const i = vram.device.read(0);
      expect(i.totalMB).toBe(64);
    });

    test('device.ioctl allocate/free works', () => {
      const ra = vram.device.ioctl('allocate', { name: 'ioctl-bank', mb: 4 });
      expect(ra.ok).toBe(true);
      expect(vram.device.ioctl('free', { name: 'ioctl-bank' })).toBe(true);
    });

    test('device.unplug clears all banks', () => {
      vram.allocate('a', 4);
      vram.device.unplug();
      expect(vram.bankList()).toHaveLength(0);
    });

    test('device caps include banked and paged', () => {
      expect(vram.device.caps).toContain('banked');
      expect(vram.device.caps).toContain('paged');
    });
  });
});
