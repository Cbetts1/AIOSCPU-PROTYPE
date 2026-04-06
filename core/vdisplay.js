'use strict';
/**
 * core/vdisplay.js — AIOS Virtual Display Driver v1.0.0
 *
 * ANSI-based layered framebuffer renderer for the AIOS virtual hardware stack.
 *
 * Architecture
 * ─────────────
 *   Layer 0 — background  : solid fill character
 *   Layer 1 — status-bar  : top status line (fed by StatusBar if available)
 *   Layer 2 — console     : scrolling text console
 *   Layer 3 — overlay     : modal dialogs / notifications
 *
 * The driver composes all layers and writes the final frame to stdout via
 * ANSI escape sequences.  It is NOT required to have a real TTY — if stdout
 * is not a TTY the driver falls back to plain-text line mode.
 *
 * Registers itself with VHAL as device type "display".
 *
 * Emits on kernel bus:
 *   display:frame     { layer, lines }
 *   display:clear     {}
 *   display:resize    { cols, rows }
 *
 * Zero external npm dependencies.
 */

// ---------------------------------------------------------------------------
// ANSI helpers
// ---------------------------------------------------------------------------
const ANSI = {
  reset:   '\x1b[0m',
  clear:   '\x1b[2J\x1b[H',
  home:    '\x1b[H',
  bold:    '\x1b[1m',
  dim:     '\x1b[2m',
  blue:    '\x1b[34m',
  cyan:    '\x1b[36m',
  white:   '\x1b[37m',
  bgBlue:  '\x1b[44m',
  bgBlack: '\x1b[40m',
  hide:    '\x1b[?25l',
  show:    '\x1b[?25h',
  moveTo:  (r, c) => `\x1b[${r};${c}H`,
};

// ---------------------------------------------------------------------------
// createVDisplay — factory
// ---------------------------------------------------------------------------
function createVDisplay(options, kernel) {
  const opts    = options  || {};
  const VERSION = '1.0.0';

  const _bus   = (kernel && kernel.bus) ? kernel.bus : { emit: () => {} };
  const _isTTY = !!process.stdout.isTTY;

  // Console dimensions (use TTY if available, fall back to defaults)
  let _cols = (_isTTY && process.stdout.columns) || opts.cols || 80;
  let _rows = (_isTTY && process.stdout.rows)    || opts.rows || 24;

  // Layer buffers: array of strings (one per visible line)
  const _layers = {
    background: [],
    statusBar:  [],
    console:    [],
    overlay:    [],
  };

  // ── helpers ──────────────────────────────────────────────────────────────

  function _pad(str, width) {
    const s = String(str || '');
    if (s.length >= width) return s.slice(0, width);
    return s + ' '.repeat(width - s.length);
  }

  // ── background ────────────────────────────────────────────────────────────
  function setBackground(char) {
    const ch = typeof char === 'string' && char.length ? char[0] : ' ';
    _layers.background = Array.from({ length: _rows }, () => ch.repeat(_cols));
  }

  // ── status bar (layer 1) ──────────────────────────────────────────────────
  function setStatusBar(line) {
    _layers.statusBar = [_pad(String(line || ''), _cols)];
  }

  // ── console (layer 2) — append lines ────────────────────────────────────
  const _consoleLines = [];

  function print(line) {
    _consoleLines.push(String(line));
    // Keep a rolling buffer of (_rows - 2) lines
    const max = Math.max(1, _rows - 2);
    if (_consoleLines.length > max) _consoleLines.shift();
    _layers.console = _consoleLines.slice();
    _bus.emit('display:frame', { layer: 'console', lines: _layers.console.length });
  }

  function clearConsole() {
    _consoleLines.length = 0;
    _layers.console = [];
  }

  // ── overlay (layer 3) ────────────────────────────────────────────────────
  function setOverlay(lines) {
    _layers.overlay = Array.isArray(lines) ? lines : [String(lines || '')];
  }

  function clearOverlay() { _layers.overlay = []; }

  // ── render ────────────────────────────────────────────────────────────────
  // Compose all layers and write to stdout
  function render() {
    if (!_isTTY) {
      // Non-TTY fallback: just emit console lines
      if (_layers.console.length) {
        process.stdout.write(_layers.console.join('\n') + '\n');
      }
      return;
    }

    const frame = [];

    // Row 0: status bar
    const statusLine = _layers.statusBar[0] || _pad('', _cols);
    frame.push(ANSI.bgBlue + ANSI.white + ANSI.bold + statusLine + ANSI.reset);

    // Rows 1..(_rows-2): console lines (padded)
    const consoleRows = _rows - 2;
    const consoleBuf  = _layers.console.slice(-consoleRows);
    while (consoleBuf.length < consoleRows) consoleBuf.unshift('');
    for (const line of consoleBuf) {
      frame.push(ANSI.bgBlack + ANSI.white + _pad(line, _cols) + ANSI.reset);
    }

    // Last row: overlay or blank
    const overlayLine = _layers.overlay[0] || _pad('', _cols);
    frame.push(ANSI.bgBlue + ANSI.cyan + _pad(overlayLine, _cols) + ANSI.reset);

    // Overlay multi-line (modal box) — centre of screen
    let output = ANSI.home + frame.join('\n');

    if (_layers.overlay.length > 1) {
      const boxLines = _layers.overlay;
      const boxRow   = Math.max(1, Math.floor((_rows - boxLines.length) / 2));
      const boxCol   = Math.max(1, Math.floor((_cols - 40) / 2));
      for (let i = 0; i < boxLines.length; i++) {
        output += ANSI.moveTo(boxRow + i, boxCol) +
                  ANSI.bgBlue + ANSI.bold + _pad(boxLines[i], 40) + ANSI.reset;
      }
    }

    process.stdout.write(output);
  }

  // ── clear ─────────────────────────────────────────────────────────────────
  function clear() {
    clearConsole();
    clearOverlay();
    _layers.statusBar  = [];
    _layers.background = [];
    if (_isTTY) process.stdout.write(ANSI.clear);
    _bus.emit('display:clear', {});
  }

  // ── resize ────────────────────────────────────────────────────────────────
  function resize(cols, rows) {
    _cols = cols || _cols;
    _rows = rows || _rows;
    _bus.emit('display:resize', { cols: _cols, rows: _rows });
  }

  if (_isTTY) {
    process.stdout.on('resize', () => {
      resize(process.stdout.columns, process.stdout.rows);
    });
  }

  // ── VHAL device descriptor ───────────────────────────────────────────────
  const device = {
    id:      'display-0',
    type:    'display',
    version: VERSION,
    caps:    ['ansi', 'layered', 'framebuffer'],
    init:    async () => ({ ok: true, cols: _cols, rows: _rows, tty: _isTTY }),
    read:    (_addr) => ({ cols: _cols, rows: _rows, layers: Object.keys(_layers) }),
    write:   (_addr, val) => {
      if (typeof val === 'string') print(val);
    },
    ioctl:   (cmd, args) => {
      if (cmd === 'print')       { print(args.line); return { ok: true }; }
      if (cmd === 'status')      { setStatusBar(args.line); return { ok: true }; }
      if (cmd === 'overlay')     { setOverlay(args.lines); return { ok: true }; }
      if (cmd === 'render')      { render(); return { ok: true }; }
      if (cmd === 'clear')       { clear(); return { ok: true }; }
      if (cmd === 'resize')      { resize(args.cols, args.rows); return { ok: true }; }
      if (cmd === 'background')  { setBackground(args.char); return { ok: true }; }
      return null;
    },
    hotplug: () => undefined,
    unplug:  () => { if (_isTTY) process.stdout.write(ANSI.show); },
  };

  return {
    name:           'vdisplay',
    version:        VERSION,
    device,
    setBackground,
    setStatusBar,
    print,
    clearConsole,
    setOverlay,
    clearOverlay,
    render,
    clear,
    resize,
    get cols() { return _cols; },
    get rows() { return _rows; },
    get isTTY(){ return _isTTY; },
  };
}

module.exports = { createVDisplay };
