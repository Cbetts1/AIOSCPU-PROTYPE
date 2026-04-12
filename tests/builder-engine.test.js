'use strict';
/**
 * tests/builder-engine.test.js
 * Unit tests for core/builder-engine.js
 */

const { createBuilderEngine, VERSION } = require('../core/builder-engine');

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeKernel() {
  return {
    bus: { emit: jest.fn(), on: jest.fn() },
    modules: { load: jest.fn(), list: jest.fn(() => []) },
    uptime: jest.fn(() => 0),
  };
}

/** Minimal VFS mock that captures writes. */
function makeVFS() {
  const _store = new Map();
  return {
    _store,
    write:  jest.fn((path, content) => { _store.set(path, content); return { ok: true, path }; }),
    read:   jest.fn((path) => _store.has(path) ? { ok: true, content: _store.get(path) } : { ok: false }),
    mkdir:  jest.fn(() => ({ ok: true })),
    exists: jest.fn((path) => _store.has(path)),
    append: jest.fn(),
  };
}

// ── Module shape ──────────────────────────────────────────────────────────────
describe('createBuilderEngine — module shape', () => {
  test('returns object with expected API', () => {
    const b = createBuilderEngine(null, null, null);
    expect(b.name).toBe('builder-engine');
    expect(b.version).toBe(VERSION);
    expect(typeof b.buildModule).toBe('function');
    expect(typeof b.buildTest).toBe('function');
    expect(typeof b.buildScript).toBe('function');
    expect(typeof b.buildConfig).toBe('function');
    expect(typeof b.listArtefacts).toBe('function');
    expect(typeof b.status).toBe('function');
    expect(typeof b.getModuleTemplate).toBe('function');
    expect(typeof b.getTestTemplate).toBe('function');
    expect(typeof b.getScriptTemplate).toBe('function');
    expect(typeof b.getConfigTemplate).toBe('function');
    expect(typeof b.commands).toBe('object');
    expect(typeof b.commands.build).toBe('function');
  });

  test('works with all nulls', () => {
    expect(() => createBuilderEngine(null, null, null)).not.toThrow();
  });

  test('VERSION is a semver string', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

// ── status() ─────────────────────────────────────────────────────────────────
describe('status()', () => {
  test('returns expected shape', () => {
    const b = createBuilderEngine(null, null, null);
    const s = b.status();
    expect(s.name).toBe('builder-engine');
    expect(s.version).toBe(VERSION);
    expect(s.artefacts).toBe(0);
    expect(s).toHaveProperty('byType');
    expect(s).toHaveProperty('hostRoot');
    expect(s).toHaveProperty('vfsRoot');
  });

  test('artefact count increases after build', () => {
    const b = createBuilderEngine(null, makeVFS(), null);
    b.buildModule('my-module');
    expect(b.status().artefacts).toBe(1);
  });
});

// ── Template generators ───────────────────────────────────────────────────────
describe('template generators', () => {
  test('getModuleTemplate returns non-empty string', () => {
    const b  = createBuilderEngine(null, null, null);
    const t  = b.getModuleTemplate('test-mod');
    expect(typeof t).toBe('string');
    expect(t.length).toBeGreaterThan(100);
  });

  test('getModuleTemplate contains factory function', () => {
    const b = createBuilderEngine(null, null, null);
    const t = b.getModuleTemplate('my-feature');
    expect(t).toContain('createMyFeature');
    expect(t).toContain("'use strict'");
  });

  test('getTestTemplate contains jest describe block', () => {
    const b = createBuilderEngine(null, null, null);
    const t = b.getTestTemplate('my-feature');
    expect(t).toContain('describe(');
    expect(t).toContain('createMyFeature');
  });

  test('getScriptTemplate is POSIX-compliant (has sh shebang)', () => {
    const b = createBuilderEngine(null, null, null);
    const t = b.getScriptTemplate('deploy');
    expect(t.startsWith('#!/usr/bin/env sh')).toBe(true);
  });

  test('getScriptTemplate has set -eu guard', () => {
    const b = createBuilderEngine(null, null, null);
    const t = b.getScriptTemplate('run');
    expect(t).toContain('set -eu');
  });

  test('getConfigTemplate returns valid JSON', () => {
    const b = createBuilderEngine(null, null, null);
    const t = b.getConfigTemplate('my-svc');
    expect(() => JSON.parse(t)).not.toThrow();
    const obj = JSON.parse(t);
    expect(obj.name).toBe('my-svc');
    expect(typeof obj.description).toBe('string');
  });

  test('name sanitisation: spaces become dashes', () => {
    const b = createBuilderEngine(null, null, null);
    const t = b.getModuleTemplate('my module name');
    expect(t).not.toContain('my module name');
    expect(t).toContain('my-module-name');
  });

  test('name sanitisation: uppercase is lowercased', () => {
    const b = createBuilderEngine(null, null, null);
    const t = b.getConfigTemplate('MyService');
    const obj = JSON.parse(t);
    expect(obj.name).toBe('myservice');
  });
});

// ── buildModule ───────────────────────────────────────────────────────────────
describe('buildModule()', () => {
  test('returns ok:true', () => {
    const b = createBuilderEngine(null, makeVFS(), null);
    const r = b.buildModule('widget');
    expect(r.ok).toBe(true);
  });

  test('returns name, type, vfsPath, content', () => {
    const b = createBuilderEngine(null, makeVFS(), null);
    const r = b.buildModule('widget');
    expect(r.type).toBe('module');
    expect(r.name).toBe('widget');
    expect(r.vfsPath).toContain('widget');
    expect(typeof r.content).toBe('string');
    expect(r.content.length).toBeGreaterThan(0);
  });

  test('writes to VFS', () => {
    const vfs = makeVFS();
    const b   = createBuilderEngine(null, vfs, null);
    b.buildModule('gadget');
    expect(vfs.write).toHaveBeenCalled();
  });

  test('appears in listArtefacts', () => {
    const b = createBuilderEngine(null, makeVFS(), null);
    b.buildModule('gadget');
    const list = b.listArtefacts();
    expect(list.some(a => a.name === 'gadget' && a.type === 'module')).toBe(true);
  });

  test('works without VFS', () => {
    const b = createBuilderEngine(null, null, null);
    expect(() => b.buildModule('no-vfs')).not.toThrow();
  });

  test('emits builder:artefact on kernel bus', () => {
    const kernel = makeKernel();
    const b      = createBuilderEngine(kernel, makeVFS(), null);
    b.buildModule('emit-test');
    expect(kernel.bus.emit).toHaveBeenCalledWith('builder:artefact', expect.objectContaining({ type: 'module' }));
  });
});

// ── buildTest ─────────────────────────────────────────────────────────────────
describe('buildTest()', () => {
  test('returns ok:true with type test', () => {
    const b = createBuilderEngine(null, makeVFS(), null);
    const r = b.buildTest('my-mod');
    expect(r.ok).toBe(true);
    expect(r.type).toBe('test');
  });

  test('generated test content contains describe block', () => {
    const b = createBuilderEngine(null, makeVFS(), null);
    const r = b.buildTest('checker');
    expect(r.content).toContain('describe(');
  });
});

// ── buildScript ───────────────────────────────────────────────────────────────
describe('buildScript()', () => {
  test('returns ok:true with type script', () => {
    const b = createBuilderEngine(null, makeVFS(), null);
    const r = b.buildScript('deploy');
    expect(r.ok).toBe(true);
    expect(r.type).toBe('script');
  });

  test('content starts with POSIX shebang', () => {
    const b = createBuilderEngine(null, makeVFS(), null);
    const r = b.buildScript('start');
    expect(r.content.startsWith('#!/usr/bin/env sh')).toBe(true);
  });
});

// ── buildConfig ───────────────────────────────────────────────────────────────
describe('buildConfig()', () => {
  test('returns ok:true with type config', () => {
    const b = createBuilderEngine(null, makeVFS(), null);
    const r = b.buildConfig('watcher');
    expect(r.ok).toBe(true);
    expect(r.type).toBe('config');
  });

  test('content is valid JSON with name field', () => {
    const b   = createBuilderEngine(null, makeVFS(), null);
    const r   = b.buildConfig('watcher');
    const obj = JSON.parse(r.content);
    expect(obj.name).toBe('watcher');
  });
});

// ── listArtefacts ─────────────────────────────────────────────────────────────
describe('listArtefacts()', () => {
  test('empty initially', () => {
    const b = createBuilderEngine(null, null, null);
    expect(b.listArtefacts()).toEqual([]);
  });

  test('returns all types after multiple builds', () => {
    const vfs = makeVFS();
    const b   = createBuilderEngine(null, vfs, null);
    b.buildModule('a');
    b.buildScript('b');
    b.buildConfig('c');
    b.buildTest('d');
    const list = b.listArtefacts();
    expect(list.length).toBe(4);
    const types = list.map(a => a.type);
    expect(types).toContain('module');
    expect(types).toContain('script');
    expect(types).toContain('config');
    expect(types).toContain('test');
  });
});

// ── Terminal commands ─────────────────────────────────────────────────────────
describe('commands.build', () => {
  test('no args returns status table', () => {
    const b = createBuilderEngine(null, null, null);
    const r = b.commands.build([]);
    expect(r.status).toBe('ok');
    expect(r.result).toMatch(/Builder Engine/i);
  });

  test('"status" returns status table', () => {
    const b = createBuilderEngine(null, null, null);
    const r = b.commands.build(['status']);
    expect(r.status).toBe('ok');
    expect(r.result).toMatch(/Builder Engine/i);
  });

  test('"help" returns usage text', () => {
    const b = createBuilderEngine(null, null, null);
    const r = b.commands.build(['help']);
    expect(r.status).toBe('ok');
    expect(r.result).toMatch(/Usage/i);
    expect(r.result).toContain('build module');
  });

  test('"list" with no artefacts returns appropriate message', () => {
    const b = createBuilderEngine(null, null, null);
    const r = b.commands.build(['list']);
    expect(r.status).toBe('ok');
    expect(r.result).toMatch(/No artefacts/i);
  });

  test('"list" after build shows artefacts', () => {
    const vfs = makeVFS();
    const b   = createBuilderEngine(null, vfs, null);
    b.buildModule('widget');
    const r = b.commands.build(['list']);
    expect(r.status).toBe('ok');
    expect(r.result).toContain('widget');
  });

  test('"module <name>" builds and reports vfsPath', () => {
    const vfs = makeVFS();
    const b   = createBuilderEngine(null, vfs, null);
    const r   = b.commands.build(['module', 'ticker']);
    expect(r.status).toBe('ok');
    expect(r.result).toContain('ticker');
    expect(r.result).toContain('VFS');
  });

  test('"script <name>" builds script', () => {
    const vfs = makeVFS();
    const b   = createBuilderEngine(null, vfs, null);
    const r   = b.commands.build(['script', 'deploy']);
    expect(r.status).toBe('ok');
    expect(r.result).toContain('deploy');
  });

  test('"config <name>" builds config', () => {
    const vfs = makeVFS();
    const b   = createBuilderEngine(null, vfs, null);
    const r   = b.commands.build(['config', 'watcher']);
    expect(r.status).toBe('ok');
  });

  test('"test <name>" builds test stub', () => {
    const vfs = makeVFS();
    const b   = createBuilderEngine(null, vfs, null);
    const r   = b.commands.build(['test', 'checker']);
    expect(r.status).toBe('ok');
  });

  test('sub-command without name returns error', () => {
    const b = createBuilderEngine(null, null, null);
    const r = b.commands.build(['module']);
    expect(r.status).toBe('error');
    expect(r.result).toMatch(/Usage/i);
  });

  test('unknown sub-command returns error', () => {
    const b = createBuilderEngine(null, null, null);
    const r = b.commands.build(['unknown-cmd', 'foo']);
    expect(r.status).toBe('error');
    expect(r.result).toMatch(/Unknown/i);
  });

  test('string arg (not array) works for status', () => {
    const b = createBuilderEngine(null, null, null);
    const r = b.commands.build('status');
    expect(r.status).toBe('ok');
  });
});
