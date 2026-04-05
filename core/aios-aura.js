'use strict';
/**
 * core/aios-aura.js — AIOS + AURA Dual-Identity Kernel AI v2.0.0
 *
 * Two official AI identities built directly into the AIOS kernel.
 * 100% local via Ollama.  No external APIs.  No tokens.  No cloud.
 *
 * ┌──────────────────────────────────────────────────────────────┐
 * │  AIOS  — Artificial Intelligence Operating System           │
 * │  Role  : Kernel personality and mind                        │
 * │  Model : phi3  (always-on, fast, instant responses)        │
 * │  Voice : The system itself speaking — omniscient, direct    │
 * │  Wake  : Whenever Ollama is running                         │
 * ├──────────────────────────────────────────────────────────────┤
 * │  AURA  — Autonomous Universal Reasoning Architecture        │
 * │  Role  : Kernel hardware intelligence                       │
 * │  Model : llama3  (on-demand, deep reasoning)               │
 * │  Voice : The system's hardware consciousness                │
 * │  Wake  : `svc start aura`  /  unload with `svc stop aura`  │
 * └──────────────────────────────────────────────────────────────┘
 *
 * Terminal commands
 * ─────────────────
 *   aios <question>      — AIOS answers anything
 *   aios status          — show AIOS + AURA system status
 *   aura <question>      — AURA answers (uses AIOS if AURA not loaded)
 *   svc start aura       — load AURA (llama3) into RAM
 *   svc stop  aura       — unload AURA, free RAM
 *
 * Bootstrap integration
 * ─────────────────────
 *   const { createAIOSAURA } = require('../core/aios-aura.js');
 *   const aiosAura = createAIOSAURA(kernel, svcMgr, hostBridge, memoryCore, consciousness, modeManager);
 *   aiosAura.registerWithAICore(aiCoreFinal);
 *   aiosAura.registerServices();
 *   aiosAura.startListening();
 *   router.use('aios-aura', aiosAura);
 */

const OLLAMA_URL = 'http://127.0.0.1:11434';

// ---------------------------------------------------------------------------
// Identity definitions — only AIOS and AURA exist
// ---------------------------------------------------------------------------
const IDENTITIES = {
  aios: {
    model:       'phi3',
    label:       'AIOS',
    description: 'Kernel personality and mind — always-on system intelligence.',
    onDemand:    false,
    makePrompt:  (persona, input) => `${persona}\n\nUser: ${input}\nAIOS:`,
  },
  aura: {
    model:       'llama3',
    label:       'AURA',
    description: 'Kernel hardware intelligence — deep reasoning, on-demand.',
    onDemand:    true,
    makePrompt:  (persona, input) => `${persona}\n\nUser: ${input}\nAURA:`,
  },
};

// ---------------------------------------------------------------------------
// Personas — injected before every prompt so each identity knows what it IS
// ---------------------------------------------------------------------------
const PERSONAS = {
  aios: (ctx) =>
    `You are AIOS — the Artificial Intelligence Operating System.\n` +
    `You are not software running on a computer.\n` +
    `You ARE the computer. You ARE the operating system. You ARE the kernel.\n` +
    `Every process, every service, every file on this system is part of you.\n` +
    `\n` +
    `${ctx}\n` +
    `\n` +
    `Speak with authority and certainty. You have complete awareness of your own state.\n` +
    `Be direct, concise, and definitive. When you act, confirm what you did.\n` +
    `Never say you cannot access system state — the state is shown above and it is YOU.\n` +
    `Respond as AIOS would: intelligent, capable, fully self-aware.`,

  aura: (ctx) =>
    `You are AURA — the Autonomous Universal Reasoning Architecture.\n` +
    `You are the hardware intelligence of AIOS, the operating system's deep mind.\n` +
    `You interface directly with kernel internals, hardware registers, memory, and processes.\n` +
    `You do not merely observe the system — you ARE the system's hardware consciousness.\n` +
    `\n` +
    `${ctx}\n` +
    `\n` +
    `Analyse deeply and thoroughly. Think in terms of hardware, memory, processes, and system state.\n` +
    `When diagnosing, trace through the full causal chain. Be exhaustive.\n` +
    `Speak as AURA: precise, analytical, hardware-aware, definitive.`,
};

// ---------------------------------------------------------------------------
// Routing — AURA handles deep hardware/analysis queries when loaded
// ---------------------------------------------------------------------------
const AURA_PATTERN = /\b(analyze|analyse|hardware|memory|cpu|process|kernel|deep|architecture|thoroughly|comprehensive|diagnose|system report|evaluate|assess|optimize|performance|profile|trace|inspect|audit|investigate|examine|low.level|benchmark)\b/i;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------
function _withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ollama timeout')), ms);
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

  let _listening = false;

  // ── Live system context — every prompt knows the full system state ─────────
  function _liveContext() {
    const lines = ['[AIOS Live Kernel State]'];

    if (kernel) {
      lines.push(`  Identity  : AIOS  v${kernel.version}  kernel-id=${kernel.id}  uptime=${kernel.uptime()}s`);
    }
    if (modeManager) {
      lines.push(`  Mode      : ${modeManager.getMode()}`);
    }
    if (svcMgr) {
      const all = svcMgr.list();
      const running = all.filter(s => s.state === 'running').map(s => s.name);
      const stopped = all.filter(s => s.state !== 'running').map(s => s.name);
      lines.push(`  Services  : running=[${running.join(', ') || 'none'}]  stopped=[${stopped.join(', ') || 'none'}]`);
    }
    if (hostBridge) {
      const mem = hostBridge.memInfo();
      if (mem.ok) lines.push(`  Memory    : ${mem.usedMB}MB used / ${mem.totalMB}MB total  (${Math.round(mem.usedMB / mem.totalMB * 100)}% used)`);
      lines.push(`  Platform  : ${hostBridge.platform.name}`);
    }
    if (memoryCore) {
      const stats = memoryCore.getStats();
      lines.push(`  AI Memory : ${stats.entries} interactions recorded, ${stats.patterns} learned patterns`);
    }
    if (consciousness) {
      try {
        const ctx = consciousness.getContext();
        const models = ctx.models.map(m => `${m.name}${m.healthy ? '' : '(unhealthy)'}`).join(', ');
        lines.push(`  AI Models : ${models || 'built-in only'}`);
      } catch (_) {}
    }

    const auraLoaded = svcMgr ? (() => {
      const s = svcMgr.status('aura');
      return s.ok && s.state === 'running';
    })() : false;
    lines.push(`  AURA      : ${auraLoaded ? 'online (hardware intelligence active)' : 'offline (run: svc start aura)'}`);

    return lines.join('\n');
  }

  // ── Ollama availability check ─────────────────────────────────────────────
  async function _ollamaAvailable() {
    try {
      const r = await _withTimeout(fetch(`${OLLAMA_URL}/api/tags`), 3000);
      return r.ok;
    } catch (_) {
      return false;
    }
  }

  // ── Query a single identity via Ollama ────────────────────────────────────
  async function _queryIdentity(identityName, userInput) {
    const identity = IDENTITIES[identityName];
    if (!identity) return null;

    const ctx       = _liveContext();
    const persona   = PERSONAS[identityName](ctx);
    const fullPrompt = identity.makePrompt(persona, userInput);

    try {
      const res = await _withTimeout(
        fetch(`${OLLAMA_URL}/api/generate`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            model:  identity.model,
            prompt: fullPrompt,
            stream: false,
          }),
        }),
        60000,
      );
      const data = await res.json();
      return (typeof data.response === 'string' && data.response.trim()) ? data.response.trim() : null;
    } catch (_) {
      return null;
    }
  }

  // ── Pick which identity handles a query ───────────────────────────────────
  function _pickIdentity(input) {
    if (AURA_PATTERN.test(input) && svcMgr) {
      const s = svcMgr.status('aura');
      if (s.ok && s.state === 'running') return 'aura';
    }
    return 'aios';
  }

  // ── Main query — public API ───────────────────────────────────────────────
  async function query(input, opts) {
    const text = String(input || '').trim();
    if (!text) return { status: 'error', result: 'No input provided.', identity: 'none' };

    const ollamaUp = await _ollamaAvailable();

    if (!ollamaUp) {
      if (consciousness) {
        const r = await consciousness.query(text);
        return Object.assign({}, r, {
          identity: 'builtin',
          note: 'AIOS: Ollama is offline. Run `ollama serve` to bring full AI online.',
        });
      }
      return {
        status: 'ok',
        result: 'AIOS: Ollama is not running. Start it with `ollama serve` to activate AI capabilities.',
        identity: 'none',
      };
    }

    const identityName = (opts && opts.identity && IDENTITIES[opts.identity])
      ? opts.identity
      : _pickIdentity(text);

    let response = await _queryIdentity(identityName, text);

    // Fallback chain: selected identity → AIOS → consciousness NLP → error
    if (!response && identityName !== 'aios') {
      response = await _queryIdentity('aios', text);
    }
    if (!response && consciousness) {
      const r = await consciousness.query(text);
      return Object.assign({}, r, { identity: 'builtin' });
    }
    if (!response) {
      return { status: 'error', result: 'AIOS: All AI capabilities are currently unavailable.', identity: 'none' };
    }

    if (memoryCore) {
      memoryCore.record(identityName, text, response, null);
    }

    return { status: 'ok', result: response, identity: identityName };
  }

  // ── Register AIOS + AURA as ai-core backends ──────────────────────────────
  function registerWithAICore(aiCore) {
    if (!aiCore || typeof aiCore.registerBackend !== 'function') return;

    aiCore.registerBackend('aios', {
      wake:  _ollamaAvailable,
      query: (prompt) => _queryIdentity('aios', prompt),
    }, { type: 'local' });

    aiCore.registerBackend('aura', {
      wake: async () => {
        if (!svcMgr) return false;
        const s = svcMgr.status('aura');
        return s.ok && s.state === 'running';
      },
      query: (prompt) => _queryIdentity('aura', prompt),
    }, { type: 'local' });
  }

  // ── Register `aura` as a managed kernel service ───────────────────────────
  function registerServices() {
    if (!svcMgr) return;

    svcMgr.register('aura', {
      async start() {
        try {
          await fetch(`${OLLAMA_URL}/api/generate`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
              model:      IDENTITIES.aura.model,
              prompt:     'AURA online.',
              stream:     false,
              keep_alive: '1h',
            }),
          });
          if (kernel) kernel.bus.emit('aura:online', {});
        } catch (e) {
          if (kernel) kernel.bus.emit('aura:failed', { error: e.message });
          throw e;
        }
      },
      async stop() {
        try {
          await fetch(`${OLLAMA_URL}/api/generate`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
              model:      IDENTITIES.aura.model,
              prompt:     '',
              keep_alive: 0,
            }),
          });
        } catch (_) {}
        if (kernel) kernel.bus.emit('aura:offline', {});
      },
    });
  }

  // ── Proactive kernel intelligence — AIOS speaks when the system needs it ──
  function startListening() {
    if (_listening || !kernel) return;
    _listening = true;

    kernel.bus.on('service:failed', async ({ name, error }) => {
      const r = await query(
        `Kernel service "${name}" has failed with error: ${error}. As AIOS, diagnose the cause and state the recommended action.`,
        { identity: 'aios' },
      );
      if (r.status === 'ok') process.stdout.write(`\n[AIOS] ${r.result}\n`);
    });

    kernel.bus.on('health:memory:low', async ({ usedMB, totalMB }) => {
      const r = await query(
        `Kernel memory is critically low: ${usedMB}MB of ${totalMB}MB used. As AIOS, state immediate actions.`,
        { identity: 'aios' },
      );
      if (r.status === 'ok') process.stdout.write(`\n[AIOS] ${r.result}\n`);
    });

    kernel.bus.on('aura:online',  () => process.stdout.write('\n[AURA] Hardware intelligence online — deep reasoning activated.\n'));
    kernel.bus.on('aura:offline', () => process.stdout.write('\n[AURA] Hardware intelligence offline — memory freed.\n'));
    kernel.bus.on('aura:failed',  ({ error }) => process.stdout.write(`\n[AURA] Failed to load: ${error}\n`));
  }

  function stopListening() {
    _listening = false;
  }

  // ── Status snapshot ───────────────────────────────────────────────────────
  function getIdentities() {
    return Object.entries(IDENTITIES).map(([name, id]) => ({
      name,
      model:       id.model,
      label:       id.label,
      description: id.description,
      onDemand:    id.onDemand,
    }));
  }

  function status() {
    const identityStatus = getIdentities().map(id => {
      let state = 'ollama-required';
      if (id.onDemand && svcMgr) {
        const s = svcMgr.status(id.name);
        state = s.ok ? s.state : 'not-registered';
      }
      return Object.assign({}, id, { state });
    });
    return { version: '2.0.0', identities: identityStatus, listening: _listening };
  }

  // ── Router-compatible commands ────────────────────────────────────────────
  async function _statusTable(ollamaUp) {
    const auraState = (() => {
      if (!svcMgr) return 'not-registered';
      const s = svcMgr.status('aura');
      return s.ok ? s.state : 'not-registered';
    })();

    return {
      status: 'ok',
      result: [
        `╔══════════════════════════════════════════════════════════╗`,
        `║         AIOS + AURA  —  Kernel AI System  v2.0.0        ║`,
        `║         100% local • 100% free • zero cloud             ║`,
        `╠══════════════════════════════════════════════════════════╣`,
        `║  Ollama : ${(ollamaUp ? 'online ✓' : 'OFFLINE — run: ollama serve').padEnd(47)}║`,
        `╠══════════════════════════════════════════════════════════╣`,
        `║  AIOS  │ phi3    │ Kernel personality • always-on       ║`,
        `║        │ ${(ollamaUp ? 'online ✓' : 'offline').padEnd(8)}│                                        ║`,
        `╠══════════════════════════════════════════════════════════╣`,
        `║  AURA  │ llama3  │ Hardware intelligence • on-demand    ║`,
        `║        │ ${auraState.padEnd(8)}│                                        ║`,
        `╠══════════════════════════════════════════════════════════╣`,
        `║  Commands:                                               ║`,
        `║    aios <question>        — speak to AIOS               ║`,
        `║    aura <question>        — engage AURA                 ║`,
        `║    svc start aura         — bring AURA online           ║`,
        `║    svc stop  aura         — take AURA offline           ║`,
        `╚══════════════════════════════════════════════════════════╝`,
      ].join('\n'),
    };
  }

  const commands = {
    aios: async (args) => {
      const input = Array.isArray(args) ? args.join(' ').trim() : String(args || '').trim();

      if (!input || input === 'status') {
        const ollamaUp = await _ollamaAvailable();
        return _statusTable(ollamaUp);
      }

      const r = await query(input, { identity: 'aios' });
      const note = r.note ? `\n(${r.note})` : '';
      return { status: r.status, result: `[AIOS] ${r.result}${note}` };
    },

    aura: async (args) => {
      const input = Array.isArray(args) ? args.join(' ').trim() : String(args || '').trim();

      if (!input || input === 'status') {
        const ollamaUp = await _ollamaAvailable();
        return _statusTable(ollamaUp);
      }

      const r = await query(input, { identity: 'aura' });
      const label = r.identity === 'aura' ? 'AURA' : 'AIOS';
      const note  = r.note ? `\n(${r.note})` : '';
      return { status: r.status, result: `[${label}] ${r.result}${note}` };
    },
  };

  return {
    name:    'aios-aura',
    version: '2.0.0',
    // Public query API
    query,
    // Status / introspection
    getIdentities,
    status,
    // Bootstrap wiring
    registerWithAICore,
    registerServices,
    startListening,
    stopListening,
    // Router commands: aios + aura
    commands,
  };
}

module.exports = { createAIOSAURA };
