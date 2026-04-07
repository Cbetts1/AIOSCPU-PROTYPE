'use strict';
/**
 * core/vmem.js — AIOS Virtual Memory Controller v4.0.0
 *
 * Maps VROM + VRAM + kernel heap into one unified 64-bit virtual address
 * space and provides virtual-to-physical (V→P) address translation.
 *
 * Address space layout (all in bytes)
 * ─────────────────────────────────────
 *   0x0000_0000 – 0x0FFF_FFFF  (256 MB)  VROM   — firmware / config
 *   0x1000_0000 – 0x8FFF_FFFF  (2 GB)    VRAM   — virtual RAM banks
 *   0x9000_0000 – 0xAFFF_FFFF  (512 MB)  HEAP   — kernel heap
 *   0xB000_0000 – 0xBFFF_FFFF  (256 MB)  MMIO   — memory-mapped I/O
 *   0xC000_0000 – 0xFFFF_FFFF  (1 GB)    reserved
 *
 * Pages are 4 KB.  The controller maintains a simple page table that maps
 * virtual page numbers to their region + offset.
 *
 * Zero external npm dependencies.
 */

const PAGE_SIZE = 4096;   // 4 KB

// Region base addresses (as JS numbers — safe up to 2^53 – 1)
const REGION = Object.freeze({
  VROM: 0x00000000,
  VRAM: 0x10000000,
  HEAP: 0x90000000,
  MMIO: 0xB0000000,
});

const REGION_SIZE = Object.freeze({
  VROM: 0x10000000,   // 256 MB
  VRAM: 0x80000000,   // 2 GB
  HEAP: 0x20000000,   // 512 MB
  MMIO: 0x10000000,   // 256 MB
});

// ---------------------------------------------------------------------------
// createVMEM — factory
// ---------------------------------------------------------------------------
function createVMEM(options) {
  const _opts   = options || {};
  const VERSION = '4.0.0';

  // Page table: vpn (virtual page number) → { region, offset }
  const _pageTable = new Map();
  let   _nextHeapPage = Math.floor(REGION.HEAP / PAGE_SIZE);

  const _stats = { mapped: 0, unmapped: 0, faults: 0 };

  // ── helpers ──────────────────────────────────────────────────────────────

  function _vpn(addr) { return Math.floor(addr / PAGE_SIZE); }
  function _poff(addr){ return addr % PAGE_SIZE; }

  function _regionOf(addr) {
    if (addr >= REGION.MMIO && addr < REGION.MMIO + REGION_SIZE.MMIO) return 'MMIO';
    if (addr >= REGION.HEAP && addr < REGION.HEAP + REGION_SIZE.HEAP) return 'HEAP';
    if (addr >= REGION.VRAM && addr < REGION.VRAM + REGION_SIZE.VRAM) return 'VRAM';
    if (addr >= REGION.VROM && addr < REGION.VROM + REGION_SIZE.VROM) return 'VROM';
    return null;
  }

  // ── map ──────────────────────────────────────────────────────────────────
  // Map a virtual address range to a logical region + base offset.
  // Returns { ok, vpnStart, vpnEnd, pages }
  function map(virtualBase, bytes, region, physBase) {
    if (!REGION_SIZE[region]) {
      return { ok: false, error: `VMEM: unknown region "${region}"` };
    }
    if (bytes <= 0 || typeof bytes !== 'number') {
      return { ok: false, error: 'VMEM: bytes must be a positive number' };
    }

    const pages    = Math.ceil(bytes / PAGE_SIZE);
    const vpnStart = _vpn(virtualBase);

    for (let i = 0; i < pages; i++) {
      const vpn = vpnStart + i;
      if (_pageTable.has(vpn)) {
        return { ok: false, error: `VMEM: virtual page ${vpn} is already mapped` };
      }
      _pageTable.set(vpn, { region, physBase: (physBase || REGION[region]) + i * PAGE_SIZE });
    }

    _stats.mapped += pages;
    return { ok: true, vpnStart, vpnEnd: vpnStart + pages - 1, pages };
  }

  // ── unmap ─────────────────────────────────────────────────────────────────
  function unmap(virtualBase, bytes) {
    const pages    = Math.ceil((bytes || PAGE_SIZE) / PAGE_SIZE);
    const vpnStart = _vpn(virtualBase);
    let   freed    = 0;
    for (let i = 0; i < pages; i++) {
      if (_pageTable.delete(vpnStart + i)) { freed++; _stats.unmapped++; }
    }
    return { ok: true, freed };
  }

  // ── translate ─────────────────────────────────────────────────────────────
  // Translate a virtual address to its physical (region) equivalent.
  // Returns { ok, region, physAddr } or { ok: false, fault }
  function translate(virtualAddr) {
    const vpn  = _vpn(virtualAddr);
    const poff = _poff(virtualAddr);
    const entry = _pageTable.get(vpn);

    if (!entry) {
      // Auto-resolve: if addr falls naturally inside a known region, map it
      const rName = _regionOf(virtualAddr);
      if (rName) {
        _pageTable.set(vpn, { region: rName, physBase: vpn * PAGE_SIZE });
        const physAddr = vpn * PAGE_SIZE + poff;
        _stats.mapped++;
        return { ok: true, region: rName, physAddr };
      }
      _stats.faults++;
      return { ok: false, fault: `VMEM: page fault at 0x${virtualAddr.toString(16)}` };
    }

    const physAddr = entry.physBase + poff;
    return { ok: true, region: entry.region, physAddr };
  }

  // ── heapAlloc ─────────────────────────────────────────────────────────────
  // Allocate N bytes on the virtual heap. Returns starting virtual address.
  function heapAlloc(bytes) {
    if (typeof bytes !== 'number' || bytes <= 0) {
      throw new TypeError('VMEM.heapAlloc: bytes must be a positive number');
    }
    const pages   = Math.ceil(bytes / PAGE_SIZE);
    const vpnBase = _nextHeapPage;

    for (let i = 0; i < pages; i++) {
      const vpn = vpnBase + i;
      _pageTable.set(vpn, { region: 'HEAP', physBase: vpn * PAGE_SIZE });
    }

    _nextHeapPage += pages;
    _stats.mapped += pages;
    return vpnBase * PAGE_SIZE;   // virtual address of the allocation
  }

  // ── info ─────────────────────────────────────────────────────────────────
  function info() {
    return {
      mappedPages:  _pageTable.size,
      stats:        Object.assign({}, _stats),
      heapNextVA:   '0x' + (_nextHeapPage * PAGE_SIZE).toString(16),
      regions:      Object.keys(REGION).map(r => ({
        name:  r,
        base:  '0x' + REGION[r].toString(16),
        sizeMB: Math.round(REGION_SIZE[r] / (1024 * 1024)),
      })),
    };
  }

  // ── VHAL device descriptor ───────────────────────────────────────────────
  const device = {
    id:      'vmem-0',
    type:    'memory',
    version: VERSION,
    caps:    ['paged', 'translation', 'heap'],
    init:    async () => ({ ok: true, regions: Object.keys(REGION).length }),
    read:    (addr) => translate(addr),
    write:   (_addr, _val) => undefined,
    ioctl:   (cmd, args) => {
      if (cmd === 'map')      return map(args.base, args.bytes, args.region, args.physBase);
      if (cmd === 'unmap')    return unmap(args.base, args.bytes);
      if (cmd === 'translate')return translate(args.addr);
      if (cmd === 'heap')     return { ok: true, addr: heapAlloc(args.bytes) };
      if (cmd === 'info')     return info();
      return null;
    },
    hotplug: () => undefined,
    unplug:  () => { _pageTable.clear(); },
  };

  return {
    name:      'vmem',
    version:   VERSION,
    REGION,
    REGION_SIZE,
    PAGE_SIZE,
    device,
    map,
    unmap,
    translate,
    heapAlloc,
    info,
  };
}

module.exports = { createVMEM, REGION, REGION_SIZE, PAGE_SIZE };
