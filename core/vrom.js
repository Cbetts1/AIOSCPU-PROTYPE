'use strict';
/**
 * core/vrom.js — AIOS Virtual ROM v4.0.0
 *
 * Read-only firmware store for the AIOS virtual hardware stack.
 * Equivalent to UEFI/BIOS tables: stores boot parameters, kernel config,
 * device capability tables, and integrity manifests.
 *
 * Features:
 *   - Write-once named firmware slots (cells)
 *   - SHA-256 checksum on every read — tamper detection
 *   - Seal the ROM so no further writes are accepted
 *   - JSON or raw-string values
 *   - Registers itself with VHAL as device type "storage"
 *
 * Zero external npm dependencies.
 */

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// createVROM — factory
// ---------------------------------------------------------------------------
function createVROM(options) {
  const opts = options || {};
  const VERSION  = '4.0.0';
  const ROM_SIZE = opts.maxCells || 256;   // max number of named cells

  // cell name → { value: string, checksum: string, writtenAt: number }
  const _cells  = new Map();
  let   _sealed = false;

  // ── helpers ──────────────────────────────────────────────────────────────

  function _checksum(str) {
    return crypto.createHash('sha256').update(str).digest('hex');
  }

  function _serialise(value) {
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
  }

  // ── write ─────────────────────────────────────────────────────────────────
  // Write a named cell.  Throws if ROM is sealed or cell already exists.
  function write(name, value) {
    if (_sealed) throw new Error('VROM: ROM is sealed — writes are no longer accepted');
    if (!name || typeof name !== 'string') throw new TypeError('VROM: cell name must be a non-empty string');
    if (_cells.has(name)) throw new Error(`VROM: cell "${name}" already written — ROM is write-once`);
    if (_cells.size >= ROM_SIZE) throw new Error('VROM: ROM capacity exceeded');

    const serial   = _serialise(value);
    const checksum = _checksum(serial);
    _cells.set(name, { value: serial, checksum, writtenAt: Date.now() });
    return checksum;
  }

  // ── read ──────────────────────────────────────────────────────────────────
  // Read a named cell and verify its checksum.
  // Returns { ok, value, checksum } or { ok: false, error }
  function read(name) {
    if (!_cells.has(name)) {
      return { ok: false, error: `VROM: cell "${name}" not found` };
    }
    const cell = _cells.get(name);
    const live = _checksum(cell.value);
    if (live !== cell.checksum) {
      return { ok: false, error: `VROM: checksum mismatch on "${name}" — possible tampering` };
    }
    // Try to return parsed JSON; fall back to raw string
    let parsed = cell.value;
    try { parsed = JSON.parse(cell.value); } catch (_) {}
    return { ok: true, value: parsed, checksum: cell.checksum };
  }

  // ── has ───────────────────────────────────────────────────────────────────
  function has(name) { return _cells.has(name); }

  // ── seal ──────────────────────────────────────────────────────────────────
  // Seal the ROM: no more writes allowed.
  function seal() { _sealed = true; }
  function isSealed() { return _sealed; }

  // ── manifest ─────────────────────────────────────────────────────────────
  // Return a list of all cell names + checksums (no values).
  function manifest() {
    return Array.from(_cells.entries()).map(([name, cell]) => ({
      name,
      checksum:  cell.checksum,
      writtenAt: cell.writtenAt,
    }));
  }

  // ── verify ────────────────────────────────────────────────────────────────
  // Verify every cell is intact. Returns { ok, failures: [] }
  function verify() {
    const failures = [];
    for (const [name, cell] of _cells.entries()) {
      const live = _checksum(cell.value);
      if (live !== cell.checksum) failures.push(name);
    }
    return { ok: failures.length === 0, failures };
  }

  // ── size ─────────────────────────────────────────────────────────────────
  function size() { return _cells.size; }

  // ── VHAL device descriptor ───────────────────────────────────────────────
  const device = {
    id:      'vrom-0',
    type:    'storage',
    version: VERSION,
    caps:    ['read-only', 'checksummed', 'firmware'],
    init:    async () => ({ ok: true, cells: _cells.size }),
    read:    (addr) => {
      const r = read(addr);
      return r.ok ? r.value : null;
    },
    write:   (addr, val) => { write(addr, val); },
    ioctl:   (cmd, args) => {
      if (cmd === 'seal')     { seal(); return { ok: true }; }
      if (cmd === 'verify')   return verify();
      if (cmd === 'manifest') return manifest();
      return null;
    },
    hotplug: () => undefined,
    unplug:  () => undefined,
  };

  return {
    name:    'vrom',
    version: VERSION,
    device,
    write,
    read,
    has,
    seal,
    isSealed,
    manifest,
    verify,
    size,
  };
}

module.exports = { createVROM };
