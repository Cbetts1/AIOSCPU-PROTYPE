'use strict';
/**
 * ai-core.js — AIOS AI Core v4.0.0
 *
 * The AI brain of AIOS Lite. Operates the OS, responds to natural language,
 * monitors system health, and can take autonomous corrective action.
 *
 * Features:
 *   - Built-in NLP pattern matcher (zero external deps, works fully offline)
 *   - Multi-backend LLM routing (ollama / llama.cpp / OpenAI-compatible)
 *   - Query complexity classifier: simple → local NLP, complex → remote LLM
 *   - Dynamic model wake-up when queries arrive (supports wake() on backends)
 *   - Circuit breaker per backend — failures never crash AIOS
 *   - Proactive suggestions and autonomous corrections without explicit commands
 *   - Persistent context and interaction learning via AIOS VFS
 *   - Autonomous monitoring loop (watches kernel event bus)
 *   - Can issue any AIOS command through the router
 *   - Decision log with reasoning trail
 *   - `ai <text>`, `ai status`, `ai log`, `ai monitor on/off` terminal commands
 *
 * Zero external npm dependencies.
 */

// ---------------------------------------------------------------------------
// Built-in NLP intent patterns
// ---------------------------------------------------------------------------
// Each pattern: { re, intent, extract }
// extract(match, raw) → { intent, params }
const PATTERNS = [
  // Filesystem
  { re: /^(show|list|ls)\s+(files?|dir(?:ectory)?|folder)\s*(?:in|at|of)?\s*(.*)$/i,
    intent: 'fs:ls', extract: (m) => ({ path: m[3].trim() || '.' }) },
  { re: /^(read|cat|open|print)\s+(?:file\s+)?(.+)$/i,
    intent: 'fs:read', extract: (m) => ({ path: m[2].trim() }) },
  { re: /^(create|make|touch)\s+(?:a\s+)?(?:file\s+)?(.+)$/i,
    intent: 'fs:touch', extract: (m) => ({ path: m[2].trim() }) },
  { re: /^(delete|remove|rm)\s+(?:file\s+)?(.+)$/i,
    intent: 'fs:rm', extract: (m) => ({ path: m[2].trim() }) },
  { re: /^(write|save)\s+"?(.+?)"?\s+to\s+(.+)$/i,
    intent: 'fs:write', extract: (m) => ({ content: m[2].trim(), path: m[3].trim() }) },
  { re: /^go\s+(?:to|into)\s+(.+)$/i,
    intent: 'fs:cd', extract: (m) => ({ path: m[1].trim() }) },
  { re: /^where\s+am\s+i/i,
    intent: 'fs:pwd', extract: () => ({}) },

  // System info
  { re: /^(show|what(?:'s)?|get|check)\s+(?:the\s+)?(?:system\s+)?info(?:rmation)?/i,
    intent: 'sys:info', extract: () => ({}) },
  { re: /^(show|what(?:'s)?|get|check)\s+(?:the\s+)?(?:disk|storage|space)\s*(?:usage|info)?/i,
    intent: 'sys:disk', extract: () => ({}) },
  { re: /^(show|what(?:'s)?|get|check)\s+(?:the\s+)?(?:memory|ram|mem)\s*(?:usage|info)?/i,
    intent: 'sys:mem', extract: () => ({}) },
  { re: /^(show|what(?:'s)?|get|check)\s+(?:the\s+)?(?:network|net|ip)\s*(?:info|interfaces?)?/i,
    intent: 'sys:net', extract: () => ({}) },
  { re: /^(show|list|get)\s+(?:running\s+)?processes?/i,
    intent: 'sys:ps', extract: () => ({}) },
  { re: /^how\s+long\s+(?:has\s+(?:it|the\s+os)\s+been\s+)?(?:running|up)/i,
    intent: 'sys:uptime', extract: () => ({}) },

  // Services
  { re: /^(start|run|launch|enable)\s+(?:service\s+|svc\s+)?(.+)$/i,
    intent: 'svc:start', extract: (m) => ({ name: m[2].trim() }) },
  { re: /^(stop|kill|disable|halt)\s+(?:service\s+|svc\s+)?(.+)$/i,
    intent: 'svc:stop', extract: (m) => ({ name: m[2].trim() }) },
  { re: /^(restart|reload)\s+(?:service\s+|svc\s+)?(.+)$/i,
    intent: 'svc:restart', extract: (m) => ({ name: m[2].trim() }) },
  { re: /^(show|list|get|check)\s+(?:all\s+)?services?/i,
    intent: 'svc:list', extract: () => ({}) },

  // CPU
  { re: /^run\s+(?:the\s+)?cpu\s+demo/i,
    intent: 'cpu:demo', extract: () => ({}) },
  { re: /^(show|get|check)\s+cpu\s+(?:info|status|state)/i,
    intent: 'cpu:info', extract: () => ({}) },

  // Shell
  { re: /^(?:run|execute|exec)\s+(?:shell\s+(?:command\s+)?|command\s+)(.+)$/i,
    intent: 'shell:exec', extract: (m) => ({ cmd: m[1].trim() }) },

  // Mirror
  { re: /^(?:mount|mirror|connect)\s+(?:the\s+)?(?:host\s+)?(?:filesystem|root|\/)/i,
    intent: 'mirror:root', extract: () => ({}) },
  { re: /^(?:mount|mirror)\s+(proc|processes?)/i,
    intent: 'mirror:proc', extract: () => ({}) },
  { re: /^(?:mount|mirror)\s+storage/i,
    intent: 'mirror:storage', extract: () => ({}) },
  { re: /^(?:list|show)\s+(?:active\s+)?mirrors?/i,
    intent: 'mirror:list', extract: () => ({}) },

  // Privileges
  { re: /^(?:become|switch\s+to|su)\s+(root|admin|operator|user)/i,
    intent: 'perm:su', extract: (m) => ({ level: m[1] }) },
  { re: /^(?:show\s+)?(?:my\s+)?(?:permissions?|capabilities?|privs?)/i,
    intent: 'perm:caps', extract: () => ({}) },

  // Help / meta
  { re: /^what\s+can\s+you\s+do/i,
    intent: 'ai:help', extract: () => ({}) },
  { re: /^(?:hello|hi|hey)\b/i,
    intent: 'ai:greet', extract: () => ({}) },
  { re: /^(?:thanks?|thank\s+you)/i,
    intent: 'ai:thanks', extract: () => ({}) },
  { re: /^(?:who|what)\s+are\s+you/i,
    intent: 'ai:identity', extract: () => ({}) },
  { re: /^(?:ai\s+)?(?:help|status|log|monitor)/i,
    intent: 'ai:meta', extract: (_, raw) => ({ raw }) },
];

// ---------------------------------------------------------------------------
// Intent → AIOS router command mapping
// ---------------------------------------------------------------------------
function _intentToCommand(intent, params) {
  switch (intent) {
    case 'fs:ls':      return `ls ${params.path || '.'}`;
    case 'fs:read':    return `cat ${params.path}`;
    case 'fs:touch':   return `touch ${params.path}`;
    case 'fs:rm':      return `rm ${params.path}`;
    case 'fs:write':   return `write ${params.path} ${params.content}`;
    case 'fs:cd':      return `cd ${params.path}`;
    case 'fs:pwd':     return 'pwd';
    case 'sys:info':   return 'sysinfo';
    case 'sys:disk':   return 'df';
    case 'sys:mem':    return 'free';
    case 'sys:net':    return 'ifconfig';
    case 'sys:ps':     return 'ps';
    case 'sys:uptime': return 'uptime';
    case 'svc:start':  return `svc start ${params.name}`;
    case 'svc:stop':   return `svc stop ${params.name}`;
    case 'svc:restart':return `svc restart ${params.name}`;
    case 'svc:list':   return 'svc list';
    case 'cpu:demo':   return 'cpu demo';
    case 'cpu:info':   return 'cpu info';
    case 'shell:exec': return `shell ${params.cmd}`;
    case 'mirror:root':return 'mirror root';
    case 'mirror:proc':return 'mirror proc';
    case 'mirror:storage': return 'mirror storage';
    case 'mirror:list':return 'mirror list';
    case 'perm:su':    return `su ${params.level}`;
    case 'perm:caps':  return 'capabilities';
    default:           return null;
  }
}

// ---------------------------------------------------------------------------
// NLP parser — match input to intent
// ---------------------------------------------------------------------------
function _parse(input) {
  const text = input.trim();
  for (const p of PATTERNS) {
    const m = text.match(p.re);
    if (m) {
      return { intent: p.intent, params: p.extract(m, text), raw: text };
    }
  }
  return { intent: 'unknown', params: {}, raw: text };
}

// ---------------------------------------------------------------------------
// Query complexity classifier
// ---------------------------------------------------------------------------
// Returns 'simple' for short, pattern-matchable queries; 'complex' otherwise.
// Simple queries are routed to local NLP without waking a remote model.
function _classifyComplexity(text, parsedIntent) {
  if (parsedIntent && parsedIntent !== 'unknown') return 'simple';
  if (text.length > 80) return 'complex';
  if (/\b(explain|analyz|compar|summar|describ|why|how does|what if|reason|help me understand)\b/i.test(text)) return 'complex';
  return 'simple';
}

// ---------------------------------------------------------------------------
// AI Core factory
// ---------------------------------------------------------------------------
// filesystem (optional 5th arg) enables persistent context and learning via VFS.
// memoryCore is an internal reference; wire via setMemoryCore() if needed.
function createAICore(kernel, router, svcMgr, hostBridge, filesystem) {
  const _decisionLog = [];
  let   _monitorActive = false;
  let   _monitorInterval = null;
  let   _stats = { queries: 0, resolved: 0, fallbacks: 0, autonomous: 0, suggestions: 0 };
  // Memory core — optional, used for consolidated decision recording and suggestions.
  // Defaults to null so all `if (memoryCore)` guards are safe without a wired instance.
  let   memoryCore = null;

  // Multi-backend registry: name → { name, query, wake, type ('local'|'remote') }
  const _backends = new Map();

  // Circuit breakers: name → { failures, lastFailure, tripped, trippedAt }
  const _circuitBreakers = new Map();

  // Interaction learning store: intent → { hits, misses }
  let _learningStore = {};

  // Pending proactive suggestions (last N)
  const _suggestions = [];

  // Optional health monitor reference
  let _healthMonitor = null;

  // ---------------------------------------------------------------------------
  // Circuit breaker helpers
  // ---------------------------------------------------------------------------
  const CB_FAILURE_THRESHOLD = 3;
  const CB_RESET_MS          = 5 * 60 * 1000; // 5 minutes

  function _isTripped(name) {
    const cb = _circuitBreakers.get(name);
    if (!cb || !cb.tripped) return false;
    if (Date.now() - cb.trippedAt > CB_RESET_MS) {
      cb.tripped  = false;
      cb.failures = 0;
      return false;
    }
    return true;
  }

  function _recordBackendSuccess(name) {
    const cb = _circuitBreakers.get(name);
    if (cb) { cb.failures = 0; cb.tripped = false; }
  }

  function _recordBackendFailure(name) {
    let cb = _circuitBreakers.get(name);
    if (!cb) {
      cb = { failures: 0, lastFailure: 0, tripped: false, trippedAt: 0 };
      _circuitBreakers.set(name, cb);
    }
    cb.failures++;
    cb.lastFailure = Date.now();
    if (cb.failures >= CB_FAILURE_THRESHOLD) {
      cb.tripped   = true;
      cb.trippedAt = Date.now();
      if (kernel) kernel.bus.emit('ai:backend-tripped', { name });
    }
  }

  // ---------------------------------------------------------------------------
  // _withTimeout — race a promise against a timeout; clears timer on resolution
  // ---------------------------------------------------------------------------
  function _withTimeout(promise, ms, message) {
    let timer = null;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  // ---------------------------------------------------------------------------
  // Dynamic model wake-up
  // ---------------------------------------------------------------------------
  async function _wakeModel(backend) {
    if (typeof backend.wake !== 'function') return true;
    try {
      await _withTimeout(backend.wake(), 10000, 'wake timeout');
      return true;
    } catch (_) {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Multi-backend query with complexity routing and circuit breaking
  // ---------------------------------------------------------------------------
  async function _queryBackends(prompt, complexity) {
    if (_backends.size === 0) return null;

    // Order: for simple queries prefer local backends; for complex prefer remote
    const ordered = Array.from(_backends.values()).sort((a, b) => {
      if (complexity === 'simple') {
        return (a.type === 'local' ? 0 : 1) - (b.type === 'local' ? 0 : 1);
      }
      return (a.type === 'remote' ? 0 : 1) - (b.type === 'remote' ? 0 : 1);
    });

    for (const backend of ordered) {
      if (_isTripped(backend.name)) continue;
      try {
        const awake = await _wakeModel(backend);
        if (!awake) { _recordBackendFailure(backend.name); continue; }

        const result = await _withTimeout(backend.query(prompt), 30000, 'query timeout');

        if (result) {
          _recordBackendSuccess(backend.name);
          return { result, backendName: backend.name };
        }
      } catch (_) {
        _recordBackendFailure(backend.name);
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Persistent context — save/load to AIOS VFS
  // ---------------------------------------------------------------------------
  const CONTEXT_PATH  = '/var/lib/aios/ai-context.json';
  const LEARNING_PATH = '/var/lib/aios/ai-learning.json';

  function _saveContext() {
    if (!filesystem) return;
    try {
      filesystem.mkdir('/var/lib/aios', { parents: true });
      const snapshot = {
        savedAt:     new Date().toISOString(),
        stats:       Object.assign({}, _stats),
        decisionLog: _decisionLog.slice(-50),
      };
      filesystem.write(CONTEXT_PATH, JSON.stringify(snapshot, null, 2));
    } catch (_) {}
  }

  function _loadContext() {
    if (!filesystem) return;
    try {
      const r = filesystem.read(CONTEXT_PATH);
      if (!r || !r.ok || !r.content) return;
      const snap = JSON.parse(r.content);
      if (snap.stats) {
        _stats.queries    += snap.stats.queries    || 0;
        _stats.resolved   += snap.stats.resolved   || 0;
        _stats.fallbacks  += snap.stats.fallbacks  || 0;
        _stats.autonomous += snap.stats.autonomous || 0;
      }
      if (Array.isArray(snap.decisionLog)) {
        snap.decisionLog.forEach(e => _decisionLog.push(e));
      }
    } catch (_) {}
  }

  // ---------------------------------------------------------------------------
  // Persistent learning — track per-intent outcome statistics
  // ---------------------------------------------------------------------------
  function _updateLearning(intent, success) {
    if (!intent || intent === 'unknown') return;
    if (!_learningStore[intent]) _learningStore[intent] = { hits: 0, misses: 0 };
    if (success) _learningStore[intent].hits++;
    else         _learningStore[intent].misses++;
    _saveLearning();
  }

  function _saveLearning() {
    if (!filesystem) return;
    try {
      filesystem.mkdir('/var/lib/aios', { parents: true });
      filesystem.write(LEARNING_PATH, JSON.stringify(_learningStore, null, 2));
    } catch (_) {}
  }

  function _loadLearning() {
    if (!filesystem) return;
    try {
      const r = filesystem.read(LEARNING_PATH);
      if (r && r.ok && r.content) _learningStore = JSON.parse(r.content);
    } catch (_) {}
  }

  // ---------------------------------------------------------------------------
  // Proactive suggestion helpers
  // ---------------------------------------------------------------------------
  function _addSuggestion(type, message, command) {
    _stats.suggestions++;
    const s = { ts: new Date().toISOString(), type, message, command: command || null };
    _suggestions.push(s);
    if (_suggestions.length > 20) _suggestions.shift();
    if (kernel) kernel.bus.emit('ai:suggestion', s);
  }

  // ---------------------------------------------------------------------------
  // Bootstrap — restore context and learning from VFS on startup
  // ---------------------------------------------------------------------------
  _loadContext();
  _loadLearning();

  function _log(type, input, result, reasoning) {
    const resultStr = typeof result === 'string' ? result.slice(0, 200) : String(result).slice(0, 200);
    const entry = {
      ts: new Date().toISOString(),
      type,
      input,
      result: resultStr,
      reasoning,
    };
    _decisionLog.push(entry);
    if (_decisionLog.length > 300) _decisionLog.shift();
    if (kernel) kernel.bus.emit('ai:decision', entry);
    // Record into unified memory core so all model outputs are consolidated
    if (memoryCore) {
      const isError = type === 'fallback' || type === 'error';
      memoryCore.record(type, input, resultStr, isError ? resultStr : null);
    }
  }

  // ---------------------------------------------------------------------------
  // process — main entry point: handle a natural language query
  // ---------------------------------------------------------------------------
  async function process(input) {
    _stats.queries++;
    const text = String(input || '').trim();
    if (!text) return { status: 'error', result: 'No input provided.' };

    // ── 1. Static responses for meta-intents ─────────────────────────────
    const lower = text.toLowerCase();

    if (lower === 'status' || lower === 'ai status') {
      const backendNames = Array.from(_backends.keys()).join(', ') || 'none';
      const tripped = Array.from(_backends.keys()).filter(n => _isTripped(n));
      return {
        status: 'ok',
        result: [
          `AI Core v3.0.0  —  AIOS AI Operating Agent`,
          `Monitor     : ${_monitorActive ? 'active' : 'inactive'}`,
          `Backends    : ${backendNames}${tripped.length ? ` (tripped: ${tripped.join(', ')})` : ''}`,
          `Queries     : ${_stats.queries}`,
          `Resolved    : ${_stats.resolved}`,
          `Fallbacks   : ${_stats.fallbacks}`,
          `Autonomous  : ${_stats.autonomous}`,
          `Suggestions : ${_stats.suggestions}`,
        ].join('\n'),
      };
    }

    if (lower === 'log' || lower === 'ai log') {
      if (!_decisionLog.length) return { status: 'ok', result: 'No AI decisions logged yet.' };
      const lines = _decisionLog.slice(-20).map(e =>
        `[${e.ts.slice(11, 19)}] ${e.type.padEnd(10)} ${e.input.slice(0, 40).padEnd(40)} → ${e.result.slice(0, 60)}`
      );
      return { status: 'ok', result: lines.join('\n') };
    }

    if (lower === 'help' || lower === 'ai help' || lower === 'what can you do') {
      return {
        status: 'ok',
        result: [
          'AIOS AI Operating Agent — I can understand natural language and operate the OS.',
          '',
          'Try saying things like:',
          '  ai list files in /etc',
          '  ai read /etc/os-release',
          '  ai show memory usage',
          '  ai start service kernel-watchdog',
          '  ai show running processes',
          '  ai run the cpu demo',
          '  ai mirror the host filesystem',
          '  ai what can you do',
          '',
          'Commands: ai <text>  |  ai status  |  ai log  |  ai monitor on/off',
        ].join('\n'),
      };
    }

    if (lower === 'monitor on') {
      startMonitor();
      return { status: 'ok', result: 'AI monitor started. Watching kernel events…' };
    }
    if (lower === 'monitor off') {
      stopMonitor();
      return { status: 'ok', result: 'AI monitor stopped.' };
    }

    // ── 2. NLP pattern match + complexity classification ─────────────────
    const parsed = _parse(text);
    const complexity = _classifyComplexity(text, parsed.intent !== 'unknown' ? parsed.intent : null);

    if (parsed.intent === 'ai:greet') {
      _stats.resolved++;
      _updateLearning('ai:greet', true);
      _log('nlp', text, 'greeting', 'static response');
      return { status: 'ok', result: 'Hello! I\'m AIOS AI — your operating system agent. Type `ai help` to see what I can do.' };
    }
    if (parsed.intent === 'ai:thanks') {
      _stats.resolved++;
      _updateLearning('ai:thanks', true);
      _log('nlp', text, 'thanks', 'static response');
      return { status: 'ok', result: 'You\'re welcome!' };
    }
    if (parsed.intent === 'ai:identity') {
      _stats.resolved++;
      _updateLearning('ai:identity', true);
      _log('nlp', text, 'identity', 'static response');
      return {
        status: 'ok',
        result: [
          'I am AIOS AI — the AI Operating Agent built into AIOS Lite.',
          'I understand natural language and can operate every part of the OS:',
          'filesystem, CPU, services, host shell, mirrors, and permissions.',
          'On a device with an LLM (ollama, llama.cpp), I can be even smarter.',
        ].join('\n'),
      };
    }

    // ── 3. Map intent → router command (local, simple path) ──────────────
    const cmd = _intentToCommand(parsed.intent, parsed.params);
    if (cmd && router) {
      _stats.resolved++;
      _updateLearning(parsed.intent, true);
      _log('nlp→cmd', text, cmd, `intent: ${parsed.intent}, complexity: ${complexity}`);
      const result = await router.handle(cmd, { fromAI: true });
      _saveContext();
      return result;
    }

    // ── 4. Route to backend(s) by complexity ─────────────────────────────
    // Complex queries go to remote/heavy models; simple unmatched go local first.
    const sysState = _buildSystemContext();
    const prompt   = `You are AIOS AI, an operating system agent.\nSystem: ${sysState}\nUser: "${text}"\nRespond concisely.`;
    const backendResult = await _queryBackends(prompt, complexity);
    if (backendResult) {
      _stats.resolved++;
      _updateLearning(parsed.intent, true);
      _log('backend', text, backendResult.result, `backend: ${backendResult.backendName}, complexity: ${complexity}`);
      _saveContext();
      return { status: 'ok', result: backendResult.result };
    }

    // ── 5. Fallback ───────────────────────────────────────────────────────
    _stats.fallbacks++;
    _updateLearning(parsed.intent, false);
    _log('fallback', text, 'unrecognised', `intent: ${parsed.intent}`);
    _saveContext();
    return {
      status:   'ok',
      fallback: true,
      result: [
        `I'm not sure how to handle: "${text}"`,
        '',
        'Try: ai help  — to see what I can do.',
        'Or connect an LLM backend for full natural language support:',
        '  ai.registerBackend(name, { type: "remote", query: async (prompt) => ... })',
      ].join('\n'),
    };
  }

  // ---------------------------------------------------------------------------
  // System context builder (for LLM prompt / monitoring)
  // ---------------------------------------------------------------------------
  function _buildSystemContext() {
    const lines = [];
    if (kernel) {
      lines.push(`uptime=${kernel.uptime()}s`);
      lines.push(`processes=${kernel.procs.list().length}`);
    }
    if (svcMgr) {
      const svcs = svcMgr.list();
      const failed = svcs.filter(s => s.state === 'failed');
      lines.push(`services=${svcs.length} (${failed.length} failed)`);
    }
    if (hostBridge) {
      const m = hostBridge.memInfo();
      if (m.ok) lines.push(`mem_free=${m.freeMB}MB/${m.totalMB}MB`);
    }
    return lines.join(' | ');
  }

  // ---------------------------------------------------------------------------
  // Autonomous monitoring loop — checks health and emits proactive suggestions
  // ---------------------------------------------------------------------------
  function _autonomousCheck() {
    if (!kernel) return;

    // Check for failed services and attempt restart
    if (svcMgr) {
      let svcs;
      try { svcs = svcMgr.list(); } catch (_) { svcs = []; }
      for (const svc of svcs) {
        if (svc.state === 'failed') {
          _stats.autonomous++;
          _log('autonomous', `service:${svc.name}`, 'restart', 'failed service detected');
          svcMgr.restart(svc.name).catch(() => {});
          kernel.syscall(1, [`[AI] Service "${svc.name}" failed — auto-restarting…`]);
          _addSuggestion('service:restart', `Service "${svc.name}" failed and was automatically restarted.`, `svc restart ${svc.name}`);
        }
      }

      // Proactively suggest: many stopped services
      const stopped = svcs.filter(s => s.state === 'stopped');
      if (stopped.length > 0 && stopped.length === svcs.length && svcs.length > 0) {
        _addSuggestion('service:all-stopped', `All ${svcs.length} registered services are stopped.`, 'svc list');
      }
    }

    // Memory warning + proactive suggestion
    if (hostBridge) {
      const m = hostBridge.memInfo();
      if (m.ok && m.freeMB < 50) {
        _log('autonomous', 'memory:low', `${m.freeMB}MB free`, 'low memory warning');
        kernel.bus.emit('ai:alert', { type: 'memory:low', freeMB: m.freeMB });
        _addSuggestion('memory:low', `Host memory is low: ${m.freeMB}MB free of ${m.totalMB}MB. Consider freeing resources.`, 'free');
      }
    }

    // Health monitor proactive suggestions
    if (_healthMonitor) {
      const report = _healthMonitor.report();
      for (const ep of report.endpoints) {
        if (ep.healthy === false) {
          _addSuggestion('endpoint:down', `Server endpoint "${ep.name}" (${ep.url}) is unreachable.`, 'health check');
        }
      }
      for (const p of report.ports) {
        if (p.active === false) {
          _addSuggestion('port:down', `Port ${p.port} on ${p.host} ("${p.name}") is not responding.`, 'health check');
        }
      }
    }

    // Tripped circuit breakers — proactive warning
    for (const [name] of _backends) {
      if (_isTripped(name)) {
        _addSuggestion('backend:tripped', `AI backend "${name}" is circuit-tripped (too many failures). Will auto-reset in 5 min.`, null);
      }
    }

    // Proactive suggestions — emit current memory-core suggestions on the kernel bus
    if (memoryCore && kernel) {
      const suggs = memoryCore.suggestions();
      if (suggs.length && !suggs[0].startsWith('No proactive')) {
        kernel.bus.emit('ai:suggestions', { suggestions: suggs });
      }
    }
  }

  function startMonitor(intervalMs) {
    if (_monitorActive) return;
    _monitorActive = true;
    const ms = intervalMs || 30000;
    _monitorInterval = setInterval(_autonomousCheck, ms);
    if (typeof _monitorInterval.unref === 'function') _monitorInterval.unref();

    // Also watch kernel event bus for real-time reaction
    if (kernel) {
      kernel.bus.on('service:failed', (data) => {
        _log('event', `service:failed:${data.name}`, 'queued-restart', 'event bus trigger');
        setTimeout(() => {
          if (svcMgr) svcMgr.restart(data.name).catch(() => {});
        }, 2000);
      });

      kernel.bus.on('kernel:exit', () => stopMonitor());
    }
  }

  function stopMonitor() {
    _monitorActive = false;
    if (_monitorInterval) {
      clearInterval(_monitorInterval);
      _monitorInterval = null;
    }
  }

  // ---------------------------------------------------------------------------
  // registerBackend — register a named LLM backend
  // opts.type: 'local' | 'remote' (default 'remote')
  // backend must have: { query: async (prompt) => string }
  // optionally:        { wake: async () => void }  — called before first query
  // ---------------------------------------------------------------------------
  function registerBackend(name, backend, opts) {
    if (!name || typeof name !== 'string') throw new TypeError('Backend name must be a non-empty string');
    if (!backend || typeof backend.query !== 'function') {
      throw new TypeError('Backend must have a query(prompt) async function');
    }
    const type = (opts && opts.type === 'local') ? 'local' : 'remote';
    _backends.set(name, Object.assign({}, backend, { name, type }));
    if (kernel) kernel.bus.emit('ai:backend-connected', { name, type });
  }

  // ---------------------------------------------------------------------------
  // setBackend — backward-compatible: registers as the 'default' remote backend
  // ---------------------------------------------------------------------------
  function setBackend(backend) {
    if (!backend || typeof backend.query !== 'function') {
      throw new TypeError('Backend must have a query(prompt) async function');
    }
    const name = (backend.name && typeof backend.name === 'string') ? backend.name : 'default';
    registerBackend(name, backend, { type: 'remote' });
  }

  // ---------------------------------------------------------------------------
  // setHealthMonitor — integrate a health-monitor instance for proactive checks
  // ---------------------------------------------------------------------------
  function setHealthMonitor(hm) {
    _healthMonitor = hm;
  }

  // ---------------------------------------------------------------------------
  // Router command module interface
  // ---------------------------------------------------------------------------
  const commands = {
    ai: async (args) => {
      const input = args.join(' ').trim();
      if (!input) {
        return {
          status: 'ok',
          result: 'Usage: ai <natural language command>  |  ai status  |  ai log  |  ai help',
        };
      }
      return process(input);
    },
  };

  return {
    name:             'ai-core',
    version:          '4.0.0',
    process,
    registerBackend,
    setBackend,
    setHealthMonitor,
    setMemoryCore:    (mc) => { memoryCore = mc; },
    startMonitor,
    stopMonitor,
    isMonitoring:     () => _monitorActive,
    stats:            () => Object.assign({}, _stats),
    decisionLog:      () => _decisionLog.slice(),
    suggestions:      () => _suggestions.slice(),
    learning:         () => Object.assign({}, _learningStore),
    saveContext:      _saveContext,
    commands,
  };
}

module.exports = { createAICore };
