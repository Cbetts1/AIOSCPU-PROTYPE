'use strict';
/**
 * tests/aios-aura.test.js
 * Full Jest test suite for core/aios-aura.js  v2.0.0
 *
 * All Ollama fetch calls are mocked — no real network, no real AI.
 * Kernel is booted standalone — proves the kernel stands on its own.
 */

const { createAIOSAURA } = require('../core/aios-aura.js');

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------
function makeKernel() {
  const _h = {};
  return {
    id: 'test-kernel', version: '1.0.0', uptime: () => 99,
    bus: {
      on:   (ev, fn) => { _h[ev] = fn; },
      emit: (ev, d)  => { if (_h[ev]) _h[ev](d); },
      _handlers: _h,
    },
  };
}

function makeSvcMgr(states = {}) {
  const _svcs = {};
  return {
    register: (name, def) => { _svcs[name] = { name, state: 'stopped', def }; },
    status:   (name) => {
      if (states[name]) return { ok: true, name, state: states[name] };
      if (_svcs[name])  return { ok: true, name, state: _svcs[name].state };
      return { ok: false, error: `No service: ${name}` };
    },
    list:      () => Object.values(_svcs).map(s => ({ name: s.name, state: s.state })),
    _setState: (n, st) => { if (_svcs[n]) _svcs[n].state = st; },
    _svcs,
  };
}

function makeHostBridge() {
  return {
    memInfo:  () => ({ ok: true, usedMB: 512, totalMB: 4096 }),
    platform: { name: 'android-termux' },
  };
}

function makeMemoryCore() {
  const _records = [];
  return {
    record:    (type, i, o, e) => _records.push({ type, input: i, output: o, err: e }),
    getStats:  () => ({ entries: _records.length, patterns: 0 }),
    _records,
  };
}

function makeConsciousness() {
  return {
    query:      async (input) => ({ status: 'ok', result: `builtin:${input}`, model: 'builtin' }),
    getContext: () => ({ mode: 'chat', memory: {}, models: [{ name: 'builtin', healthy: true }] }),
  };
}

function makeModeManager() {
  return { getMode: () => 'chat' };
}

// ---------------------------------------------------------------------------
// Fetch mock builders
// ---------------------------------------------------------------------------
function mockBackendOnline(models, chatReply) {
  global.fetch = jest.fn((url, opts) => {
    if (url.includes('/v1/models')) {
      // Accept both {id} (llama.cpp format) and legacy {name} (Ollama format)
      const data = (models || []).map(m => ({ id: m.id || m.name || '' }));
      return Promise.resolve({ ok: true, json: async () => ({ data }) });
    }
    if (url.includes('/v1/chat/completions')) {
      const body = opts && opts.body ? JSON.parse(opts.body) : {};
      const reply = typeof chatReply === 'function' ? chatReply(body) : (chatReply || 'AIOS response');
      return Promise.resolve({ ok: true, json: async () => ({ choices: [{ message: { role: 'assistant', content: reply } }] }) });
    }
    if (url.includes('/completion')) {
      return Promise.resolve({ ok: true, json: async () => ({ content: 'ok' }) });
    }
    return Promise.resolve({ ok: false, json: async () => ({}) });
  });
}

// Keep legacy alias so any test that still calls mockOllamaOnline works
const mockOllamaOnline = mockBackendOnline;

function mockOllamaOffline() {
  global.fetch = jest.fn(() => Promise.reject(new Error('ECONNREFUSED')));
}

// ---------------------------------------------------------------------------
// Factory helper
// ---------------------------------------------------------------------------
function make(overrides = {}) {
  const kernel       = overrides.kernel       || makeKernel();
  const svcMgr       = overrides.svcMgr       || makeSvcMgr();
  const hostBridge   = overrides.hostBridge   || makeHostBridge();
  const memoryCore   = overrides.memoryCore   || makeMemoryCore();
  const consciousness= overrides.consciousness|| makeConsciousness();
  const modeManager  = overrides.modeManager  || makeModeManager();
  const ai = createAIOSAURA(kernel, svcMgr, hostBridge, memoryCore, consciousness, modeManager);
  return { ai, kernel, svcMgr, hostBridge, memoryCore, consciousness };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
afterEach(() => {
  jest.restoreAllMocks();
  delete global.fetch;
});

// ── Module shape ─────────────────────────────────────────────────────────────
describe('module shape', () => {
  test('createAIOSAURA returns object with full public API', () => {
    const { ai } = make();
    expect(typeof ai.query).toBe('function');
    expect(typeof ai.clearHistory).toBe('function');
    expect(typeof ai.getIdentities).toBe('function');
    expect(typeof ai.status).toBe('function');
    expect(typeof ai.registerWithAICore).toBe('function');
    expect(typeof ai.registerServices).toBe('function');
    expect(typeof ai.startListening).toBe('function');
    expect(typeof ai.stopListening).toBe('function');
    expect(typeof ai.commands).toBe('object');
    expect(typeof ai.commands.aios).toBe('function');
    expect(typeof ai.commands.aura).toBe('function');
    expect(ai.name).toBe('aios-aura');
    expect(ai.version).toBe('2.0.0');
  });

  test('getIdentities returns exactly AIOS and AURA', () => {
    const { ai } = make();
    const ids = ai.getIdentities();
    expect(ids).toHaveLength(2);
    expect(ids.map(i => i.name)).toEqual(['aios', 'aura']);
    expect(ids.map(i => i.label)).toEqual(['AIOS', 'AURA']);
  });

  test('only AURA is onDemand', () => {
    const { ai } = make();
    const [aios, aura] = ai.getIdentities();
    expect(aios.onDemand).toBe(false);
    expect(aura.onDemand).toBe(true);
  });

  test('status().listening starts false', () => {
    const { ai } = make();
    expect(ai.status().listening).toBe(false);
  });
});

// ── Kernel stands alone — query works without Ollama ─────────────────────────
describe('kernel standalone (Ollama offline)', () => {
  test('returns built-in response when Ollama is offline', async () => {
    mockOllamaOffline();
    const { ai } = make();
    const r = await ai.query('hello');
    expect(r.status).toBe('ok');
    expect(typeof r.result).toBe('string');
    expect(r.result.length).toBeGreaterThan(0);
  });

  test('falls back to consciousness NLP when Ollama offline', async () => {
    mockOllamaOffline();
    const { ai } = make();
    const r = await ai.query('what is the kernel version');
    expect(r.identity).toBe('builtin');
  });

  test('returns error for empty input even offline', async () => {
    mockOllamaOffline();
    const { ai } = make();
    const r = await ai.query('');
    expect(r.status).toBe('error');
    expect(r.identity).toBe('none');
  });

  test('works with null kernel (pure standalone)', async () => {
    mockOllamaOffline();
    const ai = createAIOSAURA(null, null, null, null, makeConsciousness(), null);
    const r = await ai.query('hello');
    expect(r.status).toBe('ok');
  });

  test('commands.aios still returns a result when offline', async () => {
    mockOllamaOffline();
    const { ai } = make();
    const r = await ai.commands.aios(['hello']);
    expect(r.status).toBe('ok');
    expect(typeof r.result).toBe('string');
  });
});

// ── Model detection (phone-first) ────────────────────────────────────────────
describe('_detectModel — phone-first', () => {
  test('picks first installed model from preference list', async () => {
    mockOllamaOnline([{ name: 'phi3:latest' }, { name: 'tinyllama:latest' }]);
    const { ai } = make();
    const model = await ai._detectModel(['qwen2:0.5b', 'tinyllama', 'phi3']);
    expect(model).toBe('tinyllama');
  });

  test('picks qwen2:0.5b when available (smallest, phone-first)', async () => {
    mockOllamaOnline([{ name: 'qwen2:latest' }, { name: 'phi3:latest' }]);
    const { ai } = make();
    const model = await ai._detectModel(['qwen2:0.5b', 'tinyllama', 'phi3']);
    expect(model).toBe('qwen2:0.5b');
  });

  test('returns null when no models installed', async () => {
    mockOllamaOnline([]);
    const { ai } = make();
    const model = await ai._detectModel(['qwen2:0.5b', 'tinyllama', 'phi3']);
    expect(model).toBeNull();
  });

  test('returns null when Ollama offline', async () => {
    mockOllamaOffline();
    const { ai } = make();
    const model = await ai._detectModel(['phi3']);
    expect(model).toBeNull();
  });
});

// ── Multi-turn conversation (like Copilot / ChatGPT) ─────────────────────────
describe('multi-turn conversation', () => {
  test('sends previous conversation history with each new message', async () => {
    const messages = [];
    global.fetch = jest.fn((url, opts) => {
      if (url.includes('/v1/models'))
        return Promise.resolve({ ok: true, json: async () => ({ data: [{ id: 'phi3:latest' }] }) });
      if (url.includes('/v1/chat/completions')) {
        const body = JSON.parse(opts.body);
        messages.push(body.messages);
        return Promise.resolve({ ok: true, json: async () => ({ choices: [{ message: { role: 'assistant', content: 'reply' } }] }) });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });

    const { ai } = make();
    await ai.query('first question');
    await ai.query('second question');

    // Second call should include the first turn in history
    const secondCallMessages = messages[1];
    const roles = secondCallMessages.map(m => m.role);
    expect(roles).toContain('system');
    expect(roles).toContain('user');
    expect(roles).toContain('assistant');
    const userMsgs = secondCallMessages.filter(m => m.role === 'user').map(m => m.content);
    expect(userMsgs).toContain('first question');
    expect(userMsgs).toContain('second question');
  });

  test('clearHistory removes AIOS conversation', async () => {
    mockOllamaOnline([{ name: 'phi3:latest' }], 'response');
    const { ai } = make();
    await ai.query('remember this');
    expect(ai.getIdentities()[0].history).toBe(1);
    ai.clearHistory('aios');
    expect(ai.getIdentities()[0].history).toBe(0);
  });

  test('clearHistory with no arg clears both AIOS and AURA', async () => {
    mockOllamaOnline([{ name: 'phi3:latest' }], 'response');
    const svcMgr = makeSvcMgr({ aura: 'running' });
    const { ai } = make({ svcMgr });
    await ai.query('aios message', { identity: 'aios' });
    await ai.query('aura message',  { identity: 'aura' });
    ai.clearHistory();
    const [aios, aura] = ai.getIdentities();
    expect(aios.history).toBe(0);
    expect(aura.history).toBe(0);
  });

  test('history stays within MAX_HISTORY_TURNS (trims old turns)', async () => {
    mockOllamaOnline([{ name: 'phi3:latest' }], 'r');
    const { ai } = make();
    // 12 turns = should be trimmed to last 10
    for (let i = 0; i < 12; i++) await ai.query(`question ${i}`);
    expect(ai.getIdentities()[0].history).toBeLessThanOrEqual(10);
  });
});

// ── AIOS query (always-on) ────────────────────────────────────────────────────
describe('query — AIOS', () => {
  test('returns response from Ollama when online', async () => {
    mockOllamaOnline([{ name: 'phi3:latest' }], 'Hello, I am AIOS');
    const { ai } = make();
    const r = await ai.query('hello', { identity: 'aios' });
    expect(r.status).toBe('ok');
    expect(r.result).toBe('Hello, I am AIOS');
    expect(r.identity).toBe('aios');
  });

  test('records interaction in memoryCore with identity=aios', async () => {
    mockOllamaOnline([{ name: 'phi3:latest' }], 'answer');
    const { ai, memoryCore } = make();
    await ai.query('hello aios', { identity: 'aios' });
    expect(memoryCore._records.length).toBe(1);
    expect(memoryCore._records[0].type).toBe('aios');
    expect(memoryCore._records[0].input).toBe('hello aios');
  });

  test('sends live kernel context (uptime, memory) in system prompt', async () => {
    const prompts = [];
    global.fetch = jest.fn((url, opts) => {
      if (url.includes('/v1/models'))
        return Promise.resolve({ ok: true, json: async () => ({ data: [{ id: 'phi3:latest' }] }) });
      if (url.includes('/v1/chat/completions')) {
        const body = JSON.parse(opts.body);
        const sys = body.messages.find(m => m.role === 'system');
        if (sys) prompts.push(sys.content);
        return Promise.resolve({ ok: true, json: async () => ({ choices: [{ message: { role: 'assistant', content: 'ok' } }] }) });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });
    const { ai } = make();
    await ai.query('hello');
    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts[0]).toContain('uptime=99s');
    expect(prompts[0]).toContain('android-termux');
  });

  test('defaults to AIOS for general questions', async () => {
    mockBackendOnline([{ id: 'phi3:latest' }], 'general answer');
    const { ai } = make();
    const r = await ai.query('what time is it');
    expect(r.identity).toBe('aios');
  });
});

// ── AURA query (on-demand hardware intelligence) ─────────────────────────────
describe('query — AURA', () => {
  test('routes to AURA when service is running and query matches pattern', async () => {
    mockBackendOnline([{ id: 'phi3:latest' }], 'hardware analysis');
    const svcMgr = makeSvcMgr({ aura: 'running' });
    const { ai } = make({ svcMgr });
    const r = await ai.query('analyze the memory architecture thoroughly');
    expect(r.identity).toBe('aura');
  });

  test('falls back to AIOS if AURA query returns null', async () => {
    let callCount = 0;
    global.fetch = jest.fn((url, opts) => {
      if (url.includes('/v1/models'))
        return Promise.resolve({ ok: true, json: async () => ({ data: [{ id: 'phi3:latest' }] }) });
      if (url.includes('/v1/chat/completions')) {
        callCount++;
        const reply = callCount === 1 ? '' : 'AIOS fallback';
        return Promise.resolve({ ok: true, json: async () => ({ choices: [{ message: { role: 'assistant', content: reply } }] }) });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });
    const svcMgr = makeSvcMgr({ aura: 'running' });
    const { ai } = make({ svcMgr });
    const r = await ai.query('analyze thoroughly', { identity: 'aura' });
    expect(r.result).toBe('AIOS fallback');
  });

  test('uses AIOS when AURA service is stopped, even for analysis query', async () => {
    mockOllamaOnline([{ name: 'phi3:latest' }], 'aios handles it');
    const { ai } = make(); // aura not started
    const r = await ai.query('analyze the cpu load thoroughly');
    expect(r.identity).toBe('aios');
  });

  test('records interaction with identity=aura', async () => {
    mockOllamaOnline([{ name: 'phi3:latest' }], 'deep result');
    const svcMgr = makeSvcMgr({ aura: 'running' });
    const { ai, memoryCore } = make({ svcMgr });
    await ai.query('analyze system deeply', { identity: 'aura' });
    expect(memoryCore._records[0].type).toBe('aura');
  });
});

// ── registerWithAICore ────────────────────────────────────────────────────────
describe('registerWithAICore', () => {
  test('registers both aios and aura backends', () => {
    const { ai } = make();
    const registered = {};
    ai.registerWithAICore({ registerBackend: (n, b) => { registered[n] = b; } });
    expect(registered).toHaveProperty('aios');
    expect(registered).toHaveProperty('aura');
  });

  test('each backend has wake() and query()', () => {
    const { ai } = make();
    const backends = {};
    ai.registerWithAICore({ registerBackend: (n, b) => { backends[n] = b; } });
    for (const b of Object.values(backends)) {
      expect(typeof b.wake).toBe('function');
      expect(typeof b.query).toBe('function');
    }
  });

  test('aura wake() returns false when service stopped', async () => {
    const { ai } = make();
    const backends = {};
    ai.registerWithAICore({ registerBackend: (n, b) => { backends[n] = b; } });
    const awake = await backends.aura.wake();
    expect(awake).toBe(false);
  });

  test('aura wake() returns true when service running', async () => {
    const svcMgr = makeSvcMgr({ aura: 'running' });
    const { ai } = make({ svcMgr });
    const backends = {};
    ai.registerWithAICore({ registerBackend: (n, b) => { backends[n] = b; } });
    const awake = await backends.aura.wake();
    expect(awake).toBe(true);
  });

  test('does nothing if aiCore is null', () => {
    const { ai } = make();
    expect(() => ai.registerWithAICore(null)).not.toThrow();
  });

  test('only two backends are registered — no jarvis, no code, no analyst', () => {
    const { ai } = make();
    const names = [];
    ai.registerWithAICore({ registerBackend: (n) => names.push(n) });
    expect(names.sort()).toEqual(['aios', 'aura']);
  });
});

// ── registerServices ──────────────────────────────────────────────────────────
describe('registerServices', () => {
  test('registers the aura service', () => {
    const { ai, svcMgr } = make();
    ai.registerServices();
    const s = svcMgr.status('aura');
    expect(s.ok).toBe(true);
  });

  test('registered service name is exactly "aura" — nothing else', () => {
    const { ai, svcMgr } = make();
    ai.registerServices();
    const names = svcMgr._svcs ? Object.keys(svcMgr._svcs) : [];
    expect(names).toContain('aura');
    expect(names).not.toContain('analyst-model');
    expect(names).not.toContain('heavy-model');
    expect(names).not.toContain('jarvis');
  });

  test('aura service has start and stop methods', () => {
    const { ai, svcMgr } = make();
    ai.registerServices();
    const svc = svcMgr._svcs['aura'];
    expect(typeof svc.def.start).toBe('function');
    expect(typeof svc.def.stop).toBe('function');
  });

  test('stop() resolves without throwing when Ollama offline', async () => {
    mockOllamaOffline();
    const { ai, svcMgr } = make();
    ai.registerServices();
    await expect(svcMgr._svcs['aura'].def.stop()).resolves.toBeUndefined();
  });

  test('start() emits aura:online on success', async () => {
    mockOllamaOnline([{ name: 'phi3:latest' }]);
    const kernel = makeKernel();
    const { ai, svcMgr } = make({ kernel });
    ai.registerServices();
    const events = [];
    kernel.bus.on('aura:online', d => events.push(d));
    await svcMgr._svcs['aura'].def.start();
    expect(events).toHaveLength(1);
  });

  test('start() emits aura:failed and rethrows when no model found', async () => {
    mockOllamaOnline([]); // no models installed
    const kernel = makeKernel();
    const { ai, svcMgr } = make({ kernel });
    ai.registerServices();
    const failures = [];
    kernel.bus.on('aura:failed', d => failures.push(d));
    await expect(svcMgr._svcs['aura'].def.start()).rejects.toThrow();
    expect(failures).toHaveLength(1);
    expect(typeof failures[0].error).toBe('string');
  });

  test('does nothing if svcMgr is null', () => {
    const ai = createAIOSAURA(makeKernel(), null, null, null, makeConsciousness(), null);
    expect(() => ai.registerServices()).not.toThrow();
  });
});

// ── startListening / stopListening ────────────────────────────────────────────
describe('startListening / stopListening', () => {
  test('startListening sets listening to true', () => {
    const { ai } = make();
    ai.startListening();
    expect(ai.status().listening).toBe(true);
  });

  test('stopListening sets listening to false', () => {
    const { ai } = make();
    ai.startListening();
    ai.stopListening();
    expect(ai.status().listening).toBe(false);
  });

  test('calling startListening twice is idempotent', () => {
    const { ai } = make();
    ai.startListening();
    ai.startListening();
    expect(ai.status().listening).toBe(true);
  });

  test('does not throw when kernel is null', () => {
    const ai = createAIOSAURA(null, null, null, null, null, null);
    expect(() => ai.startListening()).not.toThrow();
    expect(() => ai.stopListening()).not.toThrow();
  });
});

// ── commands.aios ─────────────────────────────────────────────────────────────
describe('commands.aios', () => {
  test('no args returns status/help table', async () => {
    mockOllamaOnline([{ name: 'phi3:latest' }]);
    const { ai } = make();
    const r = await ai.commands.aios([]);
    expect(r.status).toBe('ok');
    expect(r.result).toContain('AIOS');
    expect(r.result).toContain('AURA');
  });

  test('"help" returns status table', async () => {
    mockOllamaOnline([{ name: 'phi3:latest' }]);
    const { ai } = make();
    const r = await ai.commands.aios(['help']);
    expect(r.status).toBe('ok');
    expect(r.result).toContain('AIOS');
  });

  test('"status" returns status table', async () => {
    mockOllamaOnline([{ name: 'phi3:latest' }]);
    const { ai } = make();
    const r = await ai.commands.aios(['status']);
    expect(r.status).toBe('ok');
    expect(r.result).toContain('llama.cpp');
  });

  test('"clear" clears AIOS history', async () => {
    mockOllamaOnline([{ name: 'phi3:latest' }], 'answer');
    const { ai } = make();
    await ai.query('something', { identity: 'aios' });
    expect(ai.getIdentities()[0].history).toBe(1);
    const r = await ai.commands.aios(['clear']);
    expect(r.status).toBe('ok');
    expect(ai.getIdentities()[0].history).toBe(0);
  });

  test('routes question to AIOS and prefixes result with [AIOS]', async () => {
    mockOllamaOnline([{ name: 'phi3:latest' }], 'Hello from kernel');
    const { ai } = make();
    const r = await ai.commands.aios(['hello', 'there']);
    expect(r.status).toBe('ok');
    expect(r.result).toContain('[AIOS]');
    expect(r.result).toContain('Hello from kernel');
  });

  test('works with string arg (not array)', async () => {
    mockOllamaOnline([{ name: 'phi3:latest' }], 'ok');
    const { ai } = make();
    const r = await ai.commands.aios('hello');
    expect(r.status).toBe('ok');
  });

  test('status table shows phone setup instructions', async () => {
    mockBackendOnline([]);
    const { ai } = make();
    const r = await ai.commands.aios([]);
    expect(r.result).toContain('llama-server');
    expect(r.result).toContain('llama3.gguf');
  });
});

// ── commands.aura ─────────────────────────────────────────────────────────────
describe('commands.aura', () => {
  test('no args returns status table', async () => {
    mockBackendOnline([{ id: 'phi3:latest' }]);
    const { ai } = make();
    const r = await ai.commands.aura([]);
    expect(r.status).toBe('ok');
    expect(r.result).toContain('AURA');
  });

  test('"clear" clears AURA history', async () => {
    mockBackendOnline([{ id: 'phi3:latest' }], 'answer');
    const svcMgr = makeSvcMgr({ aura: 'running' });
    const { ai } = make({ svcMgr });
    await ai.query('analyze', { identity: 'aura' });
    ai.clearHistory('aura');
    expect(ai.getIdentities()[1].history).toBe(0);
    const r = await ai.commands.aura(['clear']);
    expect(r.status).toBe('ok');
  });

  test('routes question to AURA when running, prefixes [AURA]', async () => {
    mockBackendOnline([{ id: 'phi3:latest' }], 'hardware report');
    const svcMgr = makeSvcMgr({ aura: 'running' });
    const { ai } = make({ svcMgr });
    const r = await ai.commands.aura(['analyze', 'memory', 'deeply']);
    expect(r.status).toBe('ok');
    expect(r.result).toContain('[AURA]');
  });

  test('prefixes [AIOS] when AURA returns empty and falls back to AIOS', async () => {
    let callCount = 0;
    global.fetch = jest.fn((url, opts) => {
      if (url.includes('/v1/models'))
        return Promise.resolve({ ok: true, json: async () => ({ data: [{ id: 'phi3:latest' }] }) });
      if (url.includes('/v1/chat/completions')) {
        callCount++;
        // First call (AURA) returns empty — forces fallback to AIOS
        const reply = callCount === 1 ? '' : 'AIOS fallback answer';
        return Promise.resolve({ ok: true, json: async () => ({ choices: [{ message: { role: 'assistant', content: reply } }] }) });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });
    const { ai } = make();
    const r = await ai.commands.aura(['hello']);
    expect(r.status).toBe('ok');
    expect(r.result).toContain('[AIOS]');
  });
});

// ── Status table content — phone setup visible ────────────────────────────────
describe('status table', () => {
  test('shows llama.cpp offline message when backend down', async () => {
    mockOllamaOffline();
    const { ai } = make();
    const r = await ai.commands.aios([]);
    expect(r.result).toContain('OFFLINE');
  });

  test('shows model name when detected', async () => {
    mockBackendOnline([{ id: 'qwen2:latest' }]);
    const { ai } = make();
    await ai._detectModel(['qwen2:0.5b', 'phi3']); // prime detection
    const r = await ai.commands.aios([]);
    expect(r.status).toBe('ok');
  });

  test('result contains no jarvis, analyst, code, heavy references', async () => {
    mockBackendOnline([{ id: 'phi3:latest' }]);
    const { ai } = make();
    const r = await ai.commands.aios([]);
    const lower = r.result.toLowerCase();
    expect(lower).not.toContain('jarvis');
    expect(lower).not.toContain('analyst');
    expect(lower).not.toContain('heavy-model');
    expect(lower).not.toContain('code agent');
  });
});
