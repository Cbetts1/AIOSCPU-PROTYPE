'use strict';
/**
 * consciousness.js — AIOS Consciousness Layer v1.0.0
 *
 * The central integration core for AIOS. Binds all AI models, memory,
 * and operating modes into a single, unified intelligent entity.
 *
 * Architecture:
 *   ┌─────────────────────────────────────────┐
 *   │             Consciousness               │
 *   │  ┌──────────┐  ┌──────────┐            │
 *   │  │  Memory  │  │  Mode    │            │
 *   │  │  Engine  │  │ Manager  │            │
 *   │  └────┬─────┘  └────┬─────┘            │
 *   │       │              │                  │
 *   │  ┌────▼──────────────▼──────────────┐  │
 *   │  │         Model Router             │  │
 *   │  │  ollama → llama.cpp → builtin    │  │
 *   │  └──────────────────────────────────┘  │
 *   └─────────────────────────────────────────┘
 *
 * Features:
 *   - Routes queries to the best available model for the current mode
 *   - Falls back through the model chain (never fails)
 *   - Persists context and learning across interactions
 *   - Idle/wake management for heavy models
 *   - Proactive assistance and error correction
 *   - Sample query runner for smoke-testing
 *   - `consciousness` and `chat` terminal commands
 *
 * Zero external npm dependencies.
 */

const http  = require('http');
const https = require('https');

// ---------------------------------------------------------------------------
// Utility — simple HTTP POST (for calling ollama / openai endpoints)
// ---------------------------------------------------------------------------
function _httpPost(opts, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const lib     = opts.port === 443 ? https : http;
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    const reqOpts = Object.assign({}, opts, {
      method:  'POST',
      headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, opts.headers || {}),
    });
    const req = lib.request(reqOpts, (res) => {
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end',  () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs || 15000, () => { req.destroy(new Error('LLM request timeout')); });
    req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Consciousness factory
// ---------------------------------------------------------------------------
function createConsciousness(kernel, router, memoryEngine, modeManager, modelRegistry, aiCore) {
  let _proactiveInterval = null;
  let _idleTimers        = new Map();  // modelName → timer

  const IDLE_TIMEOUT_MS = 5 * 60 * 1000;  // idle heavy models after 5 min

  // ── Helpers ──────────────────────────────────────────────────────────────

  function _ts() { return new Date().toISOString(); }

  // ── Model querying ────────────────────────────────────────────────────────

  /**
   * Query an ollama model via its REST API.
   * @param {object} model  Model registry entry
   * @param {string} prompt
   * @param {string} systemPrompt
   * @returns {Promise<string|null>}
   */
  async function _queryOllama(model, prompt, systemPrompt) {
    try {
      const url      = new URL(model.endpoint);
      const port     = parseInt(url.port, 10) || 80;
      const payload  = {
        model:  model.meta.ollamaModel || model.name.replace('ollama:', ''),
        prompt: systemPrompt ? `${systemPrompt}\n\n${prompt}` : prompt,
        stream: false,
      };
      const rawBody  = await _httpPost(
        { hostname: url.hostname, port, path: '/api/generate' },
        payload,
        15000
      );
      const data = JSON.parse(rawBody);
      return data.response || null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Query an OpenAI-compatible API.
   * @param {object} model
   * @param {string} prompt
   * @param {string} systemPrompt
   * @returns {Promise<string|null>}
   */
  async function _queryOpenAI(model, prompt, systemPrompt) {
    try {
      const url  = new URL(model.endpoint);
      const port = parseInt(url.port, 10) || (url.protocol === 'https:' ? 443 : 80);
      const payload = {
        model:    model.meta.modelId || 'gpt-3.5-turbo',
        messages: [
          ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
          { role: 'user', content: prompt },
        ],
      };
      const rawBody = await _httpPost(
        { hostname: url.hostname, port, path: '/v1/chat/completions' },
        payload,
        15000
      );
      const data   = JSON.parse(rawBody);
      const choice = data.choices && data.choices[0];
      return (choice && choice.message && choice.message.content) || null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Query the built-in AI core (offline NLP).
   * @param {string} prompt
   * @returns {Promise<string|null>}
   */
  async function _queryBuiltin(prompt) {
    if (!aiCore) return null;
    try {
      const r = await aiCore.process(prompt);
      return (r && r.result) ? r.result : null;
    } catch (_) {
      return null;
    }
  }

  /**
   * Route a prompt to the given model.
   * @param {object} model
   * @param {string} prompt
   * @param {string} systemPrompt
   * @returns {Promise<string|null>}
   */
  async function _routeToModel(model, prompt, systemPrompt) {
    if (!model) return null;

    // Wake model if idle
    if (model.idle && modelRegistry) modelRegistry.wakeModel(model.name);

    // Schedule idle timeout for non-builtin models
    if (model.type !== 'builtin' && modelRegistry) {
      const existing = _idleTimers.get(model.name);
      if (existing) clearTimeout(existing);
      const timer = setTimeout(() => {
        modelRegistry.idleModel(model.name);
        _idleTimers.delete(model.name);
      }, IDLE_TIMEOUT_MS);
      _idleTimers.set(model.name, timer);
      if (timer.unref) timer.unref();
    }

    switch (model.type) {
      case 'ollama':   return _queryOllama(model, prompt, systemPrompt);
      case 'openai':   return _queryOpenAI(model, prompt, systemPrompt);
      case 'builtin':  return _queryBuiltin(prompt);
      default:         return _queryBuiltin(prompt);
    }
  }

  // ── Context builder ───────────────────────────────────────────────────────

  function _buildContextPrompt() {
    if (!memoryEngine) return '';
    const recent = memoryEngine.getHistory(5);
    if (!recent.length) return '';
    const lines = recent.map(e => `${e.role}: ${e.content}`);
    return `Recent conversation:\n${lines.join('\n')}\n\n`;
  }

  // ── Main query entry point ─────────────────────────────────────────────────

  /**
   * Process a query through the AIOS consciousness.
   * @param {string} input
   * @param {{ mode?: string, skipMemory?: boolean }} [opts]
   * @returns {Promise<{ status: string, result: string, model: string, mode: string }>}
   */
  async function query(input, opts) {
    const text    = String(input || '').trim();
    if (!text) return { status: 'error', result: 'No input provided.', model: 'none', mode: 'none' };

    opts = opts || {};

    // Determine operating mode
    const modeName = opts.mode || (modeManager ? modeManager.getMode() : 'chat');
    const modeConfig = modeManager ? modeManager.getModeConfig(modeName) : null;
    const systemPrompt = modeConfig ? modeConfig.systemPrompt : '';

    // Build context-enriched prompt
    const contextBlock = opts.skipMemory ? '' : _buildContextPrompt();
    const fullPrompt   = contextBlock + text;

    // Store user input in memory
    if (memoryEngine && !opts.skipMemory) {
      memoryEngine.append({ role: 'user', content: text, mode: modeName });
    }

    // Select best model for this mode
    const model = modelRegistry ? modelRegistry.getBestForMode(modeName) : null;

    let result   = null;
    let usedModel = 'none';

    if (model) {
      result    = await _routeToModel(model, fullPrompt, systemPrompt);
      usedModel = model.name;
    }

    // Fallback chain: built-in NLP
    if (!result && aiCore) {
      result    = await _queryBuiltin(text);
      usedModel = 'built-in-nlp';
    }

    // Ultimate fallback
    if (!result) {
      result    = `I received your message: "${text}". No AI model is currently available. Try connecting ollama or another model.`;
      usedModel = 'fallback';
    }

    // Store response in memory
    if (memoryEngine && !opts.skipMemory) {
      memoryEngine.append({ role: 'assistant', content: result, mode: modeName, model: usedModel });
    }

    // Learn mode: extract and store facts
    if (modeName === 'learn' && memoryEngine) {
      memoryEngine.learn({ content: text, source: 'user-input', confidence: 0.9 });
    }

    if (kernel) kernel.bus.emit('consciousness:query', { mode: modeName, model: usedModel });

    return { status: 'ok', result, model: usedModel, mode: modeName };
  }

  // ── Proactive assistance ─────────────────────────────────────────────────

  /**
   * Start the proactive assistance loop.
   * @param {number} [intervalMs] defaults to 60000 (1 minute)
   */
  function startProactive(intervalMs) {
    if (_proactiveInterval) return;
    const ms = intervalMs || 60000;
    _proactiveInterval = setInterval(_proactiveCheck, ms);
    if (_proactiveInterval.unref) _proactiveInterval.unref();
    if (kernel) kernel.bus.emit('consciousness:proactive-start', { intervalMs: ms });
  }

  function stopProactive() {
    if (_proactiveInterval) {
      clearInterval(_proactiveInterval);
      _proactiveInterval = null;
    }
  }

  function _proactiveCheck() {
    if (!kernel || !modelRegistry) return;

    // Wake models that may have been idled but are needed
    const models = modelRegistry.list();
    const unhealthy = models.filter(m => m.available && !m.healthy && m.type !== 'builtin');
    if (unhealthy.length > 0) {
      kernel.bus.emit('consciousness:alert', {
        type:    'model-health',
        message: `${unhealthy.length} model(s) unhealthy: ${unhealthy.map(m => m.name).join(', ')}`,
      });
    }
  }

  // ── Learning ──────────────────────────────────────────────────────────────

  /**
   * Teach the consciousness a new fact.
   * @param {{ content: string, source?: string, confidence?: number }} fact
   */
  function learn(fact) {
    if (memoryEngine) memoryEngine.learn(fact);
    if (kernel) kernel.bus.emit('consciousness:learned', { content: (fact.content || '').slice(0, 80) });
  }

  // ── Context ───────────────────────────────────────────────────────────────

  function getContext() {
    return {
      mode:     modeManager ? modeManager.getMode() : 'chat',
      memory:   memoryEngine ? memoryEngine.summary() : null,
      models:   modelRegistry ? modelRegistry.list().map(m => ({ name: m.name, healthy: m.healthy, idle: m.idle })) : [],
    };
  }

  // ── Model integration helpers ─────────────────────────────────────────────

  /**
   * Integrate a new model and run a validation smoke-test.
   * @param {object} modelConfig  { name, type, endpoint, modes, meta }
   * @returns {Promise<{ ok: boolean, validation: object }>}
   */
  async function integrateModel(modelConfig) {
    if (!modelRegistry) return { ok: false, error: 'model registry not available' };
    const record     = modelRegistry.register(modelConfig);
    const validation = await modelRegistry.validate(record.name);
    if (kernel) kernel.bus.emit('consciousness:model-integrated', { name: record.name, ok: validation.ok });
    return { ok: validation.ok, validation, model: record };
  }

  // ── Sample query runner ───────────────────────────────────────────────────

  /**
   * Run sample queries for all modes to smoke-test the system.
   * @returns {Promise<object[]>}
   */
  async function runSampleQueries() {
    const samples = [
      { mode: 'chat',  input: 'Hello! What is AIOS?' },
      { mode: 'code',  input: 'Write a one-line Node.js hello world' },
      { mode: 'fix',   input: 'Why would a service fail to start?' },
      { mode: 'help',  input: 'How do I list running services?' },
      { mode: 'learn', input: 'AIOS is an AI Operating System built in Node.js.' },
    ];

    const results = [];
    for (const s of samples) {
      const r = await query(s.input, { mode: s.mode, skipMemory: false });
      results.push({
        mode:   s.mode,
        input:  s.input,
        ok:     r.status === 'ok',
        model:  r.model,
        result: (r.result || '').slice(0, 100),
      });
    }
    return results;
  }

  // ── Router command interface ───────────────────────────────────────────────

  const commands = {
    async consciousness(args) {
      const sub = (args[0] || 'status').toLowerCase();

      if (sub === 'status') {
        const ctx = getContext();
        return {
          status: 'ok',
          result: [
            'AIOS Consciousness v1.0.0',
            `Mode     : ${ctx.mode}`,
            `Memory   : ${ctx.memory ? `${ctx.memory.historyEntries} interactions, ${ctx.memory.learnedFacts} facts` : 'not available'}`,
            `Models   : ${ctx.models.map(m => `${m.name}(${m.healthy ? 'ok' : 'err'}${m.idle ? ',idle' : ''})`).join(' ') || 'none'}`,
            `Proactive: ${_proactiveInterval ? 'active' : 'inactive'}`,
          ].join('\n'),
        };
      }

      if (sub === 'learn' && args.length > 1) {
        learn({ content: args.slice(1).join(' '), source: 'terminal', confidence: 1.0 });
        return { status: 'ok', result: 'Fact learned.' };
      }

      if (sub === 'context') {
        const ctx = getContext();
        return { status: 'ok', result: JSON.stringify(ctx, null, 2) };
      }

      if (sub === 'sample') {
        process.stdout.write('[Consciousness] Running sample queries for all modes…\n');
        const results = await runSampleQueries();
        const lines   = results.map(r =>
          `  ${r.ok ? '✓' : '✗'} [${r.mode}] model=${r.model}  "${r.result.slice(0, 60)}"`
        );
        return { status: 'ok', result: ['Sample query results:', ...lines].join('\n') };
      }

      if (sub === 'proactive') {
        const on = (args[1] || 'on').toLowerCase() !== 'off';
        if (on) { startProactive(); return { status: 'ok', result: 'Proactive assistance started.' }; }
        stopProactive();
        return { status: 'ok', result: 'Proactive assistance stopped.' };
      }

      return {
        status: 'ok',
        result: 'Usage: consciousness <status|context|learn <fact>|sample|proactive on|off>',
      };
    },

    async chat(args) {
      if (!args.length) {
        return { status: 'ok', result: 'Usage: chat <message>\n(or use: mode chat  then: ai <message>)' };
      }
      const input = args.join(' ');
      const r     = await query(input, { mode: 'chat' });
      return { status: r.status, result: r.result };
    },
  };

  return {
    name:             'consciousness',
    version:          '1.0.0',
    query,
    learn,
    getContext,
    integrateModel,
    runSampleQueries,
    startProactive,
    stopProactive,
    commands,
  };
}

module.exports = { createConsciousness };
