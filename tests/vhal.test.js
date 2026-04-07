'use strict';

const { createVHAL, HAL_DEVICE } = require('../core/vhal');

// ── stub kernel ──────────────────────────────────────────────────────────────
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

// ── minimal valid device ─────────────────────────────────────────────────────
function makeDevice(overrides) {
  return Object.assign({
    id:      'test-0',
    type:    'virtual',
    version: '1.0.0',
    caps:    ['test'],
    init:    async () => ({ ok: true }),
    read:    (addr) => `read:${addr}`,
    write:   (addr, val) => `write:${addr}=${val}`,
    ioctl:   (cmd, args) => ({ cmd, args }),
    hotplug: () => undefined,
    unplug:  () => undefined,
  }, overrides || {});
}

describe('VHAL', () => {
  let kernel, vhal;

  beforeEach(() => {
    kernel = makeKernel();
    vhal   = createVHAL(kernel);
  });

  // ── factory ────────────────────────────────────────────────────────────────
  describe('createVHAL', () => {
    test('returns vhal object with expected API', () => {
      expect(vhal).toBeDefined();
      expect(vhal.name).toBe('vhal');
      expect(vhal.version).toBe('4.0.0');
      expect(typeof vhal.register).toBe('function');
      expect(typeof vhal.unregister).toBe('function');
      expect(typeof vhal.init).toBe('function');
      expect(typeof vhal.read).toBe('function');
      expect(typeof vhal.write).toBe('function');
      expect(typeof vhal.ioctl).toBe('function');
      expect(typeof vhal.deviceList).toBe('function');
    });

    test('HAL_DEVICE constants are exported', () => {
      expect(HAL_DEVICE.CPU).toBe('cpu');
      expect(HAL_DEVICE.MEMORY).toBe('memory');
      expect(HAL_DEVICE.NPU).toBe('npu');
      expect(HAL_DEVICE.DISPLAY).toBe('display');
    });
  });

  // ── register ───────────────────────────────────────────────────────────────
  describe('register', () => {
    test('registers a device and returns its id', () => {
      const id = vhal.register(makeDevice());
      expect(id).toBe('test-0');
      expect(vhal.hasDevice('test-0')).toBe(true);
    });

    test('emits hal:device:added on register', () => {
      const events = [];
      kernel.bus.on('hal:device:added', d => events.push(d));
      vhal.register(makeDevice());
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({ id: 'test-0', type: 'virtual' });
    });

    test('throws if id is missing', () => {
      expect(() => vhal.register(makeDevice({ id: '' }))).toThrow(TypeError);
    });

    test('throws if type is missing', () => {
      expect(() => vhal.register(makeDevice({ type: '' }))).toThrow(TypeError);
    });

    test('throws if descriptor is not an object', () => {
      expect(() => vhal.register('not-an-object')).toThrow(TypeError);
    });

    test('hot-swaps existing device — calls unplug on old one', () => {
      const unplug = jest.fn();
      vhal.register(makeDevice({ unplug }));
      vhal.register(makeDevice({ id: 'test-0', type: 'virtual', version: '2.0.0' }));
      expect(unplug).toHaveBeenCalled();
    });

    test('fills in defaults for omitted optional fields', () => {
      vhal.register({ id: 'bare-0', type: 'virtual' });
      const info = vhal.deviceInfo('bare-0');
      expect(info.version).toBe('0.0.0');
      expect(info.caps).toEqual([]);
    });
  });

  // ── unregister ─────────────────────────────────────────────────────────────
  describe('unregister', () => {
    test('removes device and returns true', () => {
      vhal.register(makeDevice());
      expect(vhal.unregister('test-0')).toBe(true);
      expect(vhal.hasDevice('test-0')).toBe(false);
    });

    test('emits hal:device:removed', () => {
      vhal.register(makeDevice());
      const events = [];
      kernel.bus.on('hal:device:removed', d => events.push(d));
      vhal.unregister('test-0');
      expect(events[0]).toMatchObject({ id: 'test-0' });
    });

    test('returns false for unknown device', () => {
      expect(vhal.unregister('no-such-device')).toBe(false);
    });

    test('calls unplug on device being removed', () => {
      const unplug = jest.fn();
      vhal.register(makeDevice({ unplug }));
      vhal.unregister('test-0');
      expect(unplug).toHaveBeenCalled();
    });
  });

  // ── init ───────────────────────────────────────────────────────────────────
  describe('init', () => {
    test('initialises all devices and returns results array', async () => {
      vhal.register(makeDevice({ id: 'a-0', type: 'virtual' }));
      vhal.register(makeDevice({ id: 'b-0', type: 'virtual' }));
      const results = await vhal.init();
      expect(results).toHaveLength(2);
      expect(results.every(r => r.ok)).toBe(true);
    });

    test('marks device state online after successful init', async () => {
      vhal.register(makeDevice());
      await vhal.init();
      expect(vhal.deviceInfo('test-0').state).toBe('online');
    });

    test('marks device fault on init failure', async () => {
      vhal.register(makeDevice({ init: async () => { throw new Error('boom'); } }));
      const results = await vhal.init();
      expect(results[0].ok).toBe(false);
      expect(vhal.deviceInfo('test-0').state).toBe('fault');
    });

    test('emits hal:device:fault on init failure', async () => {
      const events = [];
      kernel.bus.on('hal:device:fault', d => events.push(d));
      vhal.register(makeDevice({ init: async () => { throw new Error('fail'); } }));
      await vhal.init();
      expect(events[0].error).toBe('fail');
    });

    test('initialises a specific device by id', async () => {
      vhal.register(makeDevice({ id: 'x-0', type: 'virtual' }));
      vhal.register(makeDevice({ id: 'y-0', type: 'virtual' }));
      const results = await vhal.init('x-0');
      expect(results).toHaveLength(1);
      expect(results[0].id).toBe('x-0');
    });
  });

  // ── read / write / ioctl ───────────────────────────────────────────────────
  describe('read / write / ioctl', () => {
    beforeEach(() => { vhal.register(makeDevice()); });

    test('read forwards to device.read', () => {
      expect(vhal.read('test-0', 0x10)).toBe('read:16');
    });

    test('read returns null for unknown device', () => {
      expect(vhal.read('ghost', 0)).toBeNull();
    });

    test('write forwards to device.write', () => {
      expect(vhal.write('test-0', 0x20, 99)).toBe(true);
    });

    test('write returns false for unknown device', () => {
      expect(vhal.write('ghost', 0, 0)).toBe(false);
    });

    test('ioctl forwards to device.ioctl', () => {
      const r = vhal.ioctl('test-0', 'ping', { x: 1 });
      expect(r.ok).toBe(true);
      expect(r.result).toMatchObject({ cmd: 'ping', args: { x: 1 } });
    });

    test('ioctl returns error for unknown device', () => {
      const r = vhal.ioctl('ghost', 'cmd', {});
      expect(r.ok).toBe(false);
    });

    test('read catches device errors and emits fault', () => {
      vhal.register(makeDevice({ id: 'err-0', type: 'virtual', read: () => { throw new Error('read-fail'); } }));
      const faults = [];
      kernel.bus.on('hal:device:fault', d => faults.push(d));
      expect(vhal.read('err-0', 0)).toBeNull();
      expect(faults[0].error).toBe('read-fail');
    });
  });

  // ── deviceList / devicesByType ─────────────────────────────────────────────
  describe('deviceList / devicesByType', () => {
    test('deviceList returns all registered devices', () => {
      vhal.register(makeDevice({ id: 'a-0', type: 'cpu' }));
      vhal.register(makeDevice({ id: 'b-0', type: 'memory' }));
      const list = vhal.deviceList();
      expect(list).toHaveLength(2);
      expect(list.map(d => d.id)).toEqual(expect.arrayContaining(['a-0', 'b-0']));
    });

    test('devicesByType filters by type', () => {
      vhal.register(makeDevice({ id: 'cpu-0', type: 'cpu' }));
      vhal.register(makeDevice({ id: 'mem-0', type: 'memory' }));
      const cpus = vhal.devicesByType('cpu');
      expect(cpus).toHaveLength(1);
      expect(cpus[0].id).toBe('cpu-0');
    });

    test('deviceInfo returns null for unknown id', () => {
      expect(vhal.deviceInfo('nope')).toBeNull();
    });
  });
});
