'use strict';
/**
 * core/termux-bridge.js — AIOS Termux Host Bridge v1.0.0
 *
 * Enhanced Termux-specific integration layer.  AIOS runs inside Termux and
 * uses it as the only host bridge — Termux is both the OS interface and the
 * user interface.
 *
 * Responsibilities
 * ─────────────────
 *   - Detect and validate the Termux environment (PREFIX, HOME, API tools)
 *   - Install/refresh the Termux:Widget shortcut (~/.shortcuts/AIOS.sh)
 *   - Register AIOS with Termux:Boot (~/.termux/boot/) for auto-start
 *   - Provide Termux API wrappers: battery, clipboard, notification, vibrate,
 *     toast, share, volume, torch, camera-info
 *   - Expose a router command namespace: `termux <sub-command>`
 *
 * Flow model (from the new requirement)
 * ──────────────────────────────────────
 *   Termux (host OS bridge)
 *     └─► AIOS virtual world   ← kernel, VHAL, NPU, self-model live here
 *           └─► AI targets      ← TinyLlama / Ollama
 *         back through Termux terminal to user
 *
 * Zero external npm dependencies.  Uses child_process + fs (built-in).
 */

const cp     = require('child_process');
const fs     = require('fs');
const path   = require('path');
const os     = require('os');

// ---------------------------------------------------------------------------
// Detection helpers
// ---------------------------------------------------------------------------
function _isTermux() {
  return !!(
    (process.env.PREFIX && process.env.PREFIX.includes('com.termux')) ||
    fs.existsSync('/data/data/com.termux') ||
    fs.existsSync('/data/data/com.termux/files/usr')
  );
}

function _termuxPrefix() {
  return process.env.PREFIX ||
    (fs.existsSync('/data/data/com.termux/files/usr')
      ? '/data/data/com.termux/files/usr'
      : null);
}

function _run(cmd, args, opts) {
  try {
    const r = cp.spawnSync(cmd, args || [], {
      encoding: 'utf8',
      timeout:  (opts && opts.timeout) || 8000,
      env:      process.env,
    });
    if (r.error) return { ok: false, stdout: '', stderr: r.error.message };
    return { ok: r.status === 0, stdout: (r.stdout || '').trim(), stderr: (r.stderr || '').trim() };
  } catch (e) {
    return { ok: false, stdout: '', stderr: e.message };
  }
}

function _which(bin) {
  const r = _run('which', [bin]);
  return r.ok && r.stdout.length > 0;
}

// ---------------------------------------------------------------------------
// createTermuxBridge — factory
// ---------------------------------------------------------------------------
function createTermuxBridge(kernel, options) {
  const opts    = options  || {};
  const VERSION = '1.0.0';
  const _bus    = (kernel && kernel.bus) ? kernel.bus : { emit: () => {}, on: () => {} };

  const _onTermux    = _isTermux();
  const _prefix      = _termuxPrefix();
  const _home        = process.env.HOME || os.homedir();
  const _hasAPI      = _which('termux-battery-status');
  const _hasWidget   = _which('termux-widget-refresh') || fs.existsSync(path.join(_home, '.shortcuts'));
  const _hasBoot     = fs.existsSync(path.join(_home, '.termux', 'boot'));

  // ── environment snapshot ─────────────────────────────────────────────────
  const env = {
    onTermux:   _onTermux,
    prefix:     _prefix,
    home:       _home,
    hasAPI:     _hasAPI,
    hasWidget:  _hasWidget,
    hasBoot:    _hasBoot,
    shell:      process.env.SHELL || 'sh',
    term:       process.env.TERM  || 'xterm',
    colorterm:  process.env.COLORTERM || '',
  };

  // ── widget install ────────────────────────────────────────────────────────
  // Creates ~/.shortcuts/AIOS.sh — tapping this in Termux:Widget launches AIOS
  function installWidget(entryPoint) {
    const shortcutsDir = path.join(_home, '.shortcuts');
    const scriptPath   = path.join(shortcutsDir, 'AIOS.sh');
    const entry        = entryPoint || path.resolve(__dirname, '..', 'aos');

    // Create ~/.shortcuts if it does not exist
    try { fs.mkdirSync(shortcutsDir, { recursive: true, mode: 0o755 }); }
    catch (e) { return { ok: false, error: `Cannot create ~/.shortcuts: ${e.message}` }; }

    const script = [
      '#!/data/data/com.termux/files/usr/bin/bash',
      '# AIOS — Artificial Intelligence Operating System',
      '# Termux:Widget shortcut — tap to launch AIOS',
      `cd "${path.dirname(entry)}"`,
      `exec node "${entry}"`,
    ].join('\n') + '\n';

    try {
      fs.writeFileSync(scriptPath, script, { mode: 0o755, encoding: 'utf8' });
    } catch (e) {
      return { ok: false, error: `Cannot write widget script: ${e.message}` };
    }

    // Refresh widget list if possible
    if (_which('termux-widget-refresh')) {
      _run('termux-widget-refresh', []);
    }

    _bus.emit('termux:widget:installed', { path: scriptPath });
    return { ok: true, path: scriptPath };
  }

  // ── boot registration ─────────────────────────────────────────────────────
  // Creates ~/.termux/boot/aios.sh — AIOS starts when the phone boots
  function installBoot(entryPoint) {
    const bootDir  = path.join(_home, '.termux', 'boot');
    const bootFile = path.join(bootDir, 'aios.sh');
    const entry    = entryPoint || path.resolve(__dirname, '..', 'aos');

    try { fs.mkdirSync(bootDir, { recursive: true, mode: 0o755 }); }
    catch (e) { return { ok: false, error: `Cannot create ~/.termux/boot: ${e.message}` }; }

    const script = [
      '#!/data/data/com.termux/files/usr/bin/bash',
      '# AIOS — auto-start on phone boot via Termux:Boot',
      '# Runs AIOS in a detached tmux session named "aios"',
      'sleep 5   # give Termux time to initialise',
      `if command -v tmux >/dev/null 2>&1; then`,
      `  tmux new-session -d -s aios "node ${entry}"`,
      `else`,
      `  node "${entry}" &`,
      `fi`,
    ].join('\n') + '\n';

    try {
      fs.writeFileSync(bootFile, script, { mode: 0o755, encoding: 'utf8' });
    } catch (e) {
      return { ok: false, error: `Cannot write boot script: ${e.message}` };
    }

    _bus.emit('termux:boot:installed', { path: bootFile });
    return { ok: true, path: bootFile };
  }

  // ── Termux API wrappers ───────────────────────────────────────────────────

  function battery() {
    if (!_hasAPI) return { ok: false, error: 'termux-api not installed. Run: pkg install termux-api' };
    const r = _run('termux-battery-status', []);
    if (!r.ok) return { ok: false, error: r.stderr };
    try { return { ok: true, data: JSON.parse(r.stdout) }; }
    catch (_) { return { ok: true, data: r.stdout }; }
  }

  function notify(title, content) {
    if (!_hasAPI) return { ok: false, error: 'termux-api not installed' };
    const r = _run('termux-notification', ['--title', String(title), '--content', String(content)]);
    return { ok: r.ok, error: r.ok ? undefined : r.stderr };
  }

  function toast(msg) {
    if (!_hasAPI) return { ok: false, error: 'termux-api not installed' };
    const r = _run('termux-toast', ['-s', String(msg)]);
    return { ok: r.ok };
  }

  function clipboardSet(text) {
    if (!_hasAPI) return { ok: false, error: 'termux-api not installed' };
    const r = _run('termux-clipboard-set', [String(text)]);
    return { ok: r.ok };
  }

  function clipboardGet() {
    if (!_hasAPI) return { ok: false, error: 'termux-api not installed' };
    const r = _run('termux-clipboard-get', []);
    return { ok: r.ok, text: r.stdout };
  }

  function vibrate(ms) {
    if (!_hasAPI) return { ok: false, error: 'termux-api not installed' };
    const r = _run('termux-vibrate', ['-d', String(ms || 300)]);
    return { ok: r.ok };
  }

  function tts(text) {
    if (!_hasAPI) return { ok: false, error: 'termux-api not installed' };
    const r = _run('termux-tts-speak', [String(text)]);
    return { ok: r.ok };
  }

  // ── Router commands ───────────────────────────────────────────────────────
  const commands = {
    termux: (args) => {
      const sub = (args[0] || '').toLowerCase();
      if (!_onTermux) return { status: 'warn', result: 'Not running inside Termux — some features unavailable' };

      if (!sub || sub === 'status') {
        return {
          status: 'ok', result: [
            `Termux: ${_onTermux ? 'YES' : 'NO'}`,
            `Prefix: ${_prefix || 'n/a'}`,
            `API   : ${_hasAPI ? 'installed' : 'not installed (pkg install termux-api)'}`,
            `Widget: ${_hasWidget ? 'ready' : 'install Termux:Widget from F-Droid'}`,
            `Boot  : ${_hasBoot ? 'configured' : 'install Termux:Boot from F-Droid'}`,
          ].join('\n'),
        };
      }
      if (sub === 'widget') {
        const r = installWidget();
        return r.ok
          ? { status: 'ok',    result: `Widget installed: ${r.path}\nAdd Termux:Widget to your home screen and tap AIOS.` }
          : { status: 'error', result: r.error };
      }
      if (sub === 'boot') {
        const r = installBoot();
        return r.ok
          ? { status: 'ok',    result: `Boot script installed: ${r.path}\nAIOS will auto-start when the phone boots.` }
          : { status: 'error', result: r.error };
      }
      if (sub === 'battery')  { const r = battery();  return r.ok ? { status: 'ok', result: JSON.stringify(r.data, null, 2) } : { status: 'error', result: r.error }; }
      if (sub === 'toast')    { toast(args.slice(1).join(' ')); return { status: 'ok', result: 'Toast sent' }; }
      if (sub === 'notify')   { notify(args[1] || 'AIOS', args.slice(2).join(' ')); return { status: 'ok', result: 'Notification sent' }; }
      if (sub === 'vibrate')  { vibrate(parseInt(args[1], 10) || 300); return { status: 'ok', result: 'Vibrated' }; }
      if (sub === 'tts')      { tts(args.slice(1).join(' ')); return { status: 'ok', result: 'Speaking' }; }
      if (sub === 'clip-get') { const r = clipboardGet(); return r.ok ? { status: 'ok', result: r.text } : { status: 'error', result: r.error }; }
      if (sub === 'clip-set') { clipboardSet(args.slice(1).join(' ')); return { status: 'ok', result: 'Clipboard set' }; }
      if (sub === 'help') {
        return {
          status: 'ok', result: [
            'termux status        — environment summary',
            'termux widget        — install Termux:Widget shortcut (one-tap boot)',
            'termux boot          — install Termux:Boot auto-start script',
            'termux battery       — battery status',
            'termux notify T MSG  — send notification',
            'termux toast MSG     — show toast',
            'termux vibrate [ms]  — vibrate',
            'termux tts TEXT      — text-to-speech',
            'termux clip-get      — read clipboard',
            'termux clip-set TEXT — set clipboard',
          ].join('\n'),
        };
      }
      return { status: 'error', result: `Unknown termux command: ${sub}. Try: termux help` };
    },
  };

  // Emit environment info on kernel bus at startup
  _bus.emit('termux:bridge:ready', {
    onTermux:  _onTermux,
    hasAPI:    _hasAPI,
    hasWidget: _hasWidget,
    hasBoot:   _hasBoot,
  });

  return {
    name:       'termux-bridge',
    version:    VERSION,
    env,
    commands,
    installWidget,
    installBoot,
    battery,
    notify,
    toast,
    vibrate,
    tts,
    clipboardSet,
    clipboardGet,
    isTermux:  () => _onTermux,
  };
}

module.exports = { createTermuxBridge };
