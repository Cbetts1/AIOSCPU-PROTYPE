'use strict';

const { createKernel } = require('../core/kernel');
const { createModeManager, MODES } = require('../core/mode-manager');

describe('ModeManager', () => {
  let kernel;
  let mgr;

  beforeEach(() => {
    kernel = createKernel();
    kernel.boot();
    mgr = createModeManager(kernel, null);
  });

  afterEach(() => {
    kernel.shutdown();
  });

  describe('createModeManager', () => {
    test('returns object with expected API', () => {
      expect(mgr.name).toBe('mode-manager');
      expect(mgr.version).toBe('1.0.0');
      expect(typeof mgr.getMode).toBe('function');
      expect(typeof mgr.getModeInfo).toBe('function');
      expect(typeof mgr.listModes).toBe('function');
      expect(typeof mgr.setMode).toBe('function');
      expect(typeof mgr.getHistory).toBe('function');
      expect(typeof mgr.commands).toBe('object');
      expect(typeof mgr.commands.mode).toBe('function');
    });

    test('default mode is chat', () => {
      expect(mgr.getMode()).toBe('chat');
    });

    test('accepts custom default mode', () => {
      const m = createModeManager(kernel, null, { defaultMode: 'code' });
      expect(m.getMode()).toBe('code');
    });

    test('invalid default mode falls back to chat', () => {
      const m = createModeManager(kernel, null, { defaultMode: 'invalid' });
      expect(m.getMode()).toBe('chat');
    });
  });

  describe('MODES constant', () => {
    test('contains all five modes', () => {
      const keys = Object.keys(MODES);
      expect(keys).toContain('chat');
      expect(keys).toContain('code');
      expect(keys).toContain('fix');
      expect(keys).toContain('help');
      expect(keys).toContain('learn');
    });

    test('is frozen', () => {
      expect(Object.isFrozen(MODES)).toBe(true);
    });
  });

  describe('getModeInfo', () => {
    test('returns info for current mode', () => {
      const info = mgr.getModeInfo();
      expect(info.name).toBe('chat');
      expect(typeof info.label).toBe('string');
      expect(typeof info.description).toBe('string');
    });
  });

  describe('listModes', () => {
    test('returns array of five modes', () => {
      const list = mgr.listModes();
      expect(Array.isArray(list)).toBe(true);
      expect(list.length).toBe(5);
      list.forEach(m => {
        expect(m).toHaveProperty('name');
        expect(m).toHaveProperty('label');
        expect(m).toHaveProperty('description');
      });
    });
  });

  describe('setMode', () => {
    test('switches to a valid mode', () => {
      const r = mgr.setMode('code');
      expect(r.ok).toBe(true);
      expect(r.mode).toBe('code');
      expect(mgr.getMode()).toBe('code');
    });

    test('returns error for unknown mode', () => {
      const r = mgr.setMode('invalid');
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/unknown mode/i);
    });

    test('mode names are case-insensitive', () => {
      const r = mgr.setMode('CODE');
      expect(r.ok).toBe(true);
      expect(mgr.getMode()).toBe('code');
    });

    test('switches to all five modes', () => {
      for (const mode of ['chat', 'code', 'fix', 'help', 'learn']) {
        const r = mgr.setMode(mode);
        expect(r.ok).toBe(true);
        expect(mgr.getMode()).toBe(mode);
      }
    });

    test('emits mode:changed kernel event', () => {
      const events = [];
      kernel.bus.on('mode:changed', (data) => events.push(data));
      mgr.setMode('code');
      expect(events.length).toBe(1);
      expect(events[0].from).toBe('chat');
      expect(events[0].to).toBe('code');
    });
  });

  describe('getHistory', () => {
    test('records mode switches', () => {
      mgr.setMode('code');
      mgr.setMode('fix');
      const hist = mgr.getHistory(10);
      expect(hist.length).toBe(2);
      expect(hist[0].to).toBe('fix');
      expect(hist[1].to).toBe('code');
    });

    test('respects limit', () => {
      mgr.setMode('code');
      mgr.setMode('fix');
      mgr.setMode('help');
      const hist = mgr.getHistory(2);
      expect(hist.length).toBe(2);
    });
  });

  describe('commands interface', () => {
    test('mode status returns current mode', () => {
      const r = mgr.commands.mode([]);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('Chat');
    });

    test('mode list shows all modes', () => {
      const r = mgr.commands.mode(['list']);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('Chat');
      expect(r.result).toContain('Code');
      expect(r.result).toContain('Fix');
      expect(r.result).toContain('Help');
      expect(r.result).toContain('Learn');
    });

    test('mode <name> switches mode', () => {
      const r = mgr.commands.mode(['code']);
      expect(r.status).toBe('ok');
      expect(mgr.getMode()).toBe('code');
    });

    test('mode <invalid> returns error', () => {
      const r = mgr.commands.mode(['nonsense']);
      expect(r.status).toBe('error');
    });

    test('mode history shows switch log', () => {
      mgr.setMode('code');
      const r = mgr.commands.mode(['history']);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('code');
    });
  });

  describe('with memory engine integration', () => {
    test('records mode switch as learning', () => {
      const { createMemoryEngine } = require('../core/memory-engine');
      const mem = createMemoryEngine(kernel);
      const m   = createModeManager(kernel, mem);
      m.setMode('code');
      const learnings = mem.getLearnings(5, 'mode-switch');
      expect(learnings.length).toBe(1);
      expect(learnings[0].data.to).toBe('code');
    });
  });
});
