'use strict';
/**
 * ai-core.js — AIOS AI Operating Agent v2.0.0
 *
 * The AI brain of AIOS Lite. Operates the OS, responds to natural language,
 * monitors system health, and can take autonomous corrective action.
 *
 * Features:
 *   - Built-in NLP pattern matcher (zero external deps, works fully offline)
 *   - Pluggable LLM backend interface (ollama / llama.cpp / OpenAI-compatible)
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
// Pluggable LLM backend interface
// ---------------------------------------------------------------------------
// Default: offline NLP only.
// To plug in a real LLM, call ai.setBackend({ query: async (prompt) => '...' })
let _llmBackend = null;

async function _queryLLM(prompt) {
  if (_llmBackend && typeof _llmBackend.query === 'function') {
    try {
      return await _llmBackend.query(prompt);
    } catch (e) {
      return null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// AI Core factory
// ---------------------------------------------------------------------------
function createAICore(kernel, router, svcMgr, hostBridge, memoryCore) {
  const _decisionLog = [];
  let   _monitorActive = false;
  let   _monitorInterval = null;
  let   _stats = { queries: 0, resolved: 0, fallbacks: 0, autonomous: 0 };

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
      return {
        status: 'ok',
        result: [
          `AI Core v2.0.0  —  AIOS AI Operating Agent`,
          `Monitor     : ${_monitorActive ? 'active' : 'inactive'}`,
          `LLM backend : ${_llmBackend ? 'connected' : 'offline NLP only'}`,
          `Queries     : ${_stats.queries}`,
          `Resolved    : ${_stats.resolved}`,
          `Fallbacks   : ${_stats.fallbacks}`,
          `Autonomous  : ${_stats.autonomous}`,
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

    // ── 2. NLP pattern match ──────────────────────────────────────────────
    const parsed = _parse(text);

    // Meta intents with static responses
    if (parsed.intent === 'ai:greet') {
      _stats.resolved++;
      _log('nlp', text, 'greeting', 'static response');
      return { status: 'ok', result: 'Hello! I\'m AIOS AI — your operating system agent. Type `ai help` to see what I can do.' };
    }
    if (parsed.intent === 'ai:thanks') {
      _stats.resolved++;
      _log('nlp', text, 'thanks', 'static response');
      return { status: 'ok', result: 'You\'re welcome!' };
    }
    if (parsed.intent === 'ai:identity') {
      _stats.resolved++;
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

    // ── 3. Map intent → router command ───────────────────────────────────
    const cmd = _intentToCommand(parsed.intent, parsed.params);
    if (cmd && router) {
      _stats.resolved++;
      _log('nlp→cmd', text, cmd, `intent: ${parsed.intent}`);
      const result = await router.handle(cmd, { fromAI: true });
      return result;
    }

    // ── 4. Try LLM backend (if configured) ───────────────────────────────
    const sysState = _buildSystemContext();
    const llmResult = await _queryLLM(
      `You are AIOS AI, an operating system agent. System state:\n${sysState}\nUser said: "${text}"\nRespond concisely.`
    );
    if (llmResult) {
      _stats.resolved++;
      _log('llm', text, llmResult, 'LLM backend');
      return { status: 'ok', result: llmResult };
    }

    // ── 5. Fallback ───────────────────────────────────────────────────────
    _stats.fallbacks++;
    _log('fallback', text, 'unrecognised', `intent: ${parsed.intent}`);
    return {
      status: 'ok',
      result: [
        `I'm not sure how to handle: "${text}"`,
        '',
        'Try: ai help  — to see what I can do.',
        'Or connect an LLM backend for full natural language support:',
        '  ai.setBackend({ query: async (prompt) => yourModel.complete(prompt) })',
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
  // Autonomous monitoring loop
  // ---------------------------------------------------------------------------
  function _autonomousCheck() {
    if (!kernel || !svcMgr) return;

    // Check for failed services and attempt restart
    const svcs = svcMgr.list();
    for (const svc of svcs) {
      if (svc.state === 'failed') {
        _stats.autonomous++;
        _log('autonomous', `service:${svc.name}`, 'restart', 'failed service detected');
        svcMgr.restart(svc.name).catch(() => {});
        if (kernel) {
          kernel.syscall(1, [`[AI] Service "${svc.name}" failed — auto-restarting…`]);
        }
      }
    }

    // Memory warning
    if (hostBridge) {
      const m = hostBridge.memInfo();
      if (m.ok && m.freeMB < 50) {
        _log('autonomous', 'memory:low', `${m.freeMB}MB free`, 'low memory warning');
        if (kernel) kernel.bus.emit('ai:alert', { type: 'memory:low', freeMB: m.freeMB });
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
  // setBackend — plug in a real LLM
  // ---------------------------------------------------------------------------
  function setBackend(backend) {
    if (!backend || typeof backend.query !== 'function') {
      throw new TypeError('Backend must have a query(prompt) async function');
    }
    _llmBackend = backend;
    if (kernel) kernel.bus.emit('ai:backend-connected', { name: backend.name || 'custom' });
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
    name:        'ai-core',
    version:     '2.0.0',
    process,
    setBackend,
    startMonitor,
    stopMonitor,
    isMonitoring:  () => _monitorActive,
    stats:         () => Object.assign({}, _stats),
    decisionLog:   () => _decisionLog.slice(),
    getMemoryStats: () => memoryCore ? memoryCore.getStats() : null,
    commands,
  };
}

module.exports = { createAICore };
