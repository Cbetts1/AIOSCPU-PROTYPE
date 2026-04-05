'use strict';

const { createAICore }   = require('../core/ai-core');
const { createKernel }   = require('../core/kernel');
const { createFilesystem } = require('../core/filesystem');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeKernel() {
  const k = createKernel();
  k.boot();
  return k;
}

function makeFs() {
  const fs = createFilesystem();
  fs.mkdir('/var/lib/aios', { parents: true });
  return fs;
}

// ---------------------------------------------------------------------------
describe('AICore', () => {
  let kernel, ai;

  beforeEach(() => {
    kernel = makeKernel();
    ai     = createAICore(kernel, null, null, null, null);
  });

  afterEach(() => {
    if (ai.isMonitoring()) ai.stopMonitor();
    kernel.shutdown();
  });

  // ── API shape ────────────────────────────────────────────────────────────
  describe('createAICore', () => {
    test('returns ai with expected API', () => {
      expect(ai.name).toBe('ai-core');
      expect(ai.version).toBe('3.0.0');
      expect(typeof ai.process).toBe('function');
      expect(typeof ai.registerBackend).toBe('function');
      expect(typeof ai.setBackend).toBe('function');
      expect(typeof ai.setHealthMonitor).toBe('function');
      expect(typeof ai.startMonitor).toBe('function');
      expect(typeof ai.stopMonitor).toBe('function');
      expect(typeof ai.isMonitoring).toBe('function');
      expect(typeof ai.stats).toBe('function');
      expect(typeof ai.decisionLog).toBe('function');
      expect(typeof ai.suggestions).toBe('function');
      expect(typeof ai.learning).toBe('function');
      expect(typeof ai.saveContext).toBe('function');
      expect(typeof ai.commands).toBe('object');
    });

    test('accepts filesystem as 5th optional arg without error', () => {
      const fs = makeFs();
      expect(() => createAICore(kernel, null, null, null, fs)).not.toThrow();
    });
  });

  // ── process — meta intents ────────────────────────────────────────────────
  describe('process — meta intents', () => {
    test('greeting intent', async () => {
      const r = await ai.process('hello');
      expect(r.status).toBe('ok');
      expect(r.result).toMatch(/AIOS AI/);
    });

    test('thanks intent', async () => {
      const r = await ai.process('thank you');
      expect(r.status).toBe('ok');
      expect(r.result).toMatch(/welcome/i);
    });

    test('identity intent', async () => {
      const r = await ai.process('who are you');
      expect(r.status).toBe('ok');
      expect(r.result).toMatch(/AIOS AI/);
    });

    test('help intent', async () => {
      const r = await ai.process('help');
      expect(r.status).toBe('ok');
      expect(r.result).toMatch(/ai <text>/i);
    });

    test('status command', async () => {
      const r = await ai.process('status');
      expect(r.status).toBe('ok');
      expect(r.result).toMatch(/AI Core v3\.0\.0/);
      expect(r.result).toMatch(/Monitor/);
      expect(r.result).toMatch(/Queries/);
    });

    test('status shows Suggestions counter', async () => {
      const r = await ai.process('status');
      expect(r.result).toMatch(/Suggestions/);
    });

    test('log command returns no-log message initially', async () => {
      const r = await ai.process('log');
      expect(r.status).toBe('ok');
    });

    test('empty input returns error', async () => {
      const r = await ai.process('');
      expect(r.status).toBe('error');
    });

    test('monitor on/off toggle', async () => {
      jest.useFakeTimers();
      const r1 = await ai.process('monitor on');
      expect(r1.status).toBe('ok');
      expect(ai.isMonitoring()).toBe(true);
      const r2 = await ai.process('monitor off');
      expect(r2.status).toBe('ok');
      expect(ai.isMonitoring()).toBe(false);
      jest.useRealTimers();
    });
  });

  // ── process — NLP → router commands ──────────────────────────────────────
  describe('process — NLP routing', () => {
    test('routes "list files" intent through router when available', async () => {
      const mockResult = { status: 'ok', result: 'file1 file2' };
      const mockRouter = { handle: jest.fn().mockResolvedValue(mockResult) };
      const a = createAICore(kernel, mockRouter, null, null, null);
      const r = await a.process('list files in /etc');
      expect(mockRouter.handle).toHaveBeenCalledWith(expect.stringContaining('ls'), expect.any(Object));
      expect(r).toEqual(mockResult);
    });

    test('routes "show memory" intent', async () => {
      const mockRouter = { handle: jest.fn().mockResolvedValue({ status: 'ok', result: 'mem info' }) };
      const a = createAICore(kernel, mockRouter, null, null, null);
      await a.process('show memory usage');
      expect(mockRouter.handle).toHaveBeenCalledWith('free', expect.any(Object));
    });

    test('falls back when router not set', async () => {
      const r = await ai.process('list files in /etc');
      // No router, so fallback response
      expect(r.status).toBe('ok');
    });
  });

  // ── process — query complexity classifier ─────────────────────────────────
  describe('_classifyComplexity (via routing behaviour)', () => {
    test('simple matched intent goes to router, not backend', async () => {
      let backendCalled = false;
      const mockRouter  = { handle: jest.fn().mockResolvedValue({ status: 'ok', result: 'ok' }) };
      const a = createAICore(kernel, mockRouter, null, null, null);
      a.registerBackend('remote', {
        type: 'remote',
        query: async () => { backendCalled = true; return 'llm response'; },
      }, { type: 'remote' });
      await a.process('list files in /etc');
      expect(mockRouter.handle).toHaveBeenCalled();
      expect(backendCalled).toBe(false);
    });

    test('complex unmatched query goes to backend', async () => {
      let backendCalled = false;
      const a = createAICore(kernel, null, null, null, null);
      a.registerBackend('remote', {
        query: async () => { backendCalled = true; return 'analysis result'; },
      }, { type: 'remote' });
      await a.process('Explain in detail why the system services keep failing and what I should do about it given the current OS state');
      expect(backendCalled).toBe(true);
    });
  });

  // ── registerBackend ───────────────────────────────────────────────────────
  describe('registerBackend', () => {
    test('registers a backend', () => {
      ai.registerBackend('mymodel', { query: async () => 'response' }, { type: 'remote' });
      const s = ai.stats();
      expect(s).toBeDefined();
    });

    test('throws on missing name', () => {
      expect(() => ai.registerBackend('', { query: jest.fn() })).toThrow(TypeError);
    });

    test('throws when backend has no query function', () => {
      expect(() => ai.registerBackend('m', {})).toThrow(TypeError);
    });

    test('emits ai:backend-connected event', () => {
      const events = [];
      kernel.bus.on('ai:backend-connected', d => events.push(d));
      ai.registerBackend('llm', { query: async () => 'x' }, { type: 'remote' });
      expect(events).toHaveLength(1);
      expect(events[0].name).toBe('llm');
    });
  });

  // ── setBackend (backward compat) ──────────────────────────────────────────
  describe('setBackend (backward compat)', () => {
    test('registers backend under its name or "default"', () => {
      ai.setBackend({ name: 'mymodel', query: async () => 'r' });
      // Should emit ai:backend-connected
      const events = [];
      kernel.bus.on('ai:backend-connected', d => events.push(d));
      ai.setBackend({ query: async () => 'r2' }); // no name → 'default'
      expect(events[0].name).toBe('default');
    });

    test('throws when backend has no query function', () => {
      expect(() => ai.setBackend({})).toThrow(TypeError);
    });

    test('backend result is used in process()', async () => {
      ai.setBackend({ query: async () => 'llm says hello' });
      const r = await ai.process('What is the meaning of life, the universe, and everything, explained thoroughly?');
      expect(r.status).toBe('ok');
      expect(r.result).toBe('llm says hello');
    });
  });

  // ── circuit breaker ───────────────────────────────────────────────────────
  describe('circuit breaker', () => {
    test('trips after 3 backend failures and stops calling backend', async () => {
      let callCount = 0;
      ai.registerBackend('flaky', {
        query: async () => { callCount++; throw new Error('fail'); },
      }, { type: 'remote' });

      // 3 failures to trip
      for (let i = 0; i < 3; i++) {
        await ai.process('Explain the universe in extreme detail please tell me everything about it.');
      }
      const countBeforeTrip = callCount;
      // Next call — circuit should be tripped, backend not called
      await ai.process('Explain the universe in extreme detail please tell me everything about it.');
      expect(callCount).toBe(countBeforeTrip); // no additional calls
    });

    test('emits ai:backend-tripped event when circuit opens', async () => {
      const events = [];
      kernel.bus.on('ai:backend-tripped', d => events.push(d));
      ai.registerBackend('bad', {
        query: async () => { throw new Error('always fails'); },
      }, { type: 'remote' });
      for (let i = 0; i < 3; i++) {
        await ai.process('Analyze this extremely complex system failure and explain all details about it.');
      }
      expect(events).toHaveLength(1);
      expect(events[0].name).toBe('bad');
    });

    test('one tripped backend does not block other backends', async () => {
      ai.registerBackend('bad', {
        query: async () => { throw new Error('fail'); },
      }, { type: 'remote' });
      // Trip the bad backend
      for (let i = 0; i < 3; i++) {
        await ai.process('Analyze this extremely complex system failure in great detail and explain everything.');
      }
      let goodCalled = false;
      ai.registerBackend('good', {
        query: async () => { goodCalled = true; return 'good result'; },
      }, { type: 'remote' });
      const r = await ai.process('Analyze this extremely complex system failure in great detail and explain everything.');
      expect(goodCalled).toBe(true);
      expect(r.result).toBe('good result');
    });
  });

  // ── model wake-up ─────────────────────────────────────────────────────────
  describe('dynamic model wake-up', () => {
    test('calls wake() on backend before querying', async () => {
      let wakeCalled = false;
      ai.registerBackend('lazy', {
        wake:  async () => { wakeCalled = true; },
        query: async () => 'awake response',
      }, { type: 'remote' });
      await ai.process('Explain the complexity of distributed systems in full detail.');
      expect(wakeCalled).toBe(true);
    });

    test('skips backend if wake() fails', async () => {
      let queryCalled = false;
      ai.registerBackend('broken-wake', {
        wake:  async () => { throw new Error('model offline'); },
        query: async () => { queryCalled = true; return 'x'; },
      }, { type: 'remote' });
      const r = await ai.process('Explain distributed systems in complete detail with all considerations.');
      expect(queryCalled).toBe(false);
      expect(r.status).toBe('ok'); // falls back gracefully
    });
  });

  // ── persistent context ────────────────────────────────────────────────────
  describe('persistent context', () => {
    test('saveContext does not throw when filesystem is null', () => {
      expect(() => ai.saveContext()).not.toThrow();
    });

    test('saves and loads context via VFS', async () => {
      const fs = makeFs();
      const a  = createAICore(kernel, null, null, null, fs);
      await a.process('hello');
      a.saveContext();
      // Verify file was written
      const r = fs.read('/var/lib/aios/ai-context.json');
      expect(r.ok).toBe(true);
      expect(r.content).toBeTruthy();
      const snap = JSON.parse(r.content);
      expect(snap.stats).toBeDefined();
      expect(snap.stats.queries).toBeGreaterThan(0);
    });

    test('loads prior stats from context on construction', async () => {
      const fs = makeFs();
      // Create first instance, do some queries, save context
      const a1 = createAICore(kernel, null, null, null, fs);
      await a1.process('hello');
      await a1.process('who are you');
      a1.saveContext();

      // Create second instance — should load prior stats
      const a2 = createAICore(kernel, null, null, null, fs);
      expect(a2.stats().queries).toBeGreaterThanOrEqual(2);
    });

    test('loads prior decision log from context', async () => {
      const fs = makeFs();
      const a1 = createAICore(kernel, null, null, null, fs);
      await a1.process('hello');
      a1.saveContext();

      const a2 = createAICore(kernel, null, null, null, fs);
      expect(a2.decisionLog().length).toBeGreaterThan(0);
    });
  });

  // ── persistent learning ───────────────────────────────────────────────────
  describe('persistent learning', () => {
    test('learning() starts empty', () => {
      const l = ai.learning();
      expect(typeof l).toBe('object');
    });

    test('learning grows after resolved intents', async () => {
      await ai.process('hello');
      const l = ai.learning();
      expect(l['ai:greet']).toBeDefined();
      expect(l['ai:greet'].hits).toBeGreaterThan(0);
    });

    test('learning persists to VFS and reloads', async () => {
      const fs = makeFs();
      const a1 = createAICore(kernel, null, null, null, fs);
      await a1.process('hello');
      await a1.process('thank you');

      const a2 = createAICore(kernel, null, null, null, fs);
      const l = a2.learning();
      expect(l['ai:greet']).toBeDefined();
      expect(l['ai:thanks']).toBeDefined();
    });
  });

  // ── proactive suggestions ─────────────────────────────────────────────────
  describe('proactive suggestions', () => {
    test('suggestions() starts empty', () => {
      expect(ai.suggestions()).toEqual([]);
    });

    test('autonomous check adds suggestion for failed service', () => {
      const svcMgr = {
        list: () => [{ name: 'web-server', state: 'failed' }],
        restart: jest.fn().mockResolvedValue({ ok: true }),
      };
      jest.useFakeTimers();
      const a = createAICore(kernel, null, svcMgr, null, null);
      a.startMonitor(1000);
      jest.advanceTimersByTime(1100);
      a.stopMonitor();
      jest.useRealTimers();
      const s = a.suggestions();
      expect(s.length).toBeGreaterThan(0);
      expect(s.some(x => x.type === 'service:restart')).toBe(true);
    });

    test('autonomous check adds suggestion for low memory', () => {
      const hostBridge = { memInfo: () => ({ ok: true, freeMB: 20, totalMB: 1000 }) };
      jest.useFakeTimers();
      const a = createAICore(kernel, null, null, hostBridge, null);
      a.startMonitor(1000);
      jest.advanceTimersByTime(1100);
      a.stopMonitor();
      jest.useRealTimers();
      const s = a.suggestions();
      expect(s.some(x => x.type === 'memory:low')).toBe(true);
    });

    test('suggestions include actionable command', () => {
      const svcMgr = {
        list: () => [{ name: 'my-svc', state: 'failed' }],
        restart: jest.fn().mockResolvedValue({ ok: true }),
      };
      jest.useFakeTimers();
      const a = createAICore(kernel, null, svcMgr, null, null);
      a.startMonitor(1000);
      jest.advanceTimersByTime(1100);
      a.stopMonitor();
      jest.useRealTimers();
      const s = a.suggestions().filter(x => x.type === 'service:restart');
      expect(s[0].command).toContain('my-svc');
    });

    test('ai:suggestion event fired for each suggestion', () => {
      const events = [];
      kernel.bus.on('ai:suggestion', d => events.push(d));
      const svcMgr = {
        list: () => [{ name: 'svc1', state: 'failed' }],
        restart: jest.fn().mockResolvedValue({ ok: true }),
      };
      jest.useFakeTimers();
      const a = createAICore(kernel, null, svcMgr, null, null);
      a.startMonitor(1000);
      jest.advanceTimersByTime(1100);
      a.stopMonitor();
      jest.useRealTimers();
      expect(events.length).toBeGreaterThan(0);
    });
  });

  // ── health monitor integration ────────────────────────────────────────────
  describe('setHealthMonitor', () => {
    test('setHealthMonitor does not throw', () => {
      const hm = { report: () => ({ endpoints: [], ports: [] }) };
      expect(() => ai.setHealthMonitor(hm)).not.toThrow();
    });

    test('down endpoints trigger suggestions in autonomous check', () => {
      const hm = {
        report: () => ({
          endpoints: [{ name: 'api', url: 'http://localhost', healthy: false }],
          ports: [],
        }),
      };
      ai.setHealthMonitor(hm);
      const svcMgr = { list: () => [], restart: jest.fn() };
      jest.useFakeTimers();
      const a = createAICore(kernel, null, svcMgr, null, null);
      a.setHealthMonitor(hm);
      a.startMonitor(1000);
      jest.advanceTimersByTime(1100);
      a.stopMonitor();
      jest.useRealTimers();
      const s = a.suggestions();
      expect(s.some(x => x.type === 'endpoint:down')).toBe(true);
    });

    test('down ports trigger suggestions in autonomous check', () => {
      const hm = {
        report: () => ({
          endpoints: [],
          ports: [{ name: 'redis', host: '127.0.0.1', port: 6379, active: false }],
        }),
      };
      const svcMgr = { list: () => [], restart: jest.fn() };
      jest.useFakeTimers();
      const a = createAICore(kernel, null, svcMgr, null, null);
      a.setHealthMonitor(hm);
      a.startMonitor(1000);
      jest.advanceTimersByTime(1100);
      a.stopMonitor();
      jest.useRealTimers();
      const s = a.suggestions();
      expect(s.some(x => x.type === 'port:down')).toBe(true);
    });
  });

  // ── fault isolation ───────────────────────────────────────────────────────
  describe('fault isolation', () => {
    test('crashing backend does not crash AIOS', async () => {
      ai.registerBackend('crasher', {
        query: async () => { throw new Error('FATAL'); },
      }, { type: 'remote' });
      await expect(
        ai.process('Explain the detailed architecture of complex distributed systems.')
      ).resolves.toBeDefined();
    });

    test('crashing svcMgr in autonomous check does not crash monitor', () => {
      const svcMgr = {
        list: () => { throw new Error('svcMgr broken'); },
        restart: jest.fn(),
      };
      jest.useFakeTimers();
      const a = createAICore(kernel, null, svcMgr, null, null);
      // startMonitor calls _autonomousCheck; should not throw
      a.startMonitor(1000);
      expect(() => jest.advanceTimersByTime(1100)).not.toThrow();
      a.stopMonitor();
      jest.useRealTimers();
    });

    test('corrupt VFS context does not crash on load', () => {
      const fs = makeFs();
      fs.write('/var/lib/aios/ai-context.json', 'NOT_JSON{{{{');
      expect(() => createAICore(kernel, null, null, null, fs)).not.toThrow();
    });

    test('corrupt VFS learning does not crash on load', () => {
      const fs = makeFs();
      fs.write('/var/lib/aios/ai-learning.json', 'GARBAGE');
      expect(() => createAICore(kernel, null, null, null, fs)).not.toThrow();
    });
  });

  // ── startMonitor / stopMonitor ────────────────────────────────────────────
  describe('startMonitor / stopMonitor', () => {
    test('isMonitoring() reflects monitor state', () => {
      jest.useFakeTimers();
      expect(ai.isMonitoring()).toBe(false);
      ai.startMonitor(1000);
      expect(ai.isMonitoring()).toBe(true);
      ai.stopMonitor();
      expect(ai.isMonitoring()).toBe(false);
      jest.useRealTimers();
    });

    test('startMonitor is idempotent', () => {
      jest.useFakeTimers();
      ai.startMonitor(1000);
      ai.startMonitor(1000); // should not double-start
      expect(ai.isMonitoring()).toBe(true);
      ai.stopMonitor();
      jest.useRealTimers();
    });

    test('stopMonitor is safe to call when not monitoring', () => {
      expect(() => ai.stopMonitor()).not.toThrow();
    });

    test('auto-restarts failed services', async () => {
      const restartCalled = [];
      const svcMgr = {
        list: () => [{ name: 'db', state: 'failed' }],
        restart: jest.fn().mockImplementation((n) => { restartCalled.push(n); return Promise.resolve({ ok: true }); }),
      };
      jest.useFakeTimers();
      const a = createAICore(kernel, null, svcMgr, null, null);
      a.startMonitor(1000);
      jest.advanceTimersByTime(1100);
      a.stopMonitor();
      jest.useRealTimers();
      expect(restartCalled).toContain('db');
    });

    test('kernel bus service:failed event triggers restart', async () => {
      jest.useFakeTimers();
      const restartCalled = [];
      const svcMgr = {
        list: () => [],
        restart: jest.fn().mockImplementation((n) => { restartCalled.push(n); return Promise.resolve({ ok: true }); }),
      };
      const a = createAICore(kernel, null, svcMgr, null, null);
      a.startMonitor(30000);
      kernel.bus.emit('service:failed', { name: 'my-service' });
      jest.advanceTimersByTime(3000);
      a.stopMonitor();
      jest.useRealTimers();
      expect(restartCalled).toContain('my-service');
    });
  });

  // ── stats ─────────────────────────────────────────────────────────────────
  describe('stats', () => {
    test('stats() returns a copy', () => {
      const s1 = ai.stats();
      s1.queries = 999;
      const s2 = ai.stats();
      expect(s2.queries).not.toBe(999);
    });

    test('queries counter increments', async () => {
      await ai.process('hello');
      expect(ai.stats().queries).toBeGreaterThan(0);
    });

    test('resolved counter increments on successful NLP', async () => {
      await ai.process('hello');
      expect(ai.stats().resolved).toBeGreaterThan(0);
    });
  });

  // ── decisionLog ───────────────────────────────────────────────────────────
  describe('decisionLog', () => {
    test('decisionLog() returns array', () => {
      expect(Array.isArray(ai.decisionLog())).toBe(true);
    });

    test('decision log grows after process calls', async () => {
      await ai.process('hello');
      expect(ai.decisionLog().length).toBeGreaterThan(0);
    });

    test('decisionLog() returns a copy', () => {
      const l1 = ai.decisionLog();
      const len = l1.length;
      l1.push({ fake: true });
      expect(ai.decisionLog().length).toBe(len);
    });
  });

  // ── commands.ai ───────────────────────────────────────────────────────────
  describe('commands.ai', () => {
    test('no args returns usage string', async () => {
      const r = await ai.commands.ai([]);
      expect(r.status).toBe('ok');
      expect(r.result).toMatch(/Usage/);
    });

    test('passes args to process()', async () => {
      const r = await ai.commands.ai(['hello']);
      expect(r.status).toBe('ok');
      expect(r.result).toMatch(/AIOS AI/);
    });

    test('multi-word args joined', async () => {
      const r = await ai.commands.ai(['who', 'are', 'you']);
      expect(r.status).toBe('ok');
      expect(r.result).toMatch(/AIOS AI/);
    });
  });
});
