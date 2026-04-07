'use strict';
/**
 * core/remote-mesh.js — AIOS AI Mesh v1.0.0
 *
 * 7 open-source AI models wired as one brain — all free, no API keys, no cloud.
 * AIOS is the microphone: your phone routes lightweight JSON requests (~1KB),
 * llama.cpp handles all computation — on this device or a home server/PC.
 *
 * Agents (all via llama.cpp — open-source, free, no accounts required):
 * ┌────────────┬──────────────────────┬────────────────────────────────────────┐
 * │ Agent      │ Model                │ Specialty                              │
 * ├────────────┼──────────────────────┼────────────────────────────────────────┤
 * │ speed      │ qwen2:0.5b   (394MB) │ Fast replies, lightweight queries      │
 * │ chat       │ tinyllama    (637MB) │ Friendly conversation, general help    │
 * │ logic      │ gemma:2b     (1.4GB) │ Step-by-step reasoning, comparisons    │
 * │ reason     │ phi3         (2.3GB) │ Deep analysis, cause/effect, "why"     │
 * │ code       │ deepseek-coder:6.7b  │ Code, debugging, scripts, refactoring  │
 * │ mind       │ llama3       (4.7GB) │ Full-power reasoning, research, depth  │
 * │ write      │ mistral      (4.1GB) │ Writing, summarizing, explanations     │
 * └────────────┴──────────────────────┴────────────────────────────────────────┘
 *
 * How your phone stays light:
 *   Models are served by llama.cpp (llama-server).  By default it runs locally
 *   (localhost:8080).  Point LLAMA_HOST at a home server or PC and your phone
 *   only sends ~1KB JSON per request — all CPU/GPU work stays on the server.
 *
 * Smart routing (zero cost, keyword-driven):
 *   fast/simple   → speed  (qwen2:0.5b — instant)
 *   conversation  → chat   (tinyllama)
 *   logic/compare → logic  (gemma:2b)
 *   why/how/deep  → reason (phi3)
 *   code/debug    → code   (deepseek-coder)
 *   complex query → fan-out: reason + mind + write (first wins)
 *   writing/docs  → write  (mistral)
 *
 * All responses flow through memory-core: AIOS learns from every interaction.
 *
 * Setup (one-time, on any machine with llama.cpp):
 *   # Build or install llama.cpp: https://github.com/ggerganov/llama.cpp
 *   # Download a GGUF model (e.g. llama3):
 *   #   huggingface-cli download Meta-Llama/Meta-Llama-3-8B-Instruct --include "*.gguf"
 *   # Start the server:
 *   llama-server -m llama3.gguf --port 8080
 *
 *   # To offload all compute to a home server/PC:
 *   export LLAMA_HOST=http://192.168.1.100:8080
 *
 * Terminal commands:
 *   mesh            — show agent status
 *   mesh status     — same as above
 *   mesh refresh    — re-discover which models are loaded
 *   mesh help       — show this help
 *
 * Zero external npm dependencies.
 */

const VERSION = '4.0.0';

// ---------------------------------------------------------------------------
// Agent definitions — order matters for routing (most-specific first)
// ---------------------------------------------------------------------------
const MESH_AGENTS = [
  {
    name:    'code',
    model:   'deepseek-coder:6.7b',
    role:    'Code Agent',
    keywords: ['code', 'function', 'class', 'bug', 'debug', 'fix', 'error',
               'script', 'program', 'javascript', 'python', 'bash', 'typescript',
               'implement', 'refactor', 'test', 'compile', 'syntax', 'algorithm'],
    systemPrompt:
      'You are an expert coding AI embedded in AIOS. ' +
      'Write clean, complete, working code with brief explanations. ' +
      'Always include the full implementation, not just a snippet.',
  },
  {
    name:    'reason',
    model:   'phi3',
    role:    'Reason Agent',
    keywords: ['why', 'how does', 'explain', 'analyze', 'analyse', 'understand',
               'cause', 'effect', 'reason', 'examine', 'investigate', 'diagnose',
               'trace', 'audit', 'inspect'],
    systemPrompt:
      'You are a deep reasoning AI embedded in AIOS. ' +
      'Provide thorough, insightful analysis. Trace causes and effects carefully.',
  },
  {
    name:    'write',
    model:   'mistral',
    role:    'Write Agent',
    keywords: ['write', 'summarize', 'summarise', 'summary', 'rephrase',
               'describe', 'essay', 'report', 'document', 'explain in simple',
               'tldr', 'brief', 'paraphrase'],
    systemPrompt:
      'You are a writing and explanation AI embedded in AIOS. ' +
      'Be clear, structured, and articulate. Adapt your level to the user.',
  },
  {
    name:    'logic',
    model:   'gemma:2b',
    role:    'Logic Agent',
    keywords: ['compare', 'difference', 'versus', 'vs ', 'pros and cons',
               'should i', 'which is better', 'trade-off', 'tradeoff',
               'if ', 'then ', 'step by step', 'how to'],
    systemPrompt:
      'You are a logical AI embedded in AIOS. ' +
      'Think step by step. Reason clearly and weigh options fairly.',
  },
  {
    name:    'mind',
    model:   'llama3',
    role:    'Mind Agent',
    keywords: ['complex', 'research', 'deep dive', 'comprehensive',
               'thoroughly', 'in depth', 'full analysis', 'everything about'],
    systemPrompt:
      'You are the powerful reasoning core of AIOS. ' +
      'Handle complex, multi-step questions with depth and precision.',
  },
  {
    name:    'chat',
    model:   'tinyllama',
    role:    'Chat Agent',
    keywords: ['hello', 'hey', 'how are', 'tell me', 'can you', 'please help',
               'hi ', 'what do you think', 'opinion', 'suggest'],
    systemPrompt:
      'You are a friendly AI assistant embedded in AIOS. ' +
      'Be helpful, warm, and concise. The user may be on a phone.',
  },
  {
    name:    'speed',
    model:   'qwen2:0.5b',
    role:    'Speed Agent',
    keywords: ['quick', 'fast', 'simple', 'what is', 'what are',
               'define ', 'when ', 'who is', 'where is'],
    systemPrompt:
      'You are a fast, concise AI embedded in AIOS. ' +
      'Give short, direct answers. One or two sentences is ideal.',
  },
];

// Agent names used for complex-query fan-out (deepest reasoning models)
const FAN_OUT_AGENTS = ['reason', 'mind', 'write'];

// ---------------------------------------------------------------------------
// Shared timeout helper (mirrors pattern in aios-aura.js)
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
// createRemoteMesh factory
// ---------------------------------------------------------------------------
function createRemoteMesh(kernel, memoryCore, collectiveIntelligence) {
  // llama.cpp base URL — override with LLAMA_HOST to offload to a home server/PC
  // OLLAMA_HOST is accepted as a legacy alias so existing configs keep working.
  const _llamaUrl = (process.env.LLAMA_HOST || process.env.OLLAMA_HOST || 'http://127.0.0.1:8080').replace(/\/$/, '');

  // Optional VFS reference — set via setFilesystem(vfs) after boot.
  // Currently stored for future use: runtime model customization by reading
  // /etc/aios/models.json allows users to add/swap models without code changes.
  // TODO: use _filesystem in _discoverModels() to override MESH_AGENTS from VFS.
  let _filesystem = null;

  // Agents confirmed available by Ollama: agentName → agent config
  const _available = new Map();

  // Discovery state — retry on explicit refresh, but don't hammer on every query
  let _discoveryDone = false;

  // Per-agent circuit breakers: name → { failures, tripped, trippedAt }
  const _breakers    = new Map();
  const CB_LIMIT     = 3;
  const CB_RESET_MS  = 5 * 60 * 1000; // 5 min

  // ── Circuit breaker helpers ────────────────────────────────────────────────
  function _isTripped(name) {
    const cb = _breakers.get(name);
    if (!cb || !cb.tripped) return false;
    if (Date.now() - cb.trippedAt > CB_RESET_MS) {
      cb.tripped = false;
      cb.failures = 0;
      return false;
    }
    return true;
  }

  function _fail(name) {
    let cb = _breakers.get(name);
    if (!cb) { cb = { failures: 0, tripped: false, trippedAt: 0 }; _breakers.set(name, cb); }
    cb.failures++;
    if (cb.failures >= CB_LIMIT) { cb.tripped = true; cb.trippedAt = Date.now(); }
  }

  function _succeed(name) {
    const cb = _breakers.get(name);
    if (cb) { cb.failures = 0; cb.tripped = false; }
  }

  // ── llama.cpp model discovery ─────────────────────────────────────────────
  async function _discoverModels() {
    _available.clear();
    try {
      const res = await _withTimeout(fetch(`${_llamaUrl}/v1/models`), 4000);
      if (!res.ok) return;
      const data = await res.json();
      const installed = new Set(
        (data.data || []).map(m => (m.id || '').split(':')[0].toLowerCase()),
      );
      for (const agent of MESH_AGENTS) {
        const base = agent.model.split(':')[0].toLowerCase();
        if (installed.has(base)) _available.set(agent.name, agent);
      }
    } catch (_) {
      // llama.cpp offline or unreachable — _available stays empty, graceful fallback
    }
    _discoveryDone = true;
  }

  // Only discover once per session; explicit `mesh refresh` resets the flag
  async function _ensureDiscovered() {
    if (!_discoveryDone) await _discoverModels();
  }

  // ── Single-agent query via llama.cpp /v1/chat/completions ────────────────
  async function _queryAgent(agent, prompt) {
    // Inject collective intelligence context so this model benefits from
    // everything all other models have previously learned about this topic
    let systemPrompt = agent.systemPrompt;
    if (collectiveIntelligence) {
      const ctx = collectiveIntelligence.context(prompt);
      if (ctx) systemPrompt = systemPrompt + '\n\n' + ctx;
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: prompt },
    ];
    const res = await _withTimeout(
      fetch(`${_llamaUrl}/v1/chat/completions`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ model: agent.model, messages, stream: false }),
      }),
      90000, // llama.cpp can be slow on first load — 90s timeout
    );
    if (!res.ok) throw new Error(`llama.cpp HTTP ${res.status}`);
    const data = await res.json();
    const text = data.choices && data.choices[0] && data.choices[0].message &&
                 data.choices[0].message.content
      ? data.choices[0].message.content.trim()
      : null;
    if (!text) throw new Error('Empty response from llama.cpp');
    return text;
  }

  // ── Smart routing — pick best agent for the prompt ────────────────────────
  // tried: Set of agent names already attempted in this query call
  function _pickAgent(prompt, tried) {
    const lower = prompt.toLowerCase();
    // Keyword match: try each agent in MESH_AGENTS order (most-specific first)
    for (const agent of MESH_AGENTS) {
      if (tried.has(agent.name) || _isTripped(agent.name) || !_available.has(agent.name)) continue;
      if (agent.keywords.some(kw => lower.includes(kw))) return agent;
    }
    // Fallback: first available non-tripped non-tried agent
    for (const agent of MESH_AGENTS) {
      if (!tried.has(agent.name) && !_isTripped(agent.name) && _available.has(agent.name)) return agent;
    }
    return null;
  }

  // ── Complexity check — routes to fan-out for deep queries ─────────────────
  function _isComplex(prompt) {
    return (
      prompt.length > 200 ||
      /\b(complex|research|deep dive|comprehensive|thoroughly|in depth|full analysis|everything about)\b/i.test(prompt)
    );
  }

  // ── Fan-out — query multiple agents in parallel, first success wins ────────
  async function _fanOut(prompt, agentNames) {
    const agents = agentNames
      .map(n => MESH_AGENTS.find(a => a.name === n))
      .filter(a => a && _available.has(a.name) && !_isTripped(a.name));
    if (!agents.length) return null;
    return new Promise((resolve) => {
      let settled = false;
      let errCount = 0;
      agents.forEach(agent => {
        _queryAgent(agent, prompt)
          .then(text => {
            _succeed(agent.name);
            if (!settled) { settled = true; resolve({ text, agentName: agent.name }); }
          })
          .catch(() => {
            _fail(agent.name);
            errCount++;
            if (errCount === agents.length && !settled) { settled = true; resolve(null); }
          });
      });
    });
  }

  // ── Main mesh query ────────────────────────────────────────────────────────
  // Registered as the `remote-mesh` backend in ai-core.
  // AIOS calls this after local NLP fails to match — all heavy thinking lands here.
  async function query(prompt) {
    await _ensureDiscovered();

    if (_available.size === 0) {
      throw new Error(
        'No mesh agents available. ' +
        'Run `llama-server -m <model.gguf>` and reload, then `mesh refresh`.',
      );
    }

    const tried = new Set();
    let result   = null;
    let usedAgent = null;

    // ── 1. Fan-out for complex queries ──────────────────────────────────────
    if (_isComplex(prompt)) {
      // Mark fan-out agents as tried so fallback chain skips them
      FAN_OUT_AGENTS
        .filter(n => _available.has(n) && !_isTripped(n))
        .forEach(n => tried.add(n));
      const fanResult = await _fanOut(prompt, FAN_OUT_AGENTS);
      if (fanResult) { result = fanResult.text; usedAgent = fanResult.agentName; }
    }

    // ── 2. Smart single-agent routing ───────────────────────────────────────
    if (!result) {
      const agent = _pickAgent(prompt, tried);
      if (agent) {
        tried.add(agent.name);
        try {
          result    = await _queryAgent(agent, prompt);
          usedAgent = agent.name;
          _succeed(agent.name);
        } catch (_) {
          _fail(agent.name);
        }
      }
    }

    // ── 3. Fallback chain — try remaining agents in order ───────────────────
    if (!result) {
      for (const agent of MESH_AGENTS) {
        if (tried.has(agent.name) || _isTripped(agent.name) || !_available.has(agent.name)) continue;
        tried.add(agent.name);
        try {
          result    = await _queryAgent(agent, prompt);
          usedAgent = agent.name;
          _succeed(agent.name);
          break;
        } catch (_) {
          _fail(agent.name);
        }
      }
    }

    if (!result) {
      throw new Error('All mesh agents failed. Check `llama-server` and `mesh status`.');
    }

    // ── 4. Contribute to collective intelligence ─────────────────────────────
    // Store this model's answer so ALL future queries — from any model or from
    // AIOS/AURA — can draw on what was learned here.
    if (collectiveIntelligence) {
      collectiveIntelligence.contribute(usedAgent, prompt, result);
    }

    // ── 5. Record into memory-core so AIOS learns from this interaction ──────
    if (memoryCore) {
      memoryCore.record('mesh', prompt, result, null);
    }

    if (kernel) {
      kernel.bus.emit('mesh:query', { agent: usedAgent, promptLen: prompt.length });
    }

    return result;
  }

  // ── registerWithAICore ─────────────────────────────────────────────────────
  // Registers the mesh as a single composite remote backend.
  // ai-core's complexity routing sends simple queries to local backends first,
  // and complex queries to remote (mesh) first — the mesh then routes internally.
  function registerWithAICore(aiCore) {
    aiCore.registerBackend('remote-mesh', { query }, { type: 'remote' });
  }

  // ── queryAll — fan out to ALL available agents, synthesize via collective ──
  // Used by AIOS/AURA for deeply important questions where maximum intelligence
  // is needed. All responses are stored in collective intelligence.
  async function queryAll(prompt) {
    await _ensureDiscovered();
    if (_available.size === 0) return null;

    const agents  = MESH_AGENTS.filter(a => _available.has(a.name) && !_isTripped(a.name));
    if (!agents.length) return null;

    const results = await Promise.allSettled(
      agents.map(a => _queryAgent(a, prompt).then(text => ({ model: a.name, response: text }))),
    );

    const perspectives = results
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => r.value);

    // Update circuit breakers and contribute each perspective
    results.forEach((r, i) => {
      if (r.status === 'fulfilled') {
        _succeed(agents[i].name);
        if (collectiveIntelligence) {
          collectiveIntelligence.contribute(agents[i].name, prompt, r.value.response);
        }
      } else {
        _fail(agents[i].name);
      }
    });

    if (!perspectives.length) return null;

    // Synthesize all perspectives into one combined answer
    const combined = collectiveIntelligence
      ? collectiveIntelligence.synthesize(perspectives)
      : perspectives[0].response;

    if (memoryCore) {
      memoryCore.record('mesh:all', prompt, combined, null);
    }

    if (kernel) {
      kernel.bus.emit('mesh:query-all', { count: perspectives.length, promptLen: prompt.length });
    }

    return combined;
  }

  // ── setCollectiveIntelligence — wire in after construction ────────────────
  function setCollectiveIntelligence(ci) {
    collectiveIntelligence = ci;
  }

  // ── Router commands ────────────────────────────────────────────────────────
  const commands = {
    mesh: async (args) => {
      const sub = (args || []).join(' ').trim().toLowerCase();

      // ── mesh / mesh status ───────────────────────────────────────────────
      if (!sub || sub === 'status') {
        await _discoverModels(); // always refresh for status display
        const lines = [
          `AI Mesh v${VERSION}  —  ${_available.size}/7 agents online`,
          `llama.cpp: ${_llamaUrl}`,
          '',
        ];
        for (const agent of MESH_AGENTS) {
          const avail   = _available.has(agent.name);
          const tripped = _isTripped(agent.name);
          const icon    = !avail ? '○' : tripped ? '✕' : '●';
          const state   = !avail ? 'offline' : tripped ? 'tripped' : 'online ';
          lines.push(
            `  ${icon} ${state}  ${agent.role.padEnd(14)} ${agent.model}`,
          );
        }
        lines.push('');
        if (_available.size < 7) {
          lines.push(
            'To add more agents: start llama-server with that model, then: mesh refresh',
          );
        }
        if (_llamaUrl.includes('127.0.0.1') || _llamaUrl.includes('localhost')) {
          lines.push(
            'Tip: export LLAMA_HOST=http://<home-server>:8080 to offload to a PC',
          );
        }
        return { status: 'ok', result: lines.join('\n') };
      }

      // ── mesh help ────────────────────────────────────────────────────────
      if (sub === 'help') {
        return {
          status: 'ok',
          result: [
            `AI Mesh v${VERSION}  —  7 open-source models acting as one brain`,
            '',
            'Commands:',
            '  mesh           — show agent status',
            '  mesh status    — same as above',
            '  mesh refresh   — re-discover models from llama-server',
            '  mesh help      — show this help',
            '',
            'Agents (all via llama.cpp — free, open-source, no API keys):',
            ...MESH_AGENTS.map(a =>
              `  ${a.name.padEnd(8)} ${a.model.padEnd(24)} ${a.role}`
            ),
            '',
            'Setup (download a GGUF and start llama-server):',
            '  # https://github.com/ggerganov/llama.cpp',
            '  llama-server -m llama3.gguf --port 8080',
            '  llama-server -m tinyllama.gguf --port 8081',
            '  llama-server -m phi3.gguf --port 8082',
            '  llama-server -m gemma-2b.gguf --port 8083',
            '  llama-server -m deepseek-coder-6.7b.gguf --port 8084',
            '  llama-server -m mistral-7b.gguf --port 8085',
            '',
            'Offload all compute to a home server/PC (phone stays light):',
            '  export LLAMA_HOST=http://192.168.1.100:8080',
          ].join('\n'),
        };
      }

      // ── mesh refresh ─────────────────────────────────────────────────────
      if (sub === 'refresh') {
        _discoveryDone = false;
        await _discoverModels();
        return {
          status: 'ok',
          result: `Refreshed: ${_available.size}/7 agents online. (llama.cpp: ${_llamaUrl})`,
        };
      }

      return {
        status: 'error',
        result: `Unknown mesh command: "${sub}". Try: mesh help`,
      };
    },
  };

  // ── status() — for kernel module introspection ─────────────────────────────
  function status() {
    return {
      name:       'remote-mesh',
      version:    VERSION,
      llamaHost: _llamaUrl,
      agents:     MESH_AGENTS.map(a => ({
        name:      a.name,
        model:     a.model,
        role:      a.role,
        available: _available.has(a.name),
        tripped:   _isTripped(a.name),
      })),
    };
  }

  // ── setMemoryCore — wire in later, matching ai-core.js pattern ────────────
  function setMemoryCore(mc) {
    memoryCore = mc;
  }

  // ── setFilesystem — wire VFS in after boot (for /etc/aios/models.json) ───
  function setFilesystem(fs) {
    _filesystem = fs;
  }

  return {
    name:    'remote-mesh',
    version: VERSION,
    query,
    queryAll,
    registerWithAICore,
    setMemoryCore,
    setCollectiveIntelligence,
    setFilesystem,
    status,
    commands,
  };
}

module.exports = { createRemoteMesh };
