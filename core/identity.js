'use strict';
/**
 * identity.js — AIOS OS Identity Manifest v1.0.0
 *
 * Generates, stores, and publishes the unique OS identity.
 * Identity persists across boots via the host filesystem so the OS
 * keeps the same ID every time it starts.
 *
 * Published on kernel bus as 'os:identity' at boot.
 * Written to /etc/os-release and /etc/kernel/identity.json in the VFS.
 *
 * Zero external npm dependencies.
 */

const crypto   = require('crypto');
const nodefs   = require('fs');
const nodepath = require('path');
const nodeos   = require('os');

const OS_NAME    = 'AIOS UniKernel';
const OS_VERSION = '3.0.0';
const KERNEL_NAME = 'aios-unikernel';

// ---------------------------------------------------------------------------
// Identity factory
// ---------------------------------------------------------------------------
function createIdentity(kernel, fs, hostBridge) {
  let _manifest = null;

  // Persist identity here so it survives OS restarts
  const _hostStatePath = nodepath.join(nodeos.homedir(), '.aios', 'identity.json');

  function _generateID() {
    return `${KERNEL_NAME}-${crypto.randomBytes(12).toString('hex')}`;
  }

  function _loadFromHost() {
    try {
      if (nodefs.existsSync(_hostStatePath)) {
        const raw    = nodefs.readFileSync(_hostStatePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && parsed.id && parsed.osVersion === OS_VERSION) return parsed;
      }
    } catch (_) {}
    return null;
  }

  function _saveToHost(manifest) {
    try {
      nodefs.mkdirSync(nodepath.dirname(_hostStatePath), { recursive: true });
      nodefs.writeFileSync(_hostStatePath, JSON.stringify(manifest, null, 2), 'utf8');
    } catch (_) {}
  }

  function _buildManifest(id, previousBoot) {
    const platform = hostBridge ? hostBridge.platform : { name: process.platform };
    return {
      id,
      name:         OS_NAME,
      version:      OS_VERSION,
      osVersion:    OS_VERSION,
      kernelName:   KERNEL_NAME,
      platform:     platform.name,
      arch:         process.arch,
      nodeVersion:  process.version,
      bootTime:     new Date().toISOString(),
      previousBoot: previousBoot || null,
      capabilities: [
        'uni-hardware-kernel',
        'ai-personality-kernel',
        'backup-brain',
        'eternal-loop',
        'virtual-fs',
        'host-bridge',
        'init-system',
        'service-manager',
        'capability-engine',
        'state-engine',
        'module-loader',
        'debug-interface',
        'environment-loader',
      ],
    };
  }

  // ---------------------------------------------------------------------------
  // init — load or generate identity, write to VFS, persist to host FS
  // ---------------------------------------------------------------------------
  function init() {
    const existing = _loadFromHost();
    const id         = existing ? existing.id : _generateID();
    const prevBoot   = existing ? existing.bootTime : null;

    _manifest = _buildManifest(id, prevBoot);

    // Write identity to VFS
    if (fs) {
      fs.mkdir('/etc/kernel', { parents: true });
      fs.write('/etc/kernel/identity.json', JSON.stringify(_manifest, null, 2) + '\n');

      const osRelease = [
        `NAME="${OS_NAME}"`,
        `VERSION="${OS_VERSION}"`,
        `ID=aios`,
        `ID_LIKE=linux`,
        `PRETTY_NAME="${OS_NAME} v${OS_VERSION}"`,
        `VERSION_ID="${OS_VERSION}"`,
        `BUILD_ID="${id}"`,
        `VARIANT_ID=unikernel`,
        `AIOS_ID="${id}"`,
        `AIOS_KERNEL="${KERNEL_NAME}"`,
        `AIOS_FEATURES="${_manifest.capabilities.join(',')}"`,
        `HOME_URL="https://github.com/Cbetts1/AIOSCPU-PROTYPE"`,
      ].join('\n') + '\n';

      fs.write('/etc/os-release', osRelease);

      // Also write machine-id (Linux convention)
      const machineId = crypto.createHash('md5').update(id).digest('hex');
      fs.write('/etc/machine-id', machineId + '\n');
    }

    // Persist to host filesystem for cross-boot continuity
    _saveToHost(_manifest);

    // Publish on kernel bus
    if (kernel) kernel.bus.emit('os:identity', _manifest);

    return _manifest;
  }

  return {
    name:   'identity',
    init,
    get:    () => _manifest,
    id:     () => _manifest ? _manifest.id : null,
    version: OS_VERSION,
    osName:  OS_NAME,
  };
}

module.exports = { createIdentity };
