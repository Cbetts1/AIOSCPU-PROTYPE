'use strict';

const { createKernel } = require('../core/kernel');
const { createFilesystem } = require('../core/filesystem');
const { createScheduler } = require('../core/scheduler');

describe('Scheduler', () => {
  let kernel, fs, scheduler;

  beforeEach(() => {
    jest.useFakeTimers();
    kernel = createKernel();
    kernel.boot();
    fs = createFilesystem();
    fs.mkdir('/etc/cron', { parents: true });
    fs.mkdir('/var/log', { parents: true });
    scheduler = createScheduler(kernel, fs, null);
  });

  afterEach(() => {
    scheduler.stop();
    kernel.shutdown();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe('createScheduler', () => {
    test('returns scheduler with expected API', () => {
      expect(scheduler.name).toBe('scheduler');
      expect(scheduler.version).toBe('4.0.0');
      expect(typeof scheduler.addJob).toBe('function');
      expect(typeof scheduler.removeJob).toBe('function');
      expect(typeof scheduler.listJobs).toBe('function');
      expect(typeof scheduler.start).toBe('function');
      expect(typeof scheduler.stop).toBe('function');
    });
  });

  describe('addJob', () => {
    test('adds a cron job', () => {
      const handler = jest.fn();
      const job = scheduler.addJob('test-cron', 'cron', '* * * * *', handler);
      expect(job.name).toBe('test-cron');
      expect(job.type).toBe('cron');
      expect(job.enabled).toBe(true);
    });

    test('adds an interval job', () => {
      const handler = jest.fn();
      const job = scheduler.addJob('test-interval', 'interval', 60000, handler);
      expect(job.name).toBe('test-interval');
      expect(job.type).toBe('interval');
      expect(job._interval).toBeDefined();
      // Clean up interval
      clearInterval(job._interval);
    });

    test('adds a once job (future date)', () => {
      const handler = jest.fn();
      const futureDate = new Date(Date.now() + 60000);
      const job = scheduler.addJob('test-once', 'once', futureDate, handler);
      expect(job.name).toBe('test-once');
      expect(job.type).toBe('once');
      // Clean up timeout
      clearTimeout(job._interval);
    });

    test('throws for missing name', () => {
      expect(() => scheduler.addJob('', 'cron', '* * * * *', jest.fn())).toThrow(TypeError);
    });

    test('throws for invalid handler', () => {
      expect(() => scheduler.addJob('test', 'cron', '* * * * *', 123)).toThrow(TypeError);
    });

    test('accepts string handler (shell command)', () => {
      const job = scheduler.addJob('test', 'cron', '* * * * *', 'echo hello');
      expect(job.handler).toBe('echo hello');
    });

    test('persists job to VFS', () => {
      scheduler.addJob('test', 'cron', '* * * * *', jest.fn());
      const content = fs.read('/etc/cron/test.json');
      expect(content.ok).toBe(true);
      const parsed = JSON.parse(content.content);
      expect(parsed.name).toBe('test');
    });

    test('emits scheduler:job-added event', () => {
      const handler = jest.fn();
      kernel.bus.on('scheduler:job-added', handler);
      scheduler.addJob('test', 'cron', '* * * * *', jest.fn());
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ name: 'test' }));
    });
  });

  describe('removeJob', () => {
    test('removes an existing job', () => {
      scheduler.addJob('test', 'cron', '* * * * *', jest.fn());
      const result = scheduler.removeJob('test');
      expect(result.ok).toBe(true);
      expect(scheduler.listJobs()).toHaveLength(0);
    });

    test('returns error for non-existent job', () => {
      const result = scheduler.removeJob('nonexistent');
      expect(result.ok).toBe(false);
    });

    test('clears interval on interval job removal', () => {
      const job = scheduler.addJob('test', 'interval', 60000, jest.fn());
      const clearSpy = jest.spyOn(global, 'clearInterval');
      scheduler.removeJob('test');
      expect(clearSpy).toHaveBeenCalled();
    });
  });

  describe('enableJob / disableJob', () => {
    test('disables a job', () => {
      scheduler.addJob('test', 'cron', '* * * * *', jest.fn());
      const result = scheduler.disableJob('test');
      expect(result.ok).toBe(true);
      const jobs = scheduler.listJobs();
      expect(jobs[0].enabled).toBe(false);
    });

    test('enables a job', () => {
      scheduler.addJob('test', 'cron', '* * * * *', jest.fn());
      scheduler.disableJob('test');
      const result = scheduler.enableJob('test');
      expect(result.ok).toBe(true);
      expect(scheduler.listJobs()[0].enabled).toBe(true);
    });

    test('returns error for non-existent job', () => {
      expect(scheduler.enableJob('x').ok).toBe(false);
      expect(scheduler.disableJob('x').ok).toBe(false);
    });
  });

  describe('runNow', () => {
    test('runs a function handler immediately', async () => {
      const handler = jest.fn();
      scheduler.addJob('test', 'cron', '* * * * *', handler);
      const result = await scheduler.runNow('test');
      expect(result.ok).toBe(true);
      expect(handler).toHaveBeenCalled();
    });

    test('returns error for non-existent job', async () => {
      const result = await scheduler.runNow('nonexistent');
      expect(result.ok).toBe(false);
    });

    test('tracks run count', async () => {
      const handler = jest.fn();
      scheduler.addJob('test', 'cron', '* * * * *', handler);
      await scheduler.runNow('test');
      await scheduler.runNow('test');
      const jobs = scheduler.listJobs();
      expect(jobs[0].runCount).toBe(2);
    });

    test('records lastError on failure', async () => {
      scheduler.addJob('test', 'cron', '* * * * *', () => { throw new Error('fail'); });
      await scheduler.runNow('test');
      const jobs = scheduler.listJobs();
      expect(jobs[0].lastError).toBe('fail');
    });

    test('skips disabled jobs', async () => {
      const handler = jest.fn();
      scheduler.addJob('test', 'cron', '* * * * *', handler);
      scheduler.disableJob('test');
      await scheduler.runNow('test');
      // runNow calls _runJob which checks enabled
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('listJobs', () => {
    test('lists all jobs', () => {
      scheduler.addJob('a', 'cron', '* * * * *', jest.fn());
      scheduler.addJob('b', 'cron', '0 * * * *', jest.fn());
      const jobs = scheduler.listJobs();
      expect(jobs).toHaveLength(2);
      expect(jobs[0].name).toBe('a');
      expect(jobs[1].name).toBe('b');
    });

    test('returns empty for no jobs', () => {
      expect(scheduler.listJobs()).toHaveLength(0);
    });
  });

  describe('start / stop', () => {
    test('start and stop are safe to call', () => {
      expect(() => {
        scheduler.start();
        scheduler.stop();
      }).not.toThrow();
    });

    test('start is idempotent', () => {
      scheduler.start();
      scheduler.start(); // no error
      scheduler.stop();
    });
  });

  describe('commands interface', () => {
    test('cron list command', async () => {
      const result = await scheduler.commands.cron(['list']);
      expect(result.status).toBe('ok');
      expect(result.result).toContain('No scheduled jobs');
    });

    test('cron list with jobs', async () => {
      scheduler.addJob('test', 'cron', '* * * * *', jest.fn());
      const result = await scheduler.commands.cron(['list']);
      expect(result.status).toBe('ok');
      expect(result.result).toContain('test');
    });

    test('cron default shows list', async () => {
      const result = await scheduler.commands.cron([]);
      expect(result.status).toBe('ok');
    });

    test('cron add command', async () => {
      const result = await scheduler.commands.cron(['add', 'test', 'cron', '* * * * *', 'echo', 'hello']);
      expect(result.status).toBe('ok');
      expect(result.result).toContain('test');
    });

    test('cron add without params shows usage', async () => {
      const result = await scheduler.commands.cron(['add']);
      expect(result.status).toBe('error');
      expect(result.result).toContain('Usage');
    });

    test('cron remove command', async () => {
      scheduler.addJob('test', 'cron', '* * * * *', jest.fn());
      const result = await scheduler.commands.cron(['remove', 'test']);
      expect(result.status).toBe('ok');
    });

    test('cron rm command', async () => {
      scheduler.addJob('test', 'cron', '* * * * *', jest.fn());
      const result = await scheduler.commands.cron(['rm', 'test']);
      expect(result.status).toBe('ok');
    });

    test('cron run command', async () => {
      scheduler.addJob('test', 'cron', '* * * * *', jest.fn());
      const result = await scheduler.commands.cron(['run', 'test']);
      expect(result.status).toBe('ok');
    });

    test('cron enable/disable commands', async () => {
      scheduler.addJob('test', 'cron', '* * * * *', jest.fn());
      const r1 = await scheduler.commands.cron(['disable', 'test']);
      expect(r1.status).toBe('ok');
      const r2 = await scheduler.commands.cron(['enable', 'test']);
      expect(r2.status).toBe('ok');
    });

    test('cron unknown subcommand shows usage', async () => {
      const result = await scheduler.commands.cron(['unknown']);
      expect(result.status).toBe('error');
      expect(result.result).toContain('Usage');
    });
  });

  describe('without dependencies', () => {
    test('works without kernel and filesystem', () => {
      const s = createScheduler(null, null, null);
      const job = s.addJob('test', 'cron', '* * * * *', jest.fn());
      expect(job.name).toBe('test');
      s.stop();
    });
  });
});
