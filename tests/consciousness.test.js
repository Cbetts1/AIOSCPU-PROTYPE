'use strict';

const { createConsciousness } = require('../core/consciousness');
const { createKernel }        = require('../core/kernel');
const { createMemoryEngine }  = require('../core/memory-engine');
const { createModeManager }   = require('../core/mode-manager');
const { createModelRegistry } = require('../core/model-registry');

describe('Consciousness', () => {
  let kernel;
  let memory;
  let modeManager;
  let modelRegistry;
  let consciousness;

  beforeEach(() => {
    kernel        = createKernel();
    kernel.boot();
    memory        = createMemoryEngine(kernel, null);
    modeManager   = createModeManager(kernel, memory);
    modelRegistry = createModelRegistry(kernel, null, null);
    consciousness = createConsciousness(kernel, null, memory, modeManager, modelRegistry, null);
  });

  afterEach(() => {
    consciousness.stopProactive();
    kernel.shutdown();
  });

  describe('createConsciousness', () => {
    test('returns object with expected API', () => {
      expect(consciousness).toBeDefined();
      expect(consciousness.name).toBe('consciousness');
      expect(consciousness.version).toBe('1.0.0');
      expect(typeof consciousness.query).toBe('function');
      expect(typeof consciousness.learn).toBe('function');
      expect(typeof consciousness.getContext).toBe('function');
      expect(typeof consciousness.integrateModel).toBe('function');
      expect(typeof consciousness.runSampleQueries).toBe('function');
      expect(typeof consciousness.startProactive).toBe('function');
      expect(typeof consciousness.stopProactive).toBe('function');
      expect(consciousness.commands).toBeDefined();
    });
  });

  describe('query', () => {
    test('returns a result object with status, result, model, mode', async () => {
      const r = await consciousness.query('hello');
      expect(r.status).toBe('ok');
      expect(typeof r.result).toBe('string');
      expect(typeof r.model).toBe('string');
      expect(typeof r.mode).toBe('string');
    });

    test('uses the current mode', async () => {
      modeManager.setMode('code');
      const r = await consciousness.query('write hello world');
      expect(r.mode).toBe('code');
    });

    test('mode option overrides current mode', async () => {
      const r = await consciousness.query('test', { mode: 'fix' });
      expect(r.mode).toBe('fix');
    });

    test('returns ok for empty input', async () => {
      const r = await consciousness.query('');
      expect(r.status).toBe('error');
    });

    test('records interaction in memory', async () => {
      await consciousness.query('test input');
      const hist = memory.getHistory(5);
      expect(hist.some(e => e.content === 'test input')).toBe(true);
    });

    test('emits consciousness:query event', async () => {
      const handler = jest.fn();
      kernel.bus.on('consciousness:query', handler);
      await consciousness.query('hello');
      expect(handler).toHaveBeenCalled();
    });

    test('learn mode stores fact in memory', async () => {
      modeManager.setMode('learn');
      await consciousness.query('AIOS runs on Node.js');
      const facts = memory.getFacts();
      expect(facts.some(f => f.content.includes('AIOS runs on Node.js'))).toBe(true);
    });

    test('skipMemory option does not write to memory', async () => {
      const before = memory.getHistory(100).length;
      await consciousness.query('skip this', { skipMemory: true });
      expect(memory.getHistory(100).length).toBe(before);
    });
  });

  describe('learn', () => {
    test('stores fact in memory engine', () => {
      consciousness.learn({ content: 'test fact', source: 'test', confidence: 0.9 });
      expect(memory.getFacts().some(f => f.content === 'test fact')).toBe(true);
    });

    test('emits consciousness:learned event', () => {
      const handler = jest.fn();
      kernel.bus.on('consciousness:learned', handler);
      consciousness.learn({ content: 'fact' });
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('getContext', () => {
    test('returns mode, memory, and models', () => {
      const ctx = consciousness.getContext();
      expect(ctx).toBeDefined();
      expect(ctx.mode).toBeDefined();
      expect(ctx.memory).toBeDefined();
      expect(Array.isArray(ctx.models)).toBe(true);
    });

    test('mode reflects current mode manager state', () => {
      modeManager.setMode('help');
      const ctx = consciousness.getContext();
      expect(ctx.mode).toBe('help');
    });

    test('models list includes built-in-nlp', () => {
      const ctx = consciousness.getContext();
      expect(ctx.models.some(m => m.name === 'built-in-nlp')).toBe(true);
    });
  });

  describe('integrateModel', () => {
    test('integrates and validates a model', async () => {
      const r = await consciousness.integrateModel({
        name:     'test-integration',
        type:     'builtin',
        endpoint: null,
        modes:    ['chat'],
        meta:     { offline: true },
      });
      expect(r).toBeDefined();
      expect(typeof r.ok).toBe('boolean');
    });

    test('emits consciousness:model-integrated event', async () => {
      const handler = jest.fn();
      kernel.bus.on('consciousness:model-integrated', handler);
      await consciousness.integrateModel({ name: 'evt-model', type: 'builtin', modes: ['chat'] });
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('runSampleQueries', () => {
    test('runs queries for all 5 modes', async () => {
      const results = await consciousness.runSampleQueries();
      expect(results).toHaveLength(5);
      const modes = results.map(r => r.mode);
      expect(modes).toContain('chat');
      expect(modes).toContain('code');
      expect(modes).toContain('fix');
      expect(modes).toContain('help');
      expect(modes).toContain('learn');
    }, 30000);

    test('each result has ok flag and model field', async () => {
      const results = await consciousness.runSampleQueries();
      for (const r of results) {
        expect(typeof r.ok).toBe('boolean');
        expect(typeof r.model).toBe('string');
        expect(typeof r.result).toBe('string');
      }
    }, 30000);
  });

  describe('proactive assistance', () => {
    test('startProactive and stopProactive do not throw', () => {
      expect(() => consciousness.startProactive(60000)).not.toThrow();
      expect(() => consciousness.stopProactive()).not.toThrow();
    });

    test('startProactive emits consciousness:proactive-start', () => {
      const handler = jest.fn();
      kernel.bus.on('consciousness:proactive-start', handler);
      consciousness.startProactive(60000);
      expect(handler).toHaveBeenCalled();
      consciousness.stopProactive();
    });

    test('calling startProactive twice does not double-schedule', () => {
      const handler = jest.fn();
      kernel.bus.on('consciousness:proactive-start', handler);
      consciousness.startProactive(60000);
      consciousness.startProactive(60000);
      expect(handler).toHaveBeenCalledTimes(1);
      consciousness.stopProactive();
    });
  });

  describe('commands', () => {
    test('consciousness status', async () => {
      const r = await consciousness.commands.consciousness(['status']);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('Consciousness');
    });

    test('consciousness learn', async () => {
      const r = await consciousness.commands.consciousness(['learn', 'AIOS', 'is', 'great']);
      expect(r.status).toBe('ok');
      expect(memory.getFacts().some(f => f.content.includes('AIOS'))).toBe(true);
    });

    test('consciousness context', async () => {
      const r = await consciousness.commands.consciousness(['context']);
      expect(r.status).toBe('ok');
      const parsed = JSON.parse(r.result);
      expect(parsed.mode).toBeDefined();
    });

    test('consciousness sample runs without error', async () => {
      const r = await consciousness.commands.consciousness(['sample']);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('Sample query results');
    }, 30000);

    test('consciousness proactive on', async () => {
      const r = await consciousness.commands.consciousness(['proactive', 'on']);
      expect(r.status).toBe('ok');
      consciousness.stopProactive();
    });

    test('consciousness proactive off', async () => {
      const r = await consciousness.commands.consciousness(['proactive', 'off']);
      expect(r.status).toBe('ok');
    });

    test('consciousness unknown sub returns usage', async () => {
      const r = await consciousness.commands.consciousness(['unknown-sub']);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('Usage');
    });

    test('chat command with no args returns usage', async () => {
      const r = await consciousness.commands.chat([]);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('Usage');
    });

    test('chat command routes query', async () => {
      const r = await consciousness.commands.chat(['hello', 'world']);
      expect(r.status).toBe('ok');
      expect(typeof r.result).toBe('string');
    });
  });

  describe('no-dependency fallback', () => {
    test('query works when memory engine is null', async () => {
      const bare = createConsciousness(kernel, null, null, null, null, null);
      const r    = await bare.query('test');
      expect(r.status).toBe('ok');
    });

    test('learn works when memory engine is null', () => {
      const bare = createConsciousness(kernel, null, null, null, null, null);
      expect(() => bare.learn({ content: 'fact' })).not.toThrow();
    });

    test('getContext works without deps', () => {
      const bare = createConsciousness(kernel, null, null, null, null, null);
      const ctx  = bare.getContext();
      expect(ctx.mode).toBe('chat');
      expect(ctx.memory).toBeNull();
      expect(ctx.models).toEqual([]);
    });
  });
});
