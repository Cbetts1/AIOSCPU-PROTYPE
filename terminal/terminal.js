'use strict';
/**
 * terminal.js — AIOS Interactive Terminal v2.0.0
 *
 * A fully functional interactive shell for AIOS Lite.
 *
 * Features:
 *   - AIOS command routing via the Router
 *   - `!command` prefix — execute any real host OS command directly
 *   - Auto-fallback — unknown AIOS commands are tried on the host shell
 *   - `ai <text>` — natural language OS control
 *   - `sudo <cmd>` — privilege escalation relay
 *   - Privilege level shown in prompt  (user / operator / admin / root)
 *   - Full ANSI colour, arrow-key history via readline
 *   - Tab-completion for AIOS registered commands
 *   - In-memory history (up to 500 lines)
 *   - Programmatic write() API for services and AI output
 *
 * Zero external npm dependencies. Pure Node.js CommonJS.
 */

const readline = require('readline');
const { spawnSync } = require('child_process');

// ---------------------------------------------------------------------------
// ANSI colour helpers — degrade gracefully when not a TTY
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
  blue:    (t) => colour('34',    t),
  magenta: (t) => colour('35',    t),
  cyan:    (t) => colour('36',    t),
  white:   (t) => colour('37',    t),
  bgRed:   (t) => colour('41',    t),
};

// ---------------------------------------------------------------------------
// Banner
// ---------------------------------------------------------------------------
function buildBanner(hostBridge, permSystem) {
  const platform  = hostBridge  ? hostBridge.platform.name             : 'unknown';
  const rootAvail = hostBridge  ? hostBridge.root.available            : false;
  const level     = permSystem  ? permSystem.getLevel()                : 'user';

  return [
    '',
    C.cyan('╔════════════════════════════════════════════════════════════╗'),
    C.cyan('║') + '  ' + C.bold(C.white('AIOSCPU Prototype One  —  AIOS Lite v2.0.0')) + '            ' + C.cyan('║'),
    C.cyan('║') + '  ' + C.dim('Termux-Bootable · Real OS Mirror · AI-Operated · Offline') + '  ' + C.cyan('║'),
    C.cyan('╠════════════════════════════════════════════════════════════╣'),
    C.cyan('║') + '  ' + C.green('Kernel')   + '   │ ' + C.green('CPU')      + '      │ ' + C.green('Router')   + '   │ ' + C.green('Filesystem') + '           ' + C.cyan('║'),
    C.cyan('║') + '  ' + C.green('Services') + ' │ ' + C.green('AI Core') + ' │ ' + C.green('Host Bridge') + ' │ ' + C.green('Mirror') + '          ' + C.cyan('║'),
    C.cyan('╠════════════════════════════════════════════════════════════╣'),
    C.cyan('║') + '  Platform  : ' + C.yellow(platform.padEnd(20)) + '  Root: ' + (rootAvail ? C.green('yes') : C.dim('no')) + '               ' + C.cyan('║'),
    C.cyan('║') + '  ' + C.yellow('!') + ' + command  runs on the real host OS  (e.g. ' + C.yellow('!ls /') + ')       ' + C.cyan('║'),
    C.cyan('║') + '  ' + C.yellow('ai') + ' + text    AI natural language interpreter              ' + C.cyan('║'),
    C.cyan('╚════════════════════════════════════════════════════════════╝'),
    '  Type ' + C.yellow('"help"') + ' for commands.  Type ' + C.yellow('"exit"') + ' to shut down.',
    '',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Host shell execution (for ! passthrough and auto-fallback)
// ---------------------------------------------------------------------------
function _runHostShell(commandString) {
  const shell = process.platform === 'win32' ? 'cmd.exe' : '/bin/sh';
  const flag  = process.platform === 'win32' ? '/c' : '-c';
  try {
    const r = spawnSync(shell, [flag, commandString], {
      encoding: 'utf8',
      timeout:  30000,
      stdio:    ['ignore', 'pipe', 'pipe'],
    });
    const out = (r.stdout || '').replace(/\n$/, '');
    const err = (r.stderr || '').replace(/\n$/, '');
    return {
      ok:     (r.status === 0),
      output: [out, err].filter(Boolean).join('\n'),
      code:   r.status || 0,
    };
  } catch (e) {
    return { ok: false, output: e.message, code: -1 };
  }
}

// ---------------------------------------------------------------------------
// Terminal factory
// ---------------------------------------------------------------------------
function createTerminal(router, kernel, filesystem, hostBridge, permSystem) {
  let _rl      = null;
  let _running = false;

  // In-memory command history
  const _history = [];
  const MAX_HISTORY = 500;

  function _addHistory(line) {
    const trimmed = line.trim();
    if (trimmed && trimmed !== _history[_history.length - 1]) {
      _history.push(trimmed);
      if (_history.length > MAX_HISTORY) _history.shift();
    }
  }

  // ---------------------------------------------------------------------------
  // Prompt — shows CWD + privilege level
  // ---------------------------------------------------------------------------
  function _prompt() {
    const cwd    = filesystem ? filesystem.pwd() : '/';
    const lvl    = permSystem ? permSystem.getLevel() : 'user';

    // Colour the level indicator
    const levelStr = {
      user:     C.green('user'),
      operator: C.cyan('operator'),
      admin:    C.yellow('admin'),
      root:     C.bgRed(C.white('root')),
    }[lvl] || C.green(lvl);

    const cwdStr  = C.cyan(cwd);
    const dollarSign = lvl === 'root' ? C.red('# ') : C.yellow('$ ');
    return `${levelStr}:${cwdStr}${dollarSign}`;
  }

  // ---------------------------------------------------------------------------
  // Print result to stdout
  // ---------------------------------------------------------------------------
  function _printResult(result, fromHost) {
    if (!result) return;
    if (fromHost) {
      // Host shell output — print raw, no extra formatting
      if (result.output) process.stdout.write(result.output + '\n');
      return;
    }
    if (result.status === 'error') {
      process.stdout.write(C.red('Error: ' + result.result) + '\n');
    } else if (result.result !== undefined && result.result !== '') {
      process.stdout.write(String(result.result) + '\n');
    }
  }

  // ---------------------------------------------------------------------------
  // Handle a single input line
  // ---------------------------------------------------------------------------
  async function _handleLine(line) {
    const raw     = line;
    const trimmed = raw.trim();
    if (!trimmed) return;

    _addHistory(trimmed);

    // ── Built-in terminal commands (bypass router) ──────────────────────────
    const lower = trimmed.toLowerCase();

    if (lower === 'exit' || lower === 'quit' || lower === 'shutdown') {
      _running = false;
      process.stdout.write(C.yellow('\n[AIOS] Shutting down…\n'));
      if (kernel) kernel.shutdown();
      if (_rl) _rl.close();
      process.exit(0);
      return;
    }

    if (lower === 'clear' || lower === 'cls') {
      if (COLOR_SUPPORT) process.stdout.write('\x1b[2J\x1b[H');
      return;
    }

    if (lower === 'history') {
      if (!_history.length) { process.stdout.write('No history yet.\n'); return; }
      _history.forEach((h, i) =>
        process.stdout.write('  ' + String(i + 1).padStart(4) + '  ' + h + '\n')
      );
      return;
    }

    // ── `!command` — direct host shell passthrough ──────────────────────────
    if (trimmed.startsWith('!')) {
      const hostCmd = trimmed.slice(1).trim();
      if (!hostCmd) {
        process.stdout.write(C.red('Usage: !<shell command>  e.g. !ls -la /\n'));
        return;
      }
      const r = _runHostShell(hostCmd);
      if (r.output) process.stdout.write(r.output + '\n');
      if (!r.ok) process.stdout.write(C.dim(`(exit ${r.code})\n`));
      return;
    }

    // ── sudo relay — re-dispatch the inner command at escalated level ────────
    if (lower.startsWith('sudo ')) {
      const innerCmd = trimmed.slice(5).trim();
      if (!innerCmd) { process.stdout.write(C.red('Usage: sudo <command>\n')); return; }

      // Escalate in permission system if available
      const prevLevel = permSystem ? permSystem.getLevel() : 'user';
      if (permSystem) permSystem.escalate('root');

      try {
        const result = await router.handle(innerCmd, {
          terminal: _api, kernel, filesystem, hostBridge, permSystem, isSudo: true,
        });
        _printResult(result);
      } catch (e) {
        process.stdout.write(C.red('[sudo] Error: ' + e.message + '\n'));
      } finally {
        if (permSystem) permSystem.demote(prevLevel);
      }
      return;
    }

    // ── Route through AIOS router ────────────────────────────────────────────
    try {
      const result = await router.handle(trimmed, {
        terminal: _api, kernel, filesystem, hostBridge, permSystem,
      });

      // If router returned "Unknown command", try host shell as auto-fallback
      if (
        result &&
        result.status === 'error' &&
        typeof result.result === 'string' &&
        result.result.startsWith('Unknown command:')
      ) {
        const hostResult = _runHostShell(trimmed);
        if (hostResult.output) process.stdout.write(hostResult.output + '\n');
        else if (!hostResult.ok) {
          // Neither AIOS nor host knew the command — show original AIOS error
          process.stdout.write(C.red('Error: ' + result.result) + '\n');
          process.stdout.write(C.dim('(also not found on host shell)\n'));
        }
        return;
      }

      _printResult(result);
    } catch (e) {
      process.stdout.write(C.red('[Terminal] Error: ' + e.message + '\n'));
    }
  }

  // ---------------------------------------------------------------------------
  // Tab completion — complete registered AIOS commands
  // ---------------------------------------------------------------------------
  function _completer(line) {
    if (!router || typeof router.getCommands !== 'function') return [[], line];
    const commands    = router.getCommands();
    const hits        = commands.filter(c => c.startsWith(line.toLowerCase()));
    return [hits.length ? hits : commands, line];
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------
  const _api = {
    name:      'terminal',
    version:   '2.0.0',

    start() {
      if (_running) return;
      _running = true;

      process.stdout.write(buildBanner(hostBridge, permSystem));

      _rl = readline.createInterface({
        input:       process.stdin,
        output:      process.stdout,
        terminal:    true,
        completer:   _completer,
        historySize: MAX_HISTORY,
      });

      function ask() {
        if (!_running) return;
        _rl.setPrompt(_prompt());
        _rl.prompt(true);
      }

      _rl.on('line', async (line) => {
        try {
          await _handleLine(line);
        } catch (e) {
          process.stdout.write(C.red('[Terminal] Unhandled: ' + e.message + '\n'));
        }
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
    },

    stop() {
      _running = false;
      if (_rl) _rl.close();
    },

    /** Programmatic output — used by services, AI agent, CPU syscalls */
    write(text) {
      if (_rl) {
        // Clear the current prompt line, write text, then restore prompt
        _rl.clearLine(process.stdout, 0);
        _rl.cursorTo(process.stdout, 0);
        process.stdout.write(String(text));
        if (_running) {
          _rl.setPrompt(_prompt());
          _rl.prompt(true);
        }
      } else {
        process.stdout.write(String(text));
      }
    },

    writeln(text) {
      _api.write(String(text) + '\n');
    },

    history:   () => _history.slice(),
    isRunning: () => _running,
  };

  return _api;
}

module.exports = { createTerminal };
