'use strict';

const { createMemoryCore } = require('../core/memory-core');

// ---------------------------------------------------------------------------
// Minimal stub kernel for testing
// ---------------------------------------------------------------------------
function makeKernel() {
  const _handlers = {};
  return {
    bus: {
      on:   (evt, fn) => { (_handlers[evt] = _handlers[evt] || []).push(fn); },
      emit: (evt, data) => { (_handlers[evt] || []).forEach(fn => fn(data)); return true; },
    },
  };
}

// ---------------------------------------------------------------------------

describe('MemoryCore', () => {
  let kernel;
  let mem;

  beforeEach(() => {
    kernel = makeKernel();
    mem    = createMemoryCore(kernel);
  });

  // ── Module shape ──────────────────────────────────────────────────────────

  describe('createMemoryCore', () => {
    test('returns memory core object with expected properties', () => {
      expect(mem).toBeDefined();
      expect(mem.name).toBe('memory-core');
      expect(mem.version).toBe('4.0.0');
      expect(typeof mem.record).toBe('function');
      expect(typeof mem.recall).toBe('function');
      expect(typeof mem.getContext).toBe('function');
      expect(typeof mem.suggestions).toBe('function');
      expect(typeof mem.getStats).toBe('function');
      expect(mem.commands).toBeDefined();
      expect(typeof mem.commands.memcore).toBe('function');
    });

    test('works without a kernel', () => {
      const m = createMemoryCore(null);
      expect(m).toBeDefined();
      expect(() => m.record('query', 'hello', 'world', null)).not.toThrow();
    });
  });

  // ── record ────────────────────────────────────────────────────────────────

  describe('record', () => {
    test('stores an event and increments recorded count', () => {
      mem.record('query', 'ls /etc', 'file1 file2', null);
      expect(mem.getStats().recorded).toBe(1);
      expect(mem.getStats().entries).toBe(1);
    });

    test('returned entry has expected shape', () => {
      const entry = mem.record('query', 'hello', 'world', null);
      expect(entry.id).toBe(1);
      expect(entry.type).toBe('query');
      expect(entry.input).toBe('hello');
      expect(entry.output).toBe('world');
      expect(entry.error).toBeNull();
      expect(typeof entry.ts).toBe('string');
    });

    test('records error correctly', () => {
      const entry = mem.record('error', 'bad cmd', '', 'command not found');
      expect(entry.error).toBe('command not found');
      expect(mem.getStats().errors).toBe(1);
    });

    test('assigns incrementing IDs', () => {
      const e1 = mem.record('query', 'a', 'ra', null);
      const e2 = mem.record('query', 'b', 'rb', null);
      expect(e2.id).toBe(e1.id + 1);
    });

    test('truncates very long inputs to 500 chars', () => {
      const longInput = 'x'.repeat(600);
      const entry = mem.record('query', longInput, 'ok', null);
      expect(entry.input.length).toBe(500);
    });

    test('truncates very long outputs to 500 chars', () => {
      const longOutput = 'y'.repeat(600);
      const entry = mem.record('query', 'input', longOutput, null);
      expect(entry.output.length).toBe(500);
    });

    test('emits memory:recorded event on kernel bus', () => {
      const events = [];
      kernel.bus.on('memory:recorded', (data) => events.push(data));
      mem.record('query', 'test', 'result', null);
      expect(events.length).toBe(1);
      expect(events[0].type).toBe('query');
    });
  });

  // ── _learn / recall ───────────────────────────────────────────────────────

  describe('recall', () => {
    test('returns null for unknown input', () => {
      expect(mem.recall('unknown input')).toBeNull();
    });

    test('learns from a successful record and can recall it', () => {
      mem.record('query', 'list files', 'file1.txt file2.txt', null);
      const r = mem.recall('list files');
      expect(r).not.toBeNull();
      expect(r.count).toBe(1);
      expect(r.lastOutput).toBe('file1.txt file2.txt');
    });

    test('recall is case-insensitive', () => {
      mem.record('query', 'Hello World', 'greetings', null);
      expect(mem.recall('hello world')).not.toBeNull();
      expect(mem.recall('HELLO WORLD')).not.toBeNull();
    });

    test('increments count on repeated inputs', () => {
      mem.record('query', 'sysinfo', 'OS: AIOS', null);
      mem.record('query', 'sysinfo', 'OS: AIOS v2', null);
      const r = mem.recall('sysinfo');
      expect(r.count).toBe(2);
      expect(r.lastOutput).toBe('OS: AIOS v2');
    });

    test('does not learn from error entries', () => {
      mem.record('error', 'bad command', '', 'not found');
      expect(mem.recall('bad command')).toBeNull();
    });

    test('does not learn from entries with empty input', () => {
      mem.record('query', '', 'result', null);
      expect(mem.recall('')).toBeNull();
    });
  });

  // ── getContext ────────────────────────────────────────────────────────────

  describe('getContext', () => {
    test('returns empty array when no entries', () => {
      expect(mem.getContext()).toEqual([]);
    });

    test('returns last n entries in insertion order', () => {
      mem.record('query', 'a', 'ra', null);
      mem.record('query', 'b', 'rb', null);
      mem.record('query', 'c', 'rc', null);
      const ctx = mem.getContext(2);
      expect(ctx.length).toBe(2);
      expect(ctx[0].input).toBe('b');
      expect(ctx[1].input).toBe('c');
    });

    test('defaults to last 20 entries', () => {
      for (let i = 0; i < 25; i++) {
        mem.record('query', `cmd${i}`, `res${i}`, null);
      }
      expect(mem.getContext().length).toBe(20);
    });
  });

  // ── suggestions ───────────────────────────────────────────────────────────

  describe('suggestions', () => {
    test('returns a non-empty array', () => {
      const suggs = mem.suggestions();
      expect(Array.isArray(suggs)).toBe(true);
      expect(suggs.length).toBeGreaterThan(0);
    });

    test('returns "no suggestions" message when memory is clean', () => {
      const suggs = mem.suggestions();
      expect(suggs[0]).toMatch(/No proactive suggestions/);
    });

    test('includes error recovery suggestion after recording errors', () => {
      mem.record('error', 'cat /nonexistent', '', 'file not found');
      const suggs = mem.suggestions();
      expect(suggs.some(s => s.includes('[Error recovery]'))).toBe(true);
    });

    test('includes frequent-use suggestion after 3+ identical inputs', () => {
      for (let i = 0; i < 4; i++) {
        mem.record('query', 'ls /etc', 'file1 file2', null);
      }
      const suggs = mem.suggestions();
      expect(suggs.some(s => s.includes('[Frequent]'))).toBe(true);
    });

    test('increments suggestions stat', () => {
      mem.suggestions();
      expect(mem.getStats().suggestions).toBe(1);
    });
  });

  // ── getStats ──────────────────────────────────────────────────────────────

  describe('getStats', () => {
    test('returns zero counters initially', () => {
      const s = mem.getStats();
      expect(s.recorded).toBe(0);
      expect(s.learned).toBe(0);
      expect(s.errors).toBe(0);
      expect(s.suggestions).toBe(0);
      expect(s.entries).toBe(0);
      expect(s.patterns).toBe(0);
    });

    test('tracks recorded, learned, and error counts', () => {
      mem.record('query', 'ps', 'pid 1', null);
      mem.record('query', 'df', '100GB', null);
      mem.record('error', 'fail', '', 'oops');
      const s = mem.getStats();
      expect(s.recorded).toBe(3);
      expect(s.learned).toBe(2);   // two successful events
      expect(s.errors).toBe(1);
    });
  });

  // ── commands.memcore ─────────────────────────────────────────────────────

  describe('commands.memcore', () => {
    test('status returns memory core status', () => {
      const r = mem.commands.memcore([]);
      expect(r.status).toBe('ok');
      expect(r.result).toMatch(/AIOS Memory Core/);
    });

    test('status with "status" arg', () => {
      const r = mem.commands.memcore(['status']);
      expect(r.status).toBe('ok');
      expect(r.result).toMatch(/Entries/);
    });

    test('log returns empty message when no entries', () => {
      const r = mem.commands.memcore(['log']);
      expect(r.status).toBe('ok');
      expect(r.result).toMatch(/Memory is empty/);
    });

    test('log shows entries after recording', () => {
      mem.record('query', 'version', 'AIOS 3.0.0', null);
      const r = mem.commands.memcore(['log']);
      expect(r.status).toBe('ok');
      expect(r.result).toMatch(/query/);
    });

    test('suggest returns suggestions string', () => {
      const r = mem.commands.memcore(['suggest']);
      expect(r.status).toBe('ok');
      expect(typeof r.result).toBe('string');
    });

    test('recall with no arg returns usage hint', () => {
      const r = mem.commands.memcore(['recall']);
      expect(r.status).toBe('ok');
      expect(r.result).toMatch(/Usage/);
    });

    test('recall finds a previously learned entry', () => {
      mem.record('query', 'uname', 'AIOS', null);
      const r = mem.commands.memcore(['recall', 'uname']);
      expect(r.status).toBe('ok');
      expect(r.result).toMatch(/Recalled/);
      expect(r.result).toMatch(/AIOS/);
    });

    test('recall returns not-found for unknown input', () => {
      const r = mem.commands.memcore(['recall', 'unknown-thing-xyz']);
      expect(r.status).toBe('ok');
      expect(r.result).toMatch(/No memory found/);
    });

    test('unknown sub-command returns usage string', () => {
      const r = mem.commands.memcore(['bogus']);
      expect(r.status).toBe('ok');
      expect(r.result).toMatch(/Usage/);
    });
  });
});
