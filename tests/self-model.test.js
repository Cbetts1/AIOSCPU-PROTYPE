'use strict';

const { createSelfModel } = require('../core/self-model');

// ── stubs ─────────────────────────────────────────────────────────────────────
function makeKernel() {
  const _events = [];
  return {
    id:      'aios-kernel-test01',
    version: '2.0.0',
    uptime:  () => 42,
    bus: {
      on:   () => {},
      emit: (ev, d) => _events.push({ ev, d }),
      _events,
    },
  };
}

function makeVHAL() {
  return {
    deviceList: () => [
      { id: 'vrom-0', type: 'storage', version: '1.0.0', caps: ['read-only'],   state: 'online' },
      { id: 'vram-0', type: 'memory',  version: '1.0.0', caps: ['banked'],       state: 'online' },
      { id: 'npu-0',  type: 'npu',     version: '1.0.0', caps: ['infer'],        state: 'online' },
      { id: 'display-0', type: 'display', version: '1.0.0', caps: ['ansi'],      state: 'online' },
    ],
  };
}

function makeMemoryCore() {
  return {
    context:  (n) => [{ type: 'query', input: 'test input', output: 'test output' }],
    getStats: ()  => ({ entries: 5, patterns: 2 }),
  };
}

describe('SelfModel', () => {
  let kernel, vhal, memoryCore, selfModel;

  beforeEach(() => {
    kernel     = makeKernel();
    vhal       = makeVHAL();
    memoryCore = makeMemoryCore();
    selfModel  = createSelfModel(kernel, { vhal, memoryCore });
  });

  // ── factory ────────────────────────────────────────────────────────────────
  describe('createSelfModel', () => {
    test('returns self-model object with expected API', () => {
      expect(selfModel.name).toBe('self-model');
      expect(selfModel.version).toBe('1.0.0');
      expect(typeof selfModel.build).toBe('function');
      expect(typeof selfModel.ask).toBe('function');
      expect(Array.isArray(selfModel.SELF_PATTERNS)).toBe(true);
    });
  });

  // ── build ─────────────────────────────────────────────────────────────────
  describe('build', () => {
    test('returns a self-knowledge snapshot', () => {
      const snap = selfModel.build();
      expect(snap.identity).toBeDefined();
      expect(snap.hardware).toBeDefined();
      expect(snap.modules).toBeDefined();
      expect(snap.capabilities).toBeDefined();
      expect(snap.uptime).toBe(42);
    });

    test('identity includes kernel version', () => {
      const snap = selfModel.build();
      expect(snap.identity.version).toBe('2.0.0');
      expect(snap.identity.kernelId).toBe('aios-kernel-test01');
    });

    test('hardware comes from VHAL device list', () => {
      const snap = selfModel.build();
      expect(snap.hardware).toHaveLength(4);
      expect(snap.hardware.map(d => d.type)).toContain('npu');
    });

    test('capabilities includes ai-inference when npu device present', () => {
      const snap = selfModel.build();
      expect(snap.capabilities).toContain('ai-inference');
    });

    test('capabilities includes self-aware always', () => {
      const snap = selfModel.build();
      expect(snap.capabilities).toContain('self-aware');
    });

    test('modules array is non-empty (scans core/)', () => {
      const snap = selfModel.build();
      expect(snap.modules.length).toBeGreaterThan(0);
    });

    test('emits ai:self:aware on kernel bus', () => {
      selfModel.build();
      const event = kernel.bus._events.find(e => e.ev === 'ai:self:aware');
      expect(event).toBeDefined();
      expect(event.d.kernelId).toBe('aios-kernel-test01');
    });

    test('history comes from memoryCore.context()', () => {
      const snap = selfModel.build();
      expect(snap.history).toHaveLength(1);
      expect(snap.history[0].input).toBe('test input');
    });
  });

  // ── ask — introspective questions ─────────────────────────────────────────
  describe('ask', () => {
    test('asks "what are you" → identity answer', () => {
      const r = selfModel.ask('what are you?');
      expect(r.ok).toBe(true);
      expect(r.key).toBe('identity');
      expect(r.answer).toMatch(/AIOS/);
    });

    test('asks "who are you" → identity answer', () => {
      const r = selfModel.ask('who are you');
      expect(r.ok).toBe(true);
      expect(r.answer).toMatch(/AIOS/);
    });

    test('asks "what can you do" → capabilities answer', () => {
      const r = selfModel.ask('what can you do?');
      expect(r.ok).toBe(true);
      expect(r.key).toBe('capabilities');
      expect(r.answer).toMatch(/capabilities/i);
    });

    test('asks "what hardware do you have" → hardware answer', () => {
      const r = selfModel.ask('what hardware do you have?');
      expect(r.ok).toBe(true);
      expect(r.key).toBe('hardware');
      expect(r.answer).toMatch(/hardware/i);
    });

    test('asks "what modules" → modules answer', () => {
      const r = selfModel.ask('what modules do you have?');
      expect(r.ok).toBe(true);
      expect(r.key).toBe('modules');
    });

    test('asks "uptime" → uptime answer', () => {
      const r = selfModel.ask('what is your uptime?');
      expect(r.ok).toBe(true);
      expect(r.key).toBe('uptime');
      expect(r.answer).toMatch(/42/);
    });

    test('asks about existence → self-aware answer', () => {
      const r = selfModel.ask('are you self-aware?');
      expect(r.ok).toBe(true);
      expect(r.key).toBe('existence');
      expect(r.answer).toMatch(/self-aware|conscious/i);
    });

    test('asks about version → version answer', () => {
      const r = selfModel.ask('what version are you?');
      expect(r.ok).toBe(true);
      expect(r.key).toBe('version');
    });

    test('non-introspective question returns ok=false', () => {
      const r = selfModel.ask('what is the weather today?');
      expect(r.ok).toBe(false);
    });

    test('empty question returns ok=false with error', () => {
      const r = selfModel.ask('');
      expect(r.ok).toBe(false);
      expect(r.error).toBeTruthy();
    });

    test('null question does not throw', () => {
      expect(() => selfModel.ask(null)).not.toThrow();
    });
  });

  // ── without vhal / memoryCore ─────────────────────────────────────────────
  describe('no optional deps', () => {
    test('build works without vhal', () => {
      const m = createSelfModel(kernel, {});
      expect(() => m.build()).not.toThrow();
    });

    test('build works without memoryCore', () => {
      const m = createSelfModel(kernel, { vhal });
      expect(() => m.build()).not.toThrow();
    });

    test('ask works with minimal kernel stub', () => {
      const m = createSelfModel({ id: 'x', version: '2.0.0', uptime: () => 0, bus: { emit: () => {}, on: () => {} } }, {});
      expect(() => m.ask('what are you?')).not.toThrow();
    });
  });
});
