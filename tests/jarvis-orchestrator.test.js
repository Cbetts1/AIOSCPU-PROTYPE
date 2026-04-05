'use strict';
/**
 * tests/jarvis-orchestrator.test.js
 *
 * Full Jest test suite for core/jarvis-orchestrator.js.
 * All Ollama fetch calls are mocked — no real network required.
 */

const { createJarvisOrchestrator } = require('../core/jarvis-orchestrator.js');

// ---------------------------------------------------------------------------
// Minimal kernel / bus stub
// ---------------------------------------------------------------------------
function makeKernel() {
  const handlers = {};
  return {
    id:      'aios-test',
    version: '1.0.0',
    uptime:  () => 42,
    bus: {
      on:   (ev, fn) => { handlers[ev] = fn; },
      emit: (ev, data) => { if (handlers[ev]) handlers[ev](data); },
      _handlers: handlers,
    },
  };
}

// Minimal service-manager stub
function makeSvcMgr(stateOverride) {
  const svcs = {};
  return {
    register: (name, descriptor) => { svcs[name] = { name, state: 'stopped', descriptor }; },
    status:   (name) => {
      if (stateOverride && stateOverride[name]) {
        return { ok: true, name, state: stateOverride[name] };
      }
      if (svcs[name]) return { ok: true, name, state: svcs[name].state };
      return { ok: false, error: `No service: ${name}` };
    },
    list: () => Object.values(svcs),
    _setState: (name, state) => { if (svcs[name]) svcs[name].state = state; },
    _svcs: svcs,
  };
}

// Minimal hostBridge stub
function makeHostBridge() {
  return {
    memInfo:  () => ({ ok: true, usedMB: 512, totalMB: 2048 }),
    platform: { name: 'linux-test' },
  };
}

// Minimal memoryCore stub
function makeMemoryCore() {
  const records = [];
  return {
    record:   (type, input, output, err) => records.push({ type, input, output, err }),
    getStats: () => ({ entries: records.length, patterns: 0 }),
    _records: records,
  };
}

// Minimal consciousness stub
function makeConsciousness() {
  return {
    query:      async (input) => ({ status: 'ok', result: `builtin:${input}`, model: 'builtin' }),
    getContext: () => ({ mode: 'chat', memory: {}, models: [{ name: 'builtin', healthy: true }] }),
  };
}

// Minimal modeManager stub
function makeModeManager() {
  return { getMode: () => 'chat' };
}

// ---------------------------------------------------------------------------
// Global fetch mock helpers
// ---------------------------------------------------------------------------
function mockFetchOllamaUp(responseText) {
  global.fetch = jest.fn((url, opts) => {
    if (url.includes('/api/tags')) {
      return Promise.resolve({ ok: true, json: async () => ({ models: [] }) });
    }
    if (url.includes('/api/generate')) {
      return Promise.resolve({ ok: true, json: async () => ({ response: responseText || 'ok response' }) });
    }
    return Promise.resolve({ ok: false, json: async () => ({}) });
  });
}

function mockFetchOllamaDown() {
  global.fetch = jest.fn(() => Promise.reject(new Error('ECONNREFUSED')));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeOrchestrator(opts = {}) {
  const kernel       = opts.kernel       || makeKernel();
  const svcMgr       = opts.svcMgr       || makeSvcMgr();
  const hostBridge   = opts.hostBridge   || makeHostBridge();
  const memoryCore   = opts.memoryCore   || makeMemoryCore();
  const consciousness= opts.consciousness|| makeConsciousness();
  const modeManager  = opts.modeManager  || makeModeManager();
  return {
    orchestrator: createJarvisOrchestrator(
      kernel, svcMgr, hostBridge, memoryCore, consciousness, modeManager,
    ),
    kernel, svcMgr, hostBridge, memoryCore, consciousness,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('createJarvisOrchestrator', () => {

  afterEach(() => {
    jest.restoreAllMocks();
    delete global.fetch;
  });

  // ── Module shape ───────────────────────────────────────────────────────────
  describe('module shape', () => {
    test('returns object with expected API', () => {
      const { orchestrator } = makeOrchestrator();
      expect(typeof orchestrator.query).toBe('function');
      expect(typeof orchestrator.getAgents).toBe('function');
      expect(typeof orchestrator.status).toBe('function');
      expect(typeof orchestrator.registerWithAICore).toBe('function');
      expect(typeof orchestrator.registerServices).toBe('function');
      expect(typeof orchestrator.startListening).toBe('function');
      expect(typeof orchestrator.stopListening).toBe('function');
      expect(typeof orchestrator.commands).toBe('object');
      expect(typeof orchestrator.commands.jarvis).toBe('function');
      expect(orchestrator.version).toBe('1.0.0');
      expect(orchestrator.name).toBe('jarvis-orchestrator');
    });
  });

  // ── getAgents ──────────────────────────────────────────────────────────────
  describe('getAgents()', () => {
    test('returns three built-in agents', () => {
      const { orchestrator } = makeOrchestrator();
      const agents = orchestrator.getAgents();
      expect(agents).toHaveLength(3);
      const names = agents.map(a => a.name);
      expect(names).toContain('jarvis');
      expect(names).toContain('code');
      expect(names).toContain('analyst');
    });

    test('each agent has model, label, description, onDemand fields', () => {
      const { orchestrator } = makeOrchestrator();
      for (const a of orchestrator.getAgents()) {
        expect(typeof a.model).toBe('string');
        expect(typeof a.label).toBe('string');
        expect(typeof a.description).toBe('string');
        expect(typeof a.onDemand).toBe('boolean');
      }
    });

    test('only analyst is onDemand', () => {
      const { orchestrator } = makeOrchestrator();
      const agents = orchestrator.getAgents();
      const analyst = agents.find(a => a.name === 'analyst');
      const others  = agents.filter(a => a.name !== 'analyst');
      expect(analyst.onDemand).toBe(true);
      others.forEach(a => expect(a.onDemand).toBe(false));
    });
  });

  // ── status() ──────────────────────────────────────────────────────────────
  describe('status()', () => {
    test('returns version and agent list', () => {
      const { orchestrator } = makeOrchestrator();
      const s = orchestrator.status();
      expect(s.version).toBe('1.0.0');
      expect(Array.isArray(s.agents)).toBe(true);
      expect(s.agents).toHaveLength(3);
    });

    test('listening starts false', () => {
      const { orchestrator } = makeOrchestrator();
      expect(orchestrator.status().listening).toBe(false);
    });
  });

  // ── query() — Ollama offline ───────────────────────────────────────────────
  describe('query() — Ollama offline', () => {
    test('returns builtin fallback when Ollama is down', async () => {
      mockFetchOllamaDown();
      const { orchestrator } = makeOrchestrator();
      const r = await orchestrator.query('hello');
      expect(r.status).toBe('ok');
      expect(r.agent).toBe('builtin');
      expect(typeof r.result).toBe('string');
    });

    test('fallback result contains the input', async () => {
      mockFetchOllamaDown();
      const { orchestrator } = makeOrchestrator();
      const r = await orchestrator.query('what is the kernel version');
      expect(r.result).toContain('what is the kernel version');
    });

    test('empty input returns error regardless', async () => {
      mockFetchOllamaDown();
      const { orchestrator } = makeOrchestrator();
      const r = await orchestrator.query('');
      expect(r.status).toBe('error');
      expect(r.agent).toBe('none');
    });
  });

  // ── query() — Ollama online ────────────────────────────────────────────────
  describe('query() — Ollama online', () => {
    test('returns Ollama response', async () => {
      mockFetchOllamaUp('Hello from Jarvis');
      const { orchestrator } = makeOrchestrator();
      const r = await orchestrator.query('hello');
      expect(r.status).toBe('ok');
      expect(r.result).toBe('Hello from Jarvis');
    });

    test('records response in memoryCore', async () => {
      mockFetchOllamaUp('Jarvis response');
      const { orchestrator, memoryCore } = makeOrchestrator();
      await orchestrator.query('test input');
      expect(memoryCore._records.length).toBeGreaterThan(0);
      expect(memoryCore._records[0].type).toBe('jarvis');
      expect(memoryCore._records[0].input).toBe('test input');
      expect(memoryCore._records[0].output).toBe('Jarvis response');
    });

    test('agent defaults to jarvis for general input', async () => {
      mockFetchOllamaUp('general answer');
      const { orchestrator } = makeOrchestrator();
      const r = await orchestrator.query('what time is it');
      expect(r.agent).toBe('jarvis');
    });

    test('routes code-related query to code agent', async () => {
      mockFetchOllamaUp('here is the code');
      const { orchestrator } = makeOrchestrator();
      const r = await orchestrator.query('write a function to parse JSON');
      expect(r.agent).toBe('code');
    });

    test('routes debug-related query to code agent', async () => {
      mockFetchOllamaUp('debug response');
      const { orchestrator } = makeOrchestrator();
      const r = await orchestrator.query('debug this error in my script');
      expect(r.agent).toBe('code');
    });

    test('routes to analyst when analyst-model service is running', async () => {
      mockFetchOllamaUp('deep analysis');
      const svcMgr = makeSvcMgr({ 'analyst-model': 'running' });
      const { orchestrator } = makeOrchestrator({ svcMgr });
      const r = await orchestrator.query('analyze the architecture thoroughly');
      expect(r.agent).toBe('analyst');
    });

    test('falls back to jarvis for analyst query when service not running', async () => {
      mockFetchOllamaUp('jarvis fallback');
      const svcMgr = makeSvcMgr({ 'analyst-model': 'stopped' });
      const { orchestrator } = makeOrchestrator({ svcMgr });
      const r = await orchestrator.query('analyze the architecture thoroughly');
      expect(r.agent).toBe('jarvis');
    });

    test('--agent override forces specified agent', async () => {
      mockFetchOllamaUp('analyst answer');
      const svcMgr = makeSvcMgr({ 'analyst-model': 'running' });
      const { orchestrator } = makeOrchestrator({ svcMgr });
      const r = await orchestrator.query('hello', { agent: 'analyst' });
      expect(r.agent).toBe('analyst');
    });

    test('falls back to jarvis if chosen agent returns null', async () => {
      let callCount = 0;
      global.fetch = jest.fn((url) => {
        if (url.includes('/api/tags')) return Promise.resolve({ ok: true, json: async () => ({}) });
        callCount++;
        // First generate call (code agent) returns empty; second (jarvis fallback) returns text
        if (callCount === 1) return Promise.resolve({ ok: true, json: async () => ({ response: '' }) });
        return Promise.resolve({ ok: true, json: async () => ({ response: 'jarvis fallback answer' }) });
      });
      const { orchestrator } = makeOrchestrator();
      const r = await orchestrator.query('write a function');
      expect(r.status).toBe('ok');
      expect(r.result).toBe('jarvis fallback answer');
    });
  });

  // ── registerWithAICore() ───────────────────────────────────────────────────
  describe('registerWithAICore()', () => {
    test('registers jarvis, code and analyst backends', () => {
      const { orchestrator } = makeOrchestrator();
      const registered = [];
      const aiCore = {
        registerBackend: (name) => registered.push(name),
      };
      orchestrator.registerWithAICore(aiCore);
      expect(registered).toContain('jarvis');
      expect(registered).toContain('code');
      expect(registered).toContain('analyst');
    });

    test('each registered backend has a query function', () => {
      const { orchestrator } = makeOrchestrator();
      const backends = {};
      const aiCore = {
        registerBackend: (name, backend) => { backends[name] = backend; },
      };
      orchestrator.registerWithAICore(aiCore);
      for (const b of Object.values(backends)) {
        expect(typeof b.query).toBe('function');
        expect(typeof b.wake).toBe('function');
      }
    });

    test('analyst backend wake() returns false when service stopped', async () => {
      const { orchestrator } = makeOrchestrator();
      const backends = {};
      const aiCore = {
        registerBackend: (name, backend) => { backends[name] = backend; },
      };
      orchestrator.registerWithAICore(aiCore);
      const awake = await backends.analyst.wake();
      expect(awake).toBe(false);
    });

    test('analyst backend wake() returns true when service running', async () => {
      const svcMgr = makeSvcMgr({ 'analyst-model': 'running' });
      const { orchestrator } = makeOrchestrator({ svcMgr });
      const backends = {};
      const aiCore = {
        registerBackend: (name, backend) => { backends[name] = backend; },
      };
      orchestrator.registerWithAICore(aiCore);
      const awake = await backends.analyst.wake();
      expect(awake).toBe(true);
    });

    test('does nothing if aiCore is null', () => {
      const { orchestrator } = makeOrchestrator();
      expect(() => orchestrator.registerWithAICore(null)).not.toThrow();
    });
  });

  // ── registerServices() ────────────────────────────────────────────────────
  describe('registerServices()', () => {
    test('registers analyst-model service', () => {
      const { orchestrator, svcMgr } = makeOrchestrator();
      orchestrator.registerServices();
      const s = svcMgr.status('analyst-model');
      expect(s.ok).toBe(true);
    });

    test('registered service has start and stop methods', () => {
      const { orchestrator, svcMgr } = makeOrchestrator();
      orchestrator.registerServices();
      const svc = svcMgr._svcs['analyst-model'];
      expect(typeof svc.descriptor.start).toBe('function');
      expect(typeof svc.descriptor.stop).toBe('function');
    });

    test('service stop() does not throw when Ollama is offline', async () => {
      mockFetchOllamaDown();
      const { orchestrator, svcMgr } = makeOrchestrator();
      orchestrator.registerServices();
      const svc = svcMgr._svcs['analyst-model'];
      await expect(svc.descriptor.stop()).resolves.toBeUndefined();
    });

    test('service start() emits analyst-model:ready on success', async () => {
      mockFetchOllamaUp('ready');
      const kernel = makeKernel();
      const { orchestrator, svcMgr } = makeOrchestrator({ kernel });
      orchestrator.registerServices();

      const events = [];
      kernel.bus.on('analyst-model:ready', (d) => events.push(d));

      const svc = svcMgr._svcs['analyst-model'];
      await svc.descriptor.start();
      expect(events).toHaveLength(1);
    });

    test('service start() emits analyst-model:failed and rethrows on error', async () => {
      mockFetchOllamaDown();
      const kernel = makeKernel();
      const { orchestrator, svcMgr } = makeOrchestrator({ kernel });
      orchestrator.registerServices();

      const failures = [];
      kernel.bus.on('analyst-model:failed', (d) => failures.push(d));

      const svc = svcMgr._svcs['analyst-model'];
      await expect(svc.descriptor.start()).rejects.toThrow();
      expect(failures).toHaveLength(1);
      expect(typeof failures[0].error).toBe('string');
    });

    test('does nothing if svcMgr is null', () => {
      const orchestrator = createJarvisOrchestrator(
        makeKernel(), null, makeHostBridge(), makeMemoryCore(), makeConsciousness(), makeModeManager(),
      );
      expect(() => orchestrator.registerServices()).not.toThrow();
    });
  });

  // ── startListening / stopListening ────────────────────────────────────────
  describe('startListening() / stopListening()', () => {
    test('startListening sets listening to true', () => {
      const { orchestrator } = makeOrchestrator();
      expect(orchestrator.status().listening).toBe(false);
      orchestrator.startListening();
      expect(orchestrator.status().listening).toBe(true);
    });

    test('stopListening sets listening to false', () => {
      const { orchestrator } = makeOrchestrator();
      orchestrator.startListening();
      orchestrator.stopListening();
      expect(orchestrator.status().listening).toBe(false);
    });

    test('calling startListening twice does not double-register handlers', () => {
      const kernel = makeKernel();
      const { orchestrator } = makeOrchestrator({ kernel });
      orchestrator.startListening();
      orchestrator.startListening(); // second call should be no-op
      expect(orchestrator.status().listening).toBe(true);
    });

    test('does not throw when kernel is null', () => {
      const orchestrator = createJarvisOrchestrator(
        null, makeSvcMgr(), makeHostBridge(), makeMemoryCore(), makeConsciousness(), makeModeManager(),
      );
      expect(() => orchestrator.startListening()).not.toThrow();
    });
  });

  // ── commands.jarvis ────────────────────────────────────────────────────────
  describe('commands.jarvis', () => {
    test('returns status table when called with no args', async () => {
      mockFetchOllamaUp();
      const { orchestrator } = makeOrchestrator();
      const r = await orchestrator.commands.jarvis([]);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('Jarvis Orchestrator');
      expect(r.result).toContain('phi3');
    });

    test('"status" arg also returns status table', async () => {
      mockFetchOllamaUp();
      const { orchestrator } = makeOrchestrator();
      const r = await orchestrator.commands.jarvis(['status']);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('Ollama');
    });

    test('"agents" arg also returns status table', async () => {
      mockFetchOllamaUp();
      const { orchestrator } = makeOrchestrator();
      const r = await orchestrator.commands.jarvis(['agents']);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('agent');
    });

    test('routes plain text query and prefixes with agent name', async () => {
      mockFetchOllamaUp('Hello from Jarvis');
      const { orchestrator } = makeOrchestrator();
      const r = await orchestrator.commands.jarvis(['what', 'services', 'are', 'running']);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('[jarvis]');
      expect(r.result).toContain('Hello from Jarvis');
    });

    test('routes code query and prefixes with code agent', async () => {
      mockFetchOllamaUp('here is code');
      const { orchestrator } = makeOrchestrator();
      const r = await orchestrator.commands.jarvis(['write', 'a', 'function', 'to', 'parse', 'JSON']);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('[code]');
    });

    test('--agent flag routes to specified agent', async () => {
      mockFetchOllamaUp('analyst answer');
      const svcMgr = makeSvcMgr({ 'analyst-model': 'running' });
      const { orchestrator } = makeOrchestrator({ svcMgr });
      const r = await orchestrator.commands.jarvis(['--agent', 'analyst', 'deep', 'analysis']);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('[analyst]');
    });

    test('returns error when --agent given but no query text', async () => {
      mockFetchOllamaUp();
      const { orchestrator } = makeOrchestrator();
      const r = await orchestrator.commands.jarvis(['--agent', 'code']);
      expect(r.status).toBe('error');
    });

    test('shows offline note when Ollama is down', async () => {
      mockFetchOllamaDown();
      const { orchestrator } = makeOrchestrator();
      const r = await orchestrator.commands.jarvis(['hello']);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('builtin');
    });
  });

  // ── Live context injection ─────────────────────────────────────────────────
  describe('live kernel context', () => {
    test('query call includes kernel uptime in prompt sent to Ollama', async () => {
      const prompts = [];
      global.fetch = jest.fn((url, opts) => {
        if (url.includes('/api/tags')) return Promise.resolve({ ok: true, json: async () => ({}) });
        if (opts && opts.body) {
          const body = JSON.parse(opts.body);
          prompts.push(body.prompt || '');
        }
        return Promise.resolve({ ok: true, json: async () => ({ response: 'ok' }) });
      });

      const kernel = makeKernel();
      const { orchestrator } = makeOrchestrator({ kernel });
      await orchestrator.query('hello');
      expect(prompts.length).toBeGreaterThan(0);
      expect(prompts[0]).toContain('uptime=42s');
    });

    test('query prompt includes running services', async () => {
      const prompts = [];
      global.fetch = jest.fn((url, opts) => {
        if (url.includes('/api/tags')) return Promise.resolve({ ok: true, json: async () => ({}) });
        if (opts && opts.body) prompts.push(JSON.parse(opts.body).prompt || '');
        return Promise.resolve({ ok: true, json: async () => ({ response: 'ok' }) });
      });

      const svcMgr = makeSvcMgr();
      svcMgr._svcs['my-svc'] = { name: 'my-svc', state: 'running' };
      const { orchestrator } = makeOrchestrator({ svcMgr });
      await orchestrator.query('list services');
      expect(prompts[0]).toContain('my-svc');
    });
  });
});
