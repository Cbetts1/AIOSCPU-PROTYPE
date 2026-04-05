'use strict';
/**
 * diagnostics-engine.js — AIOS Diagnostics Engine v1.0.0
 *
 * Monitors models, ports, and overall system health.
 *
 * Responsibilities:
 *   - Collect and report system health snapshots (CPU, memory, uptime)
 *   - Track registered model endpoints and their reachability status
 *   - Track registered port entries and their open/closed status
 *   - Emit kernel bus events when health thresholds are crossed
 *   - Provide a polling loop (optional) for background monitoring
 *
 * Zero external npm dependencies.
 */

const os = require('os');

const DIAGNOSTICS_VERSION = '1.0.0';

// Health status values
const STATUS = Object.freeze({
  OK:      'ok',
  WARN:    'warn',
  FAIL:    'fail',
  UNKNOWN: 'unknown',
});

// ---------------------------------------------------------------------------
// createDiagnosticsEngine
// ---------------------------------------------------------------------------
/**
 * @param {object} kernel          - AIOS kernel instance
 * @param {object} [hostBridge]    - optional host-bridge for extra OS stats
 * @param {object} [opts]
 * @param {number} [opts.memWarnThresholdPct=85]  - % RAM used before WARN
 * @param {number} [opts.memFailThresholdPct=95]  - % RAM used before FAIL
 * @param {number} [opts.pollIntervalMs=60000]    - background poll interval (0 = disabled)
 */
function createDiagnosticsEngine(kernel, hostBridge, opts = {}) {
  const MEM_WARN = opts.memWarnThresholdPct != null ? opts.memWarnThresholdPct : 85;
  const MEM_FAIL = opts.memFailThresholdPct != null ? opts.memFailThresholdPct : 95;
  const POLL_MS  = opts.pollIntervalMs      != null ? opts.pollIntervalMs      : 60000;

  const _models  = new Map();   // name → { name, endpoint, status, lastChecked, latencyMs }
  const _ports   = new Map();   // port  → { port, protocol, status, lastChecked }
  const _snapshots = [];        // health snapshots (capped at 100)
  let   _pollTimer = null;
  let   _running   = false;

  // ── Helpers ───────────────────────────────────────────────────────────────
  function _now() { return new Date().toISOString(); }

  function _trimSnapshots() {
    if (_snapshots.length > 100) _snapshots.splice(0, _snapshots.length - 100);
  }

  // ── System health snapshot ─────────────────────────────────────────────────

  /**
   * Capture a health snapshot from the host OS.
   * @returns {{ ts, cpu, memory, uptime, status }}
   */
  function captureHealth() {
    const totalMem = os.totalmem();
    const freeMem  = os.freemem();
    const usedMem  = totalMem - freeMem;
    const usedPct  = totalMem > 0 ? Math.round((usedMem / totalMem) * 100) : 0;

    const loadAvg  = os.loadavg();   // [1m, 5m, 15m]
    const cpuCount = os.cpus().length;

    let memStatus = STATUS.OK;
    if (usedPct >= MEM_FAIL) memStatus = STATUS.FAIL;
    else if (usedPct >= MEM_WARN) memStatus = STATUS.WARN;

    const snapshot = {
      ts:      _now(),
      cpu: {
        cores:    cpuCount,
        loadAvg1: Number(loadAvg[0].toFixed(2)),
        loadAvg5: Number(loadAvg[1].toFixed(2)),
        model:    (os.cpus()[0] || {}).model || 'unknown',
      },
      memory: {
        totalMB:  Math.round(totalMem / 1048576),
        usedMB:   Math.round(usedMem  / 1048576),
        freeMB:   Math.round(freeMem  / 1048576),
        usedPct,
        status:   memStatus,
      },
      uptime: {
        hostSec:  Math.round(os.uptime()),
        aiosSec:  kernel ? Math.round(kernel.uptime()) : 0,
      },
      status: memStatus,
    };

    _snapshots.push(snapshot);
    _trimSnapshots();

    if (kernel && kernel.bus && memStatus !== STATUS.OK) {
      kernel.bus.emit('diagnostics:health:warn', { status: memStatus, snapshot });
    }

    return snapshot;
  }

  /** Return the most recent snapshot (captures a new one if none exist) */
  function getHealth() {
    if (_snapshots.length === 0) return captureHealth();
    return _snapshots[_snapshots.length - 1];
  }

  /** Return last N snapshots */
  function getSnapshots(limit = 10) {
    return _snapshots.slice(-limit).reverse();
  }

  // ── Model monitoring ───────────────────────────────────────────────────────

  /**
   * Register a model endpoint for monitoring.
   * @param {string} name       - model identifier (e.g. 'llama3', 'mistral')
   * @param {string} endpoint   - URL or path
   */
  function registerModel(name, endpoint) {
    _models.set(String(name), {
      name:        String(name),
      endpoint:    String(endpoint || ''),
      status:      STATUS.UNKNOWN,
      lastChecked: null,
      latencyMs:   null,
    });
  }

  /**
   * Report a model's health (called externally after a probe).
   * @param {string} name
   * @param {boolean} reachable
   * @param {number}  [latencyMs]
   */
  function reportModel(name, reachable, latencyMs) {
    const entry = _models.get(String(name));
    if (!entry) return { ok: false, error: `Model "${name}" not registered` };
    entry.status      = reachable ? STATUS.OK : STATUS.FAIL;
    entry.lastChecked = _now();
    entry.latencyMs   = latencyMs != null ? Number(latencyMs) : null;
    if (kernel && kernel.bus) {
      kernel.bus.emit('diagnostics:model', { name, status: entry.status });
    }
    return { ok: true };
  }

  /** Get status for all registered models */
  function getModels() {
    return Array.from(_models.values()).map(m => Object.assign({}, m));
  }

  // ── Port monitoring ────────────────────────────────────────────────────────

  /**
   * Register a port for monitoring.
   * @param {number} port
   * @param {string} [protocol='tcp']
   * @param {string} [description]
   */
  function registerPort(port, protocol, description) {
    _ports.set(Number(port), {
      port:        Number(port),
      protocol:    String(protocol  || 'tcp'),
      description: String(description || ''),
      status:      STATUS.UNKNOWN,
      lastChecked: null,
    });
  }

  /**
   * Report a port's status.
   * @param {number} port
   * @param {boolean} open
   */
  function reportPort(port, open) {
    const entry = _ports.get(Number(port));
    if (!entry) return { ok: false, error: `Port ${port} not registered` };
    entry.status      = open ? STATUS.OK : STATUS.FAIL;
    entry.lastChecked = _now();
    if (kernel && kernel.bus) {
      kernel.bus.emit('diagnostics:port', { port, status: entry.status });
    }
    return { ok: true };
  }

  /** Get status for all registered ports */
  function getPorts() {
    return Array.from(_ports.values()).map(p => Object.assign({}, p));
  }

  // ── Polling loop ───────────────────────────────────────────────────────────

  function start() {
    if (_running || POLL_MS <= 0) return;
    _running   = true;
    captureHealth();   // immediate first snapshot
    _pollTimer = setInterval(() => captureHealth(), POLL_MS);
  }

  function stop() {
    _running = false;
    if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
  }

  // ── Router command interface ───────────────────────────────────────────────
  function dispatch(args) {
    const sub = (args[0] || 'status').toLowerCase().trim();

    if (sub === 'status') {
      const h = getHealth();
      const lines = [
        `Diagnostics Engine v${DIAGNOSTICS_VERSION}`,
        `  Health  : ${h.status.toUpperCase()}`,
        `  Memory  : ${h.memory.usedMB}/${h.memory.totalMB} MB used (${h.memory.usedPct}%)`,
        `  CPU     : ${h.cpu.cores} cores  load=${h.cpu.loadAvg1}`,
        `  Uptime  : host=${h.uptime.hostSec}s  aios=${h.uptime.aiosSec}s`,
        `  Models  : ${_models.size}  Ports: ${_ports.size}`,
      ];
      return { status: 'ok', result: lines.join('\n') };
    }

    if (sub === 'models') {
      const list = getModels();
      if (!list.length) return { status: 'ok', result: 'No models registered.' };
      const lines = list.map(m =>
        `  ${m.name.padEnd(16)} ${m.status.padEnd(8)} ${m.endpoint}` +
        (m.latencyMs != null ? `  (${m.latencyMs}ms)` : '')
      );
      return { status: 'ok', result: ['Models:', ...lines].join('\n') };
    }

    if (sub === 'ports') {
      const list = getPorts();
      if (!list.length) return { status: 'ok', result: 'No ports registered.' };
      const lines = list.map(p =>
        `  ${String(p.port).padEnd(6)} ${p.protocol.padEnd(5)} ${p.status.padEnd(8)} ${p.description}`
      );
      return { status: 'ok', result: ['Ports:', ...lines].join('\n') };
    }

    if (sub === 'history') {
      const snaps = getSnapshots(parseInt(args[1], 10) || 5);
      if (!snaps.length) return { status: 'ok', result: 'No snapshots yet.' };
      const lines = snaps.map(s =>
        `  [${s.ts.slice(11, 19)}] mem=${s.memory.usedPct}%  load=${s.cpu.loadAvg1}  status=${s.status}`
      );
      return { status: 'ok', result: ['Health history:', ...lines].join('\n') };
    }

    if (sub === 'check') {
      const snap = captureHealth();
      return { status: 'ok', result: `Health check complete — status: ${snap.status.toUpperCase()}` };
    }

    return {
      status: 'ok',
      result: 'Usage: diagnostics <status|models|ports|history [n]|check>',
    };
  }

  return {
    name:    'diagnostics-engine',
    version: DIAGNOSTICS_VERSION,
    STATUS,
    // Core API
    captureHealth,
    getHealth,
    getSnapshots,
    registerModel,
    reportModel,
    getModels,
    registerPort,
    reportPort,
    getPorts,
    start,
    stop,
    // Router integration
    commands: { diagnostics: dispatch },
  };
}

module.exports = { createDiagnosticsEngine, STATUS };
