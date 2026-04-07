'use strict';

const { createMemoryEngine } = require('../core/memory-engine');
const { createKernel }       = require('../core/kernel');

describe('MemoryEngine', () => {
  let kernel;
  let memory;

  beforeEach(() => {
    kernel = createKernel();
    kernel.boot();
    memory = createMemoryEngine(kernel, null);  // no VFS in unit tests
  });

  afterEach(() => {
    kernel.shutdown();
  });

  describe('createMemoryEngine', () => {
    test('returns memory engine with expected API', () => {
      expect(memory).toBeDefined();
      expect(memory.name).toBe('memory-engine');
      expect(memory.version).toBe('4.0.0');
      expect(typeof memory.store).toBe('function');
      expect(typeof memory.retrieve).toBe('function');
      expect(typeof memory.forget).toBe('function');
      expect(typeof memory.append).toBe('function');
      expect(typeof memory.getHistory).toBe('function');
      expect(typeof memory.learn).toBe('function');
      expect(typeof memory.getFacts).toBe('function');
      expect(typeof memory.persist).toBe('function');
      expect(typeof memory.load).toBe('function');
      expect(typeof memory.summary).toBe('function');
      expect(memory.commands).toBeDefined();
    });
  });

  describe('store / retrieve / forget', () => {
    test('stores and retrieves a value', () => {
      memory.store('foo', 'bar');
      expect(memory.retrieve('foo')).toBe('bar');
    });

    test('stores objects', () => {
      memory.store('obj', { x: 1 });
      expect(memory.retrieve('obj')).toEqual({ x: 1 });
    });

    test('retrieve returns undefined for unknown key', () => {
      expect(memory.retrieve('nonexistent')).toBeUndefined();
    });

    test('forget removes a key', () => {
      memory.store('key', 'val');
      memory.forget('key');
      expect(memory.retrieve('key')).toBeUndefined();
    });

    test('store throws for empty key', () => {
      expect(() => memory.store('', 'val')).toThrow(TypeError);
      expect(() => memory.store(null, 'val')).toThrow(TypeError);
    });

    test('listKeys returns all stored keys', () => {
      memory.store('a', 1);
      memory.store('b', 2);
      const keys = memory.listKeys();
      expect(keys).toContain('a');
      expect(keys).toContain('b');
    });

    test('store emits memory:stored event', () => {
      const handler = jest.fn();
      kernel.bus.on('memory:stored', handler);
      memory.store('key', 'val');
      expect(handler).toHaveBeenCalledWith({ key: 'key' });
    });
  });

  describe('interaction history', () => {
    test('append adds entries to history', () => {
      memory.append({ role: 'user', content: 'hello' });
      const hist = memory.getHistory(10);
      expect(hist).toHaveLength(1);
      expect(hist[0].content).toBe('hello');
      expect(hist[0].role).toBe('user');
    });

    test('getHistory returns N most recent entries', () => {
      for (let i = 0; i < 10; i++) {
        memory.append({ role: 'user', content: `msg ${i}` });
      }
      expect(memory.getHistory(5)).toHaveLength(5);
    });

    test('append defaults role to "user"', () => {
      memory.append({ content: 'test' });
      expect(memory.getHistory(1)[0].role).toBe('user');
    });

    test('append ignores entries without content', () => {
      memory.append(null);
      memory.append({ role: 'user' });
      expect(memory.getHistory(10)).toHaveLength(0);
    });

    test('clearHistory empties history', () => {
      memory.append({ role: 'user', content: 'hi' });
      memory.clearHistory();
      expect(memory.getHistory(10)).toHaveLength(0);
    });

    test('append emits memory:appended event', () => {
      const handler = jest.fn();
      kernel.bus.on('memory:appended', handler);
      memory.append({ role: 'user', content: 'test' });
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('learning', () => {
    test('learn stores a fact', () => {
      memory.learn({ content: 'AIOS is an AI OS' });
      const facts = memory.getFacts();
      expect(facts).toHaveLength(1);
      expect(facts[0].content).toBe('AIOS is an AI OS');
      expect(facts[0].confidence).toBe(1.0);
    });

    test('learn ignores empty content', () => {
      memory.learn({ content: '' });
      memory.learn(null);
      expect(memory.getFacts()).toHaveLength(0);
    });

    test('learn stores source and confidence', () => {
      memory.learn({ content: 'fact', source: 'test', confidence: 0.8 });
      const fact = memory.getFacts()[0];
      expect(fact.source).toBe('test');
      expect(fact.confidence).toBe(0.8);
    });

    test('learn emits memory:learned event', () => {
      const handler = jest.fn();
      kernel.bus.on('memory:learned', handler);
      memory.learn({ content: 'a fact' });
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('summary', () => {
    test('returns correct counts', () => {
      memory.store('k', 'v');
      memory.append({ role: 'user', content: 'hi' });
      memory.learn({ content: 'fact' });
      const s = memory.summary();
      expect(s.contextKeys).toBe(1);
      expect(s.historyEntries).toBe(1);
      expect(s.learnedFacts).toBe(1);
    });
  });

  describe('persistence (without VFS)', () => {
    test('persist and load do not throw when vfs is null', () => {
      expect(() => memory.persist()).not.toThrow();
      expect(() => memory.load()).not.toThrow();
    });
  });

  describe('commands', () => {
    test('memory summary command', () => {
      const r = memory.commands.memory([]);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('Memory Engine');
    });

    test('memory history command', () => {
      memory.append({ role: 'user', content: 'hello' });
      const r = memory.commands.memory(['history']);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('hello');
    });

    test('memory history empty', () => {
      const r = memory.commands.memory(['history']);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('No history');
    });

    test('memory facts command', () => {
      memory.learn({ content: 'test fact' });
      const r = memory.commands.memory(['facts']);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('test fact');
    });

    test('memory facts empty', () => {
      const r = memory.commands.memory(['facts']);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('No facts');
    });

    test('memory store command', () => {
      const r = memory.commands.memory(['store', 'mykey', 'myvalue']);
      expect(r.status).toBe('ok');
      expect(memory.retrieve('mykey')).toBe('myvalue');
    });

    test('memory get command', () => {
      memory.store('x', 42);
      const r = memory.commands.memory(['get', 'x']);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('42');
    });

    test('memory get missing key', () => {
      const r = memory.commands.memory(['get', 'missing']);
      expect(r.status).toBe('error');
    });

    test('memory forget command', () => {
      memory.store('del', 'v');
      const r = memory.commands.memory(['forget', 'del']);
      expect(r.status).toBe('ok');
      expect(memory.retrieve('del')).toBeUndefined();
    });

    test('memory keys command', () => {
      memory.store('alpha', 1);
      const r = memory.commands.memory(['keys']);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('alpha');
    });

    test('memory persist command', () => {
      const r = memory.commands.memory(['persist']);
      expect(r.status).toBe('ok');
    });

    test('memory clear command', () => {
      memory.append({ role: 'user', content: 'hello' });
      const r = memory.commands.memory(['clear']);
      expect(r.status).toBe('ok');
      expect(memory.getHistory(10)).toHaveLength(0);
    });

    test('memory unknown sub returns usage', () => {
      const r = memory.commands.memory(['unknown']);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('Usage');
    });
  });
});
