'use strict';
/**
 * rootfs-builder.js — AIOS RootFS Builder v1.0.0
 *
 * Constructs the complete AIOS Root Filesystem inside the AIOS VFS.
 * Reads on-disk template files from /etc/ and /usr/ repo paths and
 * mirrors them into the in-memory VFS so AIOS operates fully within
 * its own filesystem after pivot.
 *
 * Directory layout produced inside VFS:
 *   /boot          — boot artefacts, bootstrap log
 *   /etc           — system configuration
 *   /etc/aios      — AIOS-specific config + service units
 *   /sys           — kernel state files (synthetic)
 *   /proc          — process filesystem (populated by procfs.js)
 *   /var/log       — runtime logs
 *   /var/run       — PID files and sockets
 *   /usr/lib/aios  — AIOS shared libraries (info entries)
 *   /usr/bin       — AIOS user commands
 *   /home/user     — default user home
 *   /lib           — core library stubs
 *   /run           — ephemeral runtime data
 *   /tmp           — temporary files
 *   /host          — host OS mirror mount point
 *   /sdcard        — Android storage mirror (Termux)
 *
 * Zero external npm dependencies.
 */

const nodefs   = require('fs');
const nodepath = require('path');

// Repo root is three levels up from this file (usr/lib/aios/)
const REPO_ROOT = nodepath.resolve(__dirname, '..', '..', '..');

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
function _ts() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * Read a file from the host repo and return its content string.
 * Returns null if the file does not exist (template not present).
 */
function _readTemplate(relPath) {
  const abs = nodepath.join(REPO_ROOT, relPath);
  try {
    return nodefs.readFileSync(abs, 'utf8');
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// buildRootFS — populate the VFS with the full AIOS directory tree
// ---------------------------------------------------------------------------
/**
 * @param {object} vfs   - AIOS VFS instance (createFilesystem())
 * @param {object} opts  - options
 * @param {string} opts.hostname   - hostname to write to /etc/hostname
 * @param {string} opts.version    - AIOS version string
 * @param {object} opts.identity   - identity manifest (from identity.js)
 * @returns {{ ok: boolean, dirs: string[], files: string[] }}
 */
function buildRootFS(vfs, opts = {}) {
  const hostname = opts.hostname || 'aioscpu';
  const version  = opts.version  || '3.0.0';
  const id       = opts.identity || null;
  const created  = { dirs: [], files: [] };

  function mkdir(path) {
    vfs.mkdir(path, { parents: true });
    created.dirs.push(path);
  }

  function write(path, content) {
    vfs.write(path, content);
    created.files.push(path);
  }

  function append(path, content) {
    vfs.append(path, content);
  }

  // ── Directory tree ──────────────────────────────────────────────────────
  const dirs = [
    '/boot',
    '/etc', '/etc/aios', '/etc/aios/services', '/etc/cron', '/etc/kernel',
    '/sys', '/sys/kernel', '/sys/class',
    '/proc',
    '/var', '/var/log', '/var/run', '/var/cache', '/var/tmp',
    '/usr', '/usr/bin', '/usr/lib', '/usr/lib/aios', '/usr/local/bin',
    '/home', '/home/user', '/home/user/documents', '/home/user/downloads',
    '/lib',
    '/run',
    '/tmp',
    '/host', '/host-home', '/sdcard',
  ];
  dirs.forEach(mkdir);

  // ── /etc files ───────────────────────────────────────────────────────────
  write('/etc/hostname', hostname + '\n');

  // os-release — load from on-disk template or generate
  const osReleaseTpl = _readTemplate('etc/aios/identity.json');
  let osRelease;
  if (id) {
    osRelease = [
      `NAME="AIOS UniKernel"`,
      `VERSION="${version}"`,
      `ID=aios`,
      `ID_LIKE=linux`,
      `PRETTY_NAME="AIOS UniKernel v${version}"`,
      `VERSION_ID="${version}"`,
      `BUILD_ID="${id.id || 'unknown'}"`,
      `VARIANT_ID=unikernel`,
      `AIOS_ID="${id.id || ''}"`,
      `AIOS_KERNEL="aios-unikernel"`,
      `HOME_URL="https://github.com/Cbetts1/AIOSCPU-PROTYPE"`,
    ].join('\n') + '\n';
  } else {
    osRelease = `NAME="AIOS UniKernel"\nVERSION="${version}"\nID=aios\n`;
  }
  write('/etc/os-release', osRelease);

  write('/etc/motd', [
    '',
    `  ╔══════════════════════════════════════╗`,
    `  ║   AIOS UniKernel v${version.padEnd(18)}║`,
    `  ║   AI Operating System  — Booting...  ║`,
    `  ╚══════════════════════════════════════╝`,
    '',
  ].join('\n') + '\n');

  // /etc/environment — system-wide env vars
  const etcEnvTpl = _readTemplate('etc/profile');
  write('/etc/environment', etcEnvTpl || [
    'AIOS_OS=AIOS UniKernel',
    `AIOS_VERSION=${version}`,
    'AIOS_KERNEL=aios-unikernel',
    'HOME=/home/user',
    'USER=aios',
    'SHELL=/bin/aios-shell',
    'TERM=xterm-256color',
    'LANG=en_US.UTF-8',
    'LC_ALL=en_US.UTF-8',
    'PATH=/bin:/usr/bin:/usr/local/bin',
    'PS1=aios:\\w$ ',
    'EDITOR=edit',
    'PAGER=cat',
    'TMPDIR=/tmp',
  ].join('\n') + '\n');

  // /etc/profile — shell profile
  const profileTpl = _readTemplate('etc/profile');
  write('/etc/profile', profileTpl || [
    '# AIOS System Profile',
    `export AIOS_VERSION="${version}"`,
    'export HOME=/home/user',
    'export PATH=/bin:/usr/bin:/usr/local/bin',
    'export SHELL=/bin/aios-shell',
    'export PS1="aios:\\w$ "',
    'export TMPDIR=/tmp',
    '',
    '# Source user profile if it exists',
    '[ -f /home/user/.profile ] && . /home/user/.profile',
  ].join('\n') + '\n');

  // /etc/shells — registered shells
  write('/etc/shells', '/bin/aios-shell\n/bin/sh\n');

  // /etc/fstab — AIOS virtual mount table
  write('/etc/fstab', [
    '# AIOS Virtual Filesystem Table',
    '# <source>    <target>   <type>    <options>',
    'aios-rootfs   /          vfs       defaults',
    'proc          /proc      procfs    defaults',
    'sysfs         /sys       sysfs     defaults',
    'tmpfs         /tmp       tmpfs     mode=1777',
    'tmpfs         /run       tmpfs     mode=755',
  ].join('\n') + '\n');

  // /etc/machine-id — stable host ID (populated by identity.js)
  if (id && id.id) {
    const { createHash } = require('crypto');
    write('/etc/machine-id', createHash('md5').update(id.id).digest('hex') + '\n');
  } else {
    write('/etc/machine-id', '00000000000000000000000000000000\n');
  }

  // ── /etc/aios identity ──────────────────────────────────────────────────
  const identityTpl = _readTemplate('etc/aios/identity.json');
  if (identityTpl) {
    write('/etc/aios/identity.json', identityTpl);
  } else if (id) {
    write('/etc/aios/identity.json', JSON.stringify(id, null, 2) + '\n');
  } else {
    write('/etc/aios/identity.json', JSON.stringify({
      id: 'uninitialized',
      name: 'AIOS UniKernel',
      version,
      bootCount: 0,
      capabilities: [],
    }, null, 2) + '\n');
  }

  // ── /etc/aios/services — load JSON unit files from disk ─────────────────
  const svcDir = nodepath.join(REPO_ROOT, 'etc', 'aios', 'services');
  let svcFiles = [];
  try {
    svcFiles = nodefs.readdirSync(svcDir).filter(f => f.endsWith('.json'));
  } catch (_) {}
  for (const fname of svcFiles) {
    const content = _readTemplate(nodepath.join('etc', 'aios', 'services', fname));
    if (content) write(`/etc/aios/services/${fname}`, content);
  }

  // ── /home/user ───────────────────────────────────────────────────────────
  write('/home/user/.profile', [
    '# AIOS User Profile',
    'export HOME=/home/user',
    'export PATH=/bin:/usr/bin:/usr/local/bin',
    'export PS1="aios:\\w$ "',
    'export EDITOR=edit',
  ].join('\n') + '\n');

  write('/home/user/.aios_history', '');

  // ── /var/log ─────────────────────────────────────────────────────────────
  write('/var/log/boot.log',   `[${_ts()}] AIOS RootFS initialized\n`);
  write('/var/log/kernel.log', '');
  write('/var/log/services.log', '');
  write('/var/log/cron.log',   '');
  write('/var/log/audit.log',  '');

  // ── /sys synthetic files ─────────────────────────────────────────────────
  write('/sys/kernel/hostname',  hostname + '\n');
  write('/sys/kernel/version',   `AIOS UniKernel v${version}\n`);
  write('/sys/kernel/arch',      process.arch + '\n');
  write('/sys/kernel/platform',  process.platform + '\n');
  write('/sys/kernel/node',      process.version + '\n');

  // ── /usr/lib/aios info ───────────────────────────────────────────────────
  write('/usr/lib/aios/VERSION', version + '\n');
  write('/usr/lib/aios/BUILD',
    JSON.stringify({ version, arch: process.arch, node: process.version, built: new Date().toISOString() }, null, 2) + '\n'
  );

  // ── /boot log ────────────────────────────────────────────────────────────
  write('/boot/boot.log', `[${_ts()}] AIOS RootFS build complete\n`);
  append('/var/log/boot.log', `[${_ts()}] RootFS ready — ${created.dirs.length} dirs, ${created.files.length} files\n`);

  return { ok: true, dirs: created.dirs, files: created.files };
}

module.exports = { buildRootFS };
