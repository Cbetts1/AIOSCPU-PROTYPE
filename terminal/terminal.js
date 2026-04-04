'use strict';
/**
 * terminal.js — AIOS Interactive Terminal v1.0.0
 *
 * Adapted from: Cbetts1/Terminal (server/server.js, server/router-session.js)
 * Re-implemented as a standalone Node.js readline REPL — no HTTP, no Docker.
 *
 * Provides the interactive command-line shell for AIOS Lite.
 * Reads from stdin, routes commands through the AIOS router, prints results.
 *
 * Pure Node.js CommonJS. Zero external dependencies.
 */

const readline = require('readline');
const os       = require('os');

// ---------------------------------------------------------------------------
// ANSI colour helpers (degrade gracefully when colours are unsupported)
// ---------------------------------------------------------------------------
const COLOR_SUPPORT = process.stdout.isTTY !== false;

function colour(code, text) {
  return COLOR_SUPPORT ? `\x1b[${code}m${text}\x1b[0m` : text;
}

const C = {
  bold:    (t) => colour('1',     t),
  dim:     (t) => colour('2',     t),
  red:     (t) => colour('31',    t),
  green:   (t) => colour('32',    t),
  yellow:  (t) => colour('33',    t),
  cyan:    (t) => colour('36',    t),
  white:   (t) => colour('37',    t),
  magenta: (t) => colour('35',    t),
};

// ---------------------------------------------------------------------------
// AIOS banner
// ---------------------------------------------------------------------------
const BANNER = `
${C.cyan('╔══════════════════════════════════════════════════════╗')}
${C.cyan('║')}  ${C.bold(C.white('AIOSCPU Prototype One  —  AIOS Lite v1.0.0'))}        ${C.cyan('║')}
${C.cyan('║')}  ${C.dim('Termux-Bootable · Self-Contained · Offline')}            ${C.cyan('║')}
${C.cyan('╠══════════════════════════════════════════════════════╣')}
${C.cyan('║')}  ${C.green('Kernel')}   │ ${C.green('CPU')}     │ ${C.green('Router')}  │ ${C.green('Filesystem')}         ${C.cyan('║')}
${C.cyan('║')}  ${C.green('Services')} │ ${C.green('Terminal')}│ ${C.green('InterOS')}                        ${C.cyan('║')}
${C.cyan('╚══════════════════════════════════════════════════════╝')}
  Type ${C.yellow('"help"')} for commands.  Type ${C.yellow('"exit"')} to shut down.
`;

// ---------------------------------------------------------------------------
// Terminal factory
// ---------------------------------------------------------------------------
function createTerminal(router, kernel, filesystem) {
  let _rl      = null;
  let _running = false;

  // Command history (in-memory)
  const _history = [];
  const MAX_HISTORY = 200;

  function _addHistory(line) {
    if (line && line !== _history[_history.length - 1]) {
      _history.push(line);
      if (_history.length > MAX_HISTORY) _history.shift();
    }
  }

  // ---------------------------------------------------------------------------
  // Prompt builder — shows CWD
  // ---------------------------------------------------------------------------
  function _prompt() {
    const cwd  = filesystem ? filesystem.pwd() : '/';
    const user = C.green('aios');
    const path = C.cyan(cwd);
    return `${user}:${path}${C.yellow('$ ')}`;
  }

  // ---------------------------------------------------------------------------
  // Print a result to stdout
  // ---------------------------------------------------------------------------
  function _printResult(result) {
    if (!result) return;
    if (result.status === 'error') {
      process.stdout.write(C.red(`Error: ${result.result}`) + '\n');
    } else if (result.result !== undefined && result.result !== '') {
      process.stdout.write(String(result.result) + '\n');
    }
  }

  // ---------------------------------------------------------------------------
  // Handle a single input line
  // ---------------------------------------------------------------------------
  async function _handleLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;

    _addHistory(trimmed);

    // Built-in terminal commands that don't go through the router
    if (trimmed === 'exit' || trimmed === 'quit' || trimmed === 'shutdown') {
      _running = false;
      process.stdout.write(C.yellow('\n[AIOS] Shutting down…\n'));
      if (kernel) kernel.shutdown();
      _rl.close();
      process.exit(0);
      return;
    }

    if (trimmed === 'clear' || trimmed === 'cls') {
      if (COLOR_SUPPORT) process.stdout.write('\x1b[2J\x1b[H');
      return;
    }

    if (trimmed === 'history') {
      _history.forEach((h, i) => process.stdout.write(`  ${String(i + 1).padStart(4)}  ${h}\n`));
      return;
    }

    // Route through AIOS router
    try {
      const result = await router.handle(trimmed, { terminal: this, kernel, filesystem });
      _printResult(result);
    } catch (e) {
      process.stdout.write(C.red(`[Terminal] Unhandled error: ${e.message}\n`));
    }
  }

  // ---------------------------------------------------------------------------
  // start — launch the REPL
  // ---------------------------------------------------------------------------
  function start() {
    if (_running) return;
    _running = true;

    // Print banner
    process.stdout.write(BANNER + '\n');

    _rl = readline.createInterface({
      input:     process.stdin,
      output:    process.stdout,
      terminal:  true,
      prompt:    _prompt(),
      historySize: MAX_HISTORY,
    });

    // Update prompt dynamically (CWD may change)
    function ask() {
      if (!_running) return;
      _rl.setPrompt(_prompt());
      _rl.prompt(true);
    }

    _rl.on('line', async (line) => {
      await _handleLine(line);
      ask();
    });

    _rl.on('close', () => {
      _running = false;
      process.stdout.write(C.dim('\n[AIOS] Session ended.\n'));
      if (kernel) kernel.shutdown();
      process.exit(0);
    });

    _rl.on('SIGINT', () => {
      process.stdout.write('\n');
      ask();
    });

    ask();
  }

  // ---------------------------------------------------------------------------
  // stop — close the REPL gracefully
  // ---------------------------------------------------------------------------
  function stop() {
    _running = false;
    if (_rl) _rl.close();
  }

  // ---------------------------------------------------------------------------
  // write — programmatic output (used by services / CPU syscalls)
  // ---------------------------------------------------------------------------
  function write(text) {
    process.stdout.write(String(text));
    if (_rl) _rl.setPrompt(_prompt());
  }

  return {
    name:    'terminal',
    start,
    stop,
    write,
    history: () => _history.slice(),
    isRunning: () => _running,
  };
}

module.exports = { createTerminal };
