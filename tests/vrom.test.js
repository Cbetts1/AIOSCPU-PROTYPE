'use strict';

const { createVROM } = require('../core/vrom');

describe('VROM', () => {
  let vrom;

  beforeEach(() => { vrom = createVROM(); });

  // ── factory ────────────────────────────────────────────────────────────────
  describe('createVROM', () => {
    test('returns vrom object with expected API', () => {
      expect(vrom.name).toBe('vrom');
      expect(vrom.version).toBe('1.0.0');
      expect(typeof vrom.write).toBe('function');
      expect(typeof vrom.read).toBe('function');
      expect(typeof vrom.seal).toBe('function');
      expect(typeof vrom.verify).toBe('function');
      expect(typeof vrom.manifest).toBe('function');
      expect(vrom.device).toBeDefined();
    });

    test('starts empty', () => {
      expect(vrom.size()).toBe(0);
      expect(vrom.isSealed()).toBe(false);
    });
  });

  // ── write ──────────────────────────────────────────────────────────────────
  describe('write', () => {
    test('writes a string cell and returns checksum', () => {
      const cs = vrom.write('boot.version', '3.0.0');
      expect(typeof cs).toBe('string');
      expect(cs).toHaveLength(64);
      expect(vrom.size()).toBe(1);
    });

    test('writes a JSON object and returns checksum', () => {
      const cs = vrom.write('kernel.caps', { npu: true });
      expect(typeof cs).toBe('string');
    });

    test('throws on empty name', () => {
      expect(() => vrom.write('', 'val')).toThrow(TypeError);
      expect(() => vrom.write(null, 'val')).toThrow(TypeError);
    });

    test('throws if writing same cell twice (write-once)', () => {
      vrom.write('key', 'val');
      expect(() => vrom.write('key', 'other')).toThrow(/write-once/);
    });

    test('throws if ROM is sealed', () => {
      vrom.seal();
      expect(() => vrom.write('new-cell', 'v')).toThrow(/sealed/);
    });

    test('throws when ROM capacity is exceeded', () => {
      const smallROM = createVROM({ maxCells: 2 });
      smallROM.write('a', '1');
      smallROM.write('b', '2');
      expect(() => smallROM.write('c', '3')).toThrow(/capacity/);
    });
  });

  // ── read ───────────────────────────────────────────────────────────────────
  describe('read', () => {
    test('reads a written string cell', () => {
      vrom.write('hostname', 'aioscpu');
      const r = vrom.read('hostname');
      expect(r.ok).toBe(true);
      expect(r.value).toBe('aioscpu');
    });

    test('reads a written JSON cell and parses it', () => {
      vrom.write('obj', { x: 42 });
      const r = vrom.read('obj');
      expect(r.ok).toBe(true);
      expect(r.value).toEqual({ x: 42 });
    });

    test('returns checksum in the result', () => {
      const cs = vrom.write('foo', 'bar');
      const r  = vrom.read('foo');
      expect(r.checksum).toBe(cs);
    });

    test('returns ok=false for unknown cell', () => {
      const r = vrom.read('nonexistent');
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/not found/);
    });
  });

  // ── has ────────────────────────────────────────────────────────────────────
  describe('has', () => {
    test('returns true for written cell', () => {
      vrom.write('x', 1);
      expect(vrom.has('x')).toBe(true);
    });

    test('returns false for missing cell', () => {
      expect(vrom.has('missing')).toBe(false);
    });
  });

  // ── seal ───────────────────────────────────────────────────────────────────
  describe('seal', () => {
    test('isSealed() returns true after seal()', () => {
      vrom.seal();
      expect(vrom.isSealed()).toBe(true);
    });

    test('read still works after sealing', () => {
      vrom.write('k', 'v');
      vrom.seal();
      expect(vrom.read('k').ok).toBe(true);
    });
  });

  // ── verify ─────────────────────────────────────────────────────────────────
  describe('verify', () => {
    test('returns ok=true when all cells are intact', () => {
      vrom.write('a', '1');
      vrom.write('b', '2');
      expect(vrom.verify().ok).toBe(true);
      expect(vrom.verify().failures).toHaveLength(0);
    });
  });

  // ── manifest ───────────────────────────────────────────────────────────────
  describe('manifest', () => {
    test('returns list of cell metadata', () => {
      vrom.write('z', 'hello');
      const m = vrom.manifest();
      expect(m).toHaveLength(1);
      expect(m[0].name).toBe('z');
      expect(m[0].checksum).toBeDefined();
      expect(m[0].writtenAt).toBeGreaterThan(0);
    });
  });

  // ── VHAL device descriptor ─────────────────────────────────────────────────
  describe('VHAL device', () => {
    test('device id is vrom-0', () => {
      expect(vrom.device.id).toBe('vrom-0');
      expect(vrom.device.type).toBe('storage');
    });

    test('device.init() resolves ok', async () => {
      const r = await vrom.device.init();
      expect(r.ok).toBe(true);
    });

    test('device.read(name) returns value', () => {
      vrom.write('dev', 'reading via device');
      expect(vrom.device.read('dev')).toBe('reading via device');
    });

    test('device.write(name, val) persists', () => {
      vrom.device.write('dw', 'device-written');
      expect(vrom.read('dw').value).toBe('device-written');
    });

    test('device.ioctl seal seals the ROM', () => {
      const r = vrom.device.ioctl('seal', {});
      expect(r.ok).toBe(true);
      expect(vrom.isSealed()).toBe(true);
    });

    test('device.ioctl verify returns integrity result', () => {
      vrom.write('k', 'v');
      const r = vrom.device.ioctl('verify', {});
      expect(r.ok).toBe(true);
    });

    test('device caps include read-only', () => {
      expect(vrom.device.caps).toContain('read-only');
      expect(vrom.device.caps).toContain('checksummed');
    });
  });
});
