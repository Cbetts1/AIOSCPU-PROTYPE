'use strict';

/**
 * tests/remote-mesh.test.js — AI Mesh unit tests
 *
 * Uses a mocked global fetch so no real Ollama server is needed.
 */

const { createKernel }     = require('../core/kernel');
const { createRemoteMesh } = require('../core/remote-mesh');
const { createAICore }     = require('../core/ai-core');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeKernel() {
  const k = createKernel();
  k.boot();
  return k;
}

/** A minimal llama.cpp /v1/models response listing the given model IDs. */
function tagsResponse(modelNames) {
  return {
    ok:   true,
    json: async () => ({ data: modelNames.map(n => ({ id: n })) }),
  };
}

/** A successful llama.cpp /v1/chat/completions response returning the given text. */
function chatResponse(text) {
  return {
    ok:   true,
    json: async () => ({ choices: [{ message: { content: text } }] }),
  };
}

/** A failed HTTP response (non-2xx). */
function httpError(status = 503) {
  return { ok: false, status };
}

// ---------------------------------------------------------------------------
// Mock global fetch before each test; restore after
// ---------------------------------------------------------------------------
beforeEach(() => {
  global.fetch = jest.fn();
});

afterEach(() => {
  delete global.fetch;
  jest.clearAllMocks();
});

// ---------------------------------------------------------------------------
describe('RemoteMesh', () => {
  let kernel;

  beforeEach(() => { kernel = makeKernel(); });
  afterEach(() => { kernel.shutdown(); });

  // ── API shape ────────────────────────────────────────────────────────────
  describe('createRemoteMesh', () => {
    test('returns mesh with expected API surface', () => {
      const mesh = createRemoteMesh(kernel, null);
      expect(mesh.name).toBe('remote-mesh');
      expect(typeof mesh.version).toBe('string');
      expect(typeof mesh.query).toBe('function');
      expect(typeof mesh.registerWithAICore).toBe('function');
      expect(typeof mesh.setMemoryCore).toBe('function');
      expect(typeof mesh.status).toBe('function');
      expect(typeof mesh.commands).toBe('object');
      expect(typeof mesh.commands.mesh).toBe('function');
    });

    test('works without a kernel (null kernel)', () => {
      expect(() => createRemoteMesh(null, null)).not.toThrow();
    });

    test('LLAMA_HOST defaults to localhost:8080', () => {
      const mesh = createRemoteMesh(kernel, null);
      expect(mesh.status().llamaHost).toMatch(/127\.0\.0\.1:8080/);
    });

    test('LLAMA_HOST respects LLAMA_HOST env var', () => {
      const original = process.env.LLAMA_HOST;
      process.env.LLAMA_HOST = 'http://192.168.1.50:8080';
      const mesh = createRemoteMesh(kernel, null);
      expect(mesh.status().llamaHost).toBe('http://192.168.1.50:8080');
      if (original === undefined) delete process.env.LLAMA_HOST;
      else process.env.LLAMA_HOST = original;
    });
  });

  // ── status() ─────────────────────────────────────────────────────────────
  describe('status()', () => {
    test('returns 7 agents', () => {
      const s = createRemoteMesh(kernel, null).status();
      expect(s.agents.length).toBe(7);
    });

    test('all required agent names present', () => {
      const names = createRemoteMesh(kernel, null).status().agents.map(a => a.name);
      ['speed', 'chat', 'logic', 'reason', 'code', 'mind', 'write'].forEach(n => {
        expect(names).toContain(n);
      });
    });

    test('all agents start unavailable (no discovery yet)', () => {
      const s = createRemoteMesh(kernel, null).status();
      s.agents.forEach(a => expect(a.available).toBe(false));
    });
  });

  // ── registerWithAICore ────────────────────────────────────────────────────
  describe('registerWithAICore', () => {
    test('registers remote-mesh backend without throwing', () => {
      const ai   = createAICore(kernel, null, null, null, null);
      const mesh = createRemoteMesh(kernel, null);
      expect(() => mesh.registerWithAICore(ai)).not.toThrow();
    });

    test('ai status output lists remote-mesh after registration', async () => {
      const ai   = createAICore(kernel, null, null, null, null);
      const mesh = createRemoteMesh(kernel, null);
      mesh.registerWithAICore(ai);
      const r = await ai.process('ai status');
      expect(r.status).toBe('ok');
      expect(r.result).toMatch(/remote-mesh/);
    });
  });

  // ── setMemoryCore ─────────────────────────────────────────────────────────
  describe('setMemoryCore', () => {
    test('setMemoryCore does not throw', () => {
      const mesh = createRemoteMesh(kernel, null);
      expect(() => mesh.setMemoryCore({ record: jest.fn() })).not.toThrow();
    });
  });

  // ── mesh commands ─────────────────────────────────────────────────────────
  describe('commands.mesh', () => {
    test('mesh help returns help text mentioning 7 open-source models', async () => {
      const mesh = createRemoteMesh(kernel, null);
      const r = await mesh.commands.mesh(['help']);
      expect(r.status).toBe('ok');
      expect(r.result).toMatch(/7 open-source/i);
    });

    test('mesh help lists all 7 agents', async () => {
      const mesh = createRemoteMesh(kernel, null);
      const r = await mesh.commands.mesh(['help']);
      ['speed', 'chat', 'logic', 'reason', 'code', 'mind', 'write'].forEach(name => {
        expect(r.result).toContain(name);
      });
    });

    test('mesh help mentions LLAMA_HOST', async () => {
      const mesh = createRemoteMesh(kernel, null);
      const r = await mesh.commands.mesh(['help']);
      expect(r.result).toMatch(/LLAMA_HOST/);
    });

    test('mesh status shows 0/7 when llama.cpp is offline', async () => {
      fetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const mesh = createRemoteMesh(kernel, null);
      const r = await mesh.commands.mesh(['status']);
      expect(r.status).toBe('ok');
      expect(r.result).toMatch(/0\/7 agents online/);
    });

    test('mesh status shows 3/7 when 3 models are installed', async () => {
      fetch.mockResolvedValueOnce(
        tagsResponse(['qwen2:0.5b', 'tinyllama:latest', 'phi3:latest']),
      );
      const mesh = createRemoteMesh(kernel, null);
      const r = await mesh.commands.mesh(['status']);
      expect(r.status).toBe('ok');
      expect(r.result).toMatch(/3\/7 agents online/);
    });

    test('mesh status shows 7/7 when all models are installed', async () => {
      fetch.mockResolvedValueOnce(tagsResponse([
        'qwen2:0.5b', 'tinyllama', 'gemma:2b',
        'phi3', 'deepseek-coder:6.7b', 'llama3', 'mistral',
      ]));
      const mesh = createRemoteMesh(kernel, null);
      const r = await mesh.commands.mesh(['status']);
      expect(r.status).toBe('ok');
      expect(r.result).toMatch(/7\/7 agents online/);
    });

    test('mesh status shows llamaHost URL', async () => {
      fetch.mockRejectedValueOnce(new Error('offline'));
      const mesh = createRemoteMesh(kernel, null);
      const r = await mesh.commands.mesh(['status']);
      expect(r.result).toMatch(/127\.0\.0\.1:8080/);
    });

    test('mesh refresh re-discovers and reports count', async () => {
      // First discovery via status: offline
      fetch.mockRejectedValueOnce(new Error('offline'));
      const mesh = createRemoteMesh(kernel, null);
      await mesh.commands.mesh(['status']); // sets discoveryDone

      // Now refresh with 1 model available
      fetch.mockResolvedValueOnce(tagsResponse(['qwen2:0.5b']));
      const r = await mesh.commands.mesh(['refresh']);
      expect(r.status).toBe('ok');
      expect(r.result).toMatch(/1\/7 agents online/);
    });

    test('mesh with no args shows status', async () => {
      fetch.mockRejectedValueOnce(new Error('offline'));
      const mesh = createRemoteMesh(kernel, null);
      const r = await mesh.commands.mesh([]);
      expect(r.status).toBe('ok');
      expect(r.result).toMatch(/agents online/);
    });

    test('unknown mesh subcommand returns error', async () => {
      const mesh = createRemoteMesh(kernel, null);
      const r = await mesh.commands.mesh(['unknowncmd']);
      expect(r.status).toBe('error');
      expect(r.result).toMatch(/Unknown mesh command/);
    });
  });

  // ── query() ──────────────────────────────────────────────────────────────
  describe('query()', () => {
    test('throws descriptive error when no agents available (Ollama offline)', async () => {
      fetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const mesh = createRemoteMesh(kernel, null);
      await expect(mesh.query('hello')).rejects.toThrow(/No mesh agents available/);
    });

    test('routes code query to code agent (deepseek-coder)', async () => {
      fetch
        .mockResolvedValueOnce(tagsResponse(['qwen2:0.5b', 'deepseek-coder:6.7b'])) // discovery
        .mockResolvedValueOnce(chatResponse('Here is the sorted array function...')); // code agent

      const mesh = createRemoteMesh(kernel, null);
      const result = await mesh.query('write a function to sort an array');
      expect(result).toBe('Here is the sorted array function...');

      // Confirm the chat call used deepseek-coder model
      const chatCall = fetch.mock.calls[1];
      const body = JSON.parse(chatCall[1].body);
      expect(body.model).toBe('deepseek-coder:6.7b');
    });

    test('routes "quick what is" query to speed agent (qwen2:0.5b)', async () => {
      fetch
        .mockResolvedValueOnce(tagsResponse(['qwen2:0.5b']))
        .mockResolvedValueOnce(chatResponse('Node.js is a JavaScript runtime.'));

      const mesh = createRemoteMesh(kernel, null);
      const result = await mesh.query('quick what is node.js');
      expect(result).toBe('Node.js is a JavaScript runtime.');

      const body = JSON.parse(fetch.mock.calls[1][1].body);
      expect(body.model).toBe('qwen2:0.5b');
    });

    test('falls back to next agent when primary fails', async () => {
      fetch
        .mockResolvedValueOnce(tagsResponse(['qwen2:0.5b', 'tinyllama']))
        .mockResolvedValueOnce(httpError())                         // speed agent fails
        .mockResolvedValueOnce(chatResponse('fallback from chat')); // chat agent succeeds

      const mesh = createRemoteMesh(kernel, null);
      const result = await mesh.query('quick question');
      expect(result).toBe('fallback from chat');
    });

    test('throws when all agents fail', async () => {
      fetch
        .mockResolvedValueOnce(tagsResponse(['qwen2:0.5b']))
        .mockResolvedValueOnce(httpError(503)); // only agent fails

      const mesh = createRemoteMesh(kernel, null);
      await expect(mesh.query('hello')).rejects.toThrow(/All mesh agents failed/);
    });

    test('records to memoryCore on success', async () => {
      const mc = { record: jest.fn() };
      fetch
        .mockResolvedValueOnce(tagsResponse(['qwen2:0.5b']))
        .mockResolvedValueOnce(chatResponse('memory recorded'));

      const mesh = createRemoteMesh(kernel, mc);
      await mesh.query('remember this');
      expect(mc.record).toHaveBeenCalledWith('mesh', 'remember this', 'memory recorded', null);
    });

    test('memoryCore wired via setMemoryCore is also called', async () => {
      const mc = { record: jest.fn() };
      fetch
        .mockResolvedValueOnce(tagsResponse(['qwen2:0.5b']))
        .mockResolvedValueOnce(chatResponse('wired response'));

      const mesh = createRemoteMesh(kernel, null);
      mesh.setMemoryCore(mc);
      await mesh.query('test wiring');
      expect(mc.record).toHaveBeenCalledWith('mesh', 'test wiring', 'wired response', null);
    });

    test('emits mesh:query event on kernel bus', async () => {
      const events = [];
      kernel.bus.on('mesh:query', e => events.push(e));

      fetch
        .mockResolvedValueOnce(tagsResponse(['qwen2:0.5b']))
        .mockResolvedValueOnce(chatResponse('event test'));

      const mesh = createRemoteMesh(kernel, null);
      await mesh.query('hello');
      expect(events.length).toBe(1);
      expect(events[0].agent).toBeDefined();
    });

    test('does not hammer Ollama: discovery only happens once without refresh', async () => {
      // Two queries → only one discovery call
      fetch
        .mockResolvedValueOnce(tagsResponse(['qwen2:0.5b']))   // discovery
        .mockResolvedValueOnce(chatResponse('first'))          // query 1
        .mockResolvedValueOnce(chatResponse('second'));         // query 2

      const mesh = createRemoteMesh(kernel, null);
      await mesh.query('first query');
      await mesh.query('second query');

      // fetch called 3 times total: 1 discovery + 2 chat
      expect(fetch).toHaveBeenCalledTimes(3);
    });

    test('handles complex long query with fan-out (first success wins)', async () => {
      // All 3 fan-out agents available: reason(phi3), mind(llama3), write(mistral)
      fetch
        .mockResolvedValueOnce(tagsResponse(['phi3', 'llama3', 'mistral']))
        .mockResolvedValueOnce(chatResponse('deep analysis result')); // first fan-out wins

      const mesh = createRemoteMesh(kernel, null);
      // Trigger complex path: >200 chars
      const longPrompt = 'complex full analysis: ' + 'x'.repeat(200);
      const result = await mesh.query(longPrompt);
      expect(result).toBe('deep analysis result');
    });
  });

  // ── circuit breaker ───────────────────────────────────────────────────────
  describe('circuit breaker', () => {
    test('agent trips after 3 failures and is skipped on next query', async () => {
      // Available: only qwen2:0.5b
      // Fail it 3 times to trip the breaker
      fetch
        .mockResolvedValueOnce(tagsResponse(['qwen2:0.5b']))
        .mockResolvedValueOnce(httpError()) // fail 1
        .mockResolvedValueOnce(httpError()) // fail 2
        .mockResolvedValueOnce(httpError()); // fail 3

      const mesh = createRemoteMesh(kernel, null);
      // Three failing queries to trip the breaker
      await expect(mesh.query('q1')).rejects.toThrow();
      // Reset discoveryDone so 2nd query skips re-discovery but uses cached agents
      fetch.mockResolvedValueOnce(httpError()); // fail 2nd query attempt
      await expect(mesh.query('q2')).rejects.toThrow();
      fetch.mockResolvedValueOnce(httpError()); // fail 3rd
      await expect(mesh.query('q3')).rejects.toThrow();

      // After 3 failures the agent is tripped — status reflects this
      const s = mesh.status();
      const speedAgent = s.agents.find(a => a.name === 'speed');
      expect(speedAgent.tripped).toBe(true);
    });
  });

  // ── queryAll() ───────────────────────────────────────────────────────────
  describe('queryAll()', () => {
    test('returns null when no agents available', async () => {
      fetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const mesh = createRemoteMesh(kernel, null);
      const result = await mesh.queryAll('hello');
      expect(result).toBeNull();
    });

    test('queries all available agents in parallel and returns combined response', async () => {
      fetch
        .mockResolvedValueOnce(tagsResponse(['qwen2:0.5b', 'phi3', 'mistral']))
        .mockResolvedValueOnce(chatResponse('qwen2 says hi'))
        .mockResolvedValueOnce(chatResponse('phi3 deep analysis'))
        .mockResolvedValueOnce(chatResponse('mistral writes well'));

      const mesh   = createRemoteMesh(kernel, null);
      const result = await mesh.queryAll('explain everything');
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    test('returns first successful response when some agents fail', async () => {
      fetch
        .mockResolvedValueOnce(tagsResponse(['qwen2:0.5b', 'phi3']))
        .mockResolvedValueOnce(httpError())                       // speed fails
        .mockResolvedValueOnce(chatResponse('phi3 succeeded'));   // reason succeeds

      const mesh   = createRemoteMesh(kernel, null);
      const result = await mesh.queryAll('question');
      expect(result).toBeDefined();
      expect(result).not.toBeNull();
    });

    test('returns null when all agents fail', async () => {
      fetch
        .mockResolvedValueOnce(tagsResponse(['qwen2:0.5b']))
        .mockResolvedValueOnce(httpError());

      const mesh   = createRemoteMesh(kernel, null);
      const result = await mesh.queryAll('fail all');
      expect(result).toBeNull();
    });

    test('emits mesh:query-all event on kernel bus', async () => {
      const events = [];
      kernel.bus.on('mesh:query-all', e => events.push(e));

      fetch
        .mockResolvedValueOnce(tagsResponse(['qwen2:0.5b']))
        .mockResolvedValueOnce(chatResponse('answer'));

      const mesh = createRemoteMesh(kernel, null);
      await mesh.queryAll('emit test');
      expect(events.length).toBe(1);
      expect(events[0]).toHaveProperty('count');
    });

    test('contributes to collective intelligence when wired', async () => {
      const ci = { contribute: jest.fn(), context: jest.fn(() => ''), synthesize: jest.fn(ps => ps[0].response) };
      fetch
        .mockResolvedValueOnce(tagsResponse(['qwen2:0.5b']))
        .mockResolvedValueOnce(chatResponse('collective answer'));

      const mesh = createRemoteMesh(kernel, null, ci);
      await mesh.queryAll('collective test');
      expect(ci.contribute).toHaveBeenCalledWith('speed', 'collective test', 'collective answer');
    });

    test('records to memoryCore on success', async () => {
      const mc = { record: jest.fn() };
      fetch
        .mockResolvedValueOnce(tagsResponse(['qwen2:0.5b']))
        .mockResolvedValueOnce(chatResponse('recorded'));

      const mesh = createRemoteMesh(kernel, mc);
      await mesh.queryAll('record test');
      expect(mc.record).toHaveBeenCalledWith('mesh:all', 'record test', expect.any(String), null);
    });
  });

  // ── setCollectiveIntelligence() ───────────────────────────────────────────
  describe('setCollectiveIntelligence()', () => {
    test('does not throw', () => {
      const mesh = createRemoteMesh(kernel, null);
      expect(() => mesh.setCollectiveIntelligence({ contribute: jest.fn(), context: jest.fn(() => ''), synthesize: jest.fn() })).not.toThrow();
    });

    test('collective context is injected into query prompt after wiring', async () => {
      const capturedBodies = [];
      fetch.mockImplementation((url, opts) => {
        if (url.includes('/v1/models')) return Promise.resolve(tagsResponse(['qwen2:0.5b']));
        if (opts && opts.body) capturedBodies.push(JSON.parse(opts.body));
        return Promise.resolve(chatResponse('with context'));
      });

      const ci = {
        contribute: jest.fn(),
        context:    jest.fn(() => '[Collective Intelligence — relevant prior knowledge:]\n  [reason] Previous insight.\n[End of collective context]'),
        synthesize: jest.fn(ps => ps[0] && ps[0].response),
      };
      const mesh = createRemoteMesh(kernel, null, ci);
      await mesh.query('hello');

      // The system message in the chat call should contain the collective context
      const chatBody  = capturedBodies.find(b => b.messages);
      const systemMsg = chatBody && chatBody.messages.find(m => m.role === 'system');
      expect(systemMsg).toBeDefined();
      expect(systemMsg.content).toMatch(/Collective Intelligence/);
    });

    test('contribute() is called after successful query', async () => {
      const ci = { contribute: jest.fn(), context: jest.fn(() => ''), synthesize: jest.fn() };
      fetch
        .mockResolvedValueOnce(tagsResponse(['qwen2:0.5b']))
        .mockResolvedValueOnce(chatResponse('contributed'));

      const mesh = createRemoteMesh(kernel, null, ci);
      await mesh.query('test contribute');
      expect(ci.contribute).toHaveBeenCalledWith('speed', 'test contribute', 'contributed');
    });
  });

  // ── setFilesystem() ───────────────────────────────────────────────────────
  describe('setFilesystem()', () => {
    test('does not throw', () => {
      const mesh = createRemoteMesh(kernel, null);
      expect(() => mesh.setFilesystem({ read: jest.fn(), write: jest.fn(), mkdir: jest.fn() })).not.toThrow();
    });

    test('mesh API includes setFilesystem', () => {
      const mesh = createRemoteMesh(kernel, null);
      expect(typeof mesh.setFilesystem).toBe('function');
    });
  });
});
