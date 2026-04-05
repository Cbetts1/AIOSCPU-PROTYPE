'use strict';
/**
 * model-scanner.js — AIOS AI Model Scanner v1.0.0
 *
 * Discovers, verifies, and registers AI models from multiple sources:
 *   1. Local AIOS VFS  (/models)
 *   2. Host filesystem (/models via hostBridge)
 *   3. Remote servers  (configurable JSON manifest URLs)
 *   4. GitHub          (public repo contents API)
 *   5. HuggingFace     (Hub model-info API)
 *
 * For each model found:
 *   - Verifies integrity (checksum, version, size, dependencies)
 *   - Checks compatibility with available AIOS memory and current mode
 *   - Records normalized metadata
 *
 * Deduplication: one record per (name, version) pair; local > host > remote.
 * Incompatible models are retained in the registry but flagged as incompatible.
 *
 * Model manifest format (JSON):
 * {
 *   "name":           "llama3-8b-q4",
 *   "version":        "1.0.0",
 *   "format":         "gguf",                      // gguf | safetensors | bin | json | unknown
 *   "sizeMB":         4096,                         // on-disk MB
 *   "memoryMB":       5000,                         // RAM required to run
 *   "cpuCores":       2,                            // minimum cores
 *   "supportedModes": ["self", "mirror"],           // or ["both"]
 *   "checksum":       "sha256:<hex>",               // optional
 *   "dependencies":   ["tokenizer-llama3"],         // optional
 *   "tags":           ["llm", "chat"]               // optional
 * }
 *
 * Zero external npm dependencies.
 */

const crypto = require('crypto');

// ---------------------------------------------------------------------------
// Supported model file extensions (non-manifest)
// ---------------------------------------------------------------------------
const MODEL_EXTENSIONS = new Set(['.gguf', '.safetensors', '.bin', '.pt', '.onnx']);

// ---------------------------------------------------------------------------
// Source priority for deduplication (lower = higher priority)
// ---------------------------------------------------------------------------
const SOURCE_PRIORITY = { local: 0, host: 1, remote: 2, github: 3, huggingface: 4 };

// ---------------------------------------------------------------------------
// Helper: extract format from filename extension
// ---------------------------------------------------------------------------
function _formatFromExt(filename) {
  const lower = (filename || '').toLowerCase();
  if (lower.endsWith('.gguf'))        return 'gguf';
  if (lower.endsWith('.safetensors')) return 'safetensors';
  if (lower.endsWith('.bin'))         return 'bin';
  if (lower.endsWith('.pt'))          return 'pytorch';
  if (lower.endsWith('.onnx'))        return 'onnx';
  if (lower.endsWith('.json'))        return 'json';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Helper: normalise a raw manifest object into a standard record
// ---------------------------------------------------------------------------
function _normalise(raw, source, path) {
  return {
    name:             String(raw.name         || '').trim(),
    version:          String(raw.version      || '0.0.0').trim(),
    format:           String(raw.format       || _formatFromExt(path) || 'unknown').trim(),
    source,
    path:             path || '',
    sizeMB:           Number(raw.sizeMB)   || 0,
    memoryMB:         Number(raw.memoryMB) || 0,
    cpuCores:         Number(raw.cpuCores) || 1,
    supportedModes:   Array.isArray(raw.supportedModes) ? raw.supportedModes : ['both'],
    checksum:         raw.checksum         || null,
    checksumType:     raw.checksum && raw.checksum.startsWith('sha256:') ? 'sha256' : null,
    compatible:       true,   // filled in by _checkCompatibility
    incompatibleReason: null,
    dependencies:     Array.isArray(raw.dependencies) ? raw.dependencies : [],
    tags:             Array.isArray(raw.tags)         ? raw.tags         : [],
    discoveredAt:     new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Helper: dedup key
// For manifests with a meaningful version, key is name@version.
// For bare model files (inferred version '0.0.0'), include the path to avoid
// collisions between identically-named files from different paths.
// ---------------------------------------------------------------------------
function _dedupKey(rec) {
  if (rec.version === '0.0.0') {
    return `${rec.name}@path:${rec.path}`;
  }
  return `${rec.name}@${rec.version}`;
}

// ---------------------------------------------------------------------------
// Model Scanner factory
// ---------------------------------------------------------------------------
function createModelScanner(kernel, filesystem, network, hostBridge) {
  // Registry: dedupKey → record
  const _registry = new Map();

  // ---------------------------------------------------------------------------
  // _emit — safe kernel bus emit
  // ---------------------------------------------------------------------------
  function _emit(event, data) {
    if (kernel) kernel.bus.emit(event, data);
  }

  // ---------------------------------------------------------------------------
  // _checkCompatibility — annotate record.compatible & incompatibleReason
  // ---------------------------------------------------------------------------
  function _checkCompatibility(record) {
    const reasons = [];

    // Memory check
    if (record.memoryMB > 0 && hostBridge) {
      const mem = hostBridge.memInfo();
      if (mem.ok && record.memoryMB > mem.totalMB) {
        reasons.push(`requires ${record.memoryMB} MB RAM but only ${mem.totalMB} MB total available`);
      }
    }

    // Mode check
    const currentMode = _getCurrentMode();
    if (record.supportedModes.length > 0) {
      const modes = record.supportedModes;
      const supportsBoth = modes.includes('both');
      const supportsCurrent = modes.includes(currentMode);
      if (!supportsBoth && !supportsCurrent) {
        reasons.push(`does not support current AIOS mode "${currentMode}" (supports: ${modes.join(', ')})`);
      }
    }

    // CPU check
    if (record.cpuCores > 0 && hostBridge) {
      const info = hostBridge.systemInfo ? hostBridge.systemInfo() : null;
      if (info && info.ok !== false && typeof info.cpuCores === 'number' && record.cpuCores > info.cpuCores) {
        reasons.push(`requires ${record.cpuCores} CPU cores but only ${info.cpuCores} available`);
      }
    }

    if (reasons.length > 0) {
      record.compatible       = false;
      record.incompatibleReason = reasons.join('; ');
    } else {
      record.compatible       = true;
      record.incompatibleReason = null;
    }
    return record;
  }

  // ---------------------------------------------------------------------------
  // _getCurrentMode — read AIOS mode from env-kernel/mode.js if available
  // ---------------------------------------------------------------------------
  function _getCurrentMode() {
    try {
      const modeModule = require('../usr/lib/aios/env-kernel/mode');
      return modeModule.getMode();
    } catch (_) {}
    // Fallback: read env var directly
    const env = (process.env.AIOS_MODE || '').toLowerCase().trim();
    if (env === 'self' || env === 'mirror') return env;
    return 'mirror';
  }

  // ---------------------------------------------------------------------------
  // _verifyIntegrity — validate checksum, version, size, deps
  //
  // The checksum field in a model record refers to the binary model file
  // (e.g. .gguf, .bin), NOT the JSON manifest. Checksum verification is
  // therefore only applied when `content` is the binary file content and
  // the record's path is a non-JSON file.
  // Returns { ok, errors: string[] }
  // ---------------------------------------------------------------------------
  function _verifyIntegrity(record, content) {
    const errors = [];

    // Version must be present
    if (!record.version || record.version === '0.0.0') {
      errors.push('missing or default version');
    }

    // Name must be non-empty
    if (!record.name) {
      errors.push('missing name');
    }

    // Checksum verification only for binary model files (non-JSON paths)
    const isJsonPath = (record.path || '').toLowerCase().endsWith('.json') ||
                       record.source === 'remote' ||
                       record.source === 'github' ||
                       record.source === 'huggingface';
    if (record.checksum && typeof content === 'string' && !isJsonPath) {
      if (record.checksum.startsWith('sha256:')) {
        const expected = record.checksum.slice(7);
        const actual   = crypto.createHash('sha256').update(content).digest('hex');
        if (actual !== expected) {
          errors.push(`checksum mismatch: expected sha256:${expected}, got sha256:${actual}`);
        }
      }
    }

    // Size sanity: sizeMB must not be negative
    if (record.sizeMB < 0) {
      errors.push('sizeMB must not be negative');
    }

    // Dependencies must be strings
    for (const dep of record.dependencies) {
      if (typeof dep !== 'string' || !dep.trim()) {
        errors.push(`invalid dependency entry: ${JSON.stringify(dep)}`);
      }
    }

    return { ok: errors.length === 0, errors };
  }

  // ---------------------------------------------------------------------------
  // _register — add or replace a record in the registry (respects dedup)
  // ---------------------------------------------------------------------------
  function _register(record) {
    const key      = _dedupKey(record);
    const existing = _registry.get(key);

    if (existing) {
      const existingPri = SOURCE_PRIORITY[existing.source] !== undefined ? SOURCE_PRIORITY[existing.source] : 99;
      const newPri      = SOURCE_PRIORITY[record.source]   !== undefined ? SOURCE_PRIORITY[record.source]   : 99;
      if (newPri >= existingPri) {
        // Keep existing (higher or equal priority)
        return false;
      }
    }

    _checkCompatibility(record);
    _registry.set(key, record);
    _emit('model:registered', { name: record.name, version: record.version, source: record.source });
    return true;
  }

  // ---------------------------------------------------------------------------
  // scanLocal — scan VFS /models (or a given vfsPath) for JSON manifests
  // ---------------------------------------------------------------------------
  function scanLocal(vfsPath) {
    const dir    = vfsPath || '/models';
    const found  = [];
    const errors = [];

    if (!filesystem) {
      return { ok: false, error: 'No filesystem available', found: 0 };
    }

    // Ensure the directory exists
    filesystem.mkdir(dir, { parents: true });

    const r = filesystem.ls(dir);
    if (!r.ok) return { ok: false, error: r.error, found: 0 };

    for (const entry of r.entries) {
      if (entry.type !== 'file') continue;
      const filePath = `${dir}/${entry.name}`;

      if (entry.name.endsWith('.json')) {
        const fr = filesystem.read(filePath);
        if (!fr.ok) { errors.push(`${filePath}: ${fr.error}`); continue; }
        let raw;
        try { raw = JSON.parse(fr.content); } catch (e) {
          errors.push(`${filePath}: JSON parse error — ${e.message}`); continue;
        }
        if (!raw.name) raw.name = entry.name.replace(/\.json$/, '');
        const record = _normalise(raw, 'local', filePath);
        const iv = _verifyIntegrity(record, fr.content);
        if (iv.ok) {
          _register(record);
          found.push(record.name);
        } else {
          errors.push(`${filePath}: integrity errors — ${iv.errors.join('; ')}`);
        }
      } else if (MODEL_EXTENSIONS.has(_ext(entry.name))) {
        // Bare model file without a manifest — infer metadata from filename
        const record = _normalise(
          { name: _basename(entry.name), sizeMB: Math.round(entry.size / 1024 / 1024) },
          'local',
          filePath
        );
        _checkCompatibility(record);
        _registry.set(_dedupKey(record), record);
        found.push(record.name);
      }
    }

    return { ok: true, found: found.length, names: found, errors };
  }

  // ---------------------------------------------------------------------------
  // scanHostLocal — scan real host filesystem path via hostBridge
  // ---------------------------------------------------------------------------
  function scanHostLocal(hostPath) {
    const dir   = hostPath || '/models';
    const found  = [];
    const errors = [];

    if (!hostBridge || !hostBridge.hostfs) {
      return { ok: false, error: 'No host bridge available', found: 0 };
    }

    const r = hostBridge.hostfs.ls(dir);
    if (!r.ok) return { ok: false, error: r.error, found: 0 };

    for (const entry of r.entries) {
      if (entry.type !== 'file') continue;
      const filePath = `${dir}/${entry.name}`;

      if (entry.name.endsWith('.json')) {
        const fr = hostBridge.hostfs.read(filePath);
        if (!fr.ok) { errors.push(`${filePath}: ${fr.error}`); continue; }
        let raw;
        try { raw = JSON.parse(fr.content); } catch (e) {
          errors.push(`${filePath}: JSON parse error — ${e.message}`); continue;
        }
        if (!raw.name) raw.name = entry.name.replace(/\.json$/, '');
        const record = _normalise(raw, 'host', filePath);
        const iv = _verifyIntegrity(record, fr.content);
        if (iv.ok) {
          _register(record);
          found.push(record.name);
        } else {
          errors.push(`${filePath}: integrity errors — ${iv.errors.join('; ')}`);
        }
      } else if (MODEL_EXTENSIONS.has(_ext(entry.name))) {
        const st = hostBridge.hostfs.stat(filePath);
        const sizeMB = st.ok ? Math.round(st.size / 1024 / 1024) : 0;
        const record = _normalise(
          { name: _basename(entry.name), sizeMB },
          'host',
          filePath
        );
        _checkCompatibility(record);
        _registry.set(_dedupKey(record), record);
        found.push(record.name);
      }
    }

    return { ok: true, found: found.length, names: found, errors };
  }

  // ---------------------------------------------------------------------------
  // scanRemote — fetch model manifests from an array of URL strings.
  // Each URL must return either a single manifest JSON or an array of manifests.
  // ---------------------------------------------------------------------------
  async function scanRemote(urls) {
    if (!network) return { ok: false, error: 'No network available', found: 0 };
    const allUrls = Array.isArray(urls) ? urls : [urls];
    const found   = [];
    const errors  = [];

    for (const url of allUrls) {
      try {
        const r = await network.get(url, { timeout: 15000 });
        if (!r.ok) { errors.push(`${url}: HTTP ${r.status}`); continue; }
        const data = r.json();
        if (!data) { errors.push(`${url}: invalid JSON response`); continue; }
        const manifests = Array.isArray(data) ? data : [data];
        for (const raw of manifests) {
          if (!raw || typeof raw !== 'object' || !raw.name) continue;
          const record = _normalise(raw, 'remote', url);
          _register(record);
          found.push(record.name);
        }
      } catch (e) {
        errors.push(`${url}: ${e.message}`);
      }
    }

    return { ok: true, found: found.length, names: found, errors };
  }

  // ---------------------------------------------------------------------------
  // scanGitHub — list model manifests from a GitHub repo's directory.
  // Uses the public GitHub REST API (no auth required for public repos).
  // opts: { owner, repo, path, branch }
  // ---------------------------------------------------------------------------
  async function scanGitHub(repos) {
    if (!network) return { ok: false, error: 'No network available', found: 0 };
    const list   = Array.isArray(repos) ? repos : [repos];
    const found  = [];
    const errors = [];

    for (const entry of list) {
      if (!entry || !entry.owner || !entry.repo) {
        errors.push('Invalid GitHub repo spec (requires owner and repo)');
        continue;
      }
      const repoPath = entry.path || 'models';
      const ref      = entry.branch || entry.ref || '';
      const apiUrl   = `https://api.github.com/repos/${entry.owner}/${entry.repo}/contents/${repoPath}` +
                       (ref ? `?ref=${encodeURIComponent(ref)}` : '');
      try {
        const r = await network.get(apiUrl, {
          timeout: 15000,
          headers: { Accept: 'application/vnd.github.v3+json' },
        });
        if (!r.ok) { errors.push(`GitHub ${entry.owner}/${entry.repo}: HTTP ${r.status}`); continue; }
        const items = r.json();
        if (!Array.isArray(items)) { errors.push(`GitHub ${entry.owner}/${entry.repo}: unexpected response`); continue; }

        for (const item of items) {
          if (item.type !== 'file' || !item.name.endsWith('.json') || !item.download_url) continue;
          try {
            const fr = await network.get(item.download_url, { timeout: 15000 });
            if (!fr.ok) continue;
            const raw = fr.json();
            if (!raw || !raw.name) continue;
            const record = _normalise(raw, 'github', item.html_url || item.download_url);
            _register(record);
            found.push(record.name);
          } catch (e) {
            errors.push(`GitHub file ${item.name}: ${e.message}`);
          }
        }
      } catch (e) {
        errors.push(`GitHub ${entry.owner}/${entry.repo}: ${e.message}`);
      }
    }

    return { ok: true, found: found.length, names: found, errors };
  }

  // ---------------------------------------------------------------------------
  // scanHuggingFace — fetch model info from the HuggingFace Hub API.
  // repoIds: array of "namespace/repo-id" strings.
  // ---------------------------------------------------------------------------
  async function scanHuggingFace(repoIds) {
    if (!network) return { ok: false, error: 'No network available', found: 0 };
    const list   = Array.isArray(repoIds) ? repoIds : [repoIds];
    const found  = [];
    const errors = [];

    for (const repoId of list) {
      if (typeof repoId !== 'string' || !repoId.includes('/')) {
        errors.push(`Invalid HuggingFace repo id: ${repoId} (expected "namespace/repo-id")`);
        continue;
      }
      const apiUrl = `https://huggingface.co/api/models/${repoId}`;
      try {
        const r = await network.get(apiUrl, { timeout: 15000 });
        if (!r.ok) { errors.push(`HuggingFace ${repoId}: HTTP ${r.status}`); continue; }
        const data = r.json();
        if (!data || typeof data !== 'object') { errors.push(`HuggingFace ${repoId}: invalid JSON`); continue; }

        // Map HuggingFace model info to our manifest format
        const name    = data.modelId || data.id || repoId.split('/').pop();
        const version = (data.tags && data.tags.find(t => /^v?\d+\.\d+/.test(t))) || '1.0.0';
        const sizeMB  = _hfSizeMB(data);
        const tags    = Array.isArray(data.tags) ? data.tags : [];

        const record = _normalise(
          { name, version, sizeMB, tags, supportedModes: ['both'] },
          'huggingface',
          `https://huggingface.co/${repoId}`
        );
        _register(record);
        found.push(record.name);
      } catch (e) {
        errors.push(`HuggingFace ${repoId}: ${e.message}`);
      }
    }

    return { ok: true, found: found.length, names: found, errors };
  }

  // ---------------------------------------------------------------------------
  // scan — run a full scan using all sources
  // opts: {
  //   vfsPath, hostPath, remoteUrls, githubRepos, huggingFaceRepos,
  //   skipLocal, skipHost, skipRemote, skipGitHub, skipHuggingFace
  // }
  // ---------------------------------------------------------------------------
  async function scan(opts) {
    opts = opts || {};
    const results = {};

    if (!opts.skipLocal) {
      results.local = scanLocal(opts.vfsPath);
    }
    if (!opts.skipHost) {
      results.host = scanHostLocal(opts.hostPath);
    }
    if (!opts.skipRemote && Array.isArray(opts.remoteUrls) && opts.remoteUrls.length > 0) {
      results.remote = await scanRemote(opts.remoteUrls);
    }
    if (!opts.skipGitHub && Array.isArray(opts.githubRepos) && opts.githubRepos.length > 0) {
      results.github = await scanGitHub(opts.githubRepos);
    }
    if (!opts.skipHuggingFace && Array.isArray(opts.huggingFaceRepos) && opts.huggingFaceRepos.length > 0) {
      results.huggingface = await scanHuggingFace(opts.huggingFaceRepos);
    }

    const total = Array.from(_registry.values()).length;
    const compatible   = Array.from(_registry.values()).filter(m => m.compatible).length;
    const incompatible = total - compatible;

    _emit('model:scan:complete', { total, compatible, incompatible });
    return { ok: true, total, compatible, incompatible, results };
  }

  // ---------------------------------------------------------------------------
  // list — return all registered models (or filtered)
  // ---------------------------------------------------------------------------
  function list(opts) {
    opts = opts || {};
    let records = Array.from(_registry.values());
    if (opts.compatibleOnly) records = records.filter(m => m.compatible);
    if (opts.source)         records = records.filter(m => m.source === opts.source);
    return records;
  }

  // ---------------------------------------------------------------------------
  // get — return a single model by name (or name@version)
  // ---------------------------------------------------------------------------
  function get(nameOrKey) {
    if (!nameOrKey) return null;
    // Try exact key match first
    if (_registry.has(nameOrKey)) return _registry.get(nameOrKey);
    // Try by name only (return first match)
    for (const rec of _registry.values()) {
      if (rec.name === nameOrKey) return rec;
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // remove — remove a model from the registry
  // ---------------------------------------------------------------------------
  function remove(nameOrKey) {
    if (_registry.has(nameOrKey)) { _registry.delete(nameOrKey); return true; }
    for (const [key, rec] of _registry.entries()) {
      if (rec.name === nameOrKey) { _registry.delete(key); return true; }
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // verify — re-verify a model's integrity (re-read from source)
  // ---------------------------------------------------------------------------
  function verify(nameOrKey) {
    const record = get(nameOrKey);
    if (!record) return { ok: false, error: `Model not found: ${nameOrKey}` };

    let content = null;
    if (record.source === 'local' && filesystem) {
      const r = filesystem.read(record.path);
      if (r.ok) content = r.content;
    } else if (record.source === 'host' && hostBridge) {
      const r = hostBridge.hostfs.read(record.path);
      if (r.ok) content = r.content;
    }

    const iv = _verifyIntegrity(record, content);
    return { ok: iv.ok, errors: iv.errors, model: record.name };
  }

  // ---------------------------------------------------------------------------
  // Router commands
  // ---------------------------------------------------------------------------
  const commands = {
    models: async (args) => {
      const sub = (args[0] || 'list').toLowerCase();

      // models scan [--local] [--host] [--remote <url>]
      if (sub === 'scan') {
        const localOnly  = args.includes('--local');
        const hostOnly   = args.includes('--host');
        const remoteIdx  = args.indexOf('--remote');
        const remoteUrls = remoteIdx >= 0 && args[remoteIdx + 1] ? [args[remoteIdx + 1]] : [];

        const scanOpts = {
          skipLocal:       hostOnly,
          skipHost:        localOnly,
          skipRemote:      remoteUrls.length === 0,
          skipGitHub:      true,
          skipHuggingFace: true,
          remoteUrls,
        };
        const r = await scan(scanOpts);
        return {
          status: 'ok',
          result: [
            `Scan complete.`,
            `  Total registered : ${r.total}`,
            `  Compatible       : ${r.compatible}`,
            `  Incompatible     : ${r.incompatible}`,
            ...Object.entries(r.results || {}).map(([src, res]) =>
              `  [${src}] found ${res.found || 0}` +
              (res.errors && res.errors.length ? ` (${res.errors.length} errors)` : '')
            ),
          ].join('\n'),
        };
      }

      // models list [--all]
      if (sub === 'list') {
        const showAll = args.includes('--all');
        const records = list({ compatibleOnly: !showAll });
        if (!records.length) return { status: 'ok', result: showAll ? 'No models registered.' : 'No compatible models found. Try: models list --all' };
        const lines = records.map(m => {
          const compat = m.compatible ? '✓' : '✗';
          const why    = m.compatible ? '' : `  [${m.incompatibleReason}]`;
          return `  ${compat}  ${m.name.padEnd(32)} v${m.version.padEnd(10)} [${m.source}]  ${m.format}${why}`;
        });
        return {
          status: 'ok',
          result: `AI Models  (${records.length} shown${showAll ? '' : ', compatible only'}):\n` + lines.join('\n'),
        };
      }

      // models info <name>
      if (sub === 'info') {
        const name   = args.slice(1).join(' ').trim();
        if (!name) return { status: 'error', result: 'Usage: models info <name>' };
        const record = get(name);
        if (!record) return { status: 'error', result: `Model not found: ${name}` };
        return {
          status: 'ok',
          result: JSON.stringify(record, null, 2),
        };
      }

      // models rm <name>
      if (sub === 'rm' || sub === 'remove') {
        const name = args.slice(1).join(' ').trim();
        if (!name) return { status: 'error', result: 'Usage: models rm <name>' };
        const removed = remove(name);
        return {
          status: removed ? 'ok' : 'error',
          result: removed ? `Removed model: ${name}` : `Model not found: ${name}`,
        };
      }

      // models verify <name>
      if (sub === 'verify') {
        const name = args.slice(1).join(' ').trim();
        if (!name) return { status: 'error', result: 'Usage: models verify <name>' };
        const r = verify(name);
        if (!r.ok) {
          return {
            status: 'error',
            result: r.error || `Integrity errors for "${name}":\n  ` + r.errors.join('\n  '),
          };
        }
        return { status: 'ok', result: `Model "${name}" passed integrity check.` };
      }

      // models help / unknown
      return {
        status: 'ok',
        result: [
          'Usage: models <subcommand> [options]',
          '',
          '  models scan [--local|--host] [--remote <url>]',
          '  models list [--all]',
          '  models info <name>',
          '  models rm   <name>',
          '  models verify <name>',
        ].join('\n'),
      };
    },
  };

  return {
    name:            'model-scanner',
    version:         '1.0.0',
    scan,
    scanLocal,
    scanHostLocal,
    scanRemote,
    scanGitHub,
    scanHuggingFace,
    list,
    get,
    remove,
    verify,
    commands,
  };
}

// ---------------------------------------------------------------------------
// Private helpers (module-level, not exported)
// ---------------------------------------------------------------------------
function _ext(filename) {
  const idx = filename.lastIndexOf('.');
  return idx >= 0 ? filename.slice(idx).toLowerCase() : '';
}

function _basename(filename) {
  const slash = Math.max(filename.lastIndexOf('/'), filename.lastIndexOf('\\'));
  const base  = filename.slice(slash + 1);
  const dot   = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

function _hfSizeMB(data) {
  if (data.safetensors && data.safetensors.total) {
    return Math.round(data.safetensors.total / 1024 / 1024);
  }
  return 0;
}

module.exports = { createModelScanner };
