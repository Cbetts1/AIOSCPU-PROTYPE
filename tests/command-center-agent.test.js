'use strict';
/**
 * tests/command-center-agent.test.js
 * Unit tests for core/command-center-agent.js
 */

const { createCommandCenterAgent, VERSION } = require('../core/command-center-agent');

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeKernel() {
  return {
    bus: { emit: jest.fn(), on: jest.fn() },
    modules: { load: jest.fn(), list: jest.fn(() => []) },
    uptime: jest.fn(() => 42),
  };
}

function makeRouter() {
  return {
    dispatch: jest.fn(async () => ({ status: 'ok', result: 'done' })),
    use:      jest.fn(),
    registerCommand: jest.fn(),
  };
}

function makeIdentity(id) {
  return {
    id,
    manifest: () => ({ id, osVersion: '4.0.0' }),
  };
}

function makeDiagnostics() {
  return {
    captureHealth: jest.fn(() => ({ ok: true })),
  };
}

function makeSvcMgr() {
  return {
    list: jest.fn(() => [{ name: 'kernel-watchdog', state: 'running' }]),
  };
}

// ── Module shape ──────────────────────────────────────────────────────────────
describe('createCommandCenterAgent — module shape', () => {
  test('returns object with expected API', () => {
    const agent = createCommandCenterAgent(null, null, null, null, null);
    expect(agent.name).toBe('command-center-agent');
    expect(agent.version).toBe(VERSION);
    expect(typeof agent.register).toBe('function');
    expect(typeof agent.unregister).toBe('function');
    expect(typeof agent.startHeartbeat).toBe('function');
    expect(typeof agent.stopHeartbeat).toBe('function');
    expect(typeof agent.heartbeat).toBe('function');
    expect(typeof agent.syncState).toBe('function');
    expect(typeof agent.status).toBe('function');
    expect(typeof agent.getPeers).toBe('function');
    expect(typeof agent.configure).toBe('function');
    expect(typeof agent.executeRemoteCommand).toBe('function');
    expect(typeof agent.commands).toBe('object');
    expect(typeof agent.commands.cc).toBe('function');
  });

  test('works with all nulls', () => {
    expect(() => createCommandCenterAgent(null, null, null, null, null)).not.toThrow();
  });

  test('VERSION is a semver string', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

// ── Initial status ─────────────────────────────────────────────────────────────
describe('status() — initial state', () => {
  test('registered and connected start as false', () => {
    const agent = createCommandCenterAgent(makeKernel(), makeRouter(), null, null, null);
    const s = agent.status();
    expect(s.registered).toBe(false);
    expect(s.connected).toBe(false);
  });

  test('status contains expected keys', () => {
    const agent = createCommandCenterAgent(null, null, null, null, null);
    const s = agent.status();
    expect(s).toHaveProperty('nodeId');
    expect(s).toHaveProperty('ccUrl');
    expect(s).toHaveProperty('registered');
    expect(s).toHaveProperty('connected');
    expect(s).toHaveProperty('peers');
    expect(s).toHaveProperty('stats');
    expect(s).toHaveProperty('lastError');
    expect(s).toHaveProperty('intervalMs');
  });

  test('peers starts empty', () => {
    const agent = createCommandCenterAgent(null, null, null, null, null);
    expect(agent.getPeers()).toEqual([]);
  });

  test('stats counters start at zero', () => {
    const agent = createCommandCenterAgent(null, null, null, null, null);
    const s = agent.status();
    expect(s.stats.heartbeats).toBe(0);
    expect(s.stats.commands).toBe(0);
    expect(s.stats.syncPushes).toBe(0);
    expect(s.stats.errors).toBe(0);
  });
});

// ── nodeId derivation ─────────────────────────────────────────────────────────
describe('nodeId', () => {
  test('derived from identity.manifest().id when present', () => {
    const ident = makeIdentity('test-node-abc123');
    const agent = createCommandCenterAgent(null, null, ident, null, null);
    expect(agent.status().nodeId).toBe('test-node-abc123');
  });

  test('derived from identity.id when manifest not a function', () => {
    const ident = { id: 'flat-node-id' };
    const agent = createCommandCenterAgent(null, null, ident, null, null);
    expect(agent.status().nodeId).toBe('flat-node-id');
  });

  test('falls back to hostname+pid when identity is null', () => {
    const agent = createCommandCenterAgent(null, null, null, null, null);
    expect(agent.status().nodeId).toBeTruthy();
    expect(typeof agent.status().nodeId).toBe('string');
  });
});

// ── configure ─────────────────────────────────────────────────────────────────
describe('configure()', () => {
  test('updates ccUrl', () => {
    const agent = createCommandCenterAgent(null, null, null, null, null);
    agent.configure({ ccUrl: 'http://cc.example.com:9000' });
    expect(agent.status().ccUrl).toBe('http://cc.example.com:9000');
  });

  test('updates intervalMs', () => {
    const agent = createCommandCenterAgent(null, null, null, null, null);
    agent.configure({ interval: 10_000 });
    expect(agent.status().intervalMs).toBe(10_000);
  });

  test('does not override fields not present in opts', () => {
    const agent = createCommandCenterAgent(null, null, null, null, null);
    const before = agent.status().intervalMs;
    agent.configure({ ccUrl: 'http://other:1234' });
    expect(agent.status().intervalMs).toBe(before);
  });
});

// ── register — offline behaviour ───────────────────────────────────────────────
describe('register() — offline/error behaviour', () => {
  test('returns ok:false when CC is unreachable', async () => {
    const agent = createCommandCenterAgent(makeKernel(), makeRouter(), makeIdentity('n1'), null, null);
    agent.configure({ ccUrl: 'http://127.0.0.1:1' }); // port 1 — unreachable
    const r = await agent.register();
    expect(r.ok).toBe(false);
  });

  test('increments error counter on failure', async () => {
    const agent = createCommandCenterAgent(null, null, null, null, null);
    agent.configure({ ccUrl: 'http://127.0.0.1:1' });
    await agent.register();
    expect(agent.status().stats.errors).toBeGreaterThan(0);
  });

  test('registered stays false after failed registration', async () => {
    const agent = createCommandCenterAgent(null, null, null, null, null);
    agent.configure({ ccUrl: 'http://127.0.0.1:1' });
    await agent.register();
    expect(agent.status().registered).toBe(false);
  });

  test('emits cc:error on bus when registration fails', async () => {
    const kernel = makeKernel();
    const agent  = createCommandCenterAgent(kernel, null, null, null, null);
    agent.configure({ ccUrl: 'http://127.0.0.1:1' });
    await agent.register();
    expect(kernel.bus.emit).toHaveBeenCalledWith('cc:error', expect.objectContaining({ op: 'register' }));
  });
});

// ── heartbeat — offline behaviour ─────────────────────────────────────────────
describe('heartbeat() — offline behaviour', () => {
  test('returns ok:false when not registered', async () => {
    const agent = createCommandCenterAgent(null, null, null, null, null);
    const r = await agent.heartbeat();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not registered/i);
  });
});

// ── syncState — offline behaviour ─────────────────────────────────────────────
describe('syncState() — offline behaviour', () => {
  test('returns ok:false when not registered', async () => {
    const agent = createCommandCenterAgent(null, null, null, null, null);
    const r = await agent.syncState();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not registered/i);
  });
});

// ── unregister ─────────────────────────────────────────────────────────────────
describe('unregister()', () => {
  test('returns ok:true when not registered (no-op)', async () => {
    const agent = createCommandCenterAgent(null, null, null, null, null);
    const r = await agent.unregister();
    expect(r.ok).toBe(true);
  });
});

// ── heartbeat timer ───────────────────────────────────────────────────────────
describe('startHeartbeat / stopHeartbeat', () => {
  test('stopHeartbeat does not throw when never started', () => {
    const agent = createCommandCenterAgent(null, null, null, null, null);
    expect(() => agent.stopHeartbeat()).not.toThrow();
  });

  test('startHeartbeat then stopHeartbeat does not throw', () => {
    const agent = createCommandCenterAgent(null, null, null, null, null);
    agent.configure({ interval: 999_999 }); // won't fire during test
    agent.startHeartbeat();
    expect(() => agent.stopHeartbeat()).not.toThrow();
  });

  test('calling startHeartbeat twice is safe', () => {
    const agent = createCommandCenterAgent(null, null, null, null, null);
    agent.configure({ interval: 999_999 });
    agent.startHeartbeat();
    agent.startHeartbeat(); // second call replaces first — should not throw
    agent.stopHeartbeat();
  });
});

// ── executeRemoteCommand ──────────────────────────────────────────────────────
describe('executeRemoteCommand()', () => {
  test('dispatches to router.dispatch when available', async () => {
    const router = makeRouter();
    const agent  = createCommandCenterAgent(makeKernel(), router, null, null, null);
    await agent.executeRemoteCommand({ command: 'status', args: [] });
    expect(router.dispatch).toHaveBeenCalledWith('status', []);
  });

  test('falls back to router.route when dispatch not available', async () => {
    const router = { route: jest.fn(async () => ({ ok: true })), use: jest.fn() };
    const agent  = createCommandCenterAgent(makeKernel(), router, null, null, null);
    await agent.executeRemoteCommand({ command: 'uptime', args: [] });
    expect(router.route).toHaveBeenCalledWith('uptime', []);
  });

  test('does not throw when router is null', async () => {
    const agent = createCommandCenterAgent(null, null, null, null, null);
    await expect(agent.executeRemoteCommand({ command: 'status', args: [] })).resolves.not.toThrow();
  });

  test('increments commands counter', async () => {
    const agent = createCommandCenterAgent(null, null, null, null, null);
    await agent.executeRemoteCommand({ command: 'status' });
    expect(agent.status().stats.commands).toBe(1);
  });

  test('returns undefined for null/empty command', async () => {
    const agent = createCommandCenterAgent(null, null, null, null, null);
    const r = await agent.executeRemoteCommand(null);
    expect(r).toBeUndefined();
  });
});

// ── Terminal commands ─────────────────────────────────────────────────────────
describe('commands.cc', () => {
  test('no args returns status table string', async () => {
    const agent = createCommandCenterAgent(null, null, null, null, null);
    const r = await agent.commands.cc([]);
    expect(r.status).toBe('ok');
    expect(typeof r.result).toBe('string');
    expect(r.result).toMatch(/Command Center Agent/i);
  });

  test('"status" returns status table', async () => {
    const agent = createCommandCenterAgent(null, null, null, null, null);
    const r = await agent.commands.cc(['status']);
    expect(r.status).toBe('ok');
  });

  test('"peers" returns no-peers message when empty', async () => {
    const agent = createCommandCenterAgent(null, null, null, null, null);
    const r = await agent.commands.cc(['peers']);
    expect(r.status).toBe('ok');
    expect(r.result).toMatch(/No peers/i);
  });

  test('"disconnect" calls unregister path', async () => {
    const agent = createCommandCenterAgent(null, null, null, null, null);
    const r = await agent.commands.cc(['disconnect']);
    expect(r.status).toBe('ok');
    expect(r.result).toMatch(/Disconnected/i);
  });

  test('unknown sub-command returns usage', async () => {
    const agent = createCommandCenterAgent(null, null, null, null, null);
    const r = await agent.commands.cc(['badcmd']);
    expect(r.status).toBe('ok');
    expect(r.result).toMatch(/Usage/i);
  });
});
