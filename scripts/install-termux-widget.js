#!/usr/bin/env node
'use strict';
/**
 * scripts/install-termux-widget.js
 *
 * One-shot Termux widget + boot installer.
 *
 * Run once inside Termux:
 *   node scripts/install-termux-widget.js
 *
 * What it does
 * ─────────────
 *   1. Detects Termux environment
 *   2. Creates ~/.shortcuts/AIOS.sh  — Termux:Widget shortcut
 *   3. Creates ~/.termux/boot/aios.sh — Termux:Boot auto-start (optional)
 *   4. Prints setup instructions
 *
 * After running:
 *   - Long-press home → Widgets → Termux:Widget → AIOS
 *   - Tap the AIOS widget to boot the OS in a Termux terminal
 *
 * Zero external npm dependencies.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const cp   = require('child_process');

// ── helpers ───────────────────────────────────────────────────────────────

function isTermux() {
  return !!(
    (process.env.PREFIX && process.env.PREFIX.includes('com.termux')) ||
    fs.existsSync('/data/data/com.termux/files/usr')
  );
}

function run(cmd, args) {
  try {
    const r = cp.spawnSync(cmd, args || [], { encoding: 'utf8', timeout: 5000, env: process.env });
    return { ok: r.status === 0, stdout: (r.stdout || '').trim() };
  } catch (_) { return { ok: false, stdout: '' }; }
}

function ok(msg)   { process.stdout.write(`  \x1b[32m✓\x1b[0m  ${msg}\n`); }
function warn(msg) { process.stdout.write(`  \x1b[33m⚠\x1b[0m  ${msg}\n`); }
function info(msg) { process.stdout.write(`  \x1b[36m→\x1b[0m  ${msg}\n`); }
function err(msg)  { process.stdout.write(`  \x1b[31m✗\x1b[0m  ${msg}\n`); }
function hdr(msg)  { process.stdout.write(`\n\x1b[1;35m${msg}\x1b[0m\n`); }

// ── main ──────────────────────────────────────────────────────────────────

hdr('AIOS — Termux Widget Installer');
process.stdout.write('\n');

const HOME       = process.env.HOME || os.homedir();
const AIOS_DIR   = path.resolve(__dirname, '..');
const ENTRY      = path.join(AIOS_DIR, 'aos');

info(`AIOS root : ${AIOS_DIR}`);
info(`Entry     : ${ENTRY}`);
info(`Home      : ${HOME}`);
info(`Termux    : ${isTermux() ? 'YES' : 'NO (widget will still be created)'}`);
process.stdout.write('\n');

// ── 1. ~/.shortcuts/AIOS.sh ───────────────────────────────────────────────

hdr('Step 1 — Termux:Widget shortcut');

const shortcutsDir = path.join(HOME, '.shortcuts');
const widgetPath   = path.join(shortcutsDir, 'AIOS.sh');

try { fs.mkdirSync(shortcutsDir, { recursive: true, mode: 0o755 }); }
catch (e) { err(`Cannot create ~/.shortcuts: ${e.message}`); process.exit(1); }

const widgetScript = [
  '#!/data/data/com.termux/files/usr/bin/bash',
  '# AIOS — Artificial Intelligence Operating System',
  '# Termux:Widget shortcut — tap to launch AIOS',
  `cd "${AIOS_DIR}"`,
  `exec node "${ENTRY}"`,
].join('\n') + '\n';

try {
  fs.writeFileSync(widgetPath, widgetScript, { mode: 0o755, encoding: 'utf8' });
  ok(`Widget script written: ${widgetPath}`);
} catch (e) {
  err(`Failed to write widget script: ${e.message}`);
  process.exit(1);
}

// Refresh widget list if tool is available
const canRefresh = run('which', ['termux-widget-refresh']).ok;
if (canRefresh) {
  run('termux-widget-refresh', []);
  ok('Widget list refreshed');
} else {
  warn('termux-widget-refresh not found — install Termux:Widget from F-Droid');
}

// ── 2. ~/.termux/boot/aios.sh ─────────────────────────────────────────────

hdr('Step 2 — Termux:Boot auto-start (optional)');

const bootDir  = path.join(HOME, '.termux', 'boot');
const bootFile = path.join(bootDir, 'aios.sh');

try { fs.mkdirSync(bootDir, { recursive: true, mode: 0o755 }); }
catch (e) { warn(`Cannot create ~/.termux/boot: ${e.message} — skipping boot install`); }

if (fs.existsSync(bootDir)) {
  const hasTmux = run('which', ['tmux']).ok;
  const bootScript = [
    '#!/data/data/com.termux/files/usr/bin/bash',
    '# AIOS — auto-start on phone boot via Termux:Boot',
    '# Runs AIOS in a detached tmux session named "aios"',
    'sleep 5',
    hasTmux
      ? `tmux new-session -d -s aios "node ${ENTRY}"`
      : `node "${ENTRY}" &`,
  ].join('\n') + '\n';

  try {
    fs.writeFileSync(bootFile, bootScript, { mode: 0o755, encoding: 'utf8' });
    ok(`Boot script written: ${bootFile}`);
    if (hasTmux) {
      info('tmux found — AIOS will boot in a detached tmux session named "aios"');
      info('Attach with: tmux attach -t aios');
    } else {
      warn('tmux not found — install with: pkg install tmux  (recommended)');
    }
  } catch (e) {
    warn(`Could not write boot script: ${e.message}`);
  }
}

// ── 3. Instructions ────────────────────────────────────────────────────────

hdr('Setup complete — next steps');
process.stdout.write([
  '',
  '  \x1b[1mTo use the widget:\x1b[0m',
  '    1. Install Termux:Widget from F-Droid (NOT Play Store)',
  '    2. Long-press your Android home screen',
  '    3. Tap "Widgets" → find "Termux:Widget" → long-press "AIOS"',
  '    4. Drop it on your home screen',
  '    5. Tap the AIOS widget → Termux opens and AIOS boots',
  '',
  '  \x1b[1mTo start manually:\x1b[0m',
  `    cd ${AIOS_DIR} && node aos`,
  '    OR:  npm start',
  '',
  '  \x1b[1mTo auto-start on phone boot:\x1b[0m',
  '    Install Termux:Boot from F-Droid — then reboot your phone',
  '',
  '  \x1b[1mTo install Termux API (battery, notifications, etc):\x1b[0m',
  '    pkg install termux-api',
  '    Install "Termux:API" from F-Droid as well',
  '',
].join('\n') + '\n');
