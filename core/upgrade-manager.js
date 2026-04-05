'use strict';
/**
 * core/upgrade-manager.js — AIOS System Upgrade Manager v1.0.0
 *
 * Manages planned and on-demand upgrades for the AIOS kernel.
 * Phone-friendly: lightweight operations, graceful failures.
 * Zero external npm dependencies.
 *
 * Upgrade categories
 * ──────────────────
 *   models   — pull / remove Ollama AI models
 *   system   — run system self-check and report readiness
 *   config   — update runtime configuration entries
 *   kernel   — show kernel version and component matrix
 *
 * Terminal commands
 * ─────────────────
 *   upgrade                  — show full upgrade plan + status
 *   upgrade status           — current component versions
 *   upgrade plan             — recommended upgrades
 *   upgrade history          — log of applied upgrades
 *   upgrade check            — run self-check against upgrade plan
 *   upgrade model <name>     — pull an Ollama model
 *   upgrade config <k> <v>   — set a runtime config value
 *
 * Integration
 * ───────────
 *   const { createUpgradeManager } = require('../core/upgrade-manager');
 *   const upgradeMgr = createUpgradeManager(kernel, svcMgr, hostBridge, diagnostics, vfs);
 *   router.use('upgrade-manager', upgradeMgr);
 */

const OLLAMA_URL = 'http://127.0.0.1:11434';

// ---------------------------------------------------------------------------
// AIOS component version matrix — the single source of truth
// ---------------------------------------------------------------------------
const COMPONENT_VERSIONS = [
  { name: 'kernel',             version: '1.0.0', status: 'stable' },
  { name: 'ai-core',            version: '3.0.0', status: 'stable' },
  { name: 'aios-aura',          version: '2.0.0', status: 'stable' },
  { name: 'consciousness',      version: '1.0.0', status: 'stable' },
  { name: 'memory-engine',      version: '1.0.0', status: 'stable' },
  { name: 'memory-core',        version: '1.0.0', status: 'stable' },
  { name: 'diagnostics-engine', version: '1.0.0', status: 'stable' },
  { name: 'service-manager',    version: '1.0.0', status: 'stable' },
  { name: 'router',             version: '1.0.0', status: 'stable' },
  { name: 'filesystem',         version: '1.0.0', status: 'stable' },
  { name: 'port-server',        version: '1.0.0', status: 'stable' },
  { name: 'host-bridge',        version: '1.0.0', status: 'stable' },
  { name: 'scheduler',          version: '1.0.0', status: 'stable' },
  { name: 'mode-manager',       version: '1.0.0', status: 'stable' },
  { name: 'model-registry',     version: '1.0.0', status: 'stable' },
  { name: 'upgrade-manager',    version: '1.0.0', status: 'stable' },
];

// Phone-first Ollama model recommendation list
const RECOMMENDED_MODELS = [
  { name: 'qwen2:0.5b', sizeMB: 394,  purpose: 'AIOS — smallest, works on any phone' },
  { name: 'tinyllama',  sizeMB: 637,  purpose: 'AIOS — fast, lightweight' },
  { name: 'gemma:2b',   sizeMB: 1400, purpose: 'AIOS — balanced quality' },
  { name: 'phi3',       sizeMB: 2300, purpose: 'AIOS + AURA — best for most phones' },
  { name: 'llama3',     sizeMB: 4700, purpose: 'AURA — deep reasoning, needs 6GB+ RAM' },
  { name: 'mistral',    sizeMB: 4100, purpose: 'AURA — alternative deep reasoning' },
];

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------
function _ts() { return new Date().toISOString(); }

function _withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (r) => { clearTimeout(t); resolve(r); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
function createUpgradeManager(kernel, svcMgr, hostBridge, diagnostics, vfs) {

  // ── Internal state ─────────────────────────────────────────────────────────
  const _history     = [];    // applied upgrade records
  const _config      = new Map(); // runtime config overrides
  const MAX_HISTORY  = 200;

  function _record(type, target, result, details) {
    const entry = { ts: _ts(), type, target, result, details: details || null };
    _history.push(entry);
    if (_history.length > MAX_HISTORY) _history.shift();
    if (kernel) kernel.bus.emit('upgrade:applied', entry);
    return entry;
  }

  // ── Ollama availability ────────────────────────────────────────────────────
  async function _ollamaAvailable() {
    try {
      const r = await _withTimeout(fetch(`${OLLAMA_URL}/api/tags`), 3000);
      return r.ok;
    } catch (_) { return false; }
  }

  async function _getInstalledModels() {
    try {
      const r = await _withTimeout(fetch(`${OLLAMA_URL}/api/tags`), 3000);
      if (!r.ok) return [];
      const data = await r.json();
      return (data.models || []).map(m => m.name);
    } catch (_) { return []; }
  }

  // ── Pull an Ollama model ───────────────────────────────────────────────────
  async function pullModel(name) {
    if (!name) return { ok: false, error: 'Model name required' };

    const available = await _ollamaAvailable();
    if (!available) {
      return { ok: false, error: 'Ollama not running. Start with: ollama serve' };
    }

    try {
      // Start the pull — Ollama streams progress, we wait for completion
      const res = await _withTimeout(
        fetch(`${OLLAMA_URL}/api/pull`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ name, stream: false }),
        }),
        300000, // 5 min — models are large
      );
      const data = await res.json();
      const ok = data.status && (data.status.includes('success') || data.status.includes('up to date'));
      _record('model', name, ok ? 'ok' : 'failed', data.status || '');
      return { ok, status: data.status || 'done', model: name };
    } catch (e) {
      _record('model', name, 'error', e.message);
      return { ok: false, error: e.message };
    }
  }

  // ── Remove an Ollama model from disk ──────────────────────────────────────
  async function removeModel(name) {
    if (!name) return { ok: false, error: 'Model name required' };

    const available = await _ollamaAvailable();
    if (!available) return { ok: false, error: 'Ollama not running' };

    try {
      const res = await _withTimeout(
        fetch(`${OLLAMA_URL}/api/delete`, {
          method:  'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ name }),
        }),
        30000,
      );
      const ok = res.ok || res.status === 200;
      _record('model-remove', name, ok ? 'ok' : 'failed', `HTTP ${res.status}`);
      return { ok, model: name };
    } catch (e) {
      _record('model-remove', name, 'error', e.message);
      return { ok: false, error: e.message };
    }
  }

  // ── System self-check against upgrade plan ────────────────────────────────
  async function checkUpgrades() {
    const checks = [];

    // 1. Component versions
    for (const c of COMPONENT_VERSIONS) {
      const mod = kernel ? kernel.modules.get(c.name) : null;
      const ver = mod ? (mod.version || 'unknown') : c.version;
      checks.push({
        category: 'component',
        name:     c.name,
        current:  ver,
        target:   c.version,
        status:   (ver === c.version) ? 'current' : 'mismatch',
      });
    }

    // 2. Ollama + models
    const ollamaUp       = await _ollamaAvailable();
    const installedModels = ollamaUp ? await _getInstalledModels() : [];
    checks.push({
      category: 'ollama',
      name:     'ollama-server',
      current:  ollamaUp ? 'running' : 'offline',
      target:   'running',
      status:   ollamaUp ? 'current' : 'action-required',
    });

    for (const m of RECOMMENDED_MODELS) {
      const base      = m.name.split(':')[0].toLowerCase();
      const installed = installedModels.some(n => n.split(':')[0].toLowerCase() === base);
      checks.push({
        category:   'model',
        name:       m.name,
        sizeMB:     m.sizeMB,
        purpose:    m.purpose,
        current:    installed ? 'installed' : 'not-installed',
        target:     'installed',
        status:     installed ? 'current' : 'optional',
      });
    }

    // 3. Health snapshot
    const health = diagnostics ? diagnostics.captureHealth() : null;
    if (health) {
      checks.push({
        category: 'health',
        name:     'memory',
        current:  `${health.memory.usedPct}%`,
        target:   '<90%',
        status:   health.memory.usedPct < 90 ? 'current' : 'warn',
      });
    }

    return checks;
  }

  // ── Runtime config ─────────────────────────────────────────────────────────
  function setConfig(key, value) {
    if (!key) return { ok: false, error: 'key required' };
    const old = _config.get(key);
    _config.set(key, value);
    _record('config', key, 'ok', `${old} → ${value}`);
    if (kernel) kernel.bus.emit('upgrade:config', { key, value, old });
    return { ok: true, key, value };
  }

  function getConfig(key) {
    if (key) return { ok: true, key, value: _config.get(key) };
    return { ok: true, config: Object.fromEntries(_config) };
  }

  // ── Plan summary ──────────────────────────────────────────────────────────
  async function getPlan() {
    const checks      = await checkUpgrades();
    const actionItems = checks.filter(c => c.status !== 'current');
    const required    = actionItems.filter(c => c.status === 'action-required');
    const optional    = actionItems.filter(c => c.status === 'optional');
    const warnings    = actionItems.filter(c => c.status === 'warn');
    return { checks, required, optional, warnings };
  }

  // ── Format the upgrade plan for display ───────────────────────────────────
  // Box is exactly 62 chars wide between the ║ walls.
  // _box(text) pads content to fill one box row.
  const BOX_WIDTH = 62;
  function _box(text) { return `║  ${text.padEnd(BOX_WIDTH - 2)}║`; }
  const _sep  = `╠${'═'.repeat(BOX_WIDTH)}╣`;
  const _top  = `╔${'═'.repeat(BOX_WIDTH)}╗`;
  const _bot  = `╚${'═'.repeat(BOX_WIDTH)}╝`;

  async function _buildPlanDisplay() {
    const plan   = await getPlan();
    const lines  = [];

    lines.push(_top);
    lines.push(_box('AIOS Upgrade Manager v1.0.0 — System Status'));
    lines.push(_sep);

    // Components
    const comps = plan.checks.filter(c => c.category === 'component');
    const compHeader = `COMPONENTS (${comps.length} modules — all ${comps.every(c => c.status === 'current') ? 'current ✓' : 'check below'})`;
    lines.push(_box(compHeader));
    for (const c of comps) {
      const icon = c.status === 'current' ? '✓' : '⚠';
      lines.push(_box(`${icon} ${c.name.padEnd(26)} v${c.current}`));
    }

    // Ollama
    const oll = plan.checks.find(c => c.category === 'ollama');
    if (oll) {
      lines.push(_sep);
      const icon = oll.status === 'current' ? '✓' : '✗';
      lines.push(_box(`${icon} Ollama server  ${oll.current}`));
      if (oll.status !== 'current') {
        lines.push(_box('  → Run: ollama serve'));
      }
    }

    // Models
    const models = plan.checks.filter(c => c.category === 'model');
    if (models.length) {
      lines.push(_sep);
      lines.push(_box('AI MODELS (phone-first — install at least one)'));
      for (const m of models) {
        const icon = m.status === 'current' ? '✓' : '○';
        const size = `${m.sizeMB}MB`.padEnd(7);
        lines.push(_box(`${icon} ${m.name.padEnd(16)} ${size}  ${m.purpose.slice(0, 28)}`));
        if (m.status !== 'current') {
          lines.push(_box(`  → upgrade model ${m.name}`));
        }
      }
    }

    // Required actions
    if (plan.required.length) {
      lines.push(_sep);
      lines.push(_box(`⚠ REQUIRED ACTIONS (${plan.required.length})`));
      for (const r of plan.required) {
        lines.push(_box(`  • ${r.name}: ${r.status}`));
      }
    }

    lines.push(_bot);
    return lines.join('\n');
  }

  // ── History display ───────────────────────────────────────────────────────
  function _buildHistoryDisplay(n) {
    const count   = typeof n === 'number' && n > 0 ? n : 20;
    const entries = _history.slice(-count);
    if (!entries.length) return 'No upgrade history yet.';
    const lines   = entries.map(e =>
      `  ${e.ts.slice(0, 19)}  ${e.type.padEnd(14)} ${e.target.padEnd(24)} ${e.result}`);
    return [`Upgrade history (${entries.length} entries):`, ...lines].join('\n');
  }

  // ── Terminal commands ─────────────────────────────────────────────────────
  const commands = {
    async upgrade(args) {
      const sub = (Array.isArray(args) ? (args[0] || '') : String(args || '')).toLowerCase();

      // ── upgrade (no args) or upgrade plan ───────────────────────────────
      if (!sub || sub === 'plan') {
        const display = await _buildPlanDisplay();
        return { status: 'ok', result: display };
      }

      // ── upgrade status ───────────────────────────────────────────────────
      if (sub === 'status') {
        const lines = COMPONENT_VERSIONS.map(c => {
          const mod = kernel ? kernel.modules.get(c.name) : null;
          const ver = mod ? (mod.version || c.version) : c.version;
          return `  ✓ ${c.name.padEnd(28)} v${ver.padEnd(8)} ${c.status}`;
        });
        return {
          status: 'ok',
          result: [
            `AIOS Component Status`,
            `─`.repeat(50),
            ...lines,
          ].join('\n'),
        };
      }

      // ── upgrade check ────────────────────────────────────────────────────
      if (sub === 'check') {
        const checks  = await checkUpgrades();
        const issues  = checks.filter(c => c.status !== 'current');
        const ok      = issues.filter(c => c.status === 'current').length;
        const lines   = [
          `Upgrade check: ${checks.length - issues.length}/${checks.length} items current`,
        ];
        for (const c of issues) {
          lines.push(`  ⚠ ${c.name.padEnd(28)} ${c.status}  (have: ${c.current}  need: ${c.target})`);
        }
        if (!issues.length) lines.push('  All items current. System is up to date. ✓');
        return { status: 'ok', result: lines.join('\n') };
      }

      // ── upgrade history ──────────────────────────────────────────────────
      if (sub === 'history') {
        const n = parseInt((Array.isArray(args) ? args[1] : null) || '20', 10);
        return { status: 'ok', result: _buildHistoryDisplay(isNaN(n) ? 20 : n) };
      }

      // ── upgrade model <name> ─────────────────────────────────────────────
      if (sub === 'model') {
        const modelName = Array.isArray(args) ? (args[1] || '').trim() : '';
        if (!modelName) {
          const installed = await _getInstalledModels();
          const lines = RECOMMENDED_MODELS.map(m => {
            const base = m.name.split(':')[0].toLowerCase();
            const have = installed.some(n => n.split(':')[0].toLowerCase() === base);
            return `  ${have ? '✓' : '○'} ${m.name.padEnd(18)} ${String(m.sizeMB).padEnd(6)}MB  ${m.purpose}`;
          });
          return {
            status: 'ok',
            result: [
              'Recommended AI models (usage: upgrade model <name>):',
              ...lines,
              '',
              installed.length ? `Currently installed: ${installed.join(', ')}` : 'No models installed.',
            ].join('\n'),
          };
        }
        process.stdout.write(`[UPGRADE] Pulling model: ${modelName} — this may take several minutes…\n`);
        const r = await pullModel(modelName);
        if (r.ok) {
          return { status: 'ok',   result: `[UPGRADE] Model ${modelName} installed successfully. ✓` };
        }
        return { status: 'error', result: `[UPGRADE] Failed to pull ${modelName}: ${r.error}` };
      }

      // ── upgrade model-remove <name> ──────────────────────────────────────
      if (sub === 'model-remove') {
        const modelName = Array.isArray(args) ? (args[1] || '').trim() : '';
        if (!modelName) return { status: 'error', result: 'Usage: upgrade model-remove <name>' };
        const r = await removeModel(modelName);
        if (r.ok) return { status: 'ok',   result: `[UPGRADE] Model ${modelName} removed. ✓` };
        return { status: 'error', result: `[UPGRADE] Failed to remove ${modelName}: ${r.error}` };
      }

      // ── upgrade config <key> <value> ─────────────────────────────────────
      if (sub === 'config') {
        const key   = Array.isArray(args) ? (args[1] || '').trim() : '';
        const value = Array.isArray(args) ? (args.slice(2).join(' ').trim()) : '';
        if (!key) {
          const cfg = getConfig();
          const entries = Object.entries(cfg.config);
          if (!entries.length) return { status: 'ok', result: 'No runtime config overrides set.' };
          const lines = entries.map(([k, v]) => `  ${k.padEnd(30)} = ${v}`);
          return { status: 'ok', result: ['Runtime config:', ...lines].join('\n') };
        }
        if (!value) {
          const r = getConfig(key);
          return { status: 'ok', result: `${key} = ${r.value !== undefined ? r.value : '(not set)'}` };
        }
        const r = setConfig(key, value);
        return { status: 'ok', result: `[UPGRADE] Config set: ${key} = ${value} ✓` };
      }

      return {
        status: 'ok',
        result: [
          'Usage: upgrade <command>',
          '  upgrade               — show full upgrade plan',
          '  upgrade status        — component version matrix',
          '  upgrade plan          — recommended actions',
          '  upgrade check         — verify everything is current',
          '  upgrade history [n]   — show last n upgrades (default: 20)',
          '  upgrade model         — list AI models',
          '  upgrade model <name>  — pull a model (e.g. phi3, qwen2:0.5b)',
          '  upgrade model-remove <name>  — remove installed model',
          '  upgrade config <k> <v>       — set runtime config',
        ].join('\n'),
      };
    },
  };

  return {
    name:         'upgrade-manager',
    version:      '1.0.0',
    // Public API
    pullModel,
    removeModel,
    checkUpgrades,
    getPlan,
    setConfig,
    getConfig,
    history:      () => _history.slice(),
    // Router commands
    commands,
  };
}

module.exports = { createUpgradeManager, COMPONENT_VERSIONS, RECOMMENDED_MODELS };
