'use strict';
/**
 * boot-splash.js — AIOS Boot Splash v1.0.0
 *
 * Renders the AIOS boot splash screen:
 *   - High-contrast blue theme (bg blue / white text)
 *   - Retro Windows-95-style frame
 *   - AIOSCPU logo + version string
 *   - Boot log with toggle (show/hide)
 *
 * Pure Node.js CommonJS. Zero external dependencies.
 * ANSI colour output; degrades gracefully on non-TTY terminals.
 */

const ANSI = process.stdout.isTTY !== false;
function c(code, text) { return ANSI ? `\x1b[${code}m${text}\x1b[0m` : text; }

// ---------------------------------------------------------------------------
// Theme (high-contrast blue / white)
// ---------------------------------------------------------------------------
const T = {
  frame:   t => c('1;37;44', t),  // bold white on blue
  title:   t => c('1;33;44', t),  // bold yellow on blue
  logo:    t => c('1;36;44', t),  // bold cyan on blue
  text:    t => c('37;44',   t),  // white on blue
  dim:     t => c('2;37;44', t),  // dim white on blue
  ok:      t => c('1;32;44', t),  // bold green on blue
  warn:    t => c('1;33;44', t),  // bold yellow on blue
  err:     t => c('1;31;44', t),  // bold red on blue
  reset:   t => c('0',       t),
};

// ---------------------------------------------------------------------------
// Win-95 style border helpers  (frame width = 62 inner chars)
// ---------------------------------------------------------------------------
const W = 62;

function pad(text, width) {
  const raw = text.replace(/\x1b\[[0-9;]*m/g, '');  // strip ANSI for length calc
  const fill = Math.max(0, width - raw.length);
  return text + ' '.repeat(fill);
}

function frameLine(inner) {
  return T.frame('║') + T.text(pad(' ' + inner, W + 1)) + T.frame('║');
}
function frameBlank() {
  return T.frame('║') + T.text(' '.repeat(W + 1)) + T.frame('║');
}
function frameTop()    { return T.frame('╔' + '═'.repeat(W + 1) + '╗'); }
function frameSep()    { return T.frame('╠' + '═'.repeat(W + 1) + '╣'); }
function frameBottom() { return T.frame('╚' + '═'.repeat(W + 1) + '╝'); }

// ---------------------------------------------------------------------------
// Logo (ASCII art — 5 lines × 60 chars)
// ---------------------------------------------------------------------------
const LOGO_LINES = [
  ' ██████╗ ██╗ ██████╗ ███████╗ ██████╗ ██████╗ ██╗   ██╗',
  '██╔══██╗██║██╔═══██╗██╔════╝██╔════╝██╔══██╗██║   ██║',
  '███████║██║██║   ██║███████╗██║     ██████╔╝██║   ██║',
  '██╔══██║██║██║   ██║╚════██║██║     ██╔═══╝ ██║   ██║',
  '██║  ██║██║╚██████╔╝███████║╚██████╗██║     ╚██████╔╝',
  '╚═╝  ╚═╝╚═╝ ╚═════╝ ╚══════╝ ╚═════╝╚═╝      ╚═════╝ ',
];

// ---------------------------------------------------------------------------
// Boot splash factory
// ---------------------------------------------------------------------------
function createBootSplash(options = {}) {
  const {
    version      = '1.0.0',
    showBootLog  = false,
  } = options;

  let _bootLog     = [];
  let _logVisible  = showBootLog;
  let _splashShown = false;

  // ---------------------------------------------------------------------------
  // Log entries
  // ---------------------------------------------------------------------------
  function log(message, level = 'info') {
    const ts = new Date().toISOString().slice(11, 23); // HH:MM:SS.mmm
    _bootLog.push({ ts, message, level });
    if (_logVisible) _printLogLine(_bootLog[_bootLog.length - 1]);
  }

  function _printLogLine(entry) {
    const icon  = entry.level === 'ok'   ? T.ok('[  OK  ]') :
                  entry.level === 'warn' ? T.warn('[ WARN ]') :
                  entry.level === 'err'  ? T.err('[ FAIL ]') :
                                           T.dim('[  ..  ]');
    const line  = frameLine(`${icon} ${T.dim(entry.ts)}  ${T.text(entry.message)}`);
    process.stdout.write(line + '\n');
  }

  // ---------------------------------------------------------------------------
  // Render the static splash frame
  // ---------------------------------------------------------------------------
  function render() {
    const lines = [
      frameTop(),
      frameBlank(),
    ];

    // Logo
    for (const l of LOGO_LINES) {
      lines.push(frameLine(T.logo(l)));
    }
    lines.push(frameBlank());

    // Title + version
    const titleText = `AIOSCPU  ·  AI-Operated Software CPU  ·  v${version}`;
    lines.push(frameLine(T.title(titleText)));
    lines.push(frameLine(T.dim('Termux-Bootable  ·  Offline-First  ·  Node.js >= 14')));
    lines.push(frameBlank());

    // Win-95 style status row
    lines.push(frameSep());
    lines.push(frameLine(T.text('Loading kernel modules...')));
    lines.push(frameBlank());

    // Boot log toggle hint
    const hint = _logVisible
      ? T.dim('Boot log: ON  — call splash.toggleLog() to hide')
      : T.dim('Boot log: OFF — call splash.toggleLog() to show');
    lines.push(frameLine(hint));
    lines.push(frameBlank());
    lines.push(frameBottom());
    lines.push('');

    return lines.join('\n');
  }

  /** Print the full splash to stdout. */
  function show() {
    _splashShown = true;
    process.stdout.write(render());
  }

  /** Overwrite the splash with a "boot complete" banner. */
  function complete(message = 'System ready.') {
    const line  = frameLine(T.ok(`✓  ${message}`));
    const lines = [frameSep(), line, frameBlank(), frameBottom(), ''];
    process.stdout.write(lines.join('\n'));
  }

  /** Toggle the boot log visibility. */
  function toggleLog() {
    _logVisible = !_logVisible;
    if (_logVisible) {
      // Replay all existing log entries
      for (const entry of _bootLog) _printLogLine(entry);
    }
    return _logVisible;
  }

  function setLogVisible(visible) {
    _logVisible = !!visible;
    return _logVisible;
  }

  function getLog() { return _bootLog.slice(); }
  function clearLog() { _bootLog = []; }

  return {
    name:       'boot-splash',
    version:    '1.0.0',
    render,
    show,
    complete,
    log,
    toggleLog,
    setLogVisible,
    isLogVisible: () => _logVisible,
    getLog,
    clearLog,
    isShown: () => _splashShown,
    // Frame helpers exposed for testing
    _frameTop:    frameTop,
    _frameBottom: frameBottom,
    _frameSep:    frameSep,
  };
}

module.exports = { createBootSplash };
