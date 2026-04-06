'use strict';
/**
 * core/vram.js — AIOS Virtual RAM Manager v1.0.0
 *
 * Manages banked virtual memory for the AIOS virtual hardware stack.
 * Provides allocation, deallocation, bank switching, and memory-pressure
 * events that mirror what a real OS memory subsystem emits.
 *
 * Concepts
 * ─────────
 *   - totalMB : total virtual RAM capacity (default: 256 MB)
 *   - bank    : named segment of RAM that can be allocated/freed as a unit
 *   - page    : 4 KB unit of allocation (standard page size)
 *   - pressure: emits ram:pressure on kernel bus when usage > threshold
 *
 * Emits on kernel bus:
 *   ram:bank:allocated   { name, pages, mb }
 *   ram:bank:freed       { name }
 *   ram:pressure         { usedMB, totalMB, pct }
 *
 * Zero external npm dependencies.
 */

const PAGE_SIZE_BYTES = 4096;          // 4 KB
const PAGE_SIZE_MB    = PAGE_SIZE_BYTES / (1024 * 1024);

// ---------------------------------------------------------------------------
// createVRAM — factory
// ---------------------------------------------------------------------------
function createVRAM(options, kernel) {
  const opts    = options || {};
  const VERSION = '1.0.0';

  const totalMB          = opts.totalMB          || 256;
  const pressureThreshold = opts.pressureThreshold || 0.80;   // 80 %
  const totalPages       = Math.floor(totalMB / PAGE_SIZE_MB);

  const _banks = new Map();   // name → { name, pages, mb, allocatedAt }
  let   _usedPages  = 0;

  const _bus = (kernel && kernel.bus) ? kernel.bus : { emit: () => {} };

  // ── helpers ──────────────────────────────────────────────────────────────

  function _usedMB()  { return Math.round(_usedPages * PAGE_SIZE_MB); }
  function _freeMB()  { return totalMB - _usedMB(); }
  function _usagePct(){ return totalPages > 0 ? _usedPages / totalPages : 0; }

  function _checkPressure() {
    if (_usagePct() >= pressureThreshold) {
      _bus.emit('ram:pressure', {
        usedMB:  _usedMB(),
        totalMB,
        pct:     Math.round(_usagePct() * 100),
      });
    }
  }

  // ── allocate ─────────────────────────────────────────────────────────────
  // Allocate a named bank of `mb` megabytes. Returns { ok, name, pages, mb }
  function allocate(name, mb) {
    if (!name || typeof name !== 'string') throw new TypeError('VRAM: bank name must be a non-empty string');
    if (typeof mb !== 'number' || mb <= 0) throw new TypeError('VRAM: mb must be a positive number');
    if (_banks.has(name)) throw new Error(`VRAM: bank "${name}" is already allocated`);

    const pages = Math.ceil(mb / PAGE_SIZE_MB);
    if (_usedPages + pages > totalPages) {
      return { ok: false, error: `VRAM: insufficient memory — requested ${mb} MB, available ${_freeMB()} MB` };
    }

    _usedPages += pages;
    _banks.set(name, { name, pages, mb: Math.round(pages * PAGE_SIZE_MB), allocatedAt: Date.now() });
    _bus.emit('ram:bank:allocated', { name, pages, mb: Math.round(pages * PAGE_SIZE_MB) });
    _checkPressure();
    return { ok: true, name, pages, mb: Math.round(pages * PAGE_SIZE_MB) };
  }

  // ── free ─────────────────────────────────────────────────────────────────
  function free(name) {
    const bank = _banks.get(name);
    if (!bank) return false;
    _usedPages -= bank.pages;
    if (_usedPages < 0) _usedPages = 0;
    _banks.delete(name);
    _bus.emit('ram:bank:freed', { name });
    return true;
  }

  // ── info ─────────────────────────────────────────────────────────────────
  function info() {
    return {
      totalMB,
      usedMB:  _usedMB(),
      freeMB:  _freeMB(),
      usedPct: Math.round(_usagePct() * 100),
      banks:   _banks.size,
      pages:   { total: totalPages, used: _usedPages, free: totalPages - _usedPages },
    };
  }

  function bankInfo(name) {
    return _banks.get(name) || null;
  }

  function bankList() {
    return Array.from(_banks.values());
  }

  // ── VHAL device descriptor ───────────────────────────────────────────────
  const device = {
    id:      'vram-0',
    type:    'memory',
    version: VERSION,
    caps:    ['banked', 'paged', 'pressure'],
    init:    async () => ({ ok: true, totalMB, totalPages }),
    read:    (_addr) => info(),
    write:   (_addr, val) => {
      // write({ name, mb }) → allocate
      if (val && val.name && val.mb) allocate(val.name, val.mb);
    },
    ioctl:   (cmd, args) => {
      if (cmd === 'allocate') return allocate(args.name, args.mb);
      if (cmd === 'free')     return free(args.name);
      if (cmd === 'info')     return info();
      if (cmd === 'banks')    return bankList();
      return null;
    },
    hotplug: () => undefined,
    unplug:  () => { _banks.clear(); _usedPages = 0; },
  };

  return {
    name:     'vram',
    version:  VERSION,
    device,
    allocate,
    free,
    info,
    bankInfo,
    bankList,
    totalMB,
  };
}

module.exports = { createVRAM };
