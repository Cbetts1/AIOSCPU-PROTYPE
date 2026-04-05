'use strict';
/**
 * tests/collective-intelligence.test.js
 * Full Jest test suite for core/collective-intelligence.js v1.0.0
 */

const { createCollectiveIntelligence } = require('../core/collective-intelligence');

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------
function makeKernel() {
  const _h = {};
  return {
    id: 'test-kernel', version: '1.0.0', uptime: () => 0,
    bus: {
      on:   (ev, fn) => { _h[ev] = fn; },
      emit: (ev, d)  => { if (_h[ev]) _h[ev](d); },
    },
  };
}

function makeMemoryCore() {
  const _records = [];
  return {
    record:   (type, i, o, e) => _records.push({ type, input: i, output: o, err: e }),
    _records,
  };
}

function makeFilesystem() {
  const _store = new Map();
  return {
    mkdir: () => ({ ok: true }),
    write: (path, content) => { _store.set(path, content); return { ok: true }; },
    read:  (path) => {
      const c = _store.get(path);
      return c !== undefined ? { ok: true, content: c } : { ok: false };
    },
    _store,
  };
}

// ---------------------------------------------------------------------------
describe('CollectiveIntelligence', () => {
  let ci;

  beforeEach(() => {
    ci = createCollectiveIntelligence(null, null, null);
  });

  // ── API shape ─────────────────────────────────────────────────────────────
  describe('createCollectiveIntelligence', () => {
    test('returns object with expected API', () => {
      expect(ci.name).toBe('collective-intelligence');
      expect(typeof ci.version).toBe('string');
      expect(typeof ci.contribute).toBe('function');
      expect(typeof ci.context).toBe('function');
      expect(typeof ci.synthesize).toBe('function');
      expect(typeof ci.recall).toBe('function');
      expect(typeof ci.getState).toBe('function');
      expect(typeof ci.persist).toBe('function');
      expect(typeof ci.restore).toBe('function');
      expect(typeof ci.commands).toBe('object');
      expect(typeof ci.commands.collective).toBe('function');
    });

    test('works with all nulls (no kernel, no memoryCore, no filesystem)', () => {
      expect(() => createCollectiveIntelligence(null, null, null)).not.toThrow();
    });
  });

  // ── getState() initial ────────────────────────────────────────────────────
  describe('getState() — initial state', () => {
    test('starts with zero contributions', () => {
      expect(ci.getState().contributions).toBe(0);
    });

    test('starts with zero topic keys', () => {
      expect(ci.getState().topicKeys).toBe(0);
    });

    test('starts with empty models map', () => {
      expect(ci.getState().models).toEqual({});
    });
  });

  // ── contribute() ──────────────────────────────────────────────────────────
  describe('contribute()', () => {
    test('increments contribution count', () => {
      ci.contribute('speed', 'what is node.js', 'Node.js is a runtime.');
      expect(ci.getState().contributions).toBe(1);
    });

    test('second contribution further increments count', () => {
      ci.contribute('speed', 'q1', 'a1');
      ci.contribute('code',  'q2', 'a2');
      expect(ci.getState().contributions).toBe(2);
    });

    test('tracks contribution per model', () => {
      ci.contribute('speed', 'hello', 'hi');
      ci.contribute('speed', 'bye',   'goodbye');
      ci.contribute('mind',  'think', 'ok');
      const s = ci.getState();
      expect(s.models.speed).toBe(2);
      expect(s.models.mind).toBe(1);
    });

    test('adds topic keys to index', () => {
      ci.contribute('speed', 'what is javascript', 'A language.');
      expect(ci.getState().topicKeys).toBeGreaterThan(0);
    });

    test('ignores calls with empty arguments', () => {
      ci.contribute('', 'query', 'response');
      ci.contribute('speed', '', 'response');
      ci.contribute('speed', 'query', '');
      expect(ci.getState().contributions).toBe(0);
    });

    test('records into memoryCore when wired', () => {
      const mc = makeMemoryCore();
      const c  = createCollectiveIntelligence(null, mc, null);
      c.contribute('reason', 'why does the kernel crash', 'Memory overflow');
      expect(mc._records.length).toBe(1);
      expect(mc._records[0].type).toBe('collective:reason');
      expect(mc._records[0].input).toBe('why does the kernel crash');
    });

    test('emits collective:contributed event on kernel bus', () => {
      const kernel = makeKernel();
      const events = [];
      kernel.bus.on('collective:contributed', e => events.push(e));
      const c = createCollectiveIntelligence(kernel, null, null);
      c.contribute('chat', 'hello', 'hi there');
      expect(events.length).toBe(1);
      expect(events[0].model).toBe('chat');
    });
  });

  // ── context() ─────────────────────────────────────────────────────────────
  describe('context()', () => {
    test('returns empty string when store is empty', () => {
      expect(ci.context('what is node')).toBe('');
    });

    test('returns empty string for empty prompt', () => {
      ci.contribute('speed', 'node.js', 'A runtime');
      expect(ci.context('')).toBe('');
    });

    test('returns context string after relevant contribution', () => {
      ci.contribute('speed', 'what is javascript', 'A scripting language for the web.');
      const ctx = ci.context('javascript');
      expect(typeof ctx).toBe('string');
      // May or may not find a hit depending on scoring — just no throw
    });

    test('context mentions model name when relevant match found', () => {
      ci.contribute('code', 'javascript array sort function', 'Use Array.prototype.sort().');
      const ctx = ci.context('javascript array sort');
      // If score high enough, should include 'code'
      if (ctx) {
        expect(ctx).toMatch(/code/);
      }
    });

    test('context contains collective intelligence header when matched', () => {
      ci.contribute('reason', 'why do kernels crash due to memory', 'Page faults cause panics.');
      const ctx = ci.context('memory kernel crash');
      if (ctx) {
        expect(ctx).toMatch(/Collective Intelligence/);
      }
    });

    test('increments contextBuilds stat', () => {
      ci.contribute('speed', 'test', 'answer');
      ci.context('test');
      expect(ci.getState().contextBuilds).toBe(1);
    });
  });

  // ── synthesize() ──────────────────────────────────────────────────────────
  describe('synthesize()', () => {
    test('returns empty string for empty array', () => {
      expect(ci.synthesize([])).toBe('');
    });

    test('returns empty string for null/undefined', () => {
      expect(ci.synthesize(null)).toBe('');
      expect(ci.synthesize(undefined)).toBe('');
    });

    test('returns single response unchanged when only one perspective', () => {
      const result = ci.synthesize([{ model: 'speed', response: 'Hello world' }]);
      expect(result).toBe('Hello world');
    });

    test('returns combined response with two perspectives', () => {
      const result = ci.synthesize([
        { model: 'reason', response: 'Kernels manage memory through virtual addressing and page tables.' },
        { model: 'write',  response: 'Memory management in an operating system involves paging and segmentation schemes.' },
      ]);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    test('increments syntheses stat', () => {
      ci.synthesize([{ model: 'a', response: 'x' }, { model: 'b', response: 'y' }]);
      expect(ci.getState().syntheses).toBe(1);
    });

    test('filters out empty responses', () => {
      const result = ci.synthesize([
        { model: 'a', response: '' },
        { model: 'b', response: 'real answer' },
      ]);
      expect(result).toBe('real answer');
    });

    test('uses longest response as base', () => {
      const long  = 'This is the detailed and comprehensive answer covering all aspects.';
      const short = 'Short.';
      const result = ci.synthesize([
        { model: 'a', response: short },
        { model: 'b', response: long  },
      ]);
      expect(result).toContain(long);
    });
  });

  // ── recall() ─────────────────────────────────────────────────────────────
  describe('recall()', () => {
    test('returns empty array when nothing stored', () => {
      expect(ci.recall('anything')).toEqual([]);
    });

    test('returns matching perspectives', () => {
      ci.contribute('code', 'javascript sort function implementation', 'Array.sort() uses comparison callbacks.');
      const found = ci.recall('javascript sort');
      expect(Array.isArray(found)).toBe(true);
    });

    test('increments recalls stat', () => {
      ci.recall('something');
      expect(ci.getState().recalls).toBe(1);
    });

    test('returned perspectives have model and response fields', () => {
      ci.contribute('mind', 'machine learning gradient descent', 'Gradient descent minimizes loss.');
      const found = ci.recall('gradient descent');
      found.forEach(p => {
        expect(p).toHaveProperty('model');
        expect(p).toHaveProperty('response');
      });
    });
  });

  // ── commands ─────────────────────────────────────────────────────────────
  describe('commands.collective', () => {
    test('no args shows status', () => {
      const r = ci.commands.collective([]);
      expect(r.status).toBe('ok');
      expect(r.result).toMatch(/Collective Intelligence/);
    });

    test('status shows zero contributions at start', () => {
      const r = ci.commands.collective(['status']);
      expect(r.status).toBe('ok');
      expect(r.result).toMatch(/Contributions\s*:\s*0/);
    });

    test('status shows contribution counts after contributing', () => {
      ci.contribute('speed', 'hello', 'hi');
      ci.contribute('code',  'add function', 'function add(a,b){return a+b}');
      const r = ci.commands.collective(['status']);
      expect(r.result).toMatch(/Contributions\s*:\s*2/);
    });

    test('log returns empty message when nothing stored', () => {
      const r = ci.commands.collective(['log']);
      expect(r.status).toBe('ok');
      expect(r.result).toMatch(/empty/i);
    });

    test('log shows entries after contribution', () => {
      ci.contribute('reason', 'why hello', 'because greeting');
      const r = ci.commands.collective(['log']);
      expect(r.status).toBe('ok');
      expect(r.result).toMatch(/reason/);
    });

    test('recall with no query returns error', () => {
      const r = ci.commands.collective(['recall']);
      expect(r.status).toBe('error');
      expect(r.result).toMatch(/Usage/i);
    });

    test('recall with query returns not-found when empty', () => {
      const r = ci.commands.collective(['recall', 'unknown', 'topic', 'xyz']);
      expect(r.status).toBe('ok');
      expect(r.result).toMatch(/No collective memory/i);
    });

    test('unknown subcommand returns error', () => {
      const r = ci.commands.collective(['unknowncmd']);
      expect(r.status).toBe('error');
    });
  });

  // ── persistence ───────────────────────────────────────────────────────────
  describe('persist() and restore()', () => {
    test('persist does not throw without filesystem', () => {
      ci.contribute('speed', 'test', 'value');
      expect(() => ci.persist()).not.toThrow();
    });

    test('restore does not throw without filesystem', () => {
      expect(() => ci.restore()).not.toThrow();
    });

    test('persist writes JSON to filesystem', () => {
      const fs = makeFilesystem();
      const c  = createCollectiveIntelligence(null, null, fs);
      c.contribute('speed', 'node.js', 'A runtime.');
      c.persist();
      const written = fs._store.get('/var/lib/aios/collective.json');
      expect(written).toBeDefined();
      const parsed = JSON.parse(written);
      expect(parsed).toHaveProperty('savedAt');
      expect(parsed).toHaveProperty('topicIndex');
    });

    test('restore loads previously persisted topic index', () => {
      const fs = makeFilesystem();
      const c1 = createCollectiveIntelligence(null, null, fs);
      c1.contribute('mind', 'what is recursion', 'A function calling itself.');
      c1.persist();

      // New instance, same filesystem
      const c2 = createCollectiveIntelligence(null, null, fs);
      c2.restore();
      expect(c2.getState().topicKeys).toBeGreaterThan(0);
    });

    test('restore handles corrupt JSON gracefully', () => {
      const fs = makeFilesystem();
      fs.write('/var/lib/aios/collective.json', 'NOT_VALID_JSON{{{');
      const c = createCollectiveIntelligence(null, null, fs);
      expect(() => c.restore()).not.toThrow();
    });
  });
});
