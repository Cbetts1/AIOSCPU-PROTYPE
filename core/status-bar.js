'use strict';
/**
 * status-bar.js — AIOS Status Bar v1.0.0
 *
 * Renders a compact, real-time status line showing:
 *   CPU% | MEM% | Uptime | Mode | Model | Network | Error indicator
 *
 * Pure Node.js CommonJS. Zero external dependencies.
 * ANSI colour output; degrades gracefully on non-TTY terminals.
 */

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------
const ANSI = process.stdout.isTTY !== false;
function c(code, text) { return ANSI ? `\x1b[${code}m${text}\x1b[0m` : text; }
const C = {
  bold:    t => c('1',     t),
  dim:     t => c('2',     t),
  red:     t => c('31',    t),
  green:   t => c('32',    t),
  yellow:  t => c('33',    t),
  blue:    t => c('34',    t),
  magenta: t => c('35',    t),
  cyan:    t => c('36',    t),
  white:   t => c('37',    t),
  bgBlue:  t => c('44',    t),
  bgBlack: t => c('40',    t),
  fgBlack: t => c('30',    t),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600)  / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}d${h}h${m}m`;
  if (h > 0) return `${h}h${m}m${s}s`;
  if (m > 0) return `${m}m${s}s`;
  return `${s}s`;
}

function fmtPct(value, warn = 70, crit = 90) {
  const pct = Math.min(100, Math.max(0, Math.round(value)));
  const str = `${pct}%`;
  if (pct >= crit) return C.red(C.bold(str));
  if (pct >= warn) return C.yellow(str);
  return C.green(str);
}

function bar(pct, width = 8) {
  const filled = Math.round((Math.min(100, Math.max(0, pct)) / 100) * width);
  const empty  = width - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

// ---------------------------------------------------------------------------
// StatusBar factory
// ---------------------------------------------------------------------------
function createStatusBar(kernel, options = {}) {
  const {
    refreshMs   = 5000,    // auto-refresh interval (0 = off)
    barWidth    = 6,       // progress-bar character width
    separator   = C.dim(' │ '),
  } = options;

  // Pluggable data providers — callers may inject live metrics
  let _cpuProvider    = null;   // () => 0..100
  let _memProvider    = null;   // () => { used, total }  (bytes)
  let _modeProvider   = null;   // () => string
  let _modelProvider  = null;   // () => string
  let _netProvider    = null;   // () => { up, down }  (bool flags)
  let _errorProvider  = null;   // () => string | null

  let _lastRender = '';
  let _timer      = null;
  let _running    = false;

  // ---------------------------------------------------------------------------
  // Data collection — uses providers when set, falls back to kernel/process
  // ---------------------------------------------------------------------------
  function _getCpu() {
    if (_cpuProvider) {
      try { return _cpuProvider(); } catch (_) {}
    }
    return 0;  // no real CPU measurement without a provider
  }

  function _getMem() {
    if (_memProvider) {
      try { return _memProvider(); } catch (_) {}
    }
    if (typeof process !== 'undefined' && process.memoryUsage) {
      const mu = process.memoryUsage();
      return { used: mu.heapUsed, total: mu.heapTotal };
    }
    return { used: 0, total: 1 };
  }

  function _getUptime() {
    return kernel ? kernel.uptime() : 0;
  }

  function _getMode() {
    if (_modeProvider) {
      try { return _modeProvider(); } catch (_) {}
    }
    return 'NORMAL';
  }

  function _getModel() {
    if (_modelProvider) {
      try { return _modelProvider(); } catch (_) {}
    }
    return 'offline';
  }

  function _getNet() {
    if (_netProvider) {
      try { return _netProvider(); } catch (_) {}
    }
    return { up: false, down: false };
  }

  function _getError() {
    if (_errorProvider) {
      try { return _errorProvider(); } catch (_) {}
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  function render() {
    const cpuPct = _getCpu();
    const mem    = _getMem();
    const memPct = mem.total > 0 ? (mem.used / mem.total) * 100 : 0;
    const uptime = _getUptime();
    const mode   = _getMode();
    const model  = _getModel();
    const net    = _getNet();
    const error  = _getError();

    const cpuBar  = bar(cpuPct,  barWidth);
    const memBar  = bar(memPct,  barWidth);
    const netIcon = net.up || net.down ? C.green('NET') : C.dim('NET');

    const parts = [
      `${C.cyan('CPU')} ${cpuBar} ${fmtPct(cpuPct)}`,
      `${C.cyan('MEM')} ${memBar} ${fmtPct(memPct, 60, 85)}`,
      `${C.cyan('UP')} ${C.white(fmtUptime(uptime))}`,
      `${C.cyan('MODE')} ${C.yellow(mode)}`,
      `${C.cyan('MODEL')} ${C.magenta(model.length > 16 ? model.slice(0, 14) + '..' : model)}`,
      netIcon,
    ];

    if (error) {
      parts.push(C.red(C.bold(`⚠ ${error}`)));
    }

    _lastRender = parts.join(separator);
    return _lastRender;
  }

  /** Return the last rendered status line (does not recompute). */
  function getLast() { return _lastRender || render(); }

  /** Print status bar to stdout on a single line. */
  function print() {
    const line = render();
    if (ANSI) {
      process.stdout.write(`\r${line}\r\n`);
    } else {
      process.stdout.write(line + '\n');
    }
  }

  /** Start auto-refresh timer. */
  function start() {
    if (_running || refreshMs <= 0) return;
    _running = true;
    _timer = setInterval(print, refreshMs);
    if (_timer.unref) _timer.unref();
    if (kernel && kernel.bus) kernel.bus.emit('status-bar:started', {});
  }

  /** Stop auto-refresh timer. */
  function stop() {
    if (!_running) return;
    if (_timer) { clearInterval(_timer); _timer = null; }
    _running = false;
    if (kernel && kernel.bus) kernel.bus.emit('status-bar:stopped', {});
  }

  // ---------------------------------------------------------------------------
  // Provider setters
  // ---------------------------------------------------------------------------
  function setCpuProvider(fn)   { if (typeof fn === 'function') _cpuProvider   = fn; }
  function setMemProvider(fn)   { if (typeof fn === 'function') _memProvider   = fn; }
  function setModeProvider(fn)  { if (typeof fn === 'function') _modeProvider  = fn; }
  function setModelProvider(fn) { if (typeof fn === 'function') _modelProvider = fn; }
  function setNetProvider(fn)   { if (typeof fn === 'function') _netProvider   = fn; }
  function setErrorProvider(fn) { if (typeof fn === 'function') _errorProvider = fn; }

  return {
    name:    'status-bar',
    version: '1.0.0',
    render,
    getLast,
    print,
    start,
    stop,
    isRunning: () => _running,
    // Provider registration
    setCpuProvider,
    setMemProvider,
    setModeProvider,
    setModelProvider,
    setNetProvider,
    setErrorProvider,
  };
}

module.exports = { createStatusBar };
