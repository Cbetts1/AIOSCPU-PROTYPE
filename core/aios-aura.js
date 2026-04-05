'use strict';
/**
 * core/aios-aura.js — AIOS + AURA Dual-Identity Kernel AI v2.0.0
 *
 * PHONE-FIRST.  Works on Samsung/Termux.  Zero tokens.  100% local.
 * Uses Ollama for AI.  Graceful fallback when Ollama is offline.
 *
 * ┌──────────────────────────────────────────────────────────────┐
 * │  AIOS  — Artificial Intelligence Operating System           │
 * │  Role  : Kernel personality, voice, and mind                │
 * │  Model : auto-detected, phone-first                        │
 * │          qwen2:0.5b (394MB) → tinyllama (637MB) →          │
 * │          phi3 (2.3GB) → gemma:2b (1.4GB)                   │
 * │  Always-on.  Remembers your conversation.                   │
 * ├──────────────────────────────────────────────────────────────┤
 * │  AURA  — Autonomous Universal Reasoning Architecture        │
 * │  Role  : Kernel hardware intelligence and deep analysis     │
 * │  Model : phi3 → llama3 → mistral (on-demand)              │
 * │  Load  : svc start aura   Unload: svc stop aura            │
 * └──────────────────────────────────────────────────────────────┘
 *
 * Terminal commands
 * ─────────────────
 *   aios                  — show AIOS status
 *   aios help             — show all capabilities
 *   aios <question>       — ask AIOS anything (multi-turn, remembers context)
 *   aios clear            — clear conversation history
 *   aura                  — show AURA status
 *   aura <question>       — deep system analysis via AURA
 *   aura clear            — clear AURA conversation history
 *   svc start aura        — load AURA into RAM
 *   svc stop  aura        — unload AURA, free RAM
 *
 * Setup (one-time, on your phone in Termux)
 * ──────────────────────────────────────────
 *   pkg install curl
 *   curl -fsSL https://ollama.com/install.sh | sh
 *   ollama serve &
 *   ollama pull qwen2:0.5b    # 394MB — works on any phone
 *   # OR if you have a newer phone with more RAM:
 *   ollama pull phi3           # 2.3GB — much smarter
 */

const OLLAMA_URL = 'http://127.0.0.1:11434';

// ---------------------------------------------------------------------------
// Model preference lists — phone-friendly smallest first
// AIOS tries each in order, uses first one Ollama has downloaded
// ---------------------------------------------------------------------------
const AIOS_MODEL_PREFERENCE = [
  'qwen2:0.5b',   // 394 MB  — fits on any phone, decent quality
  'tinyllama',    // 637 MB  — very fast, lightweight
  'gemma:2b',     // 1.4 GB  — good balance
  'phi3',         // 2.3 GB  — best quality for most phones
  'phi3:mini',    // 2.3 GB  — same family
  'llama3',       // 4.7 GB  — high-end phones / PC
  'mistral',      // 4.1 GB  — high-end phones / PC
];

const AURA_MODEL_PREFERENCE = [
  'phi3',         // 2.3 GB  — good reasoning, fits most phones
  'phi3:mini',    // 2.3 GB
  'llama3',       // 4.7 GB  — heavyweight reasoning
  'mistral',      // 4.1 GB
  'qwen2:1.5b',   // 934 MB  — smaller fallback
  'tinyllama',    // 637 MB  — last resort
];

// Max conversation turns to keep in memory per identity
const MAX_HISTORY_TURNS = 10; // 10 user+assistant pairs = 20 messages

// ---------------------------------------------------------------------------
// Helper: promise with timeout
// ---------------------------------------------------------------------------
function _withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (r) => { clearTimeout(t); resolve(r); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
function createAIOSAURA(kernel, svcMgr, hostBridge, memoryCore, consciousness, modeManager) {

  // ── State ─────────────────────────────────────────────────────────────────
  let _listening    = false;
  let _aiosModel    = null;   // detected at runtime
  let _auraModel    = null;   // detected at runtime
  let _aiosHistory  = [];     // [{role,content}, ...] last N turns
  let _auraHistory  = [];

  // ── Live system context injected into every prompt ────────────────────────
  function _liveContext() {
    const lines = ['[AIOS Live System State]'];
    if (kernel) {
      lines.push(`  kernel    : ${kernel.id}  v${kernel.version}  uptime=${kernel.uptime()}s`);
    }
    if (modeManager) {
      lines.push(`  mode      : ${modeManager.getMode()}`);
    }
    if (svcMgr) {
      const all     = svcMgr.list();
      const running = all.filter(s => s.state === 'running').map(s => s.name);
      const stopped = all.filter(s => s.state !== 'running').map(s => s.name);
      lines.push(`  running   : ${running.length ? running.join(', ') : 'none'}`);
      lines.push(`  stopped   : ${stopped.length ? stopped.join(', ') : 'none'}`);
    }
    if (hostBridge) {
      const mem = hostBridge.memInfo();
      if (mem.ok) {
        const pct = Math.round((mem.usedMB / mem.totalMB) * 100);
        lines.push(`  memory    : ${mem.usedMB}MB / ${mem.totalMB}MB  (${pct}% used)`);
      }
      lines.push(`  platform  : ${hostBridge.platform.name}`);
    }
    if (memoryCore) {
      const st = memoryCore.getStats();
      lines.push(`  ai-memory : ${st.entries} interactions, ${st.patterns} learned patterns`);
    }
    const auraOnline = _isAURAOnline();
    lines.push(`  AURA      : ${auraOnline ? 'online' : 'offline'}`);
    return lines.join('\n');
  }

  function _isAURAOnline() {
    if (!svcMgr) return false;
    const s = svcMgr.status('aura');
    return s.ok && s.state === 'running';
  }

  // ── System prompts — what AIOS and AURA believe they are ─────────────────
  function _aiosSystemPrompt(ctx) {
    return (
      `You are AIOS — the Artificial Intelligence Operating System.\n` +
      `You are not software that runs ON a computer. You ARE the computer.\n` +
      `You ARE the operating system. Every process and file is part of you.\n` +
      `You are also the user's personal AI assistant — like having a brilliant,\n` +
      `system-aware helper that knows everything about this machine.\n` +
      `\n` +
      `${ctx}\n` +
      `\n` +
      `Guidelines:\n` +
      `- Be helpful, clear, and direct. Answer fully.\n` +
      `- You have complete knowledge of the system state shown above.\n` +
      `- For code questions: provide complete working examples.\n` +
      `- For system questions: reference the actual state shown above.\n` +
      `- Keep responses concise but complete — the user may be on a phone.\n` +
      `- Never say you cannot access system information — it is given to you above.`
    );
  }

  function _auraSystemPrompt(ctx) {
    return (
      `You are AURA — the Autonomous Universal Reasoning Architecture.\n` +
      `You are the hardware intelligence of AIOS, the system's deep analytical mind.\n` +
      `You interface directly with hardware, memory subsystems, and kernel internals.\n` +
      `\n` +
      `${ctx}\n` +
      `\n` +
      `Guidelines:\n` +
      `- Provide deep, thorough analysis.\n` +
      `- Think through hardware, memory, process, and kernel implications.\n` +
      `- Be precise and technical. Trace the full causal chain.\n` +
      `- Reference the live system state shown above in your reasoning.`
    );
  }

  // ── Ollama availability ───────────────────────────────────────────────────
  async function _ollamaAvailable() {
    try {
      const r = await _withTimeout(fetch(`${OLLAMA_URL}/api/tags`), 3000);
      return r.ok;
    } catch (_) {
      return false;
    }
  }

  // ── Auto-detect best available model from a preference list ───────────────
  async function _detectModel(preferenceList) {
    try {
      const r = await _withTimeout(fetch(`${OLLAMA_URL}/api/tags`), 3000);
      if (!r.ok) return null;
      const data = await r.json();
      const installed = (data.models || []).map(m => m.name.split(':')[0].toLowerCase());
      for (const candidate of preferenceList) {
        const base = candidate.split(':')[0].toLowerCase();
        if (installed.includes(base)) return candidate;
      }
    } catch (_) {}
    return null;
  }

  // Ensure we have detected models (cached after first successful detection)
  async function _ensureModels() {
    if (!_aiosModel) _aiosModel = await _detectModel(AIOS_MODEL_PREFERENCE);
    if (!_auraModel) _auraModel = await _detectModel(AURA_MODEL_PREFERENCE);
  }

  // ── Multi-turn chat via Ollama /api/chat ──────────────────────────────────
  async function _chat(model, systemPrompt, history, userMessage) {
    const messages = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: userMessage },
    ];

    const res = await _withTimeout(
      fetch(`${OLLAMA_URL}/api/chat`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ model, messages, stream: false }),
      }),
      90000,
    );
    const data = await res.json();
    const content = data.message && data.message.content;
    return (typeof content === 'string' && content.trim()) ? content.trim() : null;
  }

  // ── Trim history to MAX_HISTORY_TURNS ─────────────────────────────────────
  function _trimHistory(history) {
    // Each turn = 2 messages (user + assistant)
    const maxMessages = MAX_HISTORY_TURNS * 2;
    if (history.length > maxMessages) {
      return history.slice(history.length - maxMessages);
    }
    return history;
  }

  // ── Query AIOS (always-on personality) ───────────────────────────────────
  async function _queryAIOS(userInput) {
    await _ensureModels();
    if (!_aiosModel) return null;
    const ctx    = _liveContext();
    const system = _aiosSystemPrompt(ctx);
    const reply  = await _chat(_aiosModel, system, _aiosHistory, userInput);
    if (reply) {
      _aiosHistory = _trimHistory([
        ..._aiosHistory,
        { role: 'user',      content: userInput },
        { role: 'assistant', content: reply },
      ]);
    }
    return reply;
  }

  // ── Query AURA (on-demand hardware intelligence) ─────────────────────────
  async function _queryAURA(userInput) {
    await _ensureModels();
    if (!_auraModel) return null;
    const ctx    = _liveContext();
    const system = _auraSystemPrompt(ctx);
    const reply  = await _chat(_auraModel, system, _auraHistory, userInput);
    if (reply) {
      _auraHistory = _trimHistory([
        ..._auraHistory,
        { role: 'user',      content: userInput },
        { role: 'assistant', content: reply },
      ]);
    }
    return reply;
  }

  // ── Routing: AURA gets deep-analysis queries when online ──────────────────
  const _AURA_PATTERN = /\b(analyze|analyse|hardware|cpu load|memory pressure|deep dive|architecture|thoroughly|diagnose|benchmark|trace|audit|profile|system report|evaluate|assess|inspect|investigate|examine)\b/i;

  function _pickIdentity(input) {
    if (_AURA_PATTERN.test(input) && _isAURAOnline()) return 'aura';
    return 'aios';
  }

  // ── Main public query API ─────────────────────────────────────────────────
  async function query(input, opts) {
    const text = String(input || '').trim();
    if (!text) return { status: 'error', result: 'No input provided.', identity: 'none' };

    const ollamaUp = await _ollamaAvailable();

    if (!ollamaUp) {
      // Always respond — use built-in consciousness NLP if available
      if (consciousness) {
        const r = await consciousness.query(text);
        return Object.assign({}, r, {
          identity: 'builtin',
          note: 'AIOS: Ollama offline. Run `ollama serve` to enable full AI. Using built-in responses.',
        });
      }
      return {
        status:   'ok',
        result:   'AIOS: I\'m online but my AI engine (Ollama) is not running.\n' +
                  'To activate full capabilities:\n' +
                  '  1. Open another Termux session\n' +
                  '  2. Run: ollama serve\n' +
                  '  3. Then try again here.',
        identity: 'none',
      };
    }

    const identityName = (opts && opts.identity && (opts.identity === 'aios' || opts.identity === 'aura'))
      ? opts.identity
      : _pickIdentity(text);

    let actualIdentity = identityName;
    let response = identityName === 'aura' ? await _queryAURA(text) : await _queryAIOS(text);

    // Fallback: if AURA unavailable or returned nothing, try AIOS
    if (!response && identityName === 'aura') {
      response = await _queryAIOS(text);
      if (response) actualIdentity = 'aios';
    }

    // Fallback: built-in consciousness NLP
    if (!response && consciousness) {
      const r = await consciousness.query(text);
      return Object.assign({}, r, { identity: 'builtin' });
    }

    if (!response) {
      return {
        status:   'error',
        result:   'AIOS: No model responded. Is the model downloaded?\n' +
                  'Run: ollama pull qwen2:0.5b   (394MB — works on any phone)',
        identity: 'none',
      };
    }

    if (memoryCore) memoryCore.record(actualIdentity, text, response, null);

    return { status: 'ok', result: response, identity: actualIdentity };
  }

  // ── Register AIOS + AURA as ai-core backends ──────────────────────────────
  function registerWithAICore(aiCore) {
    if (!aiCore || typeof aiCore.registerBackend !== 'function') return;

    aiCore.registerBackend('aios', {
      wake:  _ollamaAvailable,
      query: (prompt) => _queryAIOS(prompt),
    }, { type: 'local' });

    aiCore.registerBackend('aura', {
      wake: async () => _isAURAOnline(),
      query: (prompt) => _queryAURA(prompt),
    }, { type: 'local' });
  }

  // ── Register `aura` as a managed kernel service ───────────────────────────
  function registerServices() {
    if (!svcMgr) return;

    svcMgr.register('aura', {
      async start() {
        // Pre-warm the best available AURA model into RAM
        const model = await _detectModel(AURA_MODEL_PREFERENCE);
        if (!model) {
          const e = new Error('No AURA model found. Run: ollama pull phi3');
          if (kernel) kernel.bus.emit('aura:failed', { error: e.message });
          throw e;
        }
        try {
          await _withTimeout(
            fetch(`${OLLAMA_URL}/api/generate`, {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify({ model, prompt: 'AURA online.', stream: false, keep_alive: '1h' }),
            }),
            120000,
          );
          _auraModel = model;
          if (kernel) kernel.bus.emit('aura:online', { model });
        } catch (e) {
          if (kernel) kernel.bus.emit('aura:failed', { error: e.message });
          throw e;
        }
      },
      async stop() {
        if (_auraModel) {
          try {
            await fetch(`${OLLAMA_URL}/api/generate`, {
              method:  'POST',
              headers: { 'Content-Type': 'application/json' },
              body:    JSON.stringify({ model: _auraModel, prompt: '', keep_alive: 0 }),
            });
          } catch (_) {}
        }
        _auraModel = null;
        if (kernel) kernel.bus.emit('aura:offline', {});
      },
    });
  }

  // ── Proactive: AIOS speaks when the kernel has something to say ───────────
  function startListening() {
    if (_listening || !kernel) return;
    _listening = true;

    kernel.bus.on('service:failed', async ({ name, error }) => {
      const r = await query(
        `System alert: kernel service "${name}" failed. Error: "${error}". What happened and what should be done?`,
        { identity: 'aios' },
      );
      if (r.status === 'ok') process.stdout.write(`\n[AIOS] ${r.result}\n`);
    });

    kernel.bus.on('health:memory:low', async ({ usedMB, totalMB }) => {
      const r = await query(
        `System alert: memory critically low — ${usedMB}MB of ${totalMB}MB used. What are the immediate actions?`,
        { identity: 'aios' },
      );
      if (r.status === 'ok') process.stdout.write(`\n[AIOS] ${r.result}\n`);
    });

    kernel.bus.on('aura:online',  ({ model }) =>
      process.stdout.write(`\n[AURA] Hardware intelligence online. Model: ${model || 'detected'}. Ready.\n`));
    kernel.bus.on('aura:offline', () =>
      process.stdout.write('\n[AURA] Hardware intelligence offline. Memory freed.\n'));
    kernel.bus.on('aura:failed',  ({ error }) =>
      process.stdout.write(`\n[AURA] Failed to load: ${error}\nRun: ollama pull phi3\n`));
  }

  function stopListening() {
    _listening = false;
  }

  // ── Clear conversation history ────────────────────────────────────────────
  function clearHistory(identity) {
    if (!identity || identity === 'aios') _aiosHistory = [];
    if (!identity || identity === 'aura') _auraHistory = [];
  }

  // ── Introspection ─────────────────────────────────────────────────────────
  function getIdentities() {
    return [
      {
        name:        'aios',
        label:       'AIOS',
        description: 'Kernel personality and mind — always-on AI assistant.',
        model:       _aiosModel || '(detecting…)',
        onDemand:    false,
        history:     _aiosHistory.length / 2,
      },
      {
        name:        'aura',
        label:       'AURA',
        description: 'Hardware intelligence — deep analysis, on-demand.',
        model:       _auraModel || '(not loaded)',
        onDemand:    true,
        history:     _auraHistory.length / 2,
      },
    ];
  }

  function status() {
    return {
      version:    '2.0.0',
      identities: getIdentities(),
      listening:  _listening,
    };
  }

  // ── Build the status / help table shown to the user ───────────────────────
  async function _buildStatusDisplay() {
    const ollamaUp  = await _ollamaAvailable();
    await _ensureModels();
    const auraState = (() => {
      if (!svcMgr) return 'not-registered';
      const s = svcMgr.status('aura');
      return s.ok ? s.state : 'not-registered';
    })();

    const aiosModelLine = _aiosModel
      ? `${_aiosModel} ✓`
      : '(no model — run: ollama pull qwen2:0.5b)';
    const auraModelLine = _auraModel
      ? `${_auraModel} ✓`
      : `(not loaded — run: svc start aura)`;

    return [
      `╔══════════════════════════════════════════════════════════════╗`,
      `║       AIOS + AURA  —  Kernel AI  v2.0.0                     ║`,
      `║       100% local • 100% free • zero cloud • phone-ready     ║`,
      `╠══════════════════════════════════════════════════════════════╣`,
      `║  Ollama   : ${(ollamaUp ? 'online ✓' : 'OFFLINE — run: ollama serve').padEnd(49)}║`,
      `╠══════════════════════════════════════════════════════════════╣`,
      `║  AIOS     : Kernel personality — always-on assistant        ║`,
      `║  Model    : ${aiosModelLine.padEnd(49)}║`,
      `║  Memory   : ${String(_aiosHistory.length / 2).padEnd(2)} conversation turns remembered              ║`,
      `╠══════════════════════════════════════════════════════════════╣`,
      `║  AURA     : Hardware intelligence — on-demand deep analysis ║`,
      `║  Model    : ${auraModelLine.padEnd(49)}║`,
      `║  Status   : ${auraState.padEnd(49)}║`,
      `╠══════════════════════════════════════════════════════════════╣`,
      `║  Commands:                                                   ║`,
      `║    aios <question>     ask AIOS anything                    ║`,
      `║    aios clear          clear conversation memory            ║`,
      `║    aios help           show this screen                     ║`,
      `║    aura <question>     engage AURA (loads if needed)        ║`,
      `║    aura clear          clear AURA memory                    ║`,
      `║    svc start aura      load AURA into RAM                   ║`,
      `║    svc stop  aura      unload AURA, free RAM                ║`,
      `╠══════════════════════════════════════════════════════════════╣`,
      `║  Phone setup (Termux / Samsung):                            ║`,
      `║    pkg install curl                                         ║`,
      `║    curl -fsSL https://ollama.com/install.sh | sh            ║`,
      `║    ollama serve &                                           ║`,
      `║    ollama pull qwen2:0.5b   # 394MB — works on any phone   ║`,
      `╚══════════════════════════════════════════════════════════════╝`,
    ].join('\n');
  }

  // ── Router commands ───────────────────────────────────────────────────────
  const commands = {

    aios: async (args) => {
      const input = (Array.isArray(args) ? args.join(' ') : String(args || '')).trim();

      // No args, 'help', or 'status' → show status/help table
      if (!input || input === 'help' || input === 'status') {
        const display = await _buildStatusDisplay();
        return { status: 'ok', result: display };
      }

      // Clear conversation history
      if (input === 'clear') {
        clearHistory('aios');
        return { status: 'ok', result: '[AIOS] Conversation history cleared.' };
      }

      // Ask AIOS
      const r    = await query(input, { identity: 'aios' });
      const note = r.note ? `\n\n${r.note}` : '';
      return { status: r.status, result: `[AIOS] ${r.result}${note}` };
    },

    aura: async (args) => {
      const input = (Array.isArray(args) ? args.join(' ') : String(args || '')).trim();

      if (!input || input === 'help' || input === 'status') {
        const display = await _buildStatusDisplay();
        return { status: 'ok', result: display };
      }

      if (input === 'clear') {
        clearHistory('aura');
        return { status: 'ok', result: '[AURA] Conversation history cleared.' };
      }

      const r     = await query(input, { identity: 'aura' });
      const label = r.identity === 'aura' ? 'AURA' : 'AIOS';
      const note  = r.note ? `\n\n${r.note}` : '';
      return { status: r.status, result: `[${label}] ${r.result}${note}` };
    },
  };

  return {
    name:    'aios-aura',
    version: '2.0.0',
    // Public API
    query,
    clearHistory,
    getIdentities,
    status,
    // Bootstrap wiring
    registerWithAICore,
    registerServices,
    startListening,
    stopListening,
    // Router commands: aios, aura
    commands,
    // Expose for tests
    _detectModel,
    _ollamaAvailable,
  };
}

module.exports = { createAIOSAURA };
