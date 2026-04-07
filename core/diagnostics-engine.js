'use strict';
/**
 * diagnostics-engine.js — AIOS Diagnostics Engine v1.0.0
 *
 * Real-time system health monitoring, AI model tracking, and port monitoring.
 * Phone-friendly: works without hostBridge, uses native os module for data.
 * Zero external npm dependencies.
 *
 * API
 * ───
 *   captureHealth()            — take a live OS health snapshot
 *   getHealth()                — return last snapshot (or fresh if none)
 *   getSnapshots(n)            — return last n snapshots from history
 *   registerModel(name, url)   — register an AI model for tracking
 *   reportModel(name, ok, ms)  — update model status (latency in ms)
 *   getModels()                — list all registered models
 *   registerPort(port, proto, label) — register a port for monitoring
 *   reportPort(port, ok)       — update port status
 *   getPorts()                 — list all registered ports
 *   start()                    — start periodic health polling
 *   stop()                     — stop polling
 *   commands.diagnostics([..]) — terminal command handler
 *
 * Exported constants
 * ──────────────────
 *   STATUS.OK | WARN | FAIL | UNKNOWN
 *
 * Constructor
 * ───────────
 *   createDiagnosticsEngine(kernel, hostBridge, opts)
 *   opts: { pollIntervalMs: 60000 }   — 0 = no polling
 */

const os = require('os');

// ---------------------------------------------------------------------------
// Status constants
// ---------------------------------------------------------------------------
const STATUS = {
  OK:      'ok',
  WARN:    'warn',
  FAIL:    'fail',
  UNKNOWN: 'unknown',
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------
function createDiagnosticsEngine(kernel, hostBridge, opts) {
  // Support both the new 3-arg call and the old 6-arg call gracefully.
  // New: createDiagnosticsEngine(kernel, hostBridge, { pollIntervalMs })
  // Old: createDiagnosticsEngine(kernel, hostBridge, svcMgr, modelReg, portSrv, vfs)
  function _resolvePollInterval(o) {
    if (o && typeof o === 'object' && 'pollIntervalMs' in o) {
      return typeof o.pollIntervalMs === 'number' ? o.pollIntervalMs : 60000;
    }
    return 60000;
  }
  const pollIntervalMs = _resolvePollInterval(opts);

  // ── Internal state ────────────────────────────────────────────────────────
  const _snapshots  = [];           // health history (ring buffer, max 100)
  const _models     = new Map();    // name → model record
  const _ports      = new Map();    // portNumber → port record
  let   _lastSnap   = null;
  let   _pollTimer  = null;
  const MAX_SNAPS   = 100;

  // ── Helpers ───────────────────────────────────────────────────────────────
  function _ts() { return new Date().toISOString(); }

  // ── Health capture ────────────────────────────────────────────────────────
  /**
   * Take a live OS health snapshot.
   * @returns {{ ts, uptime, status, cpu, memory }}
   */
  function captureHealth() {
    const totalBytes = os.totalmem();
    const freeBytes  = os.freemem();
    const usedBytes  = totalBytes - freeBytes;
    const usedPct    = Math.round((usedBytes / totalBytes) * 100);
    const cpus       = os.cpus();
    const load       = os.loadavg();
    const up         = kernel ? kernel.uptime() : Math.round(process.uptime());

    const snap = {
      ts:      _ts(),
      uptime:  up,
      status:  usedPct > 90 ? STATUS.WARN : STATUS.OK,
      cpu: {
        cores:    cpus.length,
        model:    (cpus[0] && cpus[0].model) ? cpus[0].model : 'unknown',
        loadAvg1: parseFloat(load[0].toFixed(2)),
        loadAvg5: parseFloat(load[1].toFixed(2)),
      },
      memory: {
        totalMB: Math.round(totalBytes / 1024 / 1024),
        usedMB:  Math.round(usedBytes  / 1024 / 1024),
        freeMB:  Math.round(freeBytes  / 1024 / 1024),
        usedPct,
      },
    };

    _snapshots.push(snap);
    if (_snapshots.length > MAX_SNAPS) _snapshots.shift();
    _lastSnap = snap;
    if (kernel) kernel.bus.emit('diagnostics:health', snap);
    return snap;
  }

  /**
   * Return last captured snapshot, or capture a fresh one if none exists.
   */
  function getHealth() {
    return _lastSnap || captureHealth();
  }

  /**
   * Return last n snapshots from history.
   * @param {number} n - max number of snapshots to return
   */
  function getSnapshots(n) {
    const count = (typeof n === 'number' && n > 0) ? n : _snapshots.length;
    return _snapshots.slice(-count);
  }

  // ── Model monitoring ──────────────────────────────────────────────────────
  /**
   * Register an AI model for health tracking.
   * @param {string} name     — model name (e.g. 'llama3', 'phi3')
   * @param {string} endpoint — Ollama endpoint URL
   */
  function registerModel(name, endpoint) {
    _models.set(name, {
      name,
      endpoint:  endpoint || '',
      status:    STATUS.UNKNOWN,
      latencyMs: null,
      lastCheck: null,
    });
  }

  /**
   * Report the current health of a registered model.
   * @param {string}  name      — model name
   * @param {boolean} healthy   — true = reachable, false = failed
   * @param {number}  [latencyMs] — optional response latency
   * @returns {{ ok: boolean, error?: string }}
   */
  function reportModel(name, healthy, latencyMs) {
    if (!_models.has(name)) {
      return { ok: false, error: `Model "${name}" not registered` };
    }
    const m     = _models.get(name);
    m.status    = healthy ? STATUS.OK : STATUS.FAIL;
    m.latencyMs = (latencyMs !== undefined && latencyMs !== null) ? latencyMs : null;
    m.lastCheck = _ts();
    if (kernel) kernel.bus.emit('diagnostics:model', {
      name: m.name, status: m.status, latencyMs: m.latencyMs,
    });
    return { ok: true };
  }

  /** Return all registered models as an array. */
  function getModels() {
    return Array.from(_models.values());
  }

  // ── Port monitoring ───────────────────────────────────────────────────────
  /**
   * Register a port for health tracking.
   * @param {number} port     — port number
   * @param {string} protocol — 'tcp' | 'udp'
   * @param {string} label    — human-readable description
   */
  function registerPort(port, protocol, label) {
    _ports.set(port, {
      port,
      protocol:  protocol || 'tcp',
      label:     label    || '',
      status:    STATUS.UNKNOWN,
      lastCheck: null,
    });
  }

  /**
   * Report the current status of a registered port.
   * @param {number}  port    — port number
   * @param {boolean} healthy — true = open / reachable, false = failed
   * @returns {{ ok: boolean, error?: string }}
   */
  function reportPort(port, healthy) {
    if (!_ports.has(port)) {
      return { ok: false, error: `Port ${port} not registered` };
    }
    const p   = _ports.get(port);
    p.status    = healthy ? STATUS.OK : STATUS.FAIL;
    p.lastCheck = _ts();
    if (kernel) kernel.bus.emit('diagnostics:port', {
      port: p.port, status: p.status, protocol: p.protocol,
    });
    return { ok: true };
  }

  /** Return all registered ports as an array. */
  function getPorts() {
    return Array.from(_ports.values());
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  /** Start periodic health polling (no-op if pollIntervalMs is 0). */
  function start() {
    if (_pollTimer || !pollIntervalMs) return;
    _pollTimer = setInterval(captureHealth, pollIntervalMs);
    _pollTimer.unref();
  }

  /** Stop periodic polling and clear the timer. */
  function stop() {
    if (_pollTimer) {
      clearInterval(_pollTimer);
      _pollTimer = null;
    }
  }

  // ── Terminal commands ─────────────────────────────────────────────────────
  const commands = {
    diagnostics(args) {
      const sub = (Array.isArray(args) ? (args[0] || '') : String(args || '')).toLowerCase();

      // ── status ────────────────────────────────────────────────────────────
      if (!sub || sub === 'status') {
        const h = getHealth();
        return {
          status: 'ok',
          result: [
            `Diagnostics Engine v1.0.0`,
            `  Uptime : ${h.uptime}s`,
            `  CPU    : ${h.cpu.cores} cores  load=${h.cpu.loadAvg1}`,
            `  Memory : ${h.memory.usedMB}/${h.memory.totalMB} MB (${h.memory.usedPct}% used)`,
            `  Models : ${_models.size} registered`,
            `  Ports  : ${_ports.size} registered`,
            `  History: ${_snapshots.length} snapshots`,
          ].join('\n'),
        };
      }

      // ── check ─────────────────────────────────────────────────────────────
      if (sub === 'check') {
        const h = captureHealth();
        return {
          status: 'ok',
          result: [
            `Health check complete  (${h.ts})`,
            `  CPU    : ${h.cpu.cores} cores  load=${h.cpu.loadAvg1}`,
            `  Memory : ${h.memory.usedMB}/${h.memory.totalMB} MB (${h.memory.usedPct}% used)`,
            `  Status : ${h.status}`,
          ].join('\n'),
        };
      }

      // ── history ───────────────────────────────────────────────────────────
      if (sub === 'history') {
        const n     = parseInt((Array.isArray(args) ? args[1] : null) || '10', 10);
        const snaps = getSnapshots(isNaN(n) ? 10 : n);
        if (!snaps.length) return { status: 'ok', result: 'Health history: no snapshots yet.' };
        const lines = snaps.map(s =>
          `  ${s.ts.slice(11, 19)}  cpu=${s.cpu.loadAvg1}  mem=${s.memory.usedPct}%  ${s.status}`);
        return {
          status: 'ok',
          result: [`Health history (${snaps.length} entries):`, ...lines].join('\n'),
        };
      }

      // ── models ────────────────────────────────────────────────────────────
      if (sub === 'models') {
        const mods = getModels();
        if (!mods.length) return { status: 'ok', result: 'No models registered.' };
        const icon  = (s) => s === STATUS.OK ? '✓' : s === STATUS.FAIL ? '✗' : '?';
        const lines = mods.map(m =>
          `  ${icon(m.status)} ${m.name.padEnd(30)} ${m.status}${m.latencyMs !== null ? ` ${m.latencyMs}ms` : ''}`);
        return { status: 'ok', result: ['Models:', ...lines].join('\n') };
      }

      // ── ports ─────────────────────────────────────────────────────────────
      if (sub === 'ports') {
        const ports = getPorts();
        if (!ports.length) return { status: 'ok', result: 'No ports registered.' };
        const icon  = (s) => s === STATUS.OK ? '✓' : s === STATUS.FAIL ? '✗' : '?';
        const lines = ports.map(p =>
          `  ${icon(p.status)} ${String(p.port).padEnd(8)} ${p.protocol.padEnd(6)} ${p.label}  ${p.status}`);
        return { status: 'ok', result: ['Ports:', ...lines].join('\n') };
      }

      // ── fallthrough ───────────────────────────────────────────────────────
      return {
        status: 'ok',
        result: 'Usage: diagnostics <status|check|history [n]|models|ports>',
      };
    },
  };

  return {
    name:    'diagnostics-engine',
    version: '4.0.0',
    // Health
    captureHealth,
    getHealth,
    getSnapshots,
    // Model monitoring
    registerModel,
    reportModel,
    getModels,
    // Port monitoring
    registerPort,
    reportPort,
    getPorts,
    // Lifecycle
    start,
    stop,
    // Router commands
    commands,
  };
}

module.exports = { createDiagnosticsEngine, STATUS };
