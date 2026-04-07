'use strict';

const { createModelRegistry } = require('../core/model-registry');
const { createKernel }        = require('../core/kernel');

describe('ModelRegistry', () => {
  let kernel;
  let registry;

  beforeEach(() => {
    kernel = createKernel();
    kernel.boot();
    registry = createModelRegistry(kernel, null, null);
  });

  afterEach(() => {
    kernel.shutdown();
  });

  describe('createModelRegistry', () => {
    test('returns object with expected API', () => {
      expect(registry).toBeDefined();
      expect(registry.name).toBe('model-registry');
      expect(registry.version).toBe('4.0.0');
      expect(typeof registry.register).toBe('function');
      expect(typeof registry.assignMode).toBe('function');
      expect(typeof registry.validate).toBe('function');
      expect(typeof registry.discover).toBe('function');
      expect(typeof registry.idleModel).toBe('function');
      expect(typeof registry.wakeModel).toBe('function');
      expect(typeof registry.list).toBe('function');
      expect(typeof registry.getModel).toBe('function');
      expect(typeof registry.getBestForMode).toBe('function');
      expect(registry.commands).toBeDefined();
    });

    test('built-in NLP model is pre-registered', () => {
      const models = registry.list();
      const builtin = models.find(m => m.name === 'built-in-nlp');
      expect(builtin).toBeDefined();
      expect(builtin.type).toBe('builtin');
      expect(builtin.available).toBe(true);
      expect(builtin.healthy).toBe(true);
    });
  });

  describe('register', () => {
    test('registers a model', () => {
      const m = registry.register({ name: 'test-model', type: 'ollama', endpoint: 'http://localhost:11434', modes: ['chat'] });
      expect(m.name).toBe('test-model');
      expect(registry.getModel('test-model')).toBeDefined();
    });

    test('throws for missing name', () => {
      expect(() => registry.register({ type: 'ollama' })).toThrow(TypeError);
      expect(() => registry.register({ name: '', type: 'ollama' })).toThrow(TypeError);
    });

    test('register emits model:registered event', () => {
      const handler = jest.fn();
      kernel.bus.on('model:registered', handler);
      registry.register({ name: 'new-model', type: 'test', modes: ['chat'] });
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ name: 'new-model' }));
    });

    test('defaults modes to [chat] when not specified', () => {
      const m = registry.register({ name: 'default-mode-model', type: 'test' });
      expect(m.modes).toEqual(['chat']);
    });
  });

  describe('assignMode', () => {
    test('adds a mode to an existing model', () => {
      registry.register({ name: 'test', type: 'test', modes: ['chat'] });
      const r = registry.assignMode('test', 'code');
      expect(r.ok).toBe(true);
      expect(registry.getModel('test').modes).toContain('code');
    });

    test('does not duplicate modes', () => {
      registry.register({ name: 'test', type: 'test', modes: ['chat'] });
      registry.assignMode('test', 'chat');
      expect(registry.getModel('test').modes.filter(m => m === 'chat')).toHaveLength(1);
    });

    test('returns error for unknown model', () => {
      const r = registry.assignMode('nonexistent', 'chat');
      expect(r.ok).toBe(false);
      expect(r.error).toBeDefined();
    });
  });

  describe('list / getModel', () => {
    test('list returns all models', () => {
      registry.register({ name: 'm1', type: 'test', modes: ['chat'] });
      const models = registry.list();
      expect(models.find(m => m.name === 'm1')).toBeDefined();
    });

    test('getModel returns null for unknown name', () => {
      expect(registry.getModel('unknown')).toBeNull();
    });
  });

  describe('idleModel / wakeModel', () => {
    test('idle sets model idle flag', () => {
      registry.register({ name: 'heavy', type: 'test', modes: ['chat'] });
      registry.idleModel('heavy');
      expect(registry.getModel('heavy').idle).toBe(true);
    });

    test('wake clears idle flag', () => {
      registry.register({ name: 'heavy', type: 'test', modes: ['chat'] });
      registry.idleModel('heavy');
      registry.wakeModel('heavy');
      expect(registry.getModel('heavy').idle).toBe(false);
    });

    test('idle emits model:idle event', () => {
      const handler = jest.fn();
      kernel.bus.on('model:idle', handler);
      registry.register({ name: 'h2', type: 'test', modes: ['chat'] });
      registry.idleModel('h2');
      expect(handler).toHaveBeenCalledWith({ name: 'h2' });
    });

    test('wake emits model:wake event', () => {
      const handler = jest.fn();
      kernel.bus.on('model:wake', handler);
      registry.register({ name: 'h3', type: 'test', modes: ['chat'] });
      registry.wakeModel('h3');
      expect(handler).toHaveBeenCalledWith({ name: 'h3' });
    });
  });

  describe('getBestForMode', () => {
    test('returns built-in for chat when no other model registered', () => {
      const m = registry.getBestForMode('chat');
      expect(m).toBeDefined();
      expect(m.name).toBe('built-in-nlp');
    });

    test('returns null for mode with no models', () => {
      const m = registry.getBestForMode('nonexistent-mode');
      expect(m).toBeNull();
    });

    test('prefers non-idle non-builtin model', () => {
      registry.register({ name: 'premium', type: 'ollama', endpoint: 'http://x', modes: ['chat'], available: true, healthy: true });
      const m = registry.getBestForMode('chat');
      expect(m.name).toBe('premium');
    });

    test('falls back to built-in when preferred model is idle', () => {
      registry.register({ name: 'premium2', type: 'ollama', endpoint: 'http://x', modes: ['chat'], available: true, healthy: true });
      registry.idleModel('premium2');
      // non-idle: built-in-nlp
      const m = registry.getBestForMode('chat');
      expect(m).toBeDefined();
    });
  });

  describe('validate', () => {
    test('validates built-in model successfully', async () => {
      const r = await registry.validate('built-in-nlp');
      expect(r.ok).toBe(true);
      expect(r.score).toBeGreaterThan(0);
      expect(Array.isArray(r.checks)).toBe(true);
    });

    test('returns not-ok for unknown model', async () => {
      const r = await registry.validate('nonexistent');
      expect(r.ok).toBe(false);
    });

    test('checks include registry-entry, available, reachable, modes', async () => {
      const r = await registry.validate('built-in-nlp');
      const names = r.checks.map(c => c.name);
      expect(names).toContain('registry-entry');
      expect(names).toContain('available');
      expect(names).toContain('reachable');
      expect(names).toContain('modes');
    });
  });

  describe('discover', () => {
    test('runs without throwing even when no models are available', async () => {
      const r = await registry.discover();
      expect(r).toBeDefined();
      expect(typeof r.total).toBe('number');
      expect(Array.isArray(r.discovered)).toBe(true);
      expect(r.total).toBeGreaterThanOrEqual(1); // at least built-in
    });

    test('emits discovery events', async () => {
      const start = jest.fn();
      const done  = jest.fn();
      kernel.bus.on('model:discovery-start', start);
      kernel.bus.on('model:discovery-done',  done);
      await registry.discover();
      expect(start).toHaveBeenCalled();
      expect(done).toHaveBeenCalled();
    });
  });

  describe('commands', () => {
    test('models list command', async () => {
      const r = await registry.commands.models(['list']);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('built-in-nlp');
    });

    test('models discover command', async () => {
      const r = await registry.commands.models(['discover']);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('Discovery complete');
    });

    test('models validate command', async () => {
      const r = await registry.commands.models(['validate', 'built-in-nlp']);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('built-in-nlp');
      expect(r.result).toContain('score=');
    });

    test('models idle command', async () => {
      const r = await registry.commands.models(['idle', 'built-in-nlp']);
      expect(r.status).toBe('ok');
    });

    test('models wake command', async () => {
      const r = await registry.commands.models(['wake', 'built-in-nlp']);
      expect(r.status).toBe('ok');
    });

    test('models assign command', async () => {
      registry.register({ name: 'assignable', type: 'test', modes: [] });
      const r = await registry.commands.models(['assign', 'assignable', 'chat', 'code']);
      expect(r.status).toBe('ok');
    });

    test('models default shows usage', async () => {
      const r = await registry.commands.models(['unknown-sub']);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('Usage');
    });
  });
});
