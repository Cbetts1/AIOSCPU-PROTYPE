'use strict';

const { createKernel } = require('../core/kernel');
const { createFilesystem } = require('../core/filesystem');
const { createStateEngine, STATES } = require('../core/state-engine');

describe('StateEngine', () => {
  let kernel, fs, engine;

  beforeEach(() => {
    kernel = createKernel();
    kernel.boot();
    fs = createFilesystem();
    fs.mkdir('/var/run', { parents: true });
    engine = createStateEngine(kernel, fs);
  });

  afterEach(() => {
    kernel.shutdown();
  });

  describe('STATES constants', () => {
    test('STATES is frozen', () => {
      expect(Object.isFrozen(STATES)).toBe(true);
    });

    test('contains all expected states', () => {
      expect(STATES.INITIALIZING).toBe('INITIALIZING');
      expect(STATES.BOOTING).toBe('BOOTING');
      expect(STATES.RUNNING).toBe('RUNNING');
      expect(STATES.IDLE).toBe('IDLE');
      expect(STATES.DEGRADED).toBe('DEGRADED');
      expect(STATES.SHUTDOWN).toBe('SHUTDOWN');
      expect(STATES.HALTED).toBe('HALTED');
      expect(STATES.RESTARTING).toBe('RESTARTING');
    });
  });

  describe('initial state', () => {
    test('starts in INITIALIZING state', () => {
      expect(engine.get()).toBe('INITIALIZING');
    });

    test('isRunning() is false initially', () => {
      expect(engine.isRunning()).toBe(false);
    });

    test('isBooted() is false initially', () => {
      expect(engine.isBooted()).toBe(false);
    });
  });

  describe('transition', () => {
    test('valid transitions succeed', () => {
      let result = engine.transition('BOOTING');
      expect(result.ok).toBe(true);
      expect(result.from).toBe('INITIALIZING');
      expect(result.to).toBe('BOOTING');
      expect(engine.get()).toBe('BOOTING');

      result = engine.transition('RUNNING');
      expect(result.ok).toBe(true);
      expect(engine.get()).toBe('RUNNING');
    });

    test('invalid transitions fail', () => {
      const result = engine.transition('RUNNING'); // can't go from INITIALIZING to RUNNING
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Invalid transition');
    });

    test('unknown state fails', () => {
      const result = engine.transition('UNKNOWN');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Unknown state');
    });

    test('full boot sequence', () => {
      expect(engine.transition('BOOTING').ok).toBe(true);
      expect(engine.transition('RUNNING').ok).toBe(true);
      expect(engine.isRunning()).toBe(true);
      expect(engine.isBooted()).toBe(true);
    });

    test('RUNNING to IDLE and back', () => {
      engine.transition('BOOTING');
      engine.transition('RUNNING');
      expect(engine.transition('IDLE').ok).toBe(true);
      expect(engine.isRunning()).toBe(true);
      expect(engine.transition('RUNNING').ok).toBe(true);
    });

    test('RUNNING to DEGRADED', () => {
      engine.transition('BOOTING');
      engine.transition('RUNNING');
      expect(engine.transition('DEGRADED').ok).toBe(true);
      expect(engine.get()).toBe('DEGRADED');
    });

    test('shutdown sequence', () => {
      engine.transition('BOOTING');
      engine.transition('RUNNING');
      expect(engine.transition('SHUTDOWN').ok).toBe(true);
      expect(engine.transition('HALTED').ok).toBe(true);
      expect(engine.isRunning()).toBe(false);
      expect(engine.isBooted()).toBe(false);
    });

    test('restart sequence', () => {
      engine.transition('BOOTING');
      engine.transition('RUNNING');
      expect(engine.transition('RESTARTING').ok).toBe(true);
      expect(engine.transition('INITIALIZING').ok).toBe(true);
    });

    test('HALTED to INITIALIZING (reboot)', () => {
      engine.transition('BOOTING');
      engine.transition('RUNNING');
      engine.transition('SHUTDOWN');
      engine.transition('HALTED');
      expect(engine.transition('INITIALIZING').ok).toBe(true);
    });

    test('emits state:changed event', () => {
      const handler = jest.fn();
      kernel.bus.on('state:changed', handler);
      engine.transition('BOOTING');
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        from: 'INITIALIZING',
        to: 'BOOTING',
      }));
    });

    test('persists state to VFS', () => {
      engine.transition('BOOTING');
      const content = fs.read('/var/run/state');
      expect(content.ok).toBe(true);
      const parsed = JSON.parse(content.content.trim());
      expect(parsed.state).toBe('BOOTING');
    });
  });

  describe('history', () => {
    test('records transition history', () => {
      engine.transition('BOOTING');
      engine.transition('RUNNING');
      const hist = engine.history();
      expect(hist).toHaveLength(2);
      expect(hist[0].from).toBe('INITIALIZING');
      expect(hist[0].to).toBe('BOOTING');
      expect(hist[1].from).toBe('BOOTING');
      expect(hist[1].to).toBe('RUNNING');
    });

    test('history returns a copy', () => {
      engine.transition('BOOTING');
      const h1 = engine.history();
      const h2 = engine.history();
      expect(h1).not.toBe(h2);
      expect(h1).toEqual(h2);
    });
  });

  describe('commands interface', () => {
    test('state command returns current state', () => {
      const result = engine.commands.state([]);
      expect(result.status).toBe('ok');
      expect(result.result).toContain('INITIALIZING');
    });

    test('state history command returns history', () => {
      engine.transition('BOOTING');
      const result = engine.commands.state(['history']);
      expect(result.status).toBe('ok');
      expect(result.result).toContain('INITIALIZING');
      expect(result.result).toContain('BOOTING');
    });

    test('state history with no transitions shows empty message', () => {
      const result = engine.commands.state(['history']);
      expect(result.status).toBe('ok');
      expect(result.result).toContain('no transitions yet');
    });
  });

  describe('works without kernel/fs', () => {
    test('creates engine without kernel', () => {
      const eng = createStateEngine(null, null);
      expect(eng.get()).toBe('INITIALIZING');
      expect(eng.transition('BOOTING').ok).toBe(true);
    });
  });
});
