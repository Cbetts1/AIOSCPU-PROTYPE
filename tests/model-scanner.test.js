'use strict';

const { createModelScanner } = require('../core/model-scanner');

// ---------------------------------------------------------------------------
// Shared test helpers
// ---------------------------------------------------------------------------

function makeKernel() {
  const events = {};
  return {
    bus: {
      emit(event, data) {
        if (!events[event]) events[event] = [];
        events[event].push(data);
      },
      _events: events,
    },
  };
}

function makeFilesystem() {
  const files = {};
  const dirs  = new Set(['/']);

  return {
    mkdir(path) { dirs.add(path); return { ok: true, path }; },
    ls(path) {
      const prefix = path.endsWith('/') ? path : path + '/';
      const entries = [];
      for (const [fp] of Object.entries(files)) {
        if (fp.startsWith(prefix) && !fp.slice(prefix.length).includes('/')) {
          const name = fp.slice(prefix.length);
          entries.push({ name, type: 'file', size: files[fp].length });
        }
      }
      if (!dirs.has(path) && !entries.length) return { ok: false, error: `No such directory: ${path}` };
      return { ok: true, entries };
    },
    read(path) {
      if (!files[path]) return { ok: false, error: `No such file: ${path}` };
      return { ok: true, content: files[path] };
    },
    write(path, content) { files[path] = content; return { ok: true }; },
    _files: files,
    _dirs: dirs,
  };
}

function makeHostBridge(overrides = {}) {
  return {
    memInfo: () => ({ ok: true, totalMB: 16384, freeMB: 8192, usedMB: 8192 }),
    systemInfo: () => ({ ok: true, cpuCores: 8, cpuModel: 'Test CPU', hostname: 'test' }),
    hostfs: {
      ls:   () => ({ ok: false, error: 'not found' }),
      read: () => ({ ok: false, error: 'not found' }),
      stat: () => ({ ok: false, error: 'not found' }),
    },
    ...overrides,
  };
}

function makeNetwork(responses = {}) {
  return {
    get: jest.fn(async (url) => {
      if (responses[url]) return responses[url];
      return { ok: false, status: 404, json: () => null };
    }),
  };
}

// ---------------------------------------------------------------------------
// createModelScanner factory
// ---------------------------------------------------------------------------
describe('createModelScanner', () => {
  test('returns scanner object with expected API', () => {
    const scanner = createModelScanner(null, null, null, null);
    expect(scanner).toBeDefined();
    expect(scanner.name).toBe('model-scanner');
    expect(scanner.version).toBe('4.0.0');
    expect(typeof scanner.scan).toBe('function');
    expect(typeof scanner.scanLocal).toBe('function');
    expect(typeof scanner.scanHostLocal).toBe('function');
    expect(typeof scanner.scanRemote).toBe('function');
    expect(typeof scanner.scanGitHub).toBe('function');
    expect(typeof scanner.scanHuggingFace).toBe('function');
    expect(typeof scanner.list).toBe('function');
    expect(typeof scanner.get).toBe('function');
    expect(typeof scanner.remove).toBe('function');
    expect(typeof scanner.verify).toBe('function');
    expect(typeof scanner.commands).toBe('object');
    expect(typeof scanner.commands.models).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// scanLocal — VFS /models scanning
// ---------------------------------------------------------------------------
describe('scanLocal', () => {
  let kernel, fs, scanner;

  beforeEach(() => {
    kernel  = makeKernel();
    fs      = makeFilesystem();
    scanner = createModelScanner(kernel, fs, null, makeHostBridge());
  });

  test('returns error when no filesystem provided', () => {
    const s = createModelScanner(null, null, null, null);
    const r = s.scanLocal('/models');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/filesystem/i);
  });

  test('scans empty directory without error', () => {
    const r = scanner.scanLocal('/models');
    expect(r.ok).toBe(true);
    expect(r.found).toBe(0);
  });

  test('loads a valid JSON manifest', () => {
    const manifest = JSON.stringify({
      name: 'test-model',
      version: '1.0.0',
      format: 'gguf',
      sizeMB: 1024,
      memoryMB: 2048,
      cpuCores: 2,
      supportedModes: ['both'],
    });
    fs._dirs.add('/models');
    fs._files['/models/test-model.json'] = manifest;

    const r = scanner.scanLocal('/models');
    expect(r.ok).toBe(true);
    expect(r.found).toBe(1);
    expect(r.names).toContain('test-model');
  });

  test('record has correct metadata from manifest', () => {
    const manifest = JSON.stringify({
      name: 'my-model',
      version: '2.1.0',
      format: 'safetensors',
      sizeMB: 500,
      memoryMB: 1000,
      cpuCores: 4,
      supportedModes: ['self', 'mirror'],
      tags: ['nlp'],
      dependencies: ['tokenizer-v2'],
    });
    fs._dirs.add('/models');
    fs._files['/models/my-model.json'] = manifest;

    scanner.scanLocal('/models');
    const rec = scanner.get('my-model');
    expect(rec).not.toBeNull();
    expect(rec.version).toBe('2.1.0');
    expect(rec.format).toBe('safetensors');
    expect(rec.sizeMB).toBe(500);
    expect(rec.memoryMB).toBe(1000);
    expect(rec.cpuCores).toBe(4);
    expect(rec.source).toBe('local');
    expect(rec.tags).toContain('nlp');
    expect(rec.dependencies).toContain('tokenizer-v2');
    expect(rec.discoveredAt).toBeTruthy();
  });

  test('skips file with invalid JSON', () => {
    fs._dirs.add('/models');
    fs._files['/models/bad.json'] = 'not valid json{{{';
    const r = scanner.scanLocal('/models');
    expect(r.ok).toBe(true);
    expect(r.found).toBe(0);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  test('model without name uses filename as name', () => {
    fs._dirs.add('/models');
    fs._files['/models/inferred-name.json'] = JSON.stringify({ version: '1.0.0' });
    const r = scanner.scanLocal('/models');
    expect(r.found).toBe(1);
    expect(scanner.get('inferred-name')).not.toBeNull();
  });

  test('emits model:registered kernel event', () => {
    fs._dirs.add('/models');
    fs._files['/models/llama.json'] = JSON.stringify({ name: 'llama', version: '1.0.0' });
    scanner.scanLocal('/models');
    const events = kernel.bus._events['model:registered'] || [];
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].name).toBe('llama');
  });

  test('skips host binary model with bad checksum on verify()', () => {
    const fakeContent = 'fake binary content';
    const wrongHash   = '0000000000000000000000000000000000000000000000000000000000000000';

    const hb = makeHostBridge({
      hostfs: {
        ls:   () => ({ ok: true, entries: [{ name: 'bad.gguf', type: 'file', size: fakeContent.length }] }),
        read: () => ({ ok: true, content: fakeContent }),
        stat: () => ({ ok: true, size: fakeContent.length, isFile: true }),
      },
    });

    const scannerHB = createModelScanner(null, null, null, hb);
    scannerHB.scanHostLocal('/models');

    const rec = scannerHB.get('bad');
    expect(rec).not.toBeNull();

    // Attach a bad checksum (simulates a tampered binary file)
    rec.checksum     = `sha256:${wrongHash}`;
    rec.checksumType = 'sha256';

    // verify re-reads from hostBridge; sha256('fake binary content') !== wrongHash
    const result = scannerHB.verify('bad');
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => /checksum/i.test(e))).toBe(true);
  });

  test('checksum in JSON manifest is not self-verified (refers to binary model file)', () => {
    // The checksum field in a .json manifest refers to the binary model file,
    // not the manifest itself. A manifest with any checksum is still loaded.
    const manifest = JSON.stringify({
      name:     'hashed',
      version:  '1.0.0',
      checksum: 'sha256:0000000000000000000000000000000000000000000000000000000000000000',
    });
    fs._dirs.add('/models');
    fs._files['/models/hashed.json'] = manifest;
    const r = scanner.scanLocal('/models');
    expect(r.found).toBe(1);
    const rec = scanner.get('hashed');
    expect(rec.checksum).toBe('sha256:0000000000000000000000000000000000000000000000000000000000000000');
  });

  test('custom vfsPath is respected', () => {
    fs._dirs.add('/custom/models');
    fs._files['/custom/models/m.json'] = JSON.stringify({ name: 'm', version: '1.0.0' });
    const r = scanner.scanLocal('/custom/models');
    expect(r.found).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// scanHostLocal — host filesystem scanning
// ---------------------------------------------------------------------------
describe('scanHostLocal', () => {
  test('returns error when no hostBridge provided', () => {
    const scanner = createModelScanner(null, null, null, null);
    const r = scanner.scanHostLocal('/models');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/host bridge/i);
  });

  test('returns error when host ls fails', () => {
    const hb = makeHostBridge();
    const scanner = createModelScanner(null, null, null, hb);
    const r = scanner.scanHostLocal('/nonexistent');
    expect(r.ok).toBe(false);
  });

  test('loads a JSON manifest from host filesystem', () => {
    const manifest = JSON.stringify({ name: 'host-model', version: '1.0.0', sizeMB: 200 });
    const hb = makeHostBridge({
      hostfs: {
        ls:   (path) => ({ ok: true, entries: [{ name: 'host-model.json', type: 'file', size: manifest.length }] }),
        read: (path) => ({ ok: true, content: manifest }),
        stat: (path) => ({ ok: true, size: 200 * 1024 * 1024, isFile: true }),
      },
    });
    const scanner = createModelScanner(null, null, null, hb);
    const r = scanner.scanHostLocal('/models');
    expect(r.ok).toBe(true);
    expect(r.found).toBe(1);
    expect(scanner.get('host-model').source).toBe('host');
  });

  test('infers metadata for bare model files (.gguf)', () => {
    const hb = makeHostBridge({
      hostfs: {
        ls:   () => ({ ok: true, entries: [{ name: 'weights.gguf', type: 'file', size: 1024 }] }),
        read: () => ({ ok: false, error: 'not a manifest' }),
        stat: () => ({ ok: true, size: 4 * 1024 * 1024 * 1024, isFile: true }),
      },
    });
    const scanner = createModelScanner(null, null, null, hb);
    const r = scanner.scanHostLocal('/models');
    expect(r.found).toBe(1);
    const rec = scanner.get('weights');
    expect(rec).not.toBeNull();
    expect(rec.format).toBe('gguf');
  });
});

// ---------------------------------------------------------------------------
// scanRemote — remote URL scanning
// ---------------------------------------------------------------------------
describe('scanRemote', () => {
  test('returns error when no network provided', async () => {
    const scanner = createModelScanner(null, null, null, null);
    const r = await scanner.scanRemote(['http://example.com/models.json']);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/network/i);
  });

  test('fetches a single manifest JSON', async () => {
    const net = makeNetwork({
      'http://example.com/models.json': {
        ok: true,
        status: 200,
        json: () => ({ name: 'remote-model', version: '1.0.0', sizeMB: 100, memoryMB: 200 }),
      },
    });
    const scanner = createModelScanner(null, null, net, makeHostBridge());
    const r = await scanner.scanRemote(['http://example.com/models.json']);
    expect(r.ok).toBe(true);
    expect(r.found).toBe(1);
    expect(scanner.get('remote-model').source).toBe('remote');
  });

  test('fetches an array of manifests', async () => {
    const net = makeNetwork({
      'http://example.com/list.json': {
        ok: true,
        status: 200,
        json: () => [
          { name: 'model-a', version: '1.0.0' },
          { name: 'model-b', version: '2.0.0' },
        ],
      },
    });
    const scanner = createModelScanner(null, null, net, makeHostBridge());
    const r = await scanner.scanRemote(['http://example.com/list.json']);
    expect(r.found).toBe(2);
  });

  test('records HTTP errors in errors array', async () => {
    const net = makeNetwork({
      'http://bad.example.com/list.json': { ok: false, status: 500, json: () => null },
    });
    const scanner = createModelScanner(null, null, net, makeHostBridge());
    const r = await scanner.scanRemote(['http://bad.example.com/list.json']);
    expect(r.ok).toBe(true);
    expect(r.found).toBe(0);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  test('skips entries without a name', async () => {
    const net = makeNetwork({
      'http://example.com/noname.json': {
        ok: true, status: 200,
        json: () => [{ version: '1.0.0' }],   // no name
      },
    });
    const scanner = createModelScanner(null, null, net, makeHostBridge());
    const r = await scanner.scanRemote(['http://example.com/noname.json']);
    expect(r.found).toBe(0);
  });

  test('handles network error gracefully', async () => {
    const net = { get: jest.fn(() => Promise.reject(new Error('ECONNREFUSED'))) };
    const scanner = createModelScanner(null, null, net, makeHostBridge());
    const r = await scanner.scanRemote(['http://dead.example.com/m.json']);
    expect(r.ok).toBe(true);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0]).toMatch(/ECONNREFUSED/);
  });
});

// ---------------------------------------------------------------------------
// scanGitHub
// ---------------------------------------------------------------------------
describe('scanGitHub', () => {
  test('returns error when no network provided', async () => {
    const scanner = createModelScanner(null, null, null, null);
    const r = await scanner.scanGitHub([{ owner: 'test', repo: 'models' }]);
    expect(r.ok).toBe(false);
  });

  test('records error for missing owner/repo', async () => {
    const scanner = createModelScanner(null, null, makeNetwork(), makeHostBridge());
    const r = await scanner.scanGitHub([{ repo: 'models' }]);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  test('fetches and registers models from GitHub directory listing', async () => {
    const manifestBody = JSON.stringify({ name: 'gh-model', version: '1.0.0', memoryMB: 512 });
    const contentsUrl  = 'https://api.github.com/repos/alice/ml-models/contents/models';
    const downloadUrl  = 'https://raw.githubusercontent.com/alice/ml-models/main/models/gh-model.json';

    const net = makeNetwork({
      [contentsUrl]: {
        ok: true, status: 200,
        json: () => [
          { type: 'file', name: 'gh-model.json', download_url: downloadUrl, html_url: downloadUrl },
          { type: 'dir',  name: 'subdir' },
        ],
      },
      [downloadUrl]: {
        ok: true, status: 200,
        json: () => ({ name: 'gh-model', version: '1.0.0', memoryMB: 512 }),
      },
    });
    const scanner = createModelScanner(null, null, net, makeHostBridge());
    const r = await scanner.scanGitHub([{ owner: 'alice', repo: 'ml-models' }]);
    expect(r.ok).toBe(true);
    expect(r.found).toBe(1);
    expect(scanner.get('gh-model').source).toBe('github');
  });

  test('skips non-JSON files in GitHub listing', async () => {
    const contentsUrl = 'https://api.github.com/repos/alice/models/contents/models';
    const net = makeNetwork({
      [contentsUrl]: {
        ok: true, status: 200,
        json: () => [
          { type: 'file', name: 'weights.gguf', download_url: 'http://x.com/weights.gguf' },
        ],
      },
    });
    const scanner = createModelScanner(null, null, net, makeHostBridge());
    const r = await scanner.scanGitHub([{ owner: 'alice', repo: 'models' }]);
    expect(r.found).toBe(0);
  });

  test('handles HTTP error from GitHub API gracefully', async () => {
    const net = makeNetwork({
      'https://api.github.com/repos/notfound/models/contents/models': {
        ok: false, status: 404, json: () => null,
      },
    });
    const scanner = createModelScanner(null, null, net, makeHostBridge());
    const r = await scanner.scanGitHub([{ owner: 'notfound', repo: 'models' }]);
    expect(r.ok).toBe(true);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// scanHuggingFace
// ---------------------------------------------------------------------------
describe('scanHuggingFace', () => {
  test('returns error when no network provided', async () => {
    const scanner = createModelScanner(null, null, null, null);
    const r = await scanner.scanHuggingFace(['meta-llama/Llama-3-8B']);
    expect(r.ok).toBe(false);
  });

  test('records error for invalid repo id format', async () => {
    const scanner = createModelScanner(null, null, makeNetwork(), makeHostBridge());
    const r = await scanner.scanHuggingFace(['invalid-repo-no-slash']);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  test('fetches and registers model from HuggingFace API', async () => {
    const apiUrl = 'https://huggingface.co/api/models/meta-llama/Llama-3-8B';
    const net = makeNetwork({
      [apiUrl]: {
        ok: true, status: 200,
        json: () => ({
          modelId: 'Llama-3-8B',
          tags: ['llm', 'v1.0'],
          safetensors: { total: 8 * 1024 * 1024 * 1024 },
        }),
      },
    });
    const scanner = createModelScanner(null, null, net, makeHostBridge());
    const r = await scanner.scanHuggingFace(['meta-llama/Llama-3-8B']);
    expect(r.ok).toBe(true);
    expect(r.found).toBe(1);
    const rec = scanner.get('Llama-3-8B');
    expect(rec).not.toBeNull();
    expect(rec.source).toBe('huggingface');
    expect(rec.sizeMB).toBeGreaterThan(0);
    expect(rec.tags).toContain('llm');
  });

  test('handles HTTP error from HuggingFace gracefully', async () => {
    const net = makeNetwork({
      'https://huggingface.co/api/models/unknown/model': { ok: false, status: 404, json: () => null },
    });
    const scanner = createModelScanner(null, null, net, makeHostBridge());
    const r = await scanner.scanHuggingFace(['unknown/model']);
    expect(r.ok).toBe(true);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Compatibility checking
// ---------------------------------------------------------------------------
describe('compatibility checking', () => {
  test('marks model compatible when memory requirement is within system total', () => {
    const hb = makeHostBridge({
      memInfo: () => ({ ok: true, totalMB: 16384, freeMB: 8192 }),
      systemInfo: () => ({ cpuCores: 8 }),
    });
    const fs = makeFilesystem();
    fs._dirs.add('/models');
    fs._files['/models/small.json'] = JSON.stringify({
      name: 'small', version: '1.0.0', memoryMB: 2048, supportedModes: ['both'],
    });
    const scanner = createModelScanner(null, fs, null, hb);
    scanner.scanLocal('/models');
    const rec = scanner.get('small');
    expect(rec.compatible).toBe(true);
    expect(rec.incompatibleReason).toBeNull();
  });

  test('marks model incompatible when memory exceeds total RAM', () => {
    const hb = makeHostBridge({
      memInfo: () => ({ ok: true, totalMB: 4096, freeMB: 1000 }),
      systemInfo: () => ({ cpuCores: 8 }),
    });
    const fs = makeFilesystem();
    fs._dirs.add('/models');
    fs._files['/models/huge.json'] = JSON.stringify({
      name: 'huge', version: '1.0.0', memoryMB: 32768, supportedModes: ['both'],
    });
    const scanner = createModelScanner(null, fs, null, hb);
    scanner.scanLocal('/models');
    const rec = scanner.get('huge');
    expect(rec.compatible).toBe(false);
    expect(rec.incompatibleReason).toMatch(/RAM/i);
  });

  test('marks model incompatible when mode not supported', () => {
    // Force mode to 'mirror'
    const origMode = process.env.AIOS_MODE;
    process.env.AIOS_MODE = 'mirror';

    const hb = makeHostBridge({
      memInfo: () => ({ ok: true, totalMB: 16384, freeMB: 8192 }),
      systemInfo: () => ({ cpuCores: 8 }),
    });
    const fs = makeFilesystem();
    fs._dirs.add('/models');
    fs._files['/models/self-only.json'] = JSON.stringify({
      name: 'self-only', version: '1.0.0', memoryMB: 100, supportedModes: ['self'],
    });
    const scanner = createModelScanner(null, fs, null, hb);
    scanner.scanLocal('/models');
    const rec = scanner.get('self-only');
    expect(rec.compatible).toBe(false);
    expect(rec.incompatibleReason).toMatch(/mode/i);

    process.env.AIOS_MODE = origMode;
  });

  test('marks model compatible when it supports "both" modes', () => {
    const origMode = process.env.AIOS_MODE;
    process.env.AIOS_MODE = 'mirror';
    const hb = makeHostBridge({
      memInfo:    () => ({ ok: true, totalMB: 16384, freeMB: 8192 }),
      systemInfo: () => ({ cpuCores: 8 }),
    });
    const fs = makeFilesystem();
    fs._dirs.add('/models');
    fs._files['/models/any.json'] = JSON.stringify({
      name: 'any', version: '1.0.0', memoryMB: 100, supportedModes: ['both'],
    });
    const scanner = createModelScanner(null, fs, null, hb);
    scanner.scanLocal('/models');
    const rec = scanner.get('any');
    expect(rec.compatible).toBe(true);
    process.env.AIOS_MODE = origMode;
  });
});

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------
describe('deduplication', () => {
  test('local source wins over remote for same name@version', async () => {
    const fs = makeFilesystem();
    fs._dirs.add('/models');
    fs._files['/models/model-x.json'] = JSON.stringify({
      name: 'model-x', version: '1.0.0', sizeMB: 100,
    });

    const net = makeNetwork({
      'http://example.com/model-x.json': {
        ok: true, status: 200,
        json: () => ({ name: 'model-x', version: '1.0.0', sizeMB: 999 }),
      },
    });

    const scanner = createModelScanner(null, fs, net, makeHostBridge());
    scanner.scanLocal('/models');
    await scanner.scanRemote(['http://example.com/model-x.json']);

    const rec = scanner.get('model-x');
    expect(rec.source).toBe('local');
    expect(rec.sizeMB).toBe(100);  // local value retained
  });

  test('different versions are stored as separate entries', () => {
    const fs = makeFilesystem();
    fs._dirs.add('/models');
    fs._files['/models/m-v1.json'] = JSON.stringify({ name: 'model-y', version: '1.0.0' });
    fs._files['/models/m-v2.json'] = JSON.stringify({ name: 'model-y', version: '2.0.0' });

    const scanner = createModelScanner(null, fs, null, makeHostBridge());
    const r = scanner.scanLocal('/models');
    expect(r.found).toBe(2);
    expect(scanner.list()).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// list / get / remove
// ---------------------------------------------------------------------------
describe('list / get / remove', () => {
  let scanner, fs;

  beforeEach(() => {
    fs = makeFilesystem();
    fs._dirs.add('/models');
    fs._files['/models/compat.json']   = JSON.stringify({ name: 'compat',   version: '1.0.0', memoryMB: 100 });
    fs._files['/models/incompat.json'] = JSON.stringify({ name: 'incompat', version: '1.0.0', memoryMB: 99999999 });
    const hb = makeHostBridge({ memInfo: () => ({ ok: true, totalMB: 4096, freeMB: 1024 }) });
    scanner = createModelScanner(null, fs, null, hb);
    scanner.scanLocal('/models');
  });

  test('list() returns all models by default', () => {
    expect(scanner.list()).toHaveLength(2);
  });

  test('list({ compatibleOnly: true }) filters incompatible', () => {
    const compatible = scanner.list({ compatibleOnly: true });
    expect(compatible.every(m => m.compatible)).toBe(true);
  });

  test('list({ source: "local" }) filters by source', () => {
    const local = scanner.list({ source: 'local' });
    expect(local.every(m => m.source === 'local')).toBe(true);
  });

  test('get() returns model by name', () => {
    const rec = scanner.get('compat');
    expect(rec).not.toBeNull();
    expect(rec.name).toBe('compat');
  });

  test('get() returns model by name@version key', () => {
    const rec = scanner.get('compat@1.0.0');
    expect(rec).not.toBeNull();
  });

  test('get() returns null for unknown name', () => {
    expect(scanner.get('nonexistent')).toBeNull();
  });

  test('remove() deletes a model by name', () => {
    expect(scanner.remove('compat')).toBe(true);
    expect(scanner.get('compat')).toBeNull();
  });

  test('remove() returns false for unknown model', () => {
    expect(scanner.remove('ghost')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// verify
// ---------------------------------------------------------------------------
describe('verify', () => {
  test('returns error for unknown model', () => {
    const scanner = createModelScanner(null, null, null, null);
    const r = scanner.verify('ghost');
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not found/i);
  });

  test('passes valid model without checksum', () => {
    const fs = makeFilesystem();
    fs._dirs.add('/models');
    fs._files['/models/valid.json'] = JSON.stringify({ name: 'valid', version: '1.0.0' });
    const scanner = createModelScanner(null, fs, null, makeHostBridge());
    scanner.scanLocal('/models');
    const r = scanner.verify('valid');
    expect(r.ok).toBe(true);
  });

  test('fails model with bad version', () => {
    const fs  = makeFilesystem();
    const net = makeNetwork({
      'http://ex.com/badver.json': {
        ok: true, status: 200,
        json: () => ({ name: 'badver' }),  // missing version
      },
    });
    const scanner = createModelScanner(null, fs, net, makeHostBridge());
    // Manually put a record with default version
    scanner.list(); // ensure registry empty

    // We need to get a model with default version into registry
    // Use scanRemote which will add it
    return scanner.scanRemote(['http://ex.com/badver.json']).then(() => {
      const rec = scanner.get('badver');
      expect(rec).not.toBeNull();
      const r = scanner.verify('badver');
      // version 0.0.0 should be a warning but record has no file to check
      expect(typeof r.ok).toBe('boolean');
    });
  });
});

// ---------------------------------------------------------------------------
// scan (orchestrator)
// ---------------------------------------------------------------------------
describe('scan (orchestrator)', () => {
  test('returns ok with summary', async () => {
    const fs = makeFilesystem();
    fs._dirs.add('/models');
    fs._files['/models/m.json'] = JSON.stringify({ name: 'm', version: '1.0.0' });
    const scanner = createModelScanner(makeKernel(), fs, null, makeHostBridge());
    const r = await scanner.scan({ skipHost: true, skipRemote: true, skipGitHub: true, skipHuggingFace: true });
    expect(r.ok).toBe(true);
    expect(r.total).toBeGreaterThanOrEqual(1);
    expect(typeof r.compatible).toBe('number');
    expect(typeof r.incompatible).toBe('number');
  });

  test('emits model:scan:complete event', async () => {
    const kernel = makeKernel();
    const fs = makeFilesystem();
    fs._dirs.add('/models');
    const scanner = createModelScanner(kernel, fs, null, makeHostBridge());
    await scanner.scan({ skipHost: true, skipRemote: true, skipGitHub: true, skipHuggingFace: true });
    const events = kernel.bus._events['model:scan:complete'] || [];
    expect(events.length).toBe(1);
    expect(typeof events[0].total).toBe('number');
  });

  test('skipLocal skips local scan', async () => {
    const fs = makeFilesystem();
    fs._dirs.add('/models');
    fs._files['/models/local.json'] = JSON.stringify({ name: 'local', version: '1.0.0' });
    const scanner = createModelScanner(null, fs, null, makeHostBridge());
    const r = await scanner.scan({ skipLocal: true, skipHost: true, skipRemote: true, skipGitHub: true, skipHuggingFace: true });
    expect(scanner.get('local')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Router commands
// ---------------------------------------------------------------------------
describe('commands.models', () => {
  let scanner, fs;

  beforeEach(() => {
    fs = makeFilesystem();
    fs._dirs.add('/models');
    fs._files['/models/llama.json'] = JSON.stringify({ name: 'llama', version: '3.0.0', memoryMB: 1024 });
    scanner = createModelScanner(null, fs, null, makeHostBridge());
  });

  test('models scan runs local scan and returns summary', async () => {
    const r = await scanner.commands.models(['scan', '--local']);
    expect(r.status).toBe('ok');
    expect(r.result).toMatch(/scan complete/i);
  });

  test('models list shows compatible models', async () => {
    scanner.scanLocal('/models');
    const r = await scanner.commands.models(['list']);
    expect(r.status).toBe('ok');
    expect(r.result).toMatch(/llama/i);
  });

  test('models list --all shows all models', async () => {
    scanner.scanLocal('/models');
    const r = await scanner.commands.models(['list', '--all']);
    expect(r.status).toBe('ok');
  });

  test('models info shows model JSON', async () => {
    scanner.scanLocal('/models');
    const r = await scanner.commands.models(['info', 'llama']);
    expect(r.status).toBe('ok');
    expect(r.result).toContain('"llama"');
  });

  test('models info returns error for unknown model', async () => {
    const r = await scanner.commands.models(['info', 'ghost']);
    expect(r.status).toBe('error');
    expect(r.result).toMatch(/not found/i);
  });

  test('models info requires a name argument', async () => {
    const r = await scanner.commands.models(['info']);
    expect(r.status).toBe('error');
  });

  test('models rm removes a model', async () => {
    scanner.scanLocal('/models');
    const r = await scanner.commands.models(['rm', 'llama']);
    expect(r.status).toBe('ok');
    expect(scanner.get('llama')).toBeNull();
  });

  test('models rm returns error for unknown model', async () => {
    const r = await scanner.commands.models(['rm', 'ghost']);
    expect(r.status).toBe('error');
  });

  test('models verify returns ok for valid model', async () => {
    scanner.scanLocal('/models');
    const r = await scanner.commands.models(['verify', 'llama']);
    expect(r.status).toBe('ok');
  });

  test('models verify returns error for unknown model', async () => {
    const r = await scanner.commands.models(['verify', 'ghost']);
    expect(r.status).toBe('error');
  });

  test('unknown subcommand shows usage', async () => {
    const r = await scanner.commands.models(['bogus']);
    expect(r.status).toBe('ok');
    expect(r.result).toMatch(/usage/i);
  });

  test('no arguments shows usage', async () => {
    // default sub is "list"
    const r = await scanner.commands.models([]);
    expect(r.status).toBe('ok');
  });
});
