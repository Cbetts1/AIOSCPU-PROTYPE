'use strict';

const { createNPUTinyLlama } = require('../core/npu-tinyllama');

// ── stub kernel ──────────────────────────────────────────────────────────────
function makeKernel() {
  const _h = {};
  const _syscalls = {};
  return {
    id:      'k-test',
    version: '2.0.0',
    uptime:  () => 10,
    bus: {
      on:   (ev, fn) => { _h[ev] = fn; },
      emit: (ev, d)  => { if (_h[ev]) _h[ev](d); },
      _handlers: _h,
    },
    registerSyscall: (num, fn) => { _syscalls[num] = fn; },
    syscall: (num, args) => _syscalls[num] ? _syscalls[num](args) : null,
    _syscalls,
  };
}

function makeMemoryCore() {
  const _records = [];
  return {
    record: (type, input, output, error) => _records.push({ type, input, output, error }),
    getStats: () => ({ entries: _records.length }),
    _records,
  };
}

describe('NPU TinyLlama', () => {
  let kernel, memoryCore, npu;

  beforeEach(() => {
    kernel     = makeKernel();
    memoryCore = makeMemoryCore();
    npu        = createNPUTinyLlama(kernel, { memoryCore });
  });

  // ── factory ────────────────────────────────────────────────────────────────
  describe('createNPUTinyLlama', () => {
    test('returns npu object with expected API', () => {
      expect(npu.name).toBe('npu-tinyllama');
      expect(npu.version).toBe('1.0.0');
      expect(npu.model).toBe('tinyllama');
      expect(typeof npu.init).toBe('function');
      expect(typeof npu.infer).toBe('function');
      expect(npu.device).toBeDefined();
    });

    test('registers SYSCALL 30 (NPU_INFER) on the kernel', () => {
      expect(kernel._syscalls[30]).toBeDefined();
    });

    test('device id is npu-0 and type is npu', () => {
      expect(npu.device.id).toBe('npu-0');
      expect(npu.device.type).toBe('npu');
    });

    test('device caps include infer and tinyllama', () => {
      expect(npu.device.caps).toContain('infer');
      expect(npu.device.caps).toContain('tinyllama');
    });
  });

  // ── init — offline behaviour ───────────────────────────────────────────────
  describe('init (Ollama offline)', () => {
    test('init resolves ok even when Ollama is unreachable', async () => {
      const r = await npu.init();
      expect(r.ok).toBe(true);
    });

    test('isOnline() is false when Ollama not reachable', async () => {
      await npu.init();
      expect(npu.isOnline()).toBe(false);
    });

    test('isReady() is false when model not available', async () => {
      await npu.init();
      expect(npu.isReady()).toBe(false);
    });
  });

  // ── infer — offline queue ─────────────────────────────────────────────────
  describe('infer (offline)', () => {
    test('infer queues request when Ollama is offline', async () => {
      await npu.init();
      // The queue grows by 1 — we don't await because it would hang
      const prom = npu.infer('What is the capital of France?');
      expect(npu.queueLength()).toBe(1);
      // cleanup
      prom.catch(() => {});
    });

    test('npu:infer:start is emitted', done => {
      kernel.bus.on('npu:infer:start', (d) => {
        expect(d.prompt).toMatch(/capital/);
        done();
      });
      const p = npu.infer('capital test');
      p.catch(() => {});
    });
  });

  // ── device.read — status ──────────────────────────────────────────────────
  describe('device.read', () => {
    test('returns status object', () => {
      const s = npu.device.read(0);
      expect(s.model).toBe('tinyllama');
      expect(typeof s.online).toBe('boolean');
      expect(typeof s.ready).toBe('boolean');
      expect(typeof s.queued).toBe('number');
    });
  });

  // ── device.ioctl ─────────────────────────────────────────────────────────
  describe('device.ioctl', () => {
    test('ioctl status returns status', () => {
      const r = npu.device.ioctl('status', {});
      expect(r.ok).toBe(true);
      expect(r.model).toBe('tinyllama');
    });

    test('ioctl infer returns a promise', () => {
      const r = npu.device.ioctl('infer', { prompt: 'hello' });
      expect(r).toBeInstanceOf(Promise);
      r.catch(() => {});
    });
  });

  // ── kernel bus subscriptions ──────────────────────────────────────────────
  describe('kernel bus', () => {
    test('listens to kernel:query events', () => {
      const events = [];
      kernel.bus.on('npu:infer:start', d => events.push(d));
      kernel.bus._handlers['kernel:query'] && kernel.bus._handlers['kernel:query']({ prompt: 'query test' });
      // async - just verify it doesn't throw
    });
  });

  // ── device VHAL init ──────────────────────────────────────────────────────
  describe('device.init', () => {
    test('device.init() resolves with ok=true', async () => {
      const r = await npu.device.init();
      expect(r.ok).toBe(true);
    });
  });
});
