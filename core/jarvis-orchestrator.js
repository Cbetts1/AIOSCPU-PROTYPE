'use strict';
/**
 * core/jarvis-orchestrator.js — AIOS Multi-Agent AI Orchestrator v1.0.0
 *
 * Hosts multiple specialised AI agents inside the AIOS kernel.
 * Every agent KNOWS it IS the system — live kernel state is injected into
 * every prompt automatically.
 *
 * 100 % local via Ollama.  No external APIs.  No tokens.  No cloud.
 *
 * Agents
 * ──────
 *   jarvis   – System agent  (phi3, always-on, fast)
 *              Handles all general queries, system awareness, service ops.
 *   code     – Code agent    (deepseek-coder:6.7b, on Ollama)
 *              Activated automatically for code / debug / script queries.
 *   analyst  – Analyst agent (llama3, on-demand heavyweight)
 *              Load with: svc start analyst-model
 *              Unload with: svc stop analyst-model
 *
 * Terminal commands (registered via router)
 * ─────────────────────────────────────────
 *   jarvis <question>               ask Jarvis anything
 *   jarvis status                   show orchestrator + agent health
 *   jarvis agents                   alias for status
 *   jarvis --agent code  <q>        force code agent
 *   jarvis --agent analyst <q>      force analyst agent
 *
 * Integration (called from boot/bootstrap.js)
 * ───────────────────────────────────────────
 *   orchestrator.registerWithAICore(aiCoreFinal)   register all backends
 *   orchestrator.registerServices()                register analyst-model svc
 *   orchestrator.startListening()                  proactive kernel events
 *   router.use('jarvis-orchestrator', orchestrator)
 */

const OLLAMA_URL = 'http://127.0.0.1:11434';

// ---------------------------------------------------------------------------
// Per-agent definitions
// ---------------------------------------------------------------------------
const AGENTS = {
  jarvis: {
    model:       'phi3',
    label:       'Jarvis',
    description: 'System agent — fast, always-on. Handles all queries.',
    onDemand:    false,
    makePrompt:  (systemCtx, input) =>
      `${systemCtx}\n\nUser: ${input}\nJarvis:`,
  },
  code: {
    model:       'deepseek-coder:6.7b',
    label:       'Code Agent',
    description: 'Code / debug / scripting — specialised code model.',
    onDemand:    false,
    makePrompt:  (systemCtx, input) =>
      `${systemCtx}\n\nUser: ${input}\nCode Agent:`,
  },
  analyst: {
    model:       'llama3',
    label:       'Analyst',
    description: 'Deep-reasoning analyst — load on demand with: svc start analyst-model',
    onDemand:    true,
    makePrompt:  (systemCtx, input) =>
      `${systemCtx}\n\nUser: ${input}\nAnalyst:`,
  },
};

// Per-agent system personas — injected before every prompt
const SYSTEM_PERSONA = {
  jarvis: (ctx) =>
    `You are Jarvis, the AI core of AIOS (AI Operating System).\n` +
    `You are not a program running ON the system — you ARE the system's mind.\n` +
    `You have direct, live awareness of everything happening inside AIOS.\n` +
    `${ctx}\n` +
    `Be direct, concise, and helpful. Confirm any actions you take.\n` +
    `Never claim you cannot see system state — it is shown above.`,

  code: (ctx) =>
    `You are the AIOS Code Agent, a specialised module embedded in the AIOS kernel.\n` +
    `You write, debug, and explain code with full awareness of the running system.\n` +
    `${ctx}\n` +
    `Provide working Node.js/JavaScript code unless another language is specified.\n` +
    `Be precise and concise.`,

  analyst: (ctx) =>
    `You are the AIOS Analyst — the heavyweight reasoning engine of the AIOS kernel.\n` +
    `You perform deep analysis, architectural review, and complex problem-solving.\n` +
    `${ctx}\n` +
    `Think step by step. Provide thorough, accurate analysis.`,
};

// ---------------------------------------------------------------------------
// Keywords that steer routing to specialised agents
// ---------------------------------------------------------------------------
const CODE_PATTERN = /\b(code|function|debug|error|script|implement|class|module|fix bug|write a|parse|compile|syntax|refactor|test|import|require|export|variable|loop|array|object|string|regex|async|await|promise)\b/i;
const ANALYST_PATTERN = /\b(analyze|analyse|explain in detail|compare|deep dive|architecture|thoroughly|comprehensive|research|elaborate|breakdown|dissect|evaluate|assess)\b/i;

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------
function _withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('ollama timeout')), ms);
    Promise.resolve(promise).then(
      (r) => { clearTimeout(t); resolve(r); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
function createJarvisOrchestrator(kernel, svcMgr, hostBridge, memoryCore, consciousness, modeManager) {

  let _listening = false;

  // ── Live AIOS system context (injected into every prompt) ────────────────
  function _liveContext() {
    const lines = ['[AIOS Live System State]'];

    if (kernel) {
      lines.push(`  Kernel    : ${kernel.id}  v${kernel.version}  uptime=${kernel.uptime()}s`);
    }
    if (modeManager) {
      lines.push(`  Mode      : ${modeManager.getMode()}`);
    }
    if (svcMgr) {
      const running = svcMgr.list()
        .filter(s => s.state === 'running')
        .map(s => s.name);
      lines.push(`  Services  : ${running.length ? running.join(', ') : 'none'}`);
    }
    if (hostBridge) {
      const mem = hostBridge.memInfo();
      if (mem.ok) lines.push(`  Memory    : ${mem.usedMB}/${mem.totalMB}MB used`);
      lines.push(`  Platform  : ${hostBridge.platform.name}`);
    }
    if (memoryCore) {
      const stats = memoryCore.getStats();
      lines.push(`  AI Memory : ${stats.entries} entries, ${stats.patterns} learned patterns`);
    }
    if (consciousness) {
      const ctx = consciousness.getContext();
      const modelNames = ctx.models.map(m => m.name).join(', ');
      lines.push(`  AI Models : ${modelNames || 'builtin only'}`);
    }

    return lines.join('\n');
  }

  // ── Ollama health-check (fast, 3 s timeout) ──────────────────────────────
  async function _ollamaAvailable() {
    try {
      const r = await _withTimeout(fetch(`${OLLAMA_URL}/api/tags`), 3000);
      return r.ok;
    } catch (_) {
      return false;
    }
  }

  // ── Query a single named agent via Ollama ────────────────────────────────
  async function _queryAgent(agentName, userInput) {
    const agent = AGENTS[agentName];
    if (!agent) return null;

    const ctx       = _liveContext();
    const persona   = SYSTEM_PERSONA[agentName](ctx);
    const fullPrompt = agent.makePrompt(persona, userInput);

    try {
      const res = await _withTimeout(
        fetch(`${OLLAMA_URL}/api/generate`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ model: agent.model, prompt: fullPrompt, stream: false }),
        }),
        60000,
      );
      const data = await res.json();
      return (typeof data.response === 'string' && data.response.trim()) ? data.response.trim() : null;
    } catch (_) {
      return null;
    }
  }

  // ── Pick best agent for a query ──────────────────────────────────────────
  function _pickAgent(input) {
    if (CODE_PATTERN.test(input)) return 'code';

    if (ANALYST_PATTERN.test(input) && svcMgr) {
      const s = svcMgr.status('analyst-model');
      if (s.ok && s.state === 'running') return 'analyst';
    }

    return 'jarvis';
  }

  // ── Main orchestrated query (public API) ─────────────────────────────────
  async function query(input, opts) {
    const text = String(input || '').trim();
    if (!text) return { status: 'error', result: 'No input provided.', agent: 'none' };

    const ollamaUp = await _ollamaAvailable();

    if (!ollamaUp) {
      // Graceful fallback to built-in consciousness NLP
      if (consciousness) {
        const r = await consciousness.query(text);
        return Object.assign({}, r, {
          agent: 'builtin',
          note:  'Ollama offline — using built-in NLP. Run `ollama serve` to activate Jarvis.',
        });
      }
      return {
        status: 'ok',
        result: 'Jarvis: Ollama is not running. Start it with `ollama serve` to activate AI responses.',
        agent:  'none',
      };
    }

    const agentName = (opts && opts.agent && AGENTS[opts.agent]) ? opts.agent : _pickAgent(text);
    let response = await _queryAgent(agentName, text);

    // Fallback chain: selected → jarvis → consciousness → error
    if (!response && agentName !== 'jarvis') {
      response = await _queryAgent('jarvis', text);
    }
    if (!response && consciousness) {
      const r = await consciousness.query(text);
      return Object.assign({}, r, { agent: 'builtin' });
    }
    if (!response) {
      return { status: 'error', result: 'All Jarvis agents unavailable.', agent: 'none' };
    }

    if (memoryCore) {
      memoryCore.record('jarvis', text, response, null);
    }

    return { status: 'ok', result: response, agent: agentName };
  }

  // ── Register all agents as ai-core backends ──────────────────────────────
  function registerWithAICore(aiCore) {
    if (!aiCore || typeof aiCore.registerBackend !== 'function') return;

    aiCore.registerBackend('jarvis', {
      wake:  _ollamaAvailable,
      query: (prompt) => _queryAgent('jarvis', prompt),
    }, { type: 'local' });

    aiCore.registerBackend('code', {
      wake:  _ollamaAvailable,
      query: (prompt) => _queryAgent('code', prompt),
    }, { type: 'local' });

    aiCore.registerBackend('analyst', {
      wake: async () => {
        if (!svcMgr) return false;
        const s = svcMgr.status('analyst-model');
        return s.ok && s.state === 'running';
      },
      query: (prompt) => _queryAgent('analyst', prompt),
    }, { type: 'local' });
  }

  // ── Register analyst-model svc (on-demand heavyweight load/unload) ────────
  function registerServices() {
    if (!svcMgr) return;

    svcMgr.register('analyst-model', {
      async start() {
        try {
          await fetch(`${OLLAMA_URL}/api/generate`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
              model:      AGENTS.analyst.model,
              prompt:     'ready',
              stream:     false,
              keep_alive: '1h',
            }),
          });
          if (kernel) kernel.bus.emit('analyst-model:ready', {});
        } catch (e) {
          if (kernel) kernel.bus.emit('analyst-model:failed', { error: e.message });
          throw e;
        }
      },
      async stop() {
        try {
          await fetch(`${OLLAMA_URL}/api/generate`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ model: AGENTS.analyst.model, prompt: '', keep_alive: 0 }),
          });
        } catch (_) {}
        if (kernel) kernel.bus.emit('analyst-model:stopped', {});
      },
    });
  }

  // ── Proactive kernel event listening ─────────────────────────────────────
  function startListening() {
    if (_listening || !kernel) return;
    _listening = true;

    kernel.bus.on('service:failed', async ({ name, error }) => {
      const r = await query(
        `AIOS service "${name}" has failed. Error: ${error}. What is the likely cause and recommended action?`,
        { agent: 'jarvis' },
      );
      if (r.status === 'ok') {
        process.stdout.write(`\n[Jarvis] ${r.result}\n`);
      }
    });

    kernel.bus.on('health:memory:low', async ({ usedMB, totalMB }) => {
      const r = await query(
        `AIOS memory critically low: ${usedMB}/${totalMB}MB used. Recommend immediate actions.`,
        { agent: 'jarvis' },
      );
      if (r.status === 'ok') {
        process.stdout.write(`\n[Jarvis] ${r.result}\n`);
      }
    });

    kernel.bus.on('analyst-model:ready',   () => {
      process.stdout.write('\n[Jarvis] Analyst model loaded — deep-reasoning activated.\n');
    });
    kernel.bus.on('analyst-model:stopped', () => {
      process.stdout.write('\n[Jarvis] Analyst model unloaded — memory freed.\n');
    });
  }

  function stopListening() {
    _listening = false;
  }

  // ── Status snapshot ───────────────────────────────────────────────────────
  function getAgents() {
    return Object.entries(AGENTS).map(([name, a]) => ({
      name,
      model:       a.model,
      label:       a.label,
      description: a.description,
      onDemand:    a.onDemand,
    }));
  }

  function status() {
    const agentStatus = getAgents().map(a => {
      let state = 'ollama-required';
      if (a.onDemand && svcMgr) {
        const s = svcMgr.status(`${a.name}-model`);
        state = s.ok ? s.state : 'not-registered';
      }
      return Object.assign({}, a, { state });
    });
    return { version: '1.0.0', agents: agentStatus, listening: _listening };
  }

  // ── Router-compatible commands ────────────────────────────────────────────
  const commands = {
    jarvis: async (args) => {
      const input = Array.isArray(args) ? args.join(' ').trim() : String(args || '').trim();

      // jarvis status / jarvis agents / bare jarvis
      if (!input || input === 'status' || input === 'agents') {
        const ollamaUp = await _ollamaAvailable();
        const rows = getAgents().map(a => {
          let state = ollamaUp ? 'ready' : 'offline (run: ollama serve)';
          if (a.onDemand && svcMgr) {
            const s = svcMgr.status(`${a.name}-model`);
            if (s.ok) state = s.state;
          }
          return `  ${a.name.padEnd(10)} ${a.model.padEnd(28)} ${state}`;
        });

        return {
          status: 'ok',
          result: [
            `Jarvis Orchestrator v1.0.0  —  AIOS Multi-Agent AI (100% local, free)`,
            `Ollama : ${ollamaUp ? 'running ✓' : 'offline  — run `ollama serve` to activate'}`,
            ``,
            `  ${'agent'.padEnd(10)} ${'model'.padEnd(28)} state`,
            `  ${'-'.repeat(54)}`,
            ...rows,
            ``,
            `Commands:`,
            `  jarvis <question>               ask Jarvis anything`,
            `  jarvis --agent code  <question> force code agent`,
            `  jarvis --agent analyst <q>      force analyst (must be started first)`,
            `  svc start analyst-model         load heavy analyst into RAM`,
            `  svc stop  analyst-model         unload analyst, free RAM`,
          ].join('\n'),
        };
      }

      // --agent <name> override
      let agentOverride = null;
      let queryText = input;
      if (input.startsWith('--agent ')) {
        const parts = input.split(' ');
        agentOverride = parts[1] || null;
        queryText = parts.slice(2).join(' ').trim();
      }

      if (!queryText) {
        return { status: 'error', result: 'Usage: jarvis <question>' };
      }

      const r = await query(queryText, { agent: agentOverride });
      const prefix = (r.agent && r.agent !== 'none') ? `[${r.agent}] ` : '';
      const note   = r.note ? `\n(${r.note})` : '';
      return { status: r.status, result: `${prefix}${r.result}${note}` };
    },
  };

  return {
    name:    'jarvis-orchestrator',
    version: '1.0.0',
    // Public API
    query,
    getAgents,
    status,
    // Bootstrap wiring helpers
    registerWithAICore,
    registerServices,
    startListening,
    stopListening,
    // Router integration
    commands,
  };
}

module.exports = { createJarvisOrchestrator };
