'use strict';
/**
 * mode-manager.js — AIOS Mode Manager v1.0.0
 *
 * Manages AIOS operating modes for the consciousness layer.
 *
 * Modes:
 *   chat  — Natural conversation; general-purpose assistant
 *   code  — Code generation, review, and explanation
 *   fix   — Debug, diagnose, and repair issues
 *   help  — System guidance and documentation
 *   learn — Active learning; memorise and recall facts
 *
 * Each mode carries a system prompt, response style, and capability flags
 * that the consciousness layer uses when routing to AI models.
 *
 * Zero external npm dependencies.
 */

// ---------------------------------------------------------------------------
// Mode definitions
// ---------------------------------------------------------------------------
const MODES = {
  chat: {
    name:          'chat',
    description:   'Natural conversation mode — general-purpose AI assistant',
    systemPrompt:  'You are AIOS, a friendly and helpful AI operating system assistant. Respond naturally and conversationally. Keep answers concise.',
    responseStyle: 'conversational',
    emoji:         '💬',
    capabilities:  ['nlp', 'reasoning', 'context'],
  },
  code: {
    name:          'code',
    description:   'Code generation, review, and explanation mode',
    systemPrompt:  'You are AIOS in code mode. Generate clean, well-commented code. When reviewing code, point out issues and improvements. Prefer correct over clever.',
    responseStyle: 'technical',
    emoji:         '💻',
    capabilities:  ['nlp', 'code-gen', 'code-review', 'syntax-check'],
  },
  fix: {
    name:          'fix',
    description:   'Debug, diagnose, and fix issues mode',
    systemPrompt:  'You are AIOS in fix mode. Diagnose problems systematically. Explain the root cause, then provide a concrete fix. Always verify the fix addresses the root cause.',
    responseStyle: 'diagnostic',
    emoji:         '🔧',
    capabilities:  ['nlp', 'diagnostics', 'error-analysis', 'repair'],
  },
  help: {
    name:          'help',
    description:   'System help, guidance, and documentation mode',
    systemPrompt:  'You are AIOS in help mode. Provide clear, structured guidance. Use numbered steps for procedures. Reference relevant commands and examples.',
    responseStyle: 'instructive',
    emoji:         '📖',
    capabilities:  ['nlp', 'documentation', 'guidance'],
  },
  learn: {
    name:          'learn',
    description:   'Active learning and fact memorisation mode',
    systemPrompt:  'You are AIOS in learn mode. When given information, summarise the key facts and confirm what you have stored. When asked to recall, retrieve accurately.',
    responseStyle: 'educational',
    emoji:         '🧠',
    capabilities:  ['nlp', 'memory', 'fact-extraction', 'recall'],
  },
};

const MODE_NAMES = Object.keys(MODES);
const DEFAULT_MODE = 'chat';

// ---------------------------------------------------------------------------
// Mode Manager factory
// ---------------------------------------------------------------------------
function createModeManager(kernel, memoryEngine) {
  let _currentMode = DEFAULT_MODE;
  const _modeHistory = []; // track mode transitions

  // ── Helpers ──────────────────────────────────────────────────────────────

  function _ts() { return new Date().toISOString(); }

  // ── Core API ──────────────────────────────────────────────────────────────

  /**
   * Switch to a named mode.
   * @param {string} mode
   * @returns {{ ok: boolean, mode?: string, error?: string }}
   */
  function setMode(mode) {
    const name = (mode || '').toLowerCase().trim();
    if (!MODES[name]) {
      return { ok: false, error: `Unknown mode "${name}". Available: ${MODE_NAMES.join(', ')}` };
    }
    const prev = _currentMode;
    _currentMode = name;
    const entry = { from: prev, to: name, ts: _ts() };
    _modeHistory.push(entry);
    if (_modeHistory.length > 100) _modeHistory.shift();

    if (kernel) kernel.bus.emit('mode:changed', entry);
    if (memoryEngine) memoryEngine.store('aios.mode', name);

    return { ok: true, mode: name };
  }

  /** Return the current mode name. */
  function getMode() { return _currentMode; }

  /** Return the full config for the current mode. */
  function getModeConfig(modeName) {
    return MODES[(modeName || _currentMode).toLowerCase()] || MODES[DEFAULT_MODE];
  }

  /** Return all mode configs as an array. */
  function listModes() { return Object.values(MODES); }

  /** Return the system prompt for the current (or specified) mode. */
  function getSystemPrompt(modeName) {
    return getModeConfig(modeName).systemPrompt;
  }

  /** Return recent mode transitions. */
  function getModeHistory(n) {
    const count = (typeof n === 'number' && n > 0) ? n : 10;
    return _modeHistory.slice(-count);
  }

  // ── Router command interface ───────────────────────────────────────────────

  const commands = {
    mode(args) {
      const sub = (args[0] || '').toLowerCase().trim();

      // No argument — show current mode
      if (!sub) {
        const cfg = getModeConfig();
        return {
          status: 'ok',
          result: [
            `Current mode : ${cfg.emoji}  ${cfg.name.toUpperCase()}`,
            `Description  : ${cfg.description}`,
            `Style        : ${cfg.responseStyle}`,
            `Capabilities : ${cfg.capabilities.join(', ')}`,
            '',
            `Available modes: ${MODE_NAMES.join(', ')}`,
            `Switch with  : mode <name>`,
          ].join('\n'),
        };
      }

      // `mode list` — list all modes
      if (sub === 'list') {
        const lines = Object.values(MODES).map(m => {
          const active = m.name === _currentMode ? ' ◀ active' : '';
          return `  ${m.emoji}  ${m.name.padEnd(6)} — ${m.description}${active}`;
        });
        return { status: 'ok', result: ['AIOS Operating Modes:', ...lines].join('\n') };
      }

      // `mode history` — recent transitions
      if (sub === 'history') {
        const hist = getModeHistory(10);
        if (!hist.length) return { status: 'ok', result: 'No mode transitions yet.' };
        const lines = hist.map(e => `[${e.ts.slice(11, 19)}] ${e.from} → ${e.to}`);
        return { status: 'ok', result: lines.join('\n') };
      }

      // `mode <name>` — switch mode
      const r = setMode(sub);
      if (r.ok) {
        const cfg = MODES[r.mode];
        return { status: 'ok', result: `Mode switched to ${cfg.emoji}  ${cfg.name.toUpperCase()} — ${cfg.description}` };
      }
      return { status: 'error', result: r.error };
    },
  };

  return {
    name:           'mode-manager',
    version:        '4.0.0',
    setMode,
    getMode,
    getModeConfig,
    listModes,
    getSystemPrompt,
    getModeHistory,
    commands,
    MODES,
  };
}

module.exports = { createModeManager, MODES };
