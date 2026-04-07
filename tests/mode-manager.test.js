'use strict';

const { createModeManager, MODES } = require('../core/mode-manager');
const { createKernel }             = require('../core/kernel');

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
      expect(mgr).toBeDefined();
      expect(mgr.name).toBe('mode-manager');
      expect(mgr.version).toBe('4.0.0');
      expect(typeof mgr.setMode).toBe('function');
      expect(typeof mgr.getMode).toBe('function');
      expect(typeof mgr.getModeConfig).toBe('function');
      expect(typeof mgr.listModes).toBe('function');
      expect(typeof mgr.getSystemPrompt).toBe('function');
      expect(typeof mgr.getModeHistory).toBe('function');
      expect(mgr.commands).toBeDefined();
    });

    test('default mode is chat', () => {
      expect(mgr.getMode()).toBe('chat');
    });
  });

  describe('MODES constant', () => {
    test('has all five modes', () => {
      expect(Object.keys(MODES)).toEqual(expect.arrayContaining(['chat', 'code', 'fix', 'help', 'learn']));
    });

    test('each mode has required fields', () => {
      for (const m of Object.values(MODES)) {
        expect(typeof m.name).toBe('string');
        expect(typeof m.description).toBe('string');
        expect(typeof m.systemPrompt).toBe('string');
        expect(typeof m.responseStyle).toBe('string');
        expect(Array.isArray(m.capabilities)).toBe(true);
      }
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
      const r = mgr.setMode('invalid-mode');
      expect(r.ok).toBe(false);
      expect(r.error).toBeDefined();
    });

    test('mode names are case-insensitive', () => {
      const r = mgr.setMode('CODE');
      expect(r.ok).toBe(true);
      expect(mgr.getMode()).toBe('code');
    });

    test('emits mode:changed event', () => {
      const handler = jest.fn();
      kernel.bus.on('mode:changed', handler);
      mgr.setMode('fix');
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ from: 'chat', to: 'fix' }));
    });

    test('records mode transition history', () => {
      mgr.setMode('code');
      mgr.setMode('fix');
      const hist = mgr.getModeHistory(5);
      expect(hist).toHaveLength(2);
      expect(hist[0].to).toBe('code');
      expect(hist[1].to).toBe('fix');
    });
  });

  describe('getModeConfig', () => {
    test('returns config for current mode by default', () => {
      mgr.setMode('learn');
      const cfg = mgr.getModeConfig();
      expect(cfg.name).toBe('learn');
    });

    test('returns config for named mode', () => {
      const cfg = mgr.getModeConfig('code');
      expect(cfg.name).toBe('code');
    });

    test('falls back to default for unknown mode name', () => {
      const cfg = mgr.getModeConfig('unknown');
      expect(cfg).toBeDefined();
    });
  });

  describe('listModes', () => {
    test('returns array of all modes', () => {
      const list = mgr.listModes();
      expect(Array.isArray(list)).toBe(true);
      expect(list).toHaveLength(5);
      expect(list.map(m => m.name)).toEqual(expect.arrayContaining(['chat', 'code', 'fix', 'help', 'learn']));
    });
  });

  describe('getSystemPrompt', () => {
    test('returns non-empty string for each mode', () => {
      for (const name of ['chat', 'code', 'fix', 'help', 'learn']) {
        const p = mgr.getSystemPrompt(name);
        expect(typeof p).toBe('string');
        expect(p.length).toBeGreaterThan(0);
      }
    });
  });

  describe('commands', () => {
    test('mode command with no args shows current mode', () => {
      const r = mgr.commands.mode([]);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('CHAT');
    });

    test('mode list shows all modes', () => {
      const r = mgr.commands.mode(['list']);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('chat');
      expect(r.result).toContain('code');
      expect(r.result).toContain('fix');
      expect(r.result).toContain('help');
      expect(r.result).toContain('learn');
      expect(r.result).toContain('active');
    });

    test('mode <name> switches mode', () => {
      const r = mgr.commands.mode(['code']);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('CODE');
      expect(mgr.getMode()).toBe('code');
    });

    test('mode <invalid> returns error', () => {
      const r = mgr.commands.mode(['bogus']);
      expect(r.status).toBe('error');
    });

    test('mode history shows transitions', () => {
      mgr.setMode('code');
      const r = mgr.commands.mode(['history']);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('code');
    });

    test('mode history empty', () => {
      const r = mgr.commands.mode(['history']);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('No mode transitions');
    });
  });
});
