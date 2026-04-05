'use strict';
/**
 * mode-manager.js — AIOS Mode Manager v1.0.0
 *
 * Manages the active operating mode for the AIOS session.
 *
 * Supported modes:
 *   chat  — general conversational AI interaction
 *   code  — coding assistance, generation, and review
 *   fix   — debugging, error diagnosis, and patching
 *   help  — documentation, command hints, and how-to guidance
 *   learn — active learning and knowledge capture
 *
 * Zero external npm dependencies.
 */

const MODE_MANAGER_VERSION = '1.0.0';

const MODES = Object.freeze({
  chat:  { name: 'chat',  label: 'Chat',  description: 'General conversational AI interaction' },
  code:  { name: 'code',  label: 'Code',  description: 'Coding assistance, generation, and review' },
  fix:   { name: 'fix',   label: 'Fix',   description: 'Debugging, error diagnosis, and patching' },
  help:  { name: 'help',  label: 'Help',  description: 'Documentation, command hints, and how-to guidance' },
  learn: { name: 'learn', label: 'Learn', description: 'Active learning and knowledge capture' },
});

const DEFAULT_MODE = 'chat';

// ---------------------------------------------------------------------------
// createModeManager
// ---------------------------------------------------------------------------
/**
 * @param {object} kernel         - AIOS kernel instance
 * @param {object} [memoryEngine] - optional memory engine (records mode switches)
 * @param {object} [opts]
 * @param {string} [opts.defaultMode] - starting mode (default: 'chat')
 */
function createModeManager(kernel, memoryEngine, opts = {}) {
  const startMode = (opts.defaultMode && MODES[opts.defaultMode])
    ? opts.defaultMode
    : DEFAULT_MODE;

  let _currentMode = startMode;
  const _history   = [];   // { ts, from, to }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function _now() { return new Date().toISOString(); }

  function _record(from, to) {
    _history.push({ ts: _now(), from, to });
    if (_history.length > 500) _history.splice(0, _history.length - 500);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** Get the current mode name */
  function getMode() { return _currentMode; }

  /** Get full mode descriptor for the current mode */
  function getModeInfo() { return Object.assign({}, MODES[_currentMode]); }

  /** List all available modes */
  function listModes() {
    return Object.values(MODES).map(m => Object.assign({}, m));
  }

  /**
   * Switch to a new mode.
   * @param {string} modeName
   * @returns {{ ok: boolean, mode?: string, error?: string }}
   */
  function setMode(modeName) {
    const key = String(modeName || '').toLowerCase().trim();
    if (!MODES[key]) {
      return { ok: false, error: `Unknown mode "${key}". Valid: ${Object.keys(MODES).join(', ')}` };
    }
    const prev = _currentMode;
    _currentMode = key;
    _record(prev, key);

    if (kernel && kernel.bus) {
      kernel.bus.emit('mode:changed', { from: prev, to: key });
    }
    if (memoryEngine) {
      memoryEngine.learn('mode-switch', { from: prev, to: key }, 1.0);
    }
    return { ok: true, mode: key };
  }

  /** Mode-switch history (most recent first) */
  function getHistory(limit = 20) {
    return _history.slice(-limit).reverse();
  }

  // ── Router command interface ───────────────────────────────────────────────
  function dispatch(args) {
    const sub = (args[0] || '').toLowerCase().trim();

    if (!sub || sub === 'status') {
      const info = getModeInfo();
      return {
        status: 'ok',
        result: `Mode Manager v${MODE_MANAGER_VERSION}\n  Current mode : ${info.label}\n  Description  : ${info.description}`,
      };
    }

    if (sub === 'list') {
      const lines = listModes().map(m =>
        `  ${m.name === _currentMode ? '▶' : ' '} ${m.label.padEnd(6)}  — ${m.description}`
      );
      return { status: 'ok', result: ['Available modes:', ...lines].join('\n') };
    }

    if (sub === 'history') {
      const hist = getHistory(parseInt(args[1], 10) || 10);
      if (!hist.length) return { status: 'ok', result: 'No mode switches recorded.' };
      const lines = hist.map(h => `[${h.ts.slice(11, 19)}] ${h.from} → ${h.to}`);
      return { status: 'ok', result: lines.join('\n') };
    }

    // Attempt to switch mode
    const r = setMode(sub);
    if (r.ok) {
      const info = MODES[r.mode];
      return { status: 'ok', result: `Mode switched to "${info.label}" — ${info.description}` };
    }
    return { status: 'error', result: r.error };
  }

  return {
    name:    'mode-manager',
    version: MODE_MANAGER_VERSION,
    MODES,
    // Core API
    getMode,
    getModeInfo,
    listModes,
    setMode,
    getHistory,
    // Router integration
    commands: { mode: dispatch },
  };
}

module.exports = { createModeManager, MODES };
