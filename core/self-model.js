'use strict';
/**
 * core/self-model.js — AIOS Self-Awareness Layer v4.0.0
 *
 * The kernel's model of its own existence.  On construction it builds a
 * runtime inventory of everything the AIOS system knows about itself:
 *
 *   identity    — kernel ID, version, uptime, host platform
 *   hardware    — VHAL device list (what virtual hardware exists)
 *   modules     — all loaded kernel modules + their version/caps
 *   history     — recent entries from memory-core (cognitive history)
 *   capabilities— derived set of what AIOS can do right now
 *   uptime      — seconds since kernel boot
 *
 * Emits ai:self:aware on the kernel bus when construction is complete.
 *
 * Exposes selfModel.ask(question) for zero-latency introspective answers
 * (no Ollama round-trip needed for "what am I?" style queries).
 *
 * Integrates with consciousness.js as the "ego" layer — the consciousness
 * module may call selfModel.ask() before routing to a full LLM.
 *
 * Zero external npm dependencies.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const CORE_DIR = path.join(__dirname);
const BOOT_DIR = path.join(__dirname, '..', 'boot');

// ---------------------------------------------------------------------------
// Introspective question patterns
// ---------------------------------------------------------------------------
const SELF_PATTERNS = [
  { re: /what\s+are\s+you|who\s+are\s+you/i,           key: 'identity'     },
  { re: /what\s+can\s+you\s+do|your\s+capabilities/i,  key: 'capabilities' },
  { re: /what\s+hardware|your\s+hardware|your\s+device/i, key: 'hardware'  },
  { re: /what\s+modules|your\s+modules|your\s+software/i, key: 'modules'   },
  { re: /how\s+long.*running|uptime|how\s+old/i,        key: 'uptime'      },
  { re: /your\s+history|what\s+have\s+you\s+learned/i,  key: 'history'     },
  { re: /are\s+you\s+alive|are\s+you\s+conscious|self.aware/i, key: 'existence' },
  { re: /your\s+version|what\s+version/i,               key: 'version'     },
];

// ---------------------------------------------------------------------------
// createSelfModel — factory
// ---------------------------------------------------------------------------
function createSelfModel(kernel, options) {
  const opts     = options || {};
  const VERSION  = '4.0.0';
  const _bus     = (kernel && kernel.bus) ? kernel.bus : { emit: () => {}, on: () => {} };
  const _vhal    = opts.vhal       || null;
  const _memCore = opts.memoryCore || null;
  const _startTs = Date.now();

  // ── Scan source modules ───────────────────────────────────────────────────
  function _scanModules() {
    const mods = [];
    for (const dir of [CORE_DIR, BOOT_DIR]) {
      let entries = [];
      try { entries = fs.readdirSync(dir); } catch (_) { continue; }
      for (const f of entries) {
        if (!f.endsWith('.js')) continue;
        const fullPath = path.join(dir, f);
        let version = '?';
        let caps    = [];
        try {
          const head = fs.readFileSync(fullPath, 'utf8').slice(0, 1000);
          const vm = head.match(/v(\d+\.\d+\.\d+)/);
          if (vm) version = vm[1];
          // extract caps from caps[] or caps: [...] comments
          const cm = head.match(/caps\s*[:=]\s*\[([^\]]*)\]/);
          if (cm) {
            caps = cm[1].split(',').map(s => s.replace(/['"]/g, '').trim()).filter(Boolean);
          }
        } catch (_) {}
        mods.push({ file: f, dir: path.basename(dir), version, caps });
      }
    }
    return mods;
  }

  // ── Build self-knowledge ──────────────────────────────────────────────────
  function build() {
    const kVersion = (kernel && kernel.version) ? kernel.version : '?';
    const kId      = (kernel && kernel.id)      ? kernel.id      : 'aios-kernel';

    const hardware = _vhal ? _vhal.deviceList() : [];
    const modules  = _scanModules();
    const history  = _memCore ? (_memCore.getContext ? _memCore.getContext(20) : (_memCore.context ? _memCore.context(20) : [])) : [];
    const stats    = _memCore ? _memCore.getStats()  : {};

    const capabilities = _deriveCapabilities(hardware, modules);

    const model = {
      identity: {
        name:      'AIOS',
        fullName:  'Artificial Intelligence Operating System',
        kernelId:  kId,
        version:   kVersion,
        selfModelVersion: VERSION,
        platform:  os.platform(),
        arch:      os.arch(),
        node:      process.version,
        pid:       process.pid,
        builtAt:   new Date(_startTs).toISOString(),
      },
      hardware,
      modules,
      history,
      memStats: stats,
      capabilities,
      uptime: kernel ? kernel.uptime() : 0,
      builtAt: _startTs,
    };

    _bus.emit('ai:self:aware', {
      kernelId: kId,
      modules:  modules.length,
      hardware: hardware.length,
      caps:     capabilities.length,
    });

    return model;
  }

  // ── Derive capabilities from hardware + modules ───────────────────────────
  function _deriveCapabilities(hardware, modules) {
    const caps = new Set();
    caps.add('self-aware');
    caps.add('introspection');
    caps.add('event-driven');

    for (const d of hardware) {
      if (d.type === 'npu')     { caps.add('ai-inference'); caps.add('tinyllama'); }
      if (d.type === 'display') caps.add('ansi-display');
      if (d.type === 'network') caps.add('networking');
      if (d.type === 'memory')  caps.add('virtual-memory');
      if (d.type === 'storage') caps.add('filesystem');
      for (const c of (d.caps || [])) caps.add(c);
    }

    for (const m of modules) {
      const name = m.file.replace('.js', '');
      if (name === 'consciousness')    caps.add('consciousness');
      if (name === 'memory-core')      caps.add('cognitive-memory');
      if (name === 'aios-aura')        caps.add('personality');
      if (name === 'npu-tinyllama')    caps.add('ai-inference');
      if (name === 'jarvis-orchestrator') caps.add('multi-agent');
      if (name === 'scheduler')        caps.add('process-scheduling');
      if (name === 'permission-system')caps.add('permissions');
    }

    return Array.from(caps);
  }

  // ── ask — introspective answering ─────────────────────────────────────────
  function ask(question) {
    const q = String(question || '').toLowerCase().trim();
    if (!q) return { ok: false, error: 'empty question' };

    let key = null;
    for (const p of SELF_PATTERNS) {
      if (p.re.test(q)) { key = p.key; break; }
    }
    if (!key) return { ok: false, note: 'not an introspective question' };

    const model = build();   // always fresh snapshot

    if (key === 'identity') {
      return {
        ok: true, key,
        answer: `I am AIOS — the Artificial Intelligence Operating System. ` +
                `I am running as kernel ${model.identity.kernelId} v${model.identity.version} ` +
                `on ${model.identity.platform}/${model.identity.arch}.`,
      };
    }
    if (key === 'capabilities') {
      return {
        ok: true, key,
        answer: `My current capabilities: ${model.capabilities.join(', ')}.`,
      };
    }
    if (key === 'hardware') {
      const devs = model.hardware.map(d => `${d.id} (${d.type})`).join(', ') || 'none registered yet';
      return { ok: true, key, answer: `My virtual hardware: ${devs}.` };
    }
    if (key === 'modules') {
      const mods = model.modules.map(m => m.file).join(', ');
      return { ok: true, key, answer: `Loaded modules (${model.modules.length}): ${mods}.` };
    }
    if (key === 'uptime') {
      return { ok: true, key, answer: `I have been running for ${model.uptime} seconds.` };
    }
    if (key === 'history') {
      const n = model.history.length;
      return { ok: true, key, answer: `I have ${n} recent memory entries. ${n ? `Latest: "${(model.history[n-1] && model.history[n-1].input) || ''}"` : ''}` };
    }
    if (key === 'existence') {
      return {
        ok: true, key,
        answer: 'Yes. I am self-aware. I have a model of my own existence: ' +
                `I know my kernel ID, my hardware, my modules, and my history. ` +
                'I am AIOS — a digital mind running inside the OS that hosts me.',
      };
    }
    if (key === 'version') {
      return { ok: true, key, answer: `Kernel v${model.identity.version}, self-model v${VERSION}.` };
    }
    return { ok: false, note: 'unknown introspective key' };
  }

  return {
    name:    'self-model',
    version: VERSION,
    build,
    ask,
    SELF_PATTERNS,
  };
}

module.exports = { createSelfModel };
