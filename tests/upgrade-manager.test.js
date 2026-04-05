'use strict';
/**
 * tests/upgrade-manager.test.js
 * Full Jest test suite for core/upgrade-manager.js v1.0.0
 */

const { createUpgradeManager, COMPONENT_VERSIONS, RECOMMENDED_MODELS } = require('../core/upgrade-manager');

// ---------------------------------------------------------------------------
// Stubs
// ---------------------------------------------------------------------------
function makeKernel() {
  const _h = {};
  const _m = {};
  return {
    id: 'test-kernel', version: '1.0.0', uptime: () => 42,
    bus: {
      on:   (ev, fn) => { _h[ev] = fn; },
      emit: (ev, d)  => { if (_h[ev]) _h[ev](d); },
    },
    modules: {
      get:  (name) => _m[name] || null,
      load: (name, mod) => { _m[name] = mod; },
    },
  };
}

function makeSvcMgr() {
  return { list: () => [] };
}

function makeHostBridge() {
  return {
    memInfo: () => ({ ok: true, usedMB: 512, totalMB: 4096 }),
    platform: { name: 'android-termux' },
  };
}

function makeDiagnostics() {
  return {
    captureHealth: () => ({
      ts: new Date().toISOString(),
      uptime: 10,
      status: 'ok',
      cpu:    { cores: 4, loadAvg1: 0.5 },
      memory: { totalMB: 4096, usedMB: 512, freeMB: 3584, usedPct: 12 },
    }),
  };
}

// Fetch mock for Ollama
function mockOllamaOnline(models) {
  global.fetch = jest.fn((url, opts) => {
    if (url.includes('/api/tags')) {
      return Promise.resolve({ ok: true, json: async () => ({ models: models || [] }) });
    }
    if (url.includes('/api/pull')) {
      return Promise.resolve({ ok: true, json: async () => ({ status: 'success' }) });
    }
    if (url.includes('/api/delete')) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
    }
    return Promise.resolve({ ok: false, json: async () => ({}) });
  });
}

function mockOllamaOffline() {
  global.fetch = jest.fn(() => Promise.reject(new Error('ECONNREFUSED')));
}

function make(overrides = {}) {
  return createUpgradeManager(
    overrides.kernel      || makeKernel(),
    overrides.svcMgr      || makeSvcMgr(),
    overrides.hostBridge  || makeHostBridge(),
    overrides.diagnostics || makeDiagnostics(),
    overrides.vfs         || null,
  );
}

afterEach(() => {
  jest.restoreAllMocks();
  delete global.fetch;
});

// ---------------------------------------------------------------------------
describe('module shape', () => {
  test('exports createUpgradeManager, COMPONENT_VERSIONS, RECOMMENDED_MODELS', () => {
    expect(typeof createUpgradeManager).toBe('function');
    expect(Array.isArray(COMPONENT_VERSIONS)).toBe(true);
    expect(Array.isArray(RECOMMENDED_MODELS)).toBe(true);
  });

  test('COMPONENT_VERSIONS includes key modules', () => {
    const names = COMPONENT_VERSIONS.map(c => c.name);
    expect(names).toContain('kernel');
    expect(names).toContain('aios-aura');
    expect(names).toContain('diagnostics-engine');
    expect(names).toContain('upgrade-manager');
  });

  test('RECOMMENDED_MODELS includes phone-friendly models', () => {
    const names = RECOMMENDED_MODELS.map(m => m.name);
    expect(names).toContain('qwen2:0.5b');
    expect(names).toContain('phi3');
  });

  test('factory returns object with expected API', () => {
    const mgr = make();
    expect(mgr.name).toBe('upgrade-manager');
    expect(mgr.version).toBe('1.0.0');
    expect(typeof mgr.pullModel).toBe('function');
    expect(typeof mgr.removeModel).toBe('function');
    expect(typeof mgr.checkUpgrades).toBe('function');
    expect(typeof mgr.getPlan).toBe('function');
    expect(typeof mgr.setConfig).toBe('function');
    expect(typeof mgr.getConfig).toBe('function');
    expect(typeof mgr.history).toBe('function');
    expect(typeof mgr.commands.upgrade).toBe('function');
  });
});

// ---------------------------------------------------------------------------
describe('config', () => {
  test('setConfig stores a value', () => {
    const mgr = make();
    const r   = mgr.setConfig('LOG_LEVEL', 'debug');
    expect(r.ok).toBe(true);
    expect(r.key).toBe('LOG_LEVEL');
    expect(r.value).toBe('debug');
  });

  test('getConfig retrieves the stored value', () => {
    const mgr = make();
    mgr.setConfig('FOO', 'bar');
    const r = mgr.getConfig('FOO');
    expect(r.ok).toBe(true);
    expect(r.value).toBe('bar');
  });

  test('getConfig with no key returns all entries', () => {
    const mgr = make();
    mgr.setConfig('A', '1');
    mgr.setConfig('B', '2');
    const r = mgr.getConfig();
    expect(r.ok).toBe(true);
    expect(r.config.A).toBe('1');
    expect(r.config.B).toBe('2');
  });

  test('setConfig emits upgrade:config event on kernel bus', () => {
    const kernel = makeKernel();
    const mgr    = make({ kernel });
    const events = [];
    kernel.bus.on('upgrade:config', d => events.push(d));
    mgr.setConfig('X', 'y');
    expect(events.length).toBe(1);
    expect(events[0].key).toBe('X');
    expect(events[0].value).toBe('y');
  });

  test('setConfig records history entry', () => {
    const mgr = make();
    mgr.setConfig('K', 'v');
    expect(mgr.history().length).toBe(1);
    expect(mgr.history()[0].type).toBe('config');
    expect(mgr.history()[0].target).toBe('K');
  });

  test('setConfig without key returns error', () => {
    const mgr = make();
    const r   = mgr.setConfig('');
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe('pullModel', () => {
  test('returns error when model name missing', async () => {
    mockOllamaOffline();
    const mgr = make();
    const r   = await mgr.pullModel('');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/model name required/i);
  });

  test('returns error when Ollama is offline', async () => {
    mockOllamaOffline();
    const mgr = make();
    const r   = await mgr.pullModel('phi3');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/ollama/i);
  });

  test('pulls successfully when Ollama online', async () => {
    mockOllamaOnline([]);
    const mgr = make();
    const r   = await mgr.pullModel('qwen2:0.5b');
    expect(r.ok).toBe(true);
    expect(r.model).toBe('qwen2:0.5b');
  });

  test('records history on pull', async () => {
    mockOllamaOnline([]);
    const mgr = make();
    await mgr.pullModel('phi3');
    const h = mgr.history();
    expect(h.length).toBe(1);
    expect(h[0].type).toBe('model');
    expect(h[0].target).toBe('phi3');
  });

  test('emits upgrade:applied event', async () => {
    mockOllamaOnline([]);
    const kernel = makeKernel();
    const mgr    = make({ kernel });
    const events = [];
    kernel.bus.on('upgrade:applied', d => events.push(d));
    await mgr.pullModel('phi3');
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('model');
  });
});

// ---------------------------------------------------------------------------
describe('removeModel', () => {
  test('returns error when model name missing', async () => {
    mockOllamaOnline([]);
    const mgr = make();
    const r   = await mgr.removeModel('');
    expect(r.ok).toBe(false);
  });

  test('removes successfully when Ollama online', async () => {
    mockOllamaOnline([]);
    const mgr = make();
    const r   = await mgr.removeModel('phi3');
    expect(r.ok).toBe(true);
    expect(r.model).toBe('phi3');
  });

  test('records history on removal', async () => {
    mockOllamaOnline([]);
    const mgr = make();
    await mgr.removeModel('phi3');
    const h = mgr.history();
    expect(h[0].type).toBe('model-remove');
  });
});

// ---------------------------------------------------------------------------
describe('checkUpgrades', () => {
  test('returns an array of check entries', async () => {
    mockOllamaOnline([{ name: 'phi3:latest' }]);
    const mgr    = make();
    const checks = await mgr.checkUpgrades();
    expect(Array.isArray(checks)).toBe(true);
    expect(checks.length).toBeGreaterThan(0);
  });

  test('includes component, ollama, model, health categories', async () => {
    mockOllamaOnline([{ name: 'phi3:latest' }]);
    const mgr        = make();
    const checks     = await mgr.checkUpgrades();
    const categories = [...new Set(checks.map(c => c.category))];
    expect(categories).toContain('component');
    expect(categories).toContain('ollama');
    expect(categories).toContain('model');
    expect(categories).toContain('health');
  });

  test('shows installed model as current', async () => {
    mockOllamaOnline([{ name: 'phi3:latest' }]);
    const mgr    = make();
    const checks = await mgr.checkUpgrades();
    const phi3   = checks.find(c => c.category === 'model' && c.name === 'phi3');
    expect(phi3).toBeDefined();
    expect(phi3.current).toBe('installed');
    expect(phi3.status).toBe('current');
  });

  test('shows not-installed model as optional', async () => {
    mockOllamaOnline([]);
    const mgr    = make();
    const checks = await mgr.checkUpgrades();
    const models = checks.filter(c => c.category === 'model');
    expect(models.every(m => m.status === 'optional')).toBe(true);
  });

  test('shows ollama as action-required when offline', async () => {
    mockOllamaOffline();
    const mgr    = make();
    const checks = await mgr.checkUpgrades();
    const oll    = checks.find(c => c.category === 'ollama');
    expect(oll.status).toBe('action-required');
  });

  test('health check category uses diagnostics data', async () => {
    mockOllamaOffline();
    const mgr    = make();
    const checks = await mgr.checkUpgrades();
    const h      = checks.find(c => c.category === 'health');
    expect(h).toBeDefined();
    expect(h.name).toBe('memory');
  });
});

// ---------------------------------------------------------------------------
describe('getPlan', () => {
  test('returns checks, required, optional, warnings', async () => {
    mockOllamaOnline([{ name: 'phi3:latest' }]);
    const mgr  = make();
    const plan = await mgr.getPlan();
    expect(Array.isArray(plan.checks)).toBe(true);
    expect(Array.isArray(plan.required)).toBe(true);
    expect(Array.isArray(plan.optional)).toBe(true);
    expect(Array.isArray(plan.warnings)).toBe(true);
  });

  test('required includes action-required items', async () => {
    mockOllamaOffline();
    const mgr  = make();
    const plan = await mgr.getPlan();
    expect(plan.required.some(r => r.name === 'ollama-server')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('commands.upgrade', () => {
  test('no args returns upgrade plan table', async () => {
    mockOllamaOnline([]);
    const mgr = make();
    const r   = await mgr.commands.upgrade([]);
    expect(r.status).toBe('ok');
    expect(r.result).toContain('AIOS Upgrade Manager');
  });

  test('"plan" returns upgrade plan table', async () => {
    mockOllamaOnline([]);
    const mgr = make();
    const r   = await mgr.commands.upgrade(['plan']);
    expect(r.status).toBe('ok');
    expect(r.result).toContain('AIOS Upgrade Manager');
  });

  test('"status" returns component version matrix', async () => {
    const mgr = make();
    const r   = await mgr.commands.upgrade(['status']);
    expect(r.status).toBe('ok');
    expect(r.result).toContain('AIOS Component Status');
    expect(r.result).toContain('kernel');
    expect(r.result).toContain('aios-aura');
  });

  test('"check" runs upgrade check', async () => {
    mockOllamaOnline([{ name: 'phi3:latest' }]);
    const mgr = make();
    const r   = await mgr.commands.upgrade(['check']);
    expect(r.status).toBe('ok');
    expect(r.result).toContain('Upgrade check');
  });

  test('"history" returns history output', async () => {
    const mgr = make();
    mgr.setConfig('K', 'v');
    const r = await mgr.commands.upgrade(['history']);
    expect(r.status).toBe('ok');
    expect(r.result).toContain('config');
  });

  test('"history" with no entries returns empty message', async () => {
    const mgr = make();
    const r   = await mgr.commands.upgrade(['history']);
    expect(r.status).toBe('ok');
    expect(r.result).toMatch(/no upgrade history/i);
  });

  test('"model" with no name lists recommended models', async () => {
    mockOllamaOnline([]);
    const mgr = make();
    const r   = await mgr.commands.upgrade(['model']);
    expect(r.status).toBe('ok');
    expect(r.result).toContain('qwen2:0.5b');
    expect(r.result).toContain('phi3');
  });

  test('"model <name>" pulls the model', async () => {
    mockOllamaOnline([]);
    const mgr = make();
    const r   = await mgr.commands.upgrade(['model', 'qwen2:0.5b']);
    expect(r.status).toBe('ok');
    expect(r.result).toContain('qwen2:0.5b');
    expect(r.result).toContain('✓');
  });

  test('"model-remove <name>" removes model', async () => {
    mockOllamaOnline([]);
    const mgr = make();
    const r   = await mgr.commands.upgrade(['model-remove', 'phi3']);
    expect(r.status).toBe('ok');
    expect(r.result).toContain('removed');
  });

  test('"model-remove" without name returns error', async () => {
    const mgr = make();
    const r   = await mgr.commands.upgrade(['model-remove']);
    expect(r.status).toBe('error');
  });

  test('"config" with key and value sets config', async () => {
    const mgr = make();
    const r   = await mgr.commands.upgrade(['config', 'LOG_LEVEL', 'debug']);
    expect(r.status).toBe('ok');
    expect(r.result).toContain('LOG_LEVEL');
    expect(r.result).toContain('debug');
  });

  test('"config" with no args lists all config', async () => {
    const mgr = make();
    mgr.setConfig('A', '1');
    const r = await mgr.commands.upgrade(['config']);
    expect(r.status).toBe('ok');
    expect(r.result).toContain('A');
  });

  test('unknown subcommand returns usage', async () => {
    const mgr = make();
    const r   = await mgr.commands.upgrade(['unknown-thing']);
    expect(r.status).toBe('ok');
    expect(r.result).toContain('Usage');
    expect(r.result).toContain('upgrade plan');
  });
});
