'use strict';

const { createKernel } = require('../core/kernel');
const { createMemoryEngine } = require('../core/memory-engine');

describe('MemoryEngine', () => {
  let kernel;
  let mem;

  beforeEach(() => {
    kernel = createKernel();
    kernel.boot();
    mem = createMemoryEngine(kernel);
  });

  afterEach(() => {
    kernel.shutdown();
  });

  describe('createMemoryEngine', () => {
    test('returns engine with expected API', () => {
      expect(mem.name).toBe('memory-engine');
      expect(mem.version).toBe('1.0.0');
      expect(typeof mem.recordInteraction).toBe('function');
      expect(typeof mem.recordQuery).toBe('function');
      expect(typeof mem.learn).toBe('function');
      expect(typeof mem.getInteractions).toBe('function');
      expect(typeof mem.getQueries).toBe('function');
      expect(typeof mem.getLearnings).toBe('function');
      expect(typeof mem.stats).toBe('function');
      expect(typeof mem.clear).toBe('function');
      expect(typeof mem.commands).toBe('object');
      expect(typeof mem.commands.memory).toBe('function');
    });
  });

  describe('recordInteraction', () => {
    test('records and returns an id', () => {
      const r = mem.recordInteraction('chat', 'hello', 'hi there');
      expect(r).toHaveProperty('id');
      expect(typeof r.id).toBe('number');
      expect(r.id).toBeGreaterThan(0);
    });

    test('stored interaction is retrievable', () => {
      mem.recordInteraction('chat', 'what is the time?', 'now');
      const list = mem.getInteractions(10);
      expect(list.length).toBe(1);
      expect(list[0].mode).toBe('chat');
      expect(list[0].input).toBe('what is the time?');
      expect(list[0].response).toBe('now');
    });

    test('filters by mode', () => {
      mem.recordInteraction('chat', 'a', 'a');
      mem.recordInteraction('code', 'b', 'b');
      const chatOnly = mem.getInteractions(10, 'chat');
      expect(chatOnly.length).toBe(1);
      expect(chatOnly[0].mode).toBe('chat');
    });

    test('returns most recent first', () => {
      mem.recordInteraction('chat', 'first',  'r1');
      mem.recordInteraction('chat', 'second', 'r2');
      const list = mem.getInteractions(5);
      expect(list[0].input).toBe('second');
      expect(list[1].input).toBe('first');
    });
  });

  describe('recordQuery', () => {
    test('records and retrieves a query', () => {
      const r = mem.recordQuery('ls /tmp', { command: 'ls', args: ['/tmp'] }, 'terminal');
      expect(r).toHaveProperty('id');
      const queries = mem.getQueries(5);
      expect(queries.length).toBe(1);
      expect(queries[0].raw).toBe('ls /tmp');
      expect(queries[0].source).toBe('terminal');
    });
  });

  describe('learn', () => {
    test('records a learning observation', () => {
      const r = mem.learn('os', { fact: 'linux is cool' }, 0.9);
      expect(r).toHaveProperty('id');
      const list = mem.getLearnings(5);
      expect(list.length).toBe(1);
      expect(list[0].topic).toBe('os');
      expect(list[0].confidence).toBeCloseTo(0.9);
    });

    test('filters by topic', () => {
      mem.learn('os',  { x: 1 });
      mem.learn('net', { y: 2 });
      const osOnly = mem.getLearnings(10, 'os');
      expect(osOnly.length).toBe(1);
      expect(osOnly[0].topic).toBe('os');
    });

    test('clamps confidence to 0-1', () => {
      mem.learn('topic', {}, 5);
      const list = mem.getLearnings(5);
      expect(list[0].confidence).toBe(1);

      mem.learn('topic2', {}, -3);
      const list2 = mem.getLearnings(5);
      const item = list2.find(l => l.topic === 'topic2');
      expect(item.confidence).toBe(0);
    });
  });

  describe('stats', () => {
    test('returns correct counts', () => {
      mem.recordInteraction('chat', 'a', 'a');
      mem.recordQuery('q', {}, 'test');
      mem.learn('t', {});
      const s = mem.stats();
      expect(s.interactions.count).toBe(1);
      expect(s.queries.count).toBe(1);
      expect(s.learnings.count).toBe(1);
      expect(s.totalRecords).toBe(3);
    });
  });

  describe('clear', () => {
    test('clears all stores', () => {
      mem.recordInteraction('chat', 'x', 'y');
      mem.recordQuery('z', {}, 'test');
      mem.learn('t', {});
      mem.clear();
      const s = mem.stats();
      expect(s.totalRecords).toBe(0);
    });
  });

  describe('commands interface', () => {
    test('memory stats returns stats', () => {
      const r = mem.commands.memory(['stats']);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('Memory Engine');
    });

    test('memory history returns history', () => {
      mem.recordInteraction('chat', 'hi', 'hello');
      const r = mem.commands.memory(['history']);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('chat');
    });

    test('memory queries returns queries', () => {
      mem.recordQuery('test query', {}, 'test');
      const r = mem.commands.memory(['queries']);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('test query');
    });

    test('memory learn returns learnings', () => {
      mem.learn('topic', { x: 1 });
      const r = mem.commands.memory(['learn']);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('topic');
    });

    test('memory clear clears and reports', () => {
      mem.recordInteraction('chat', 'x', 'y');
      const r = mem.commands.memory(['clear']);
      expect(r.status).toBe('ok');
      expect(mem.stats().totalRecords).toBe(0);
    });

    test('memory default with no args shows stats', () => {
      const r = mem.commands.memory([]);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('Memory Engine');
    });
  });

  describe('cap enforcement', () => {
    test('trims interactions when maxInteractions is exceeded', () => {
      const small = createMemoryEngine(null, { maxInteractions: 3 });
      for (let i = 0; i < 5; i++) small.recordInteraction('chat', `msg${i}`, 'r');
      expect(small.getInteractions(10).length).toBe(3);
    });
  });
});
