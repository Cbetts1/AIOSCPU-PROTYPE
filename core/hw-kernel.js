'use strict';
/**
 * hw-kernel.js — AIOS Uni Hardware Kernel v1.0.0
 *
 * The Hardware Integration Layer of the AIOS UniKernel stack.
 *
 * Architecture position:
 *   ┌──────────────────────────────────────────────────────┐
 *   │           AI Personality Kernel                      │
 *   ├──────────────────────────────────────────────────────┤
 *   │           Uni Hardware Kernel  ← YOU ARE HERE        │
 *   │   (wraps AIOS software kernel as the "hardware")     │
 *   ├──────────────────────────────────────────────────────┤
 *   │           AIOS Software Kernel (kernel.js)           │
 *   ├──────────────────────────────────────────────────────┤
 *   │           Host Bridge (read-only OS mirror)          │
 *   ├──────────────────────────────────────────────────────┤
 *   │           Host Linux / Android / macOS Kernel        │
 *   │           ─ NEVER modified, never replaced ─         │
 *   └──────────────────────────────────────────────────────┘
 *
 * The HW Kernel presents a unified hardware abstraction:
 *   - Device registry (CPU, memory, storage, network, battery, …)
 *   - Hardware capability detection
 *   - Hardware event bus (subset of kernel bus)
 *   - Hardware-level handshake (identity + signature)
 *   - Live hardware metrics
 *
 * Zero external npm dependencies.
 */

const crypto  = require('crypto');
const nodeos  = require('os');

const HW_VERSION = '1.0.0';

// ---------------------------------------------------------------------------
// Device type constants
// ---------------------------------------------------------------------------
const DEVICE = Object.freeze({
  CPU:     'cpu',
  MEMORY:  'memory',
  STORAGE: 'storage',
  NETWORK: 'network',
  DISPLAY: 'display',
  INPUT:   'input',
  AUDIO:   'audio',
  BATTERY: 'battery',
  SENSOR:  'sensor',
  VIRTUAL: 'virtual',
});

// ---------------------------------------------------------------------------
// Hardware Kernel factory
// ---------------------------------------------------------------------------
function createHWKernel(softwareKernel, hostBridge) {
  const _hwId      = `hw-${crypto.randomBytes(6).toString('hex')}`;
  const _devices   = new Map();   // id → device descriptor
  const _bootTime  = Date.now();

  const _bus = softwareKernel ? softwareKernel.bus : {
    emit: () => {},
    on:   () => {},
  };

  // ---------------------------------------------------------------------------
  // _registerDevice — add a device to the hardware registry
  // ---------------------------------------------------------------------------
  function _registerDevice(type, info) {
    const existing = Array.from(_devices.keys()).filter(k => k.startsWith(type));
    const id       = `${type}-${existing.length}`;
    _devices.set(id, { id, type, info, state: 'online', registeredAt: Date.now() });
    _bus.emit('hw:device:registered', { id, type });
    return id;
  }

  // ---------------------------------------------------------------------------
  // _detectHardware — probe all hardware at boot
  // ---------------------------------------------------------------------------
  function _detectHardware() {
    // CPU
    const cpus = nodeos.cpus();
    _registerDevice(DEVICE.CPU, {
      model:  cpus.length ? cpus[0].model.trim() : 'virtual-cpu',
      cores:  cpus.length,
      speed:  cpus.length ? cpus[0].speed : 0,
      arch:   process.arch,
    });

    // Memory
    const totalMem = nodeos.totalmem();
    const freeMem  = nodeos.freemem();
    _registerDevice(DEVICE.MEMORY, {
      totalMB: Math.round(totalMem / 1048576),
      freeMB:  Math.round(freeMem  / 1048576),
      usedMB:  Math.round((totalMem - freeMem) / 1048576),
    });

    // Storage
    _registerDevice(DEVICE.STORAGE, {
      vfs:           'in-memory (unlimited)',
      hostAvailable: !!hostBridge,
      hostWrite:     !!(hostBridge && hostBridge.hostfs),
    });

    // Network
    const ifaces   = nodeos.networkInterfaces();
    const ifNames  = Object.keys(ifaces);
    _registerDevice(DEVICE.NETWORK, {
      interfaces: ifNames,
      count:      ifNames.length,
    });

    // Virtual CPU device (AIOSCPU emulator)
    _registerDevice(DEVICE.VIRTUAL, {
      name:       'AIOSCPU v1.0',
      type:       'emulated-cpu',
      registers:  8,
      memoryKB:   64,
    });

    // Battery (Android / Termux only)
    if (hostBridge && hostBridge.platform.isTermux) {
      _registerDevice(DEVICE.BATTERY, {
        platform:   'android',
        termuxAPI:  hostBridge.termux && hostBridge.termux.available,
      });
    }

    _bus.emit('hw:detection:complete', { devices: _devices.size });
  }

  // ---------------------------------------------------------------------------
  // Public hardware API
  // ---------------------------------------------------------------------------

  function cpuInfo() {
    const dev = _devices.get('cpu-0');
    if (!dev) return { ok: false, error: 'CPU not detected' };
    const cpus = nodeos.cpus();
    const loads = cpus.map(c => {
      const total = Object.values(c.times).reduce((a, b) => a + b, 0);
      return total > 0 ? Math.round((1 - c.times.idle / total) * 100) : 0;
    });
    return {
      ok:      true,
      model:   dev.info.model,
      cores:   dev.info.cores,
      arch:    dev.info.arch,
      loads,
      avgLoad: loads.length
        ? Math.round(loads.reduce((a, b) => a + b, 0) / loads.length)
        : 0,
    };
  }

  function memInfo() {
    if (hostBridge) return hostBridge.memInfo();
    const total = nodeos.totalmem();
    const free  = nodeos.freemem();
    return {
      ok:      true,
      totalMB: Math.round(total / 1048576),
      freeMB:  Math.round(free  / 1048576),
      usedMB:  Math.round((total - free) / 1048576),
    };
  }

  function deviceList() {
    return Array.from(_devices.values()).map(d => ({
      id:    d.id,
      type:  d.type,
      state: d.state,
      ...d.info,
    }));
  }

  function deviceInfo(id) {
    return _devices.get(id) || null;
  }

  function uptime() {
    return Math.floor((Date.now() - _bootTime) / 1000);
  }

  // ---------------------------------------------------------------------------
  // handshake — hardware identity proof
  // Used by the personality kernel to verify it is running on real hardware.
  // ---------------------------------------------------------------------------
  function handshake() {
    const payload = `${_hwId}:${HW_VERSION}:${process.pid}:${_bootTime}`;
    const sig = {
      hwId:        _hwId,
      hwVersion:   HW_VERSION,
      platform:    hostBridge ? hostBridge.platform.name : process.platform,
      arch:        process.arch,
      node:        process.version,
      pid:         process.pid,
      hostUptime:  Math.round(nodeos.uptime()),
      hwUptime:    uptime(),
      memory:      `${Math.round(nodeos.totalmem() / 1048576)}MB`,
      devices:     _devices.size,
      timestamp:   Date.now(),
      signature:   crypto.createHash('sha256').update(payload).digest('hex').slice(0, 24),
    };
    _bus.emit('hw:handshake', sig);
    return sig;
  }

  // ---------------------------------------------------------------------------
  // Router commands
  // ---------------------------------------------------------------------------
  const commands = {
    hwinfo: (_args) => {
      const devs  = deviceList();
      const lines = devs.map(d => {
        const detail = Object.entries(d)
          .filter(([k]) => !['id', 'type', 'state'].includes(k))
          .map(([k, v]) => `${k}=${Array.isArray(v) ? `[${v.join(',')}]` : JSON.stringify(v)}`)
          .join('  ');
        return `  [${d.state}]  ${d.id.padEnd(14)} ${detail}`;
      });
      return { status: 'ok', result: `Hardware Devices (${devs.length} detected):\n${lines.join('\n')}` };
    },

    hwcpu: (_args) => {
      const r = cpuInfo();
      if (!r.ok) return { status: 'error', result: r.error };
      return {
        status: 'ok',
        result: [
          `Model    : ${r.model}`,
          `Cores    : ${r.cores}`,
          `Arch     : ${r.arch}`,
          `Avg Load : ${r.avgLoad}%`,
          `Per-Core : ${r.loads.map((l, i) => `cpu${i}=${l}%`).join(' ')}`,
        ].join('\n'),
      };
    },

    hwmem: (_args) => {
      const r = memInfo();
      if (!r.ok) return { status: 'error', result: r.error };
      return {
        status: 'ok',
        result: [
          `Total : ${r.totalMB} MB`,
          `Used  : ${r.usedMB} MB`,
          `Free  : ${r.freeMB} MB`,
        ].join('\n'),
      };
    },

    hwhandshake: (_args) => {
      const h = handshake();
      return {
        status: 'ok',
        result: Object.entries(h).map(([k, v]) => `  ${k.padEnd(14)}: ${v}`).join('\n'),
      };
    },
  };

  // ---------------------------------------------------------------------------
  // Boot — detect hardware and signal readiness
  // ---------------------------------------------------------------------------
  _detectHardware();
  _bus.emit('hw:ready', { hwId: _hwId, version: HW_VERSION, devices: _devices.size });

  return {
    name:       'hw-kernel',
    version:    HW_VERSION,
    id:         _hwId,
    DEVICE,
    cpuInfo,
    memInfo,
    deviceList,
    deviceInfo,
    handshake,
    uptime,
    commands,
  };
}

module.exports = { createHWKernel, DEVICE };
