'use strict';
/**
 * pivot.js — AIOS Environment Pivot v1.0.0
 *
 * Simulates a pivot_root operation for AIOS running inside Node.js.
 *
 * A real Linux pivot_root(2) syscall:
 *   1. Makes a new filesystem the root "/"
 *   2. Moves the old root to a new mount point
 *   3. The process then lives entirely inside the new root
 *
 * Since AIOS runs on Node.js (not as a kernel process), a full pivot_root
 * is not possible, but we achieve the equivalent effect by:
 *   1. Setting AIOS_PIVOTED=true so all modules know the pivot happened
 *   2. Overwriting PATH so only AIOS paths are searched first
 *   3. Setting HOME to the AIOS home (/home/user)
 *   4. Setting AIOS_ROOTFS to the logical RootFS root
 *   5. Setting SHELL to /bin/aios-shell (AIOS's own shell)
 *   6. Detaching from Termux-specific paths in PATH
 *   7. Writing the pivot manifest to /boot/pivot.json in the VFS
 *
 * After pivot, the AIOS environment no longer depends on Termux paths.
 * All modules that check process.env will see the AIOS-owned environment.
 *
 * Zero external npm dependencies.
 */

// ---------------------------------------------------------------------------
// PivotContext — returned after a successful pivot
// ---------------------------------------------------------------------------
class PivotContext {
  constructor(opts) {
    this.pivoted    = opts.pivoted;
    this.rootfs     = opts.rootfs;
    this.oldPath    = opts.oldPath;
    this.newPath    = opts.newPath;
    this.platform   = opts.platform;
    this.pivotTime  = opts.pivotTime;
  }

  toString() {
    return `PivotContext { pivoted=${this.pivoted} rootfs=${this.rootfs} platform=${this.platform} }`;
  }
}

// ---------------------------------------------------------------------------
// pivot — perform the environment pivot
// ---------------------------------------------------------------------------
/**
 * @param {object} vfs     - AIOS VFS instance (may be null; manifest is written if provided)
 * @param {object} opts
 * @param {string} opts.rootfs   - logical AIOS root path (default: "/")
 * @param {string} opts.version  - AIOS version (default: "3.0.0")
 * @returns {PivotContext}
 */
function pivot(vfs, opts = {}) {
  const rootfs   = opts.rootfs  || '/';
  const version  = opts.version || '3.0.0';
  const platform = process.platform;

  const oldPath = process.env.PATH || '';

  // Build the new AIOS-first PATH
  // AIOS virtual paths go first; host paths are kept as fallback so
  // Node.js built-ins (node, npm) remain accessible during this session.
  const aiosPaths    = ['/bin', '/usr/bin', '/usr/local/bin'];
  const hostSegments = oldPath.split(':').filter(p => p && !aiosPaths.includes(p));
  const newPath      = [...aiosPaths, ...hostSegments].join(':');

  // Apply environment pivot
  process.env.AIOS_PIVOTED    = 'true';
  process.env.AIOS_ROOTFS     = rootfs;
  process.env.AIOS_VERSION    = version;
  process.env.AIOS_KERNEL     = 'aios-unikernel';
  process.env.PATH            = newPath;
  process.env.HOME            = '/home/user';
  process.env.SHELL           = '/bin/aios-shell';
  process.env.USER            = 'aios';
  process.env.LOGNAME         = 'aios';
  process.env.AIOS_PLATFORM   = platform;

  // Remove Termux-specific vars from the AIOS environment view
  // (they remain in process.env for host bridge use, but AIOS layers
  //  its own values on top via the env-loader)
  const termuxKeys = ['TERMUX_APP_PID', 'TERMUX_VERSION'];
  for (const k of termuxKeys) delete process.env[k];

  const pivotTime = new Date().toISOString();

  // Write pivot manifest to VFS if available
  if (vfs) {
    const manifest = {
      pivoted:   true,
      rootfs,
      version,
      platform,
      oldPath,
      newPath,
      pivotTime,
      env: {
        AIOS_PIVOTED:  'true',
        AIOS_ROOTFS:   rootfs,
        PATH:          newPath,
        HOME:          '/home/user',
        SHELL:         '/bin/aios-shell',
      },
    };
    try {
      vfs.mkdir('/boot', { parents: true });
      vfs.write('/boot/pivot.json', JSON.stringify(manifest, null, 2) + '\n');
      vfs.append('/boot/boot.log',
        `[${new Date().toISOString().slice(11, 19)}] Environment pivot complete\n`
      );
    } catch (_) {}
  }

  return new PivotContext({
    pivoted:   true,
    rootfs,
    oldPath,
    newPath,
    platform,
    pivotTime,
  });
}

// ---------------------------------------------------------------------------
// isPivoted — check if the pivot has already happened this session
// ---------------------------------------------------------------------------
function isPivoted() {
  return process.env.AIOS_PIVOTED === 'true';
}

module.exports = { pivot, isPivoted, PivotContext };
