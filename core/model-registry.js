'use strict';
/**
 * model-registry.js — AIOS Model Registry v1.0.0
 *
 * Discovers, validates, and manages AI models available to AIOS.
 *
 * Discovery order:
 *   1. Ollama (localhost:11434) — lists all local ollama models
 *   2. llama.cpp binary         — checks common system paths
 *   3. OpenAI-compatible API    — if AIOS_OPENAI_URL env var is set
 *   4. Built-in NLP fallback    — always available offline
 *
 * Each model entry:
 *   { name, type, endpoint, available, healthy, modes[], idleMs, lastUsed }
 *
 * Zero external npm dependencies (uses built-in http/https + child_process).
 */

const http      = require('http');
const https     = require('https');
const path      = require('path');
const { spawnSync } = require('child_process');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const OLLAMA_HOST     = '127.0.0.1';
const OLLAMA_PORT     = 11434;
const DISCOVERY_TIMEOUT_MS = 3000;

const LLAMA_CPP_PATHS = [
  '/usr/local/bin/llama',
  '/usr/bin/llama',
  '/data/data/com.termux/files/usr/bin/llama',
  path.join(process.env.HOME || '', '.local', 'bin', 'llama'),
];

// ---------------------------------------------------------------------------
// Utility — simple HTTP GET returning body as string (no external deps)
// ---------------------------------------------------------------------------
function _httpGet(opts, timeoutMs) {
  return new Promise((resolve, reject) => {
    const lib = opts.port === 443 ? https : http;
    const req = lib.request(opts, (res) => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => resolve(body));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(new Error('timeout')); });
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Model Registry factory
// ---------------------------------------------------------------------------
function createModelRegistry(kernel, hostBridge, envLoader) {
  const _models = new Map();  // name → model record
  let   _discoveryTs = null;

  // ── Built-in fallback model (always registered) ──────────────────────────

  function _registerBuiltin() {
    _models.set('built-in-nlp', {
      name:      'built-in-nlp',
      type:      'builtin',
      endpoint:  null,
      available: true,
      healthy:   true,
      modes:     ['chat', 'help', 'fix'],
      idle:      false,
      lastUsed:  null,
      meta:      { description: 'AIOS offline NLP pattern matcher (zero deps)', offline: true },
    });
  }

  _registerBuiltin();

  // ── Register a model manually ─────────────────────────────────────────────

  /**
   * Register an AI model.
   * @param {{ name, type, endpoint, modes, meta }} model
   */
  function register(model) {
    if (!model || typeof model.name !== 'string' || !model.name) {
      throw new TypeError('model.name must be a non-empty string');
    }
    const record = {
      name:      model.name,
      type:      model.type      || 'unknown',
      endpoint:  model.endpoint  || null,
      available: model.available !== false,
      healthy:   model.healthy   !== false,
      modes:     Array.isArray(model.modes) ? model.modes : ['chat'],
      idle:      false,
      lastUsed:  null,
      meta:      model.meta      || {},
    };
    _models.set(record.name, record);
    if (kernel) kernel.bus.emit('model:registered', { name: record.name, type: record.type });
    return record;
  }

  // ── Assign mode to a model ────────────────────────────────────────────────

  /**
   * Assign one or more operating modes to a registered model.
   * @param {string} name
   * @param {string|string[]} modes
   */
  function assignMode(name, modes) {
    const model = _models.get(name);
    if (!model) return { ok: false, error: `Model "${name}" not found` };
    const list = Array.isArray(modes) ? modes : [modes];
    list.forEach(m => {
      if (!model.modes.includes(m)) model.modes.push(m);
    });
    if (kernel) kernel.bus.emit('model:modes-assigned', { name, modes: list });
    return { ok: true };
  }

  // ── Validate a model record ───────────────────────────────────────────────

  /**
   * Run validation checks on a registered model.
   * For remote models this performs a lightweight health check.
   * @param {string} name
   * @returns {Promise<{ ok: boolean, checks: object[], score: number }>}
   */
  async function validate(name) {
    const model = _models.get(name);
    if (!model) return { ok: false, checks: [{ name: 'exists', ok: false }], score: 0 };

    const checks = [];

    // Check 1: model record integrity
    checks.push({
      name:   'registry-entry',
      ok:     Boolean(model.name && model.type),
      detail: `name=${model.name} type=${model.type}`,
    });

    // Check 2: availability flag
    checks.push({
      name:   'available',
      ok:     model.available,
      detail: model.available ? 'yes' : 'marked unavailable',
    });

    // Check 3: endpoint reachability (for non-builtin)
    if (model.type !== 'builtin' && model.endpoint) {
      try {
        const url    = new URL(model.endpoint);
        const port   = parseInt(url.port, 10) || (url.protocol === 'https:' ? 443 : 80);
        await _httpGet({ hostname: url.hostname, port, path: '/', method: 'GET' }, DISCOVERY_TIMEOUT_MS);
        checks.push({ name: 'reachable', ok: true, detail: model.endpoint });
        model.healthy = true;
      } catch (e) {
        checks.push({ name: 'reachable', ok: false, detail: e.message });
        model.healthy = false;
      }
    } else if (model.type === 'builtin') {
      checks.push({ name: 'reachable', ok: true, detail: 'offline built-in' });
    }

    // Check 4: modes assigned
    checks.push({
      name:   'modes',
      ok:     model.modes.length > 0,
      detail: model.modes.join(', ') || 'none',
    });

    const passed = checks.filter(c => c.ok).length;
    const score  = Math.round((passed / checks.length) * 100);
    model.healthy = score >= 50;

    return { ok: model.healthy, checks, score };
  }

  // ── Discover ollama models ────────────────────────────────────────────────

  async function _discoverOllama() {
    const discovered = [];
    try {
      const body = await _httpGet(
        { hostname: OLLAMA_HOST, port: OLLAMA_PORT, path: '/api/tags', method: 'GET' },
        DISCOVERY_TIMEOUT_MS
      );
      const data = JSON.parse(body);
      const modelList = data.models || data;
      if (Array.isArray(modelList)) {
        for (const m of modelList) {
          const modelName = m.name || m;
          if (!modelName) continue;
          const record = register({
            name:     `ollama:${modelName}`,
            type:     'ollama',
            endpoint: `http://${OLLAMA_HOST}:${OLLAMA_PORT}`,
            modes:    ['chat', 'code', 'fix', 'help', 'learn'],
            meta:     { ollamaModel: modelName, size: m.size },
          });
          discovered.push(record.name);
        }
      }
    } catch (_) {
      // Ollama not running or not installed — expected
    }
    return discovered;
  }

  // ── Discover llama.cpp binary ─────────────────────────────────────────────

  function _discoverLlamaCpp() {
    for (const bin of LLAMA_CPP_PATHS) {
      try {
        const r = spawnSync('test', ['-x', bin], { timeout: 1000 });
        if (r.status === 0) {
          return register({
            name:     'llama.cpp',
            type:     'llama-cpp',
            endpoint: null,
            modes:    ['chat', 'code', 'fix'],
            meta:     { binary: bin },
          });
        }
      } catch (_) {}
    }
    return null;
  }

  // ── Discover OpenAI-compatible API ───────────────────────────────────────

  async function _discoverOpenAI() {
    const envVars   = envLoader ? envLoader.get() : {};
    const apiUrl    = envVars['AIOS_OPENAI_URL'] || process.env.AIOS_OPENAI_URL;
    if (!apiUrl) return null;

    try {
      const url  = new URL(apiUrl);
      const port = parseInt(url.port, 10) || (url.protocol === 'https:' ? 443 : 80);
      await _httpGet({ hostname: url.hostname, port, path: '/v1/models', method: 'GET' }, DISCOVERY_TIMEOUT_MS);
      return register({
        name:     'openai-compatible',
        type:     'openai',
        endpoint: apiUrl,
        modes:    ['chat', 'code', 'fix', 'help', 'learn'],
        meta:     { url: apiUrl },
      });
    } catch (_) {
      return null;
    }
  }

  // ── Main discovery entry point ────────────────────────────────────────────

  /**
   * Discover all available AI models.
   * @returns {Promise<{ discovered: string[], total: number }>}
   */
  async function discover() {
    _discoveryTs = new Date().toISOString();
    if (kernel) kernel.bus.emit('model:discovery-start', {});

    const found = [];

    // 1. Ollama
    const ollamaModels = await _discoverOllama();
    found.push(...ollamaModels);

    // 2. llama.cpp
    const llamaModel = _discoverLlamaCpp();
    if (llamaModel) found.push(llamaModel.name);

    // 3. OpenAI-compatible
    const oaiModel = await _discoverOpenAI();
    if (oaiModel) found.push(oaiModel.name);

    if (kernel) kernel.bus.emit('model:discovery-done', { found: found.length });
    return { discovered: found, total: _models.size };
  }

  // ── Idle / wake ───────────────────────────────────────────────────────────

  function idleModel(name) {
    const m = _models.get(name);
    if (m) { m.idle = true; if (kernel) kernel.bus.emit('model:idle', { name }); }
  }

  function wakeModel(name) {
    const m = _models.get(name);
    if (m) { m.idle = false; m.lastUsed = new Date().toISOString(); if (kernel) kernel.bus.emit('model:wake', { name }); }
  }

  // ── List / get ────────────────────────────────────────────────────────────

  function list() { return Array.from(_models.values()); }

  function getModel(name) { return _models.get(name) || null; }

  /**
   * Get the best available model for a given mode, preferring non-idle models.
   * @param {string} mode
   * @returns {object|null}
   */
  function getBestForMode(mode) {
    const candidates = list().filter(m =>
      m.available && m.healthy && m.modes.includes(mode)
    );
    // Prefer non-idle, non-builtin models first
    const preferred = candidates.filter(m => !m.idle && m.type !== 'builtin');
    if (preferred.length) return preferred[0];
    // Fall back to any (including built-in)
    return candidates[0] || null;
  }

  // ── Router command interface ───────────────────────────────────────────────

  const commands = {
    async models(args) {
      const sub = (args[0] || 'list').toLowerCase();

      if (sub === 'list') {
        const all = list();
        if (!all.length) return { status: 'ok', result: 'No models registered.' };
        const lines = all.map(m => {
          const status  = m.healthy   ? '✓' : '✗';
          const idleStr = m.idle      ? ' [idle]' : '';
          const modes   = m.modes.join(',');
          return `  ${status} ${m.name.padEnd(30)} type=${m.type.padEnd(12)} modes=${modes}${idleStr}`;
        });
        return { status: 'ok', result: ['Models:', ...lines].join('\n') };
      }

      if (sub === 'discover') {
        const r = await discover();
        return {
          status: 'ok',
          result: [
            `Discovery complete at ${_discoveryTs}`,
            `Newly found : ${r.discovered.join(', ') || 'none'}`,
            `Total models: ${r.total}`,
          ].join('\n'),
        };
      }

      if (sub === 'validate' && args[1]) {
        const r = await validate(args[1]);
        const lines = r.checks.map(c => `  ${c.ok ? '✓' : '✗'} ${c.name.padEnd(20)} ${c.detail || ''}`);
        return {
          status: 'ok',
          result: [
            `Validation for "${args[1]}": score=${r.score}% healthy=${r.ok}`,
            ...lines,
          ].join('\n'),
        };
      }

      if (sub === 'idle' && args[1]) {
        idleModel(args[1]);
        return { status: 'ok', result: `Model "${args[1]}" idled.` };
      }

      if (sub === 'wake' && args[1]) {
        wakeModel(args[1]);
        return { status: 'ok', result: `Model "${args[1]}" woken.` };
      }

      if (sub === 'assign' && args[1] && args[2]) {
        const r = assignMode(args[1], args.slice(2));
        return r.ok
          ? { status: 'ok',    result: `Modes ${args.slice(2).join(',')} assigned to "${args[1]}".` }
          : { status: 'error', result: r.error };
      }

      return {
        status: 'ok',
        result: 'Usage: models <list|discover|validate <name>|idle <name>|wake <name>|assign <name> <mode...>>',
      };
    },
  };

  return {
    name:            'model-registry',
    version:         '4.0.0',
    register,
    assignMode,
    validate,
    discover,
    idleModel,
    wakeModel,
    list,
    getModel,
    getBestForMode,
    commands,
  };
}

module.exports = { createModelRegistry };
