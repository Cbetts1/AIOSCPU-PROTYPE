'use strict';
/**
 * core/vhal.js — AIOS Virtual Hardware Abstraction Layer v1.0.0
 *
 * The plug-and-play device bus for the AIOS virtual hardware stack.
 * Every virtual hardware component registers here with a standard interface:
 *
 *   {
 *     id       : string   — unique device identifier (e.g. "npu-0", "display-0")
 *     type     : string   — device type (cpu|memory|storage|network|display|npu|…)
 *     version  : string   — semver of the device driver
 *     caps     : string[] — capability tags (e.g. ['infer','fp16'])
 *     init()            : async device initialisation; returns { ok, … }
 *     read(addr)        : synchronous read from device address/register
 *     write(addr, val)  : synchronous write to device address/register
 *     ioctl(cmd, args)  : generic command/control channel; returns any
 *     hotplug()         : called by VHAL when re-attaching a device
 *     unplug()          : called by VHAL before removal — allows graceful teardown
 *   }
 *
 * Bus events emitted on the kernel event bus:
 *   hal:device:added    { id, type, version }
 *   hal:device:removed  { id, type }
 *   hal:device:fault    { id, type, error }
 *   hal:ready           { devices: N }
 *
 * Zero external npm dependencies. Pure Node.js CommonJS.
 */

// ---------------------------------------------------------------------------
// Device type constants
// ---------------------------------------------------------------------------
const HAL_DEVICE = Object.freeze({
  CPU:     'cpu',
  MEMORY:  'memory',
  STORAGE: 'storage',
  NETWORK: 'network',
  DISPLAY: 'display',
  INPUT:   'input',
  AUDIO:   'audio',
  BATTERY: 'battery',
  NPU:     'npu',
  SENSOR:  'sensor',
  VIRTUAL: 'virtual',
});

// ---------------------------------------------------------------------------
// Default no-op stub — devices may override any subset of these
// ---------------------------------------------------------------------------
const NOOP_DEVICE = Object.freeze({
  caps:    [],
  init:    async () => ({ ok: true }),
  read:    (_addr)       => null,
  write:   (_addr, _val) => undefined,
  ioctl:   (_cmd, _args) => null,
  hotplug: ()            => undefined,
  unplug:  ()            => undefined,
});

// ---------------------------------------------------------------------------
// createVHAL — factory
// ---------------------------------------------------------------------------
function createVHAL(kernel) {
  const _bus = kernel ? kernel.bus : { emit: () => {}, on: () => {} };

  // device id → full device descriptor + VHAL metadata
  const _devices = new Map();

  // ---------------------------------------------------------------------------
  // _normalise — merge supplied descriptor with defaults
  // ---------------------------------------------------------------------------
  function _normalise(raw) {
    if (!raw || typeof raw !== 'object') {
      throw new TypeError('VHAL.register: device descriptor must be an object');
    }
    if (typeof raw.id !== 'string' || !raw.id.trim()) {
      throw new TypeError('VHAL.register: device.id must be a non-empty string');
    }
    if (typeof raw.type !== 'string' || !raw.type.trim()) {
      throw new TypeError('VHAL.register: device.type must be a non-empty string');
    }

    return Object.assign(
      {},
      NOOP_DEVICE,
      raw,
      {
        id:      raw.id.trim(),
        type:    raw.type.trim(),
        version: raw.version || '0.0.0',
        caps:    Array.isArray(raw.caps) ? raw.caps.slice() : [],
        _state:  'offline',        // lifecycle state managed by VHAL
        _addedAt: Date.now(),
      }
    );
  }

  // ---------------------------------------------------------------------------
  // register — attach a device to the bus
  // ---------------------------------------------------------------------------
  function register(raw) {
    const dev = _normalise(raw);
    const { id, type, version } = dev;

    if (_devices.has(id)) {
      // Hot-swap: call unplug on the existing device first
      const existing = _devices.get(id);
      try { existing.unplug(); } catch (_) {}
      _devices.delete(id);
    }

    _devices.set(id, dev);
    _bus.emit('hal:device:added', { id, type, version });
    return id;
  }

  // ---------------------------------------------------------------------------
  // unregister — detach a device from the bus
  // ---------------------------------------------------------------------------
  function unregister(id) {
    const dev = _devices.get(id);
    if (!dev) return false;
    try { dev.unplug(); } catch (_) {}
    _devices.delete(id);
    _bus.emit('hal:device:removed', { id, type: dev.type });
    return true;
  }

  // ---------------------------------------------------------------------------
  // init — initialise all registered devices (or a specific one)
  // ---------------------------------------------------------------------------
  async function init(id) {
    const targets = id ? [_devices.get(id)].filter(Boolean) : Array.from(_devices.values());
    const results = [];

    for (const dev of targets) {
      dev._state = 'initialising';
      try {
        const r = await dev.init();
        dev._state = r && r.ok === false ? 'fault' : 'online';
        results.push({ id: dev.id, ok: dev._state === 'online', detail: r });
        if (dev._state === 'fault') {
          _bus.emit('hal:device:fault', { id: dev.id, type: dev.type, error: r && r.error ? r.error : 'init returned ok=false' });
        }
      } catch (e) {
        dev._state = 'fault';
        _bus.emit('hal:device:fault', { id: dev.id, type: dev.type, error: e.message });
        results.push({ id: dev.id, ok: false, detail: { error: e.message } });
      }
    }
    return results;
  }

  // ---------------------------------------------------------------------------
  // read / write / ioctl — forward calls to the target device
  // ---------------------------------------------------------------------------
  function read(id, addr) {
    const dev = _devices.get(id);
    if (!dev) return null;
    try { return dev.read(addr); }
    catch (e) {
      _bus.emit('hal:device:fault', { id, type: dev.type, error: e.message });
      return null;
    }
  }

  function write(id, addr, val) {
    const dev = _devices.get(id);
    if (!dev) return false;
    try { dev.write(addr, val); return true; }
    catch (e) {
      _bus.emit('hal:device:fault', { id, type: dev.type, error: e.message });
      return false;
    }
  }

  function ioctl(id, cmd, args) {
    const dev = _devices.get(id);
    if (!dev) return { ok: false, error: `Device ${id} not found` };
    try { return { ok: true, result: dev.ioctl(cmd, args) }; }
    catch (e) {
      _bus.emit('hal:device:fault', { id, type: dev.type, error: e.message });
      return { ok: false, error: e.message };
    }
  }

  // ---------------------------------------------------------------------------
  // deviceList — returns metadata snapshot of all registered devices
  // ---------------------------------------------------------------------------
  function deviceList() {
    return Array.from(_devices.values()).map(d => ({
      id:      d.id,
      type:    d.type,
      version: d.version,
      caps:    d.caps,
      state:   d._state,
    }));
  }

  function deviceInfo(id) {
    const d = _devices.get(id);
    if (!d) return null;
    return { id: d.id, type: d.type, version: d.version, caps: d.caps, state: d._state };
  }

  function devicesByType(type) {
    return deviceList().filter(d => d.type === type);
  }

  function hasDevice(id) {
    return _devices.has(id);
  }

  // ---------------------------------------------------------------------------
  // Signal readiness
  // ---------------------------------------------------------------------------
  _bus.emit('hal:ready', { devices: _devices.size });

  return {
    name:          'vhal',
    version:       '1.0.0',
    HAL_DEVICE,
    register,
    unregister,
    init,
    read,
    write,
    ioctl,
    deviceList,
    deviceInfo,
    devicesByType,
    hasDevice,
  };
}

module.exports = { createVHAL, HAL_DEVICE };
