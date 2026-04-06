'use strict';

const { createVMEM, REGION, REGION_SIZE, PAGE_SIZE } = require('../core/vmem');

describe('VMEM', () => {
  let vmem;

  beforeEach(() => { vmem = createVMEM(); });

  // ── factory ────────────────────────────────────────────────────────────────
  describe('createVMEM', () => {
    test('returns vmem object with expected API', () => {
      expect(vmem.name).toBe('vmem');
      expect(vmem.version).toBe('1.0.0');
      expect(typeof vmem.map).toBe('function');
      expect(typeof vmem.unmap).toBe('function');
      expect(typeof vmem.translate).toBe('function');
      expect(typeof vmem.heapAlloc).toBe('function');
      expect(vmem.device).toBeDefined();
    });

    test('REGION constants are exported', () => {
      expect(REGION.VROM).toBe(0x00000000);
      expect(REGION.VRAM).toBe(0x10000000);
      expect(REGION.HEAP).toBe(0x90000000);
      expect(REGION.MMIO).toBe(0xB0000000);
    });

    test('PAGE_SIZE is 4096', () => {
      expect(PAGE_SIZE).toBe(4096);
    });
  });

  // ── map ────────────────────────────────────────────────────────────────────
  describe('map', () => {
    test('maps a virtual range to a region', () => {
      const r = vmem.map(REGION.VRAM, PAGE_SIZE, 'VRAM');
      expect(r.ok).toBe(true);
      expect(r.pages).toBe(1);
    });

    test('returns error for unknown region', () => {
      const r = vmem.map(0x1000, PAGE_SIZE, 'XYZZY');
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/unknown region/);
    });

    test('returns error if page already mapped', () => {
      vmem.map(0x00001000, PAGE_SIZE, 'VROM');
      const r = vmem.map(0x00001000, PAGE_SIZE, 'VROM');
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/already mapped/);
    });

    test('maps multiple pages for large ranges', () => {
      const bytes = PAGE_SIZE * 4;
      const r = vmem.map(REGION.HEAP, bytes, 'HEAP');
      expect(r.ok).toBe(true);
      expect(r.pages).toBe(4);
    });
  });

  // ── unmap ─────────────────────────────────────────────────────────────────
  describe('unmap', () => {
    test('unmaps a previously mapped range', () => {
      vmem.map(REGION.VRAM + PAGE_SIZE, PAGE_SIZE, 'VRAM');
      const r = vmem.unmap(REGION.VRAM + PAGE_SIZE, PAGE_SIZE);
      expect(r.ok).toBe(true);
      expect(r.freed).toBe(1);
    });

    test('freed count is 0 for non-mapped address', () => {
      const r = vmem.unmap(0xDEAD0000, PAGE_SIZE);
      expect(r.freed).toBe(0);
    });
  });

  // ── translate ─────────────────────────────────────────────────────────────
  describe('translate', () => {
    test('auto-resolves VROM addresses without explicit map', () => {
      const r = vmem.translate(REGION.VROM + 0x100);
      expect(r.ok).toBe(true);
      expect(r.region).toBe('VROM');
    });

    test('auto-resolves VRAM addresses', () => {
      const r = vmem.translate(REGION.VRAM + 0x200);
      expect(r.ok).toBe(true);
      expect(r.region).toBe('VRAM');
    });

    test('auto-resolves HEAP addresses', () => {
      const r = vmem.translate(REGION.HEAP + 0x300);
      expect(r.ok).toBe(true);
      expect(r.region).toBe('HEAP');
    });

    test('auto-resolves MMIO addresses', () => {
      const r = vmem.translate(REGION.MMIO + 0x10);
      expect(r.ok).toBe(true);
      expect(r.region).toBe('MMIO');
    });

    test('returns page fault for out-of-range address', () => {
      const r = vmem.translate(0xF0000000);
      expect(r.ok).toBe(false);
      expect(r.fault).toMatch(/page fault/);
    });

    test('physAddr is consistent across calls', () => {
      const r1 = vmem.translate(REGION.VROM + 8);
      const r2 = vmem.translate(REGION.VROM + 8);
      expect(r1.physAddr).toBe(r2.physAddr);
    });
  });

  // ── heapAlloc ─────────────────────────────────────────────────────────────
  describe('heapAlloc', () => {
    test('returns a virtual address in HEAP region', () => {
      const addr = vmem.heapAlloc(PAGE_SIZE);
      expect(addr).toBeGreaterThanOrEqual(REGION.HEAP);
    });

    test('successive allocations return different addresses', () => {
      const a1 = vmem.heapAlloc(PAGE_SIZE);
      const a2 = vmem.heapAlloc(PAGE_SIZE);
      expect(a1).not.toBe(a2);
    });

    test('allocated addresses can be translated back', () => {
      const addr = vmem.heapAlloc(PAGE_SIZE);
      const r = vmem.translate(addr);
      expect(r.ok).toBe(true);
      expect(r.region).toBe('HEAP');
    });

    test('throws for non-positive bytes', () => {
      expect(() => vmem.heapAlloc(0)).toThrow(TypeError);
      expect(() => vmem.heapAlloc(-1)).toThrow(TypeError);
    });
  });

  // ── info ─────────────────────────────────────────────────────────────────
  describe('info', () => {
    test('returns info object with regions', () => {
      const i = vmem.info();
      expect(i.regions).toBeDefined();
      expect(i.regions.length).toBe(4);
      expect(i.regions.map(r => r.name)).toContain('HEAP');
    });

    test('mappedPages increases after translations', () => {
      vmem.translate(REGION.VRAM + 0x100);
      expect(vmem.info().mappedPages).toBeGreaterThan(0);
    });
  });

  // ── VHAL device descriptor ─────────────────────────────────────────────────
  describe('VHAL device', () => {
    test('device id is vmem-0', () => {
      expect(vmem.device.id).toBe('vmem-0');
      expect(vmem.device.type).toBe('memory');
    });

    test('device.init() resolves ok', async () => {
      const r = await vmem.device.init();
      expect(r.ok).toBe(true);
    });

    test('device.read(addr) translates the address', () => {
      const r = vmem.device.read(REGION.VROM + 0x50);
      expect(r.ok).toBe(true);
    });

    test('device.ioctl translate works', () => {
      const r = vmem.device.ioctl('translate', { addr: REGION.VRAM + 0x10 });
      expect(r.ok).toBe(true);
    });

    test('device.ioctl heap allocates', () => {
      const r = vmem.device.ioctl('heap', { bytes: PAGE_SIZE });
      expect(r.ok).toBe(true);
      expect(r.addr).toBeGreaterThanOrEqual(REGION.HEAP);
    });

    test('device caps include paged and translation', () => {
      expect(vmem.device.caps).toContain('paged');
      expect(vmem.device.caps).toContain('translation');
    });
  });
});
