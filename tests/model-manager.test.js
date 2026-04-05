'use strict';

const { createKernel }       = require('../core/kernel');
const { createFilesystem }   = require('../core/filesystem');
const { createIPC }          = require('../core/ipc');
const {
  createModelManager,
  MODE_ASSIGNMENTS,
  MODEL_TYPES,
  MODEL_STATES,
} = require('../core/model-manager');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBackend(response) {
  return { query: jest.fn().mockResolvedValue(response) };
}

function makeErrorBackend(message) {
  return { query: jest.fn().mockRejectedValue(new Error(message)) };
}

function setup(opts = {}) {
  const kernel = createKernel();
  kernel.boot();
  const fs  = createFilesystem();
  fs.mkdir('/var/run/ipc/pipes', { parents: true });
  const ipc = createIPC(kernel, fs);
  const mgr = createModelManager(
    opts.noKernel  ? null : kernel,
    opts.noIPC     ? null : ipc,
    opts.network   || null
  );
  return { kernel, fs, ipc, mgr };
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('ModelManager — constants', () => {
  test('exports AIOS_PORT', () => {
    const { mgr } = setup();
    expect(typeof mgr.AIOS_PORT).toBe('number');
    expect(mgr.AIOS_PORT).toBeGreaterThan(0);
  });

  test('MODE_ASSIGNMENTS maps local modes', () => {
    expect(MODE_ASSIGNMENTS.chat).toBe('local');
    expect(MODE_ASSIGNMENTS.help).toBe('local');
    expect(MODE_ASSIGNMENTS.quickfix).toBe('local');
  });

  test('MODE_ASSIGNMENTS maps remote modes', () => {
    expect(MODE_ASSIGNMENTS.code).toBe('remote');
    expect(MODE_ASSIGNMENTS.fix).toBe('remote');
    expect(MODE_ASSIGNMENTS.learn).toBe('remote');
  });

  test('MODEL_TYPES exposes LOCAL and REMOTE', () => {
    expect(MODEL_TYPES.LOCAL).toBe('local');
    expect(MODEL_TYPES.REMOTE).toBe('remote');
  });

  test('MODEL_STATES are frozen', () => {
    expect(Object.isFrozen(MODEL_STATES)).toBe(true);
    expect(MODEL_STATES.OFFLINE).toBeDefined();
    expect(MODEL_STATES.ONLINE).toBeDefined();
    expect(MODEL_STATES.IDLE).toBeDefined();
    expect(MODEL_STATES.ERROR).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// registerModel
// ---------------------------------------------------------------------------

describe('ModelManager — registerModel', () => {
  test('registers a local model', () => {
    const { mgr } = setup();
    const r = mgr.registerModel({ id: 'local-1', name: 'TinyLlama', type: 'local' });
    expect(r.ok).toBe(true);
    expect(r.id).toBe('local-1');
  });

  test('registers a remote model', () => {
    const { mgr } = setup();
    const r = mgr.registerModel({ id: 'remote-1', name: 'GPT4', type: 'remote', endpoint: 'http://host/api' });
    expect(r.ok).toBe(true);
  });

  test('throws when id is missing', () => {
    const { mgr } = setup();
    expect(() => mgr.registerModel({ name: 'X', type: 'local' })).toThrow();
  });

  test('throws when name is missing', () => {
    const { mgr } = setup();
    expect(() => mgr.registerModel({ id: 'x', type: 'local' })).toThrow();
  });

  test('throws when type is missing', () => {
    const { mgr } = setup();
    expect(() => mgr.registerModel({ id: 'x', name: 'X' })).toThrow();
  });

  test('throws on unknown type', () => {
    const { mgr } = setup();
    expect(() => mgr.registerModel({ id: 'x', name: 'X', type: 'mega' })).toThrow(/unknown type/i);
  });

  test('emits model:registered event on kernel bus', () => {
    const { kernel, mgr } = setup();
    const handler = jest.fn();
    kernel.bus.on('model:registered', handler);
    mgr.registerModel({ id: 'local-1', name: 'TinyLlama', type: 'local' });
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ id: 'local-1', type: 'local' }));
  });

  test('local model has chat/help/quickfix modes', () => {
    const { mgr } = setup();
    mgr.registerModel({ id: 'l', name: 'Tiny', type: 'local' });
    const s = mgr.status()[0];
    expect(s.modes).toContain('chat');
    expect(s.modes).toContain('help');
    expect(s.modes).toContain('quickfix');
    expect(s.modes).not.toContain('code');
  });

  test('remote model has code/fix/learn modes', () => {
    const { mgr } = setup();
    mgr.registerModel({ id: 'r', name: 'GPT', type: 'remote', endpoint: 'http://ep' });
    const s = mgr.status()[0];
    expect(s.modes).toContain('code');
    expect(s.modes).toContain('fix');
    expect(s.modes).toContain('learn');
    expect(s.modes).not.toContain('chat');
  });

  test('new model starts in OFFLINE state', () => {
    const { mgr } = setup();
    mgr.registerModel({ id: 'l', name: 'X', type: 'local' });
    expect(mgr.status()[0].state).toBe(MODEL_STATES.OFFLINE);
  });
});

// ---------------------------------------------------------------------------
// connect / virtual channel
// ---------------------------------------------------------------------------

describe('ModelManager — connect', () => {
  test('local model without backend connects immediately (no validation)', async () => {
    const { mgr } = setup();
    mgr.registerModel({ id: 'l', name: 'Tiny', type: 'local' });
    const r = await mgr.connect('l');
    expect(r.ok).toBe(true);
    expect(r.validated).toBe(false);
    expect(mgr.status()[0].state).toBe(MODEL_STATES.ONLINE);
  });

  test('local model with backend validates via sample query', async () => {
    const { mgr } = setup();
    mgr.registerModel({ id: 'l', name: 'Tiny', type: 'local' });
    mgr.setModelBackend('l', makeBackend('pong'));
    const r = await mgr.connect('l');
    expect(r.ok).toBe(true);
    expect(r.validated).toBe(true);
  });

  test('connect returns error for unknown model', async () => {
    const { mgr } = setup();
    const r = await mgr.connect('nonexistent');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not found/i);
  });

  test('connect opens IPC pipe channel', async () => {
    const { ipc, mgr } = setup();
    mgr.registerModel({ id: 'l', name: 'Tiny', type: 'local' });
    await mgr.connect('l');
    const snap = ipc.status();
    const pipe = snap.pipes.find(p => p.name === 'model:channel:l');
    expect(pipe).toBeDefined();
  });

  test('connect allocates shared memory for output', async () => {
    const { ipc, mgr } = setup();
    mgr.registerModel({ id: 'l', name: 'Tiny', type: 'local' });
    await mgr.connect('l');
    const snap = ipc.status();
    expect(snap.shm).toContain('model:output:l');
  });

  test('emits model:connecting and model:connected events', async () => {
    const { kernel, mgr } = setup();
    const connecting = jest.fn();
    const connected  = jest.fn();
    kernel.bus.on('model:connecting', connecting);
    kernel.bus.on('model:connected',  connected);
    mgr.registerModel({ id: 'l', name: 'Tiny', type: 'local' });
    await mgr.connect('l');
    expect(connecting).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'l' }));
    expect(connected).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'l' }));
  });

  test('failed backend validation sets ERROR state', async () => {
    const { mgr } = setup();
    mgr.registerModel({ id: 'l', name: 'Tiny', type: 'local' });
    mgr.setModelBackend('l', makeErrorBackend('backend crash'));
    const r = await mgr.connect('l');
    expect(r.ok).toBe(false);
    expect(mgr.status()[0].state).toBe(MODEL_STATES.ERROR);
  });

  test('emits model:channel-opened with pipe and port', async () => {
    const { kernel, mgr } = setup();
    const handler = jest.fn();
    kernel.bus.on('model:channel-opened', handler);
    mgr.registerModel({ id: 'l', name: 'Tiny', type: 'local' });
    await mgr.connect('l');
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({
      modelId: 'l',
      pipe:    'model:channel:l',
      port:    mgr.AIOS_PORT,
    }));
  });
});

// ---------------------------------------------------------------------------
// disconnect
// ---------------------------------------------------------------------------

describe('ModelManager — disconnect', () => {
  test('disconnect sets model to OFFLINE', async () => {
    const { mgr } = setup();
    mgr.registerModel({ id: 'l', name: 'X', type: 'local' });
    await mgr.connect('l');
    mgr.disconnect('l');
    expect(mgr.status()[0].state).toBe(MODEL_STATES.OFFLINE);
  });

  test('disconnect returns error for unknown model', () => {
    const { mgr } = setup();
    const r = mgr.disconnect('nonexistent');
    expect(r.ok).toBe(false);
  });

  test('disconnect closes IPC pipe', async () => {
    const { ipc, mgr } = setup();
    mgr.registerModel({ id: 'l', name: 'X', type: 'local' });
    await mgr.connect('l');
    mgr.disconnect('l');
    const snap = ipc.status();
    expect(snap.pipes.find(p => p.name === 'model:channel:l')).toBeUndefined();
  });

  test('emits model:disconnected event', async () => {
    const { kernel, mgr } = setup();
    const handler = jest.fn();
    kernel.bus.on('model:disconnected', handler);
    mgr.registerModel({ id: 'l', name: 'X', type: 'local' });
    await mgr.connect('l');
    mgr.disconnect('l');
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'l' }));
  });
});

// ---------------------------------------------------------------------------
// query
// ---------------------------------------------------------------------------

describe('ModelManager — query', () => {
  test('query returns error for unknown model', async () => {
    const { mgr } = setup();
    const r = await mgr.query('ghost', 'hello');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not found/i);
  });

  test('query returns error when model is OFFLINE', async () => {
    const { mgr } = setup();
    mgr.registerModel({ id: 'l', name: 'X', type: 'local' });
    const r = await mgr.query('l', 'hello');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/offline/i);
  });

  test('query returns offline fallback for online model with no backend', async () => {
    const { mgr } = setup();
    mgr.registerModel({ id: 'l', name: 'X', type: 'local' });
    await mgr.connect('l');
    const r = await mgr.query('l', 'hello');
    expect(r.ok).toBe(true);
    expect(r.response).toMatch(/offline/i);
  });

  test('query uses pluggable backend when set', async () => {
    const { mgr } = setup();
    mgr.registerModel({ id: 'l', name: 'X', type: 'local' });
    mgr.setModelBackend('l', makeBackend('backend response'));
    await mgr.connect('l');
    const r = await mgr.query('l', 'hello');
    expect(r.ok).toBe(true);
    expect(r.response).toBe('backend response');
  });

  test('query increments queryCount', async () => {
    const { mgr } = setup();
    mgr.registerModel({ id: 'l', name: 'X', type: 'local' });
    await mgr.connect('l');
    await mgr.query('l', 'a');
    await mgr.query('l', 'b');
    expect(mgr.status()[0].queryCount).toBe(2);
  });

  test('query writes response to IPC shared memory', async () => {
    const { ipc, mgr } = setup();
    mgr.registerModel({ id: 'l', name: 'X', type: 'local' });
    mgr.setModelBackend('l', makeBackend('test-answer'));
    await mgr.connect('l');
    await mgr.query('l', 'hi');
    const raw = ipc.shmRead('model:output:l');
    expect(raw.ok).toBe(true);
    const parsed = JSON.parse(raw.data);
    expect(parsed.modelId).toBe('l');
    expect(parsed.response).toBe('test-answer');
  });

  test('query writes response to IPC channel pipe', async () => {
    const { ipc, mgr } = setup();
    mgr.registerModel({ id: 'l', name: 'X', type: 'local' });
    mgr.setModelBackend('l', makeBackend('piped-answer'));
    await mgr.connect('l');
    await mgr.query('l', 'hi');
    const msg = ipc.readPipe('model:channel:l');
    expect(msg.ok).toBe(true);
    const parsed = JSON.parse(msg.data);
    expect(parsed.response).toBe('piped-answer');
  });

  test('emits model:output event', async () => {
    const { kernel, mgr } = setup();
    const handler = jest.fn();
    kernel.bus.on('model:output', handler);
    mgr.registerModel({ id: 'l', name: 'X', type: 'local' });
    await mgr.connect('l');
    await mgr.query('l', 'hi');
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'l' }));
  });

  test('backend error sets lastError and returns ok:false', async () => {
    const { mgr } = setup();
    mgr.registerModel({ id: 'l', name: 'X', type: 'local' });
    // Connect with no backend so validation is skipped → model goes ONLINE
    await mgr.connect('l');
    expect(mgr.status()[0].state).toBe(MODEL_STATES.ONLINE);
    // Attach an error backend to simulate a runtime query failure
    mgr.setModelBackend('l', makeErrorBackend('runtime error'));
    const r = await mgr.query('l', 'test');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('runtime error');
    expect(mgr.status()[0].lastError).toBe('runtime error');
  });

  test('emits model:error event on backend failure', async () => {
    const { kernel, mgr } = setup();
    const errHandler = jest.fn();
    kernel.bus.on('model:error', errHandler);
    mgr.registerModel({ id: 'l', name: 'X', type: 'local' });
    await mgr.connect('l');
    mgr.setModelBackend('l', makeErrorBackend('fail'));
    await mgr.query('l', 'test');
    expect(errHandler).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'l' }));
  });
});

// ---------------------------------------------------------------------------
// Mode Manager — queryByMode
// ---------------------------------------------------------------------------

describe('ModelManager — queryByMode', () => {
  test('routes chat mode to local model', async () => {
    const { mgr } = setup();
    mgr.registerModel({ id: 'local-1', name: 'Tiny', type: 'local' });
    mgr.setModelBackend('local-1', makeBackend('local reply'));
    await mgr.connect('local-1');
    const r = await mgr.queryByMode('chat', 'hello');
    expect(r.ok).toBe(true);
    expect(r.response).toBe('local reply');
    expect(r.modelId).toBe('local-1');
  });

  test('routes help mode to local model', async () => {
    const { mgr } = setup();
    mgr.registerModel({ id: 'local-1', name: 'Tiny', type: 'local' });
    mgr.setModelBackend('local-1', makeBackend('help text'));
    await mgr.connect('local-1');
    const r = await mgr.queryByMode('help', 'how?');
    expect(r.ok).toBe(true);
  });

  test('routes quickfix mode to local model', async () => {
    const { mgr } = setup();
    mgr.registerModel({ id: 'local-1', name: 'Tiny', type: 'local' });
    mgr.setModelBackend('local-1', makeBackend('fix'));
    await mgr.connect('local-1');
    const r = await mgr.queryByMode('quickfix', 'patch this');
    expect(r.ok).toBe(true);
  });

  test('routes code mode to remote model', async () => {
    const { mgr } = setup();
    mgr.registerModel({ id: 'remote-1', name: 'GPT', type: 'remote', endpoint: 'http://ep' });
    mgr.setModelBackend('remote-1', makeBackend('code answer'));
    await mgr.connect('remote-1');
    const r = await mgr.queryByMode('code', 'write a function');
    expect(r.ok).toBe(true);
    expect(r.modelId).toBe('remote-1');
  });

  test('routes fix mode to remote model', async () => {
    const { mgr } = setup();
    mgr.registerModel({ id: 'remote-1', name: 'GPT', type: 'remote', endpoint: 'http://ep' });
    mgr.setModelBackend('remote-1', makeBackend('fixed'));
    await mgr.connect('remote-1');
    const r = await mgr.queryByMode('fix', 'fix bug');
    expect(r.ok).toBe(true);
  });

  test('routes learn mode to remote model', async () => {
    const { mgr } = setup();
    mgr.registerModel({ id: 'remote-1', name: 'GPT', type: 'remote', endpoint: 'http://ep' });
    mgr.setModelBackend('remote-1', makeBackend('lesson'));
    await mgr.connect('remote-1');
    const r = await mgr.queryByMode('learn', 'explain closures');
    expect(r.ok).toBe(true);
  });

  test('returns error for unknown mode', async () => {
    const { mgr } = setup();
    const r = await mgr.queryByMode('dream', 'hello');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/unknown mode/i);
  });

  test('returns error when no model is online for mode', async () => {
    const { mgr } = setup();
    mgr.registerModel({ id: 'l', name: 'X', type: 'local' });
    // Not connected
    const r = await mgr.queryByMode('chat', 'hi');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/no local model/i);
  });

  test('prefers ONLINE over IDLE model', async () => {
    jest.useFakeTimers();
    const { mgr } = setup();
    const b1 = makeBackend('from-b1');
    const b2 = makeBackend('from-b2');

    // l1 has a short idle timeout; l2 has a long one
    mgr.registerModel({ id: 'l1', name: 'L1', type: 'local', idleTimeoutMs: 1000 });
    mgr.registerModel({ id: 'l2', name: 'L2', type: 'local', idleTimeoutMs: 60000 });
    mgr.setModelBackend('l1', b1);
    mgr.setModelBackend('l2', b2);

    await mgr.connect('l1');
    await mgr.connect('l2');

    // Advance only enough to idle l1 but not l2
    jest.advanceTimersByTime(1001);

    const r = await mgr.queryByMode('chat', 'hi');
    expect(r.response).toBe('from-b2');  // l2 is still ONLINE

    jest.useRealTimers();
  });

  test('prefers model with lower queryCount', async () => {
    const { mgr } = setup();
    const b1 = makeBackend('b1');
    const b2 = makeBackend('b2');
    mgr.registerModel({ id: 'la', name: 'LA', type: 'local' });
    mgr.registerModel({ id: 'lb', name: 'LB', type: 'local' });
    mgr.setModelBackend('la', b1);
    mgr.setModelBackend('lb', b2);
    await mgr.connect('la');
    await mgr.connect('lb');

    // Give la more queries
    await mgr.query('la', 'q1');
    await mgr.query('la', 'q2');

    const r = await mgr.queryByMode('help', 'who?');
    expect(r.modelId).toBe('lb');  // lb has fewer queries
  });
});

// ---------------------------------------------------------------------------
// Idle logic
// ---------------------------------------------------------------------------

describe('ModelManager — idle logic', () => {
  test('model enters IDLE state after inactivity timeout', async () => {
    jest.useFakeTimers();
    const { mgr } = setup();
    mgr.registerModel({ id: 'l', name: 'X', type: 'local', idleTimeoutMs: 5000 });
    await mgr.connect('l');
    expect(mgr.status()[0].state).toBe(MODEL_STATES.ONLINE);
    jest.advanceTimersByTime(5001);
    expect(mgr.status()[0].state).toBe(MODEL_STATES.IDLE);
    jest.useRealTimers();
  });

  test('emits model:idle event with idleMs', async () => {
    jest.useFakeTimers();
    const { kernel, mgr } = setup();
    const handler = jest.fn();
    kernel.bus.on('model:idle', handler);
    mgr.registerModel({ id: 'l', name: 'X', type: 'local', idleTimeoutMs: 2000 });
    await mgr.connect('l');
    jest.advanceTimersByTime(2001);
    expect(handler).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'l', idleMs: 2000 }));
    jest.useRealTimers();
  });

  test('query before timeout resets idle timer', async () => {
    jest.useFakeTimers();
    const { mgr } = setup();
    mgr.registerModel({ id: 'l', name: 'X', type: 'local', idleTimeoutMs: 5000 });
    await mgr.connect('l');
    jest.advanceTimersByTime(4000);
    await mgr.query('l', 'hi');     // reset timer
    jest.advanceTimersByTime(4000); // only 4s since last activity
    expect(mgr.status()[0].state).toBe(MODEL_STATES.ONLINE);
    jest.advanceTimersByTime(1001); // now 5s+ since last query
    expect(mgr.status()[0].state).toBe(MODEL_STATES.IDLE);
    jest.useRealTimers();
  });

  test('query to idle model wakes it back to ONLINE', async () => {
    jest.useFakeTimers();
    const { mgr } = setup();
    mgr.registerModel({ id: 'l', name: 'X', type: 'local', idleTimeoutMs: 1000 });
    await mgr.connect('l');
    jest.advanceTimersByTime(1001);
    expect(mgr.status()[0].state).toBe(MODEL_STATES.IDLE);
    jest.useRealTimers();  // use real timers for async
    await mgr.query('l', 'wake me up');
    expect(mgr.status()[0].state).toBe(MODEL_STATES.ONLINE);
  });

  test('emits model:wake event when idle model receives query', async () => {
    jest.useFakeTimers();
    const { kernel, mgr } = setup();
    const wakeHandler = jest.fn();
    kernel.bus.on('model:wake', wakeHandler);
    mgr.registerModel({ id: 'l', name: 'X', type: 'local', idleTimeoutMs: 500 });
    await mgr.connect('l');
    jest.advanceTimersByTime(501);
    jest.useRealTimers();
    await mgr.query('l', 'rise and shine');
    expect(wakeHandler).toHaveBeenCalledWith(expect.objectContaining({ modelId: 'l' }));
  });

  test('memory and channel remain active during idle', async () => {
    jest.useFakeTimers();
    const { ipc, mgr } = setup();
    mgr.registerModel({ id: 'l', name: 'X', type: 'local', idleTimeoutMs: 1000 });
    mgr.setModelBackend('l', makeBackend('stored'));
    await mgr.connect('l');
    await mgr.query('l', 'save this');
    jest.advanceTimersByTime(1001);
    expect(mgr.status()[0].state).toBe(MODEL_STATES.IDLE);
    // IPC memory still has the last output
    const raw = ipc.shmRead('model:output:l');
    expect(raw.ok).toBe(true);
    const parsed = JSON.parse(raw.data);
    expect(parsed.response).toBe('stored');
    jest.useRealTimers();
  });

  test('disconnect cancels idle timer', async () => {
    jest.useFakeTimers();
    const { kernel, mgr } = setup();
    const idleHandler = jest.fn();
    kernel.bus.on('model:idle', idleHandler);
    mgr.registerModel({ id: 'l', name: 'X', type: 'local', idleTimeoutMs: 1000 });
    await mgr.connect('l');
    mgr.disconnect('l');
    jest.advanceTimersByTime(2000);
    expect(idleHandler).not.toHaveBeenCalled();
    jest.useRealTimers();
  });
});

// ---------------------------------------------------------------------------
// connectAll
// ---------------------------------------------------------------------------

describe('ModelManager — connectAll', () => {
  test('connects all registered models', async () => {
    const { mgr } = setup();
    mgr.registerModel({ id: 'l1', name: 'L1', type: 'local' });
    mgr.registerModel({ id: 'l2', name: 'L2', type: 'local' });
    const results = await mgr.connectAll();
    expect(results).toHaveLength(2);
    expect(results.every(r => r.ok)).toBe(true);
    const states = mgr.status().map(m => m.state);
    expect(states.every(s => s === MODEL_STATES.ONLINE)).toBe(true);
  });

  test('returns result per model even when one fails', async () => {
    const { mgr } = setup();
    mgr.registerModel({ id: 'good', name: 'Good', type: 'local' });
    mgr.registerModel({ id: 'bad',  name: 'Bad',  type: 'local' });
    mgr.setModelBackend('bad', makeErrorBackend('crash'));
    const results = await mgr.connectAll();
    expect(results.find(r => r.modelId === 'good').ok).toBe(true);
    expect(results.find(r => !r.ok)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// readOutput
// ---------------------------------------------------------------------------

describe('ModelManager — readOutput', () => {
  test('reads stored response from shared memory', async () => {
    const { mgr } = setup();
    mgr.registerModel({ id: 'l', name: 'X', type: 'local' });
    mgr.setModelBackend('l', makeBackend('answer42'));
    await mgr.connect('l');
    await mgr.query('l', 'what is 6x7?');
    const r = mgr.readOutput('l');
    expect(r.ok).toBe(true);
    const parsed = JSON.parse(r.data);
    expect(parsed.response).toBe('answer42');
    expect(parsed.modelId).toBe('l');
    expect(typeof parsed.ts).toBe('number');
  });

  test('readOutput returns error when IPC not available', async () => {
    const { mgr } = setup({ noIPC: true });
    mgr.registerModel({ id: 'l', name: 'X', type: 'local' });
    const r = mgr.readOutput('l');
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// setModelBackend
// ---------------------------------------------------------------------------

describe('ModelManager — setModelBackend', () => {
  test('throws for unknown model', () => {
    const { mgr } = setup();
    expect(() => mgr.setModelBackend('ghost', makeBackend('x'))).toThrow(/not found/i);
  });

  test('throws when backend has no query function', () => {
    const { mgr } = setup();
    mgr.registerModel({ id: 'l', name: 'X', type: 'local' });
    expect(() => mgr.setModelBackend('l', {})).toThrow(/query/i);
  });
});

// ---------------------------------------------------------------------------
// status / modeMap
// ---------------------------------------------------------------------------

describe('ModelManager — status & modeMap', () => {
  test('status returns empty array when no models registered', () => {
    const { mgr } = setup();
    expect(mgr.status()).toEqual([]);
  });

  test('status snapshot includes all fields', async () => {
    const { mgr } = setup();
    mgr.registerModel({ id: 'l', name: 'X', type: 'local' });
    await mgr.connect('l');
    const snap = mgr.status()[0];
    expect(snap).toMatchObject({
      id:          'l',
      name:        'X',
      type:        'local',
      state:       MODEL_STATES.ONLINE,
      modes:       expect.arrayContaining(['chat', 'help', 'quickfix']),
      queryCount:  0,
      channel:     'model:channel:l',
    });
  });

  test('modeMap returns the mode assignment table', () => {
    const { mgr } = setup();
    const map = mgr.modeMap();
    expect(map.chat).toBe('local');
    expect(map.code).toBe('remote');
    expect(Object.keys(map).length).toBe(6);
  });
});

// ---------------------------------------------------------------------------
// Router commands
// ---------------------------------------------------------------------------

describe('ModelManager — router commands', () => {
  test('model status shows no models', async () => {
    const { mgr } = setup();
    const r = await mgr.commands.model([]);
    expect(r.status).toBe('ok');
    expect(r.result).toMatch(/no models/i);
  });

  test('model status lists registered models', async () => {
    const { mgr } = setup();
    mgr.registerModel({ id: 'l', name: 'TinyLlama', type: 'local' });
    await mgr.connect('l');
    const r = await mgr.commands.model(['status']);
    expect(r.status).toBe('ok');
    expect(r.result).toContain('l');
    expect(r.result).toContain('online');
  });

  test('model modes lists all modes', async () => {
    const { mgr } = setup();
    const r = await mgr.commands.model(['modes']);
    expect(r.status).toBe('ok');
    expect(r.result).toContain('chat');
    expect(r.result).toContain('code');
    expect(r.result).toContain('local');
    expect(r.result).toContain('remote');
  });

  test('model connect succeeds', async () => {
    const { mgr } = setup();
    mgr.registerModel({ id: 'l', name: 'X', type: 'local' });
    const r = await mgr.commands.model(['connect', 'l']);
    expect(r.status).toBe('ok');
    expect(r.result).toContain('connected');
  });

  test('model connect requires id', async () => {
    const { mgr } = setup();
    const r = await mgr.commands.model(['connect']);
    expect(r.status).toBe('error');
  });

  test('model disconnect succeeds', async () => {
    const { mgr } = setup();
    mgr.registerModel({ id: 'l', name: 'X', type: 'local' });
    await mgr.connect('l');
    const r = await mgr.commands.model(['disconnect', 'l']);
    expect(r.status).toBe('ok');
    expect(r.result).toContain('disconnected');
  });

  test('model disconnect requires id', async () => {
    const { mgr } = setup();
    const r = await mgr.commands.model(['disconnect']);
    expect(r.status).toBe('error');
  });

  test('model query returns response', async () => {
    const { mgr } = setup();
    mgr.registerModel({ id: 'l', name: 'X', type: 'local' });
    mgr.setModelBackend('l', makeBackend('hello back'));
    await mgr.connect('l');
    const r = await mgr.commands.model(['query', 'l', 'hello']);
    expect(r.status).toBe('ok');
    expect(r.result).toBe('hello back');
  });

  test('model query requires id and prompt', async () => {
    const { mgr } = setup();
    const r = await mgr.commands.model(['query']);
    expect(r.status).toBe('error');
  });

  test('model ask routes via mode', async () => {
    const { mgr } = setup();
    mgr.registerModel({ id: 'l', name: 'X', type: 'local' });
    mgr.setModelBackend('l', makeBackend('mode reply'));
    await mgr.connect('l');
    const r = await mgr.commands.model(['ask', 'chat', 'hey']);
    expect(r.status).toBe('ok');
    expect(r.result).toBe('mode reply');
  });

  test('model ask requires mode and prompt', async () => {
    const { mgr } = setup();
    const r = await mgr.commands.model(['ask']);
    expect(r.status).toBe('error');
  });

  test('model unknown sub-command returns error', async () => {
    const { mgr } = setup();
    const r = await mgr.commands.model(['bogus']);
    expect(r.status).toBe('error');
    expect(r.result).toMatch(/usage/i);
  });
});

// ---------------------------------------------------------------------------
// Works without kernel / IPC
// ---------------------------------------------------------------------------

describe('ModelManager — works without kernel or IPC', () => {
  test('registerModel does not crash without kernel', () => {
    const { mgr } = setup({ noKernel: true });
    expect(() => mgr.registerModel({ id: 'l', name: 'X', type: 'local' })).not.toThrow();
  });

  test('connect does not crash without IPC', async () => {
    const { mgr } = setup({ noIPC: true });
    mgr.registerModel({ id: 'l', name: 'X', type: 'local' });
    const r = await mgr.connect('l');
    expect(r.ok).toBe(true);
  });

  test('query does not crash without IPC', async () => {
    const { mgr } = setup({ noIPC: true });
    mgr.registerModel({ id: 'l', name: 'X', type: 'local' });
    await mgr.connect('l');
    const r = await mgr.query('l', 'hi');
    expect(r.ok).toBe(true);
  });
});
