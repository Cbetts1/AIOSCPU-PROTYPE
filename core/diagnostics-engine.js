'use strict';
/**
 * diagnostics-engine.js — AIOS Diagnostics Engine v1.0.0
 *
 * Provides comprehensive system diagnostics and health reporting for AIOS.
 *
 * Features:
 *   - System health checks (kernel, VFS, CPU, memory)
 *   - AI model validation (via model-registry)
 *   - Service health checks
 *   - Port server status
 *   - Full integration report generation
 *   - `diag` terminal command
 *
 * Zero external npm dependencies.
 */

const os = require('os');

// ---------------------------------------------------------------------------
// Diagnostics Engine factory
// ---------------------------------------------------------------------------
function createDiagnosticsEngine(kernel, hostBridge, svcMgr, modelRegistry, portServer, vfs) {
  let _lastReport = null;

  // ── Helpers ──────────────────────────────────────────────────────────────

  function _ts() { return new Date().toISOString(); }

  function _mb(bytes) { return Math.round(bytes / 1024 / 1024); }

  // ── System health check ───────────────────────────────────────────────────

  /**
   * Check core AIOS system health.
   * @returns {{ ok: boolean, checks: object[] }}
   */
  function checkSystem() {
    const checks = [];

    // Kernel
    checks.push({
      name:   'kernel',
      ok:     Boolean(kernel && kernel.isBooted()),
      detail: kernel ? `v${kernel.version} uptime=${kernel.uptime()}s` : 'not available',
    });

    // VFS
    const vfsCheck = vfs ? (() => {
      try { const r = vfs.ls('/'); return r && (r.ok !== false); }
      catch (_) { return false; }
    })() : false;
    checks.push({
      name:   'vfs',
      ok:     vfsCheck,
      detail: vfsCheck ? 'mounted' : 'unavailable',
    });

    // Host bridge / memory
    if (hostBridge) {
      const m = hostBridge.memInfo();
      checks.push({
        name:   'host-memory',
        ok:     m.ok,
        detail: m.ok ? `${m.freeMB}MB free / ${m.totalMB}MB total (${m.usedPercent}% used)` : 'unavailable',
      });
    }

    // Node.js process memory
    const nodeHeap = process.memoryUsage();
    checks.push({
      name:   'node-heap',
      ok:     true,
      detail: `used=${_mb(nodeHeap.heapUsed)}MB / total=${_mb(nodeHeap.heapTotal)}MB rss=${_mb(nodeHeap.rss)}MB`,
    });

    // OS load average (Unix only)
    const load = os.loadavg();
    checks.push({
      name:   'cpu-load',
      ok:     load[0] < os.cpus().length * 2,  // warn if load > 2× cpu count
      detail: `1m=${load[0].toFixed(2)} 5m=${load[1].toFixed(2)} 15m=${load[2].toFixed(2)} (${os.cpus().length} CPUs)`,
    });

    // Uptime
    checks.push({
      name:   'node-uptime',
      ok:     true,
      detail: `${Math.round(process.uptime())}s`,
    });

    const passed = checks.filter(c => c.ok).length;
    return { ok: passed === checks.length, checks, passed, total: checks.length };
  }

  // ── Service health check ──────────────────────────────────────────────────

  function checkServices() {
    if (!svcMgr) return { ok: true, checks: [], note: 'service manager not available' };
    const svcs = svcMgr.list();
    const checks = svcs.map(s => ({
      name:   s.name,
      ok:     s.state === 'running',
      detail: s.state,
    }));
    const failed = checks.filter(c => !c.ok);
    return { ok: failed.length === 0, checks, failed: failed.length, total: checks.length };
  }

  // ── Model health check ────────────────────────────────────────────────────

  async function checkModels() {
    if (!modelRegistry) return { ok: true, checks: [], note: 'model registry not available' };
    const models = modelRegistry.list();
    const results = [];
    for (const m of models) {
      const v = await modelRegistry.validate(m.name);
      results.push({
        name:   m.name,
        ok:     v.ok,
        score:  v.score,
        detail: `score=${v.score}% type=${m.type} modes=${m.modes.join(',')}`,
      });
    }
    const healthy = results.filter(r => r.ok).length;
    return { ok: healthy > 0, checks: results, healthy, total: results.length };
  }

  // ── Port server check ─────────────────────────────────────────────────────

  function checkPortServer() {
    if (!portServer) return { ok: false, detail: 'port server not initialised' };
    const s = portServer.status();
    return {
      ok:     s.started,
      detail: s.started
        ? `listening on port ${s.port} — ${s.requests} requests served`
        : 'stopped',
    };
  }

  // ── Full diagnostics run ──────────────────────────────────────────────────

  /**
   * Run all diagnostic checks.
   * @returns {Promise<object>} Diagnostics result object
   */
  async function runDiagnostics() {
    const started = _ts();

    const system   = checkSystem();
    const services = checkServices();
    const models   = await checkModels();
    const port     = checkPortServer();

    const allOk = system.ok && services.ok && models.ok;

    const result = {
      ts:       started,
      healthy:  allOk,
      system,
      services,
      models,
      port,
    };

    _lastReport = result;
    if (kernel) kernel.bus.emit('diagnostics:run', { healthy: allOk, ts: started });
    return result;
  }

  // ── Report generation ─────────────────────────────────────────────────────

  /**
   * Generate a human-readable integration report.
   * @returns {Promise<string>}
   */
  async function generateReport() {
    const diag = await runDiagnostics();
    const lines = [];

    const line = (t) => lines.push(t);
    const sep  = () => line('─'.repeat(60));
    const tick = (ok) => ok ? '✓' : '✗';

    line('');
    line('╔══════════════════════════════════════════════════════════╗');
    line('║          AIOS Integration & Diagnostics Report          ║');
    line(`║  Generated : ${diag.ts.replace('T', ' ').slice(0, 19).padEnd(44)}║`);
    line('╚══════════════════════════════════════════════════════════╝');
    line('');

    // System health
    line('SYSTEM HEALTH');
    sep();
    diag.system.checks.forEach(c => {
      line(`  ${tick(c.ok)}  ${c.name.padEnd(20)}  ${c.detail}`);
    });
    line(`  Result: ${diag.system.passed}/${diag.system.total} checks passed`);
    line('');

    // Models
    line('AI MODELS');
    sep();
    if (diag.models.checks.length === 0) {
      line('  No models registered.');
    } else {
      diag.models.checks.forEach(c => {
        line(`  ${tick(c.ok)}  ${c.name.padEnd(32)}  ${c.detail}`);
      });
      line(`  Result: ${diag.models.healthy}/${diag.models.total} models healthy`);
    }
    line('');

    // Services
    line('SERVICES');
    sep();
    if (diag.services.checks.length === 0) {
      line('  No services registered.');
    } else {
      diag.services.checks.forEach(c => {
        line(`  ${tick(c.ok)}  ${c.name.padEnd(30)}  ${c.detail}`);
      });
      line(`  Result: ${diag.services.total - diag.services.failed}/${diag.services.total} services running`);
    }
    line('');

    // Port Server
    line('PORT SERVER');
    sep();
    line(`  ${tick(diag.port.ok)}  ${diag.port.detail}`);
    line('');

    // Overall
    line('OVERALL STATUS');
    sep();
    line(`  System health : ${diag.healthy ? '✓ HEALTHY' : '✗ DEGRADED'}`);
    line('');

    return lines.join('\n');
  }

  // ── Last report accessor ───────────────────────────────────────────────────

  function getLastReport() { return _lastReport; }

  // ── Router command interface ───────────────────────────────────────────────

  const commands = {
    async diag(args) {
      const sub = (args[0] || 'run').toLowerCase();

      if (sub === 'run' || sub === 'check') {
        const d = await runDiagnostics();
        const systemIcon  = d.system.ok   ? '✓' : '✗';
        const modelsIcon  = d.models.ok   ? '✓' : '✗';
        const svcsIcon    = d.services.ok ? '✓' : '✗';
        const portIcon    = d.port.ok     ? '✓' : '✗';
        return {
          status: 'ok',
          result: [
            `Diagnostics — ${d.ts}`,
            `  ${systemIcon} System   : ${d.system.passed}/${d.system.total} checks`,
            `  ${modelsIcon} Models   : ${d.models.healthy}/${d.models.total} healthy`,
            `  ${svcsIcon} Services : ${d.services.total - d.services.failed}/${d.services.total} running`,
            `  ${portIcon} Port     : ${d.port.detail}`,
            '',
            `Overall: ${d.healthy ? '✓ HEALTHY' : '✗ DEGRADED'}`,
          ].join('\n'),
        };
      }

      if (sub === 'report') {
        const report = await generateReport();
        return { status: 'ok', result: report };
      }

      if (sub === 'system') {
        const s = checkSystem();
        const lines = s.checks.map(c => `  ${c.ok ? '✓' : '✗'} ${c.name.padEnd(20)} ${c.detail}`);
        return { status: 'ok', result: ['System health:', ...lines].join('\n') };
      }

      if (sub === 'services') {
        const s = checkServices();
        if (!s.checks.length) return { status: 'ok', result: 'No services.' };
        const lines = s.checks.map(c => `  ${c.ok ? '✓' : '✗'} ${c.name.padEnd(30)} ${c.detail}`);
        return { status: 'ok', result: ['Services:', ...lines].join('\n') };
      }

      if (sub === 'models') {
        const m = await checkModels();
        if (!m.checks.length) return { status: 'ok', result: 'No models.' };
        const lines = m.checks.map(c => `  ${c.ok ? '✓' : '✗'} ${c.name.padEnd(32)} ${c.detail}`);
        return { status: 'ok', result: ['Models:', ...lines].join('\n') };
      }

      return {
        status: 'ok',
        result: 'Usage: diag <run|report|system|services|models>',
      };
    },
  };

  return {
    name:           'diagnostics-engine',
    version:        '1.0.0',
    checkSystem,
    checkServices,
    checkModels,
    checkPortServer,
    runDiagnostics,
    generateReport,
    getLastReport,
    commands,
  };
}

module.exports = { createDiagnosticsEngine };
