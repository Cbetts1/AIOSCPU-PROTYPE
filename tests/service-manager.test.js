'use strict';

const { createKernel } = require('../core/kernel');
const { createServiceManager, STATE } = require('../core/service-manager');

describe('ServiceManager', () => {
  let kernel, svc;

  beforeEach(() => {
    kernel = createKernel();
    kernel.boot();
    // Suppress syscall stdout writes
    jest.spyOn(process.stdout, 'write').mockImplementation(() => {});
    svc = createServiceManager(kernel);
  });

  afterEach(() => {
    process.stdout.write.mockRestore();
    kernel.shutdown();
  });

  describe('STATE constants', () => {
    test('STATE is frozen', () => {
      expect(Object.isFrozen(STATE)).toBe(true);
    });

    test('contains expected states', () => {
      expect(STATE.STOPPED).toBe('stopped');
      expect(STATE.STARTING).toBe('starting');
      expect(STATE.RUNNING).toBe('running');
      expect(STATE.STOPPING).toBe('stopping');
      expect(STATE.FAILED).toBe('failed');
    });
  });

  describe('register', () => {
    test('registers a service', () => {
      svc.register('test-svc', { start: jest.fn(), stop: jest.fn() });
      const services = svc.list();
      expect(services).toHaveLength(1);
      expect(services[0].name).toBe('test-svc');
      expect(services[0].state).toBe('stopped');
    });

    test('throws for empty name', () => {
      expect(() => svc.register('', {})).toThrow(TypeError);
    });

    test('throws for non-string name', () => {
      expect(() => svc.register(123, {})).toThrow(TypeError);
    });

    test('throws for non-object descriptor', () => {
      expect(() => svc.register('test', null)).toThrow(TypeError);
      expect(() => svc.register('test', 'string')).toThrow(TypeError);
    });

    test('emits service:registered event', () => {
      const handler = jest.fn();
      kernel.bus.on('service:registered', handler);
      svc.register('test-svc', {});
      expect(handler).toHaveBeenCalledWith({ name: 'test-svc' });
    });
  });

  describe('start', () => {
    test('starts a registered service', async () => {
      const startFn = jest.fn();
      svc.register('test', { start: startFn });
      const result = await svc.start('test');
      expect(result.ok).toBe(true);
      expect(startFn).toHaveBeenCalledWith(kernel);
    });

    test('returns error for unregistered service', async () => {
      const result = await svc.start('nonexistent');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('not registered');
    });

    test('returns ok if already running', async () => {
      svc.register('test', { start: jest.fn() });
      await svc.start('test');
      const result = await svc.start('test');
      expect(result.ok).toBe(true);
      expect(result.note).toBe('already running');
    });

    test('handles start failure', async () => {
      svc.register('test', { start: () => { throw new Error('boot fail'); } });
      const result = await svc.start('test');
      expect(result.ok).toBe(false);
      expect(result.error).toBe('boot fail');
      expect(svc.status('test').state).toBe('failed');
    });

    test('emits service:started event', async () => {
      const handler = jest.fn();
      kernel.bus.on('service:started', handler);
      svc.register('test', {});
      await svc.start('test');
      expect(handler).toHaveBeenCalledWith({ name: 'test' });
    });

    test('emits service:failed event on failure', async () => {
      const handler = jest.fn();
      kernel.bus.on('service:failed', handler);
      svc.register('test', { start: () => { throw new Error('err'); } });
      await svc.start('test');
      expect(handler).toHaveBeenCalledWith({ name: 'test', error: 'err' });
    });
  });

  describe('stop', () => {
    test('stops a running service', async () => {
      const stopFn = jest.fn();
      svc.register('test', { start: jest.fn(), stop: stopFn });
      await svc.start('test');
      const result = await svc.stop('test');
      expect(result.ok).toBe(true);
      expect(stopFn).toHaveBeenCalledWith(kernel);
    });

    test('returns ok if already stopped', async () => {
      svc.register('test', {});
      const result = await svc.stop('test');
      expect(result.ok).toBe(true);
      expect(result.note).toBe('already stopped');
    });

    test('returns error for unregistered service', async () => {
      const result = await svc.stop('nonexistent');
      expect(result.ok).toBe(false);
    });

    test('handles stop failure', async () => {
      svc.register('test', { start: jest.fn(), stop: () => { throw new Error('stop fail'); } });
      await svc.start('test');
      const result = await svc.stop('test');
      expect(result.ok).toBe(false);
      expect(result.error).toBe('stop fail');
    });
  });

  describe('restart', () => {
    test('restarts a running service', async () => {
      const startFn = jest.fn();
      const stopFn = jest.fn();
      svc.register('test', { start: startFn, stop: stopFn });
      await svc.start('test');
      const result = await svc.restart('test');
      expect(result.ok).toBe(true);
      expect(stopFn).toHaveBeenCalled();
      expect(startFn).toHaveBeenCalledTimes(2);
    });
  });

  describe('status', () => {
    test('returns status of a service', () => {
      svc.register('test', {});
      const result = svc.status('test');
      expect(result.ok).toBe(true);
      expect(result.name).toBe('test');
      expect(result.state).toBe('stopped');
    });

    test('returns error for unregistered service', () => {
      const result = svc.status('nonexistent');
      expect(result.ok).toBe(false);
    });
  });

  describe('list', () => {
    test('returns all services', () => {
      svc.register('a', {});
      svc.register('b', {});
      const list = svc.list();
      expect(list).toHaveLength(2);
    });
  });

  describe('stopAll', () => {
    test('stops all running services', async () => {
      const stop1 = jest.fn();
      const stop2 = jest.fn();
      svc.register('a', { start: jest.fn(), stop: stop1 });
      svc.register('b', { start: jest.fn(), stop: stop2 });
      await svc.start('a');
      await svc.start('b');
      await svc.stopAll();
      expect(stop1).toHaveBeenCalled();
      expect(stop2).toHaveBeenCalled();
    });
  });

  describe('commands interface', () => {
    test('svc list command', async () => {
      svc.register('test', {});
      const result = await svc.commands.svc(['list']);
      expect(result.status).toBe('ok');
    });

    test('svc list with no services', async () => {
      const result = await svc.commands.svc(['list']);
      expect(result.status).toBe('ok');
      expect(result.result).toContain('No services');
    });

    test('svc status command', async () => {
      svc.register('test', {});
      const result = await svc.commands.svc(['status', 'test']);
      expect(result.status).toBe('ok');
    });

    test('svc start command', async () => {
      svc.register('test', {});
      const result = await svc.commands.svc(['start', 'test']);
      expect(result.status).toBe('ok');
    });

    test('svc stop command', async () => {
      svc.register('test', {});
      await svc.start('test');
      const result = await svc.commands.svc(['stop', 'test']);
      expect(result.status).toBe('ok');
    });

    test('svc restart command', async () => {
      svc.register('test', {});
      await svc.start('test');
      const result = await svc.commands.svc(['restart', 'test']);
      expect(result.status).toBe('ok');
    });

    test('svc with no action shows usage', async () => {
      const result = await svc.commands.svc([]);
      expect(result.status).toBe('error');
      expect(result.result).toContain('Usage');
    });

    test('svc with unknown action shows error', async () => {
      const result = await svc.commands.svc(['unknown']);
      expect(result.status).toBe('error');
    });

    test('svc status without name shows usage', async () => {
      const result = await svc.commands.svc(['status']);
      expect(result.status).toBe('error');
    });

    test('svc start without name shows usage', async () => {
      const result = await svc.commands.svc(['start']);
      expect(result.status).toBe('error');
    });
  });
});
