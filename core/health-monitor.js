'use strict';
/**
 * health-monitor.js — AIOS Health Monitor v1.0.0
 *
 * Monitors system health: HTTP/HTTPS server endpoints, TCP port activity,
 * and host memory. Emits kernel bus events when issues are detected or
 * resolved. Designed to integrate with ai-core for autonomous recovery.
 *
 * Features:
 *   - Register any number of HTTP/HTTPS endpoints to probe
 *   - Register TCP ports to check for liveness
 *   - Runs all checks concurrently on a configurable interval
 *   - Emits health:endpoint:down / health:endpoint:recovered events
 *   - Emits health:port:down / health:port:recovered events
 *   - Emits health:memory:low events via hostBridge
 *   - `health` and `health check` router commands
 *   - Individual check failures never crash the monitor
 *
 * Zero external npm dependencies.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const LOW_MEMORY_THRESHOLD_MB = 50;

// ---------------------------------------------------------------------------
// HealthMonitor factory
// ---------------------------------------------------------------------------
function createHealthMonitor(kernel, network, hostBridge) {
  const _endpoints = new Map();  // name → endpoint descriptor
  const _ports     = new Map();  // name → port descriptor
  let   _running   = false;
  let   _interval  = null;
  const _stats     = { checks: 0, failures: 0, recovered: 0 };

  function _emit(event, data) {
    if (kernel) kernel.bus.emit(event, data);
  }

  // ---------------------------------------------------------------------------
  // registerEndpoint — add an HTTP/HTTPS server link to watch
  // ---------------------------------------------------------------------------
  function registerEndpoint(name, url, opts) {
    if (!name || typeof name !== 'string') throw new TypeError('Endpoint name must be a non-empty string');
    if (!url  || typeof url  !== 'string') throw new TypeError('Endpoint URL must be a non-empty string');
    _endpoints.set(name, {
      name,
      url,
      timeout:     (opts && opts.timeout) || 5000,
      lastStatus:  null,
      lastChecked: null,
      failures:    0,
      healthy:     null,  // null = never checked
    });
  }

  // ---------------------------------------------------------------------------
  // unregisterEndpoint — remove an endpoint from monitoring
  // ---------------------------------------------------------------------------
  function unregisterEndpoint(name) {
    return _endpoints.delete(name);
  }

  // ---------------------------------------------------------------------------
  // registerPort — add a TCP port to watch
  // ---------------------------------------------------------------------------
  function registerPort(name, host, port, opts) {
    if (!name || typeof name !== 'string') throw new TypeError('Port monitor name must be a non-empty string');
    const portNum = parseInt(port, 10);
    if (!portNum || portNum < 1 || portNum > 65535) throw new TypeError('Port must be a valid number 1–65535');
    _ports.set(name, {
      name,
      host:        host || '127.0.0.1',
      port:        portNum,
      timeout:     (opts && opts.timeout) || 3000,
      lastChecked: null,
      failures:    0,
      active:      null,  // null = never checked
    });
  }

  // ---------------------------------------------------------------------------
  // unregisterPort — remove a port from monitoring
  // ---------------------------------------------------------------------------
  function unregisterPort(name) {
    return _ports.delete(name);
  }

  // ---------------------------------------------------------------------------
  // _checkEndpoint — probe one HTTP/HTTPS endpoint
  // ---------------------------------------------------------------------------
  async function _checkEndpoint(ep) {
    _stats.checks++;
    ep.lastChecked = new Date().toISOString();

    if (!network) {
      ep.healthy = null;
      return;
    }

    try {
      const r = await network.get(ep.url, { timeout: ep.timeout });
      const wasHealthy = ep.healthy;
      ep.healthy    = r.ok;
      ep.lastStatus = r.status;
      ep.failures   = r.ok ? 0 : ep.failures + 1;

      if (!r.ok) {
        _stats.failures++;
        _emit('health:endpoint:down', { name: ep.name, url: ep.url, status: r.status });
      } else if (wasHealthy === false) {
        _stats.recovered++;
        _emit('health:endpoint:recovered', { name: ep.name, url: ep.url });
      }
    } catch (e) {
      const wasHealthy = ep.healthy;
      ep.healthy    = false;
      ep.lastStatus = 0;
      ep.failures++;
      _stats.failures++;
      if (wasHealthy !== false) {
        _emit('health:endpoint:down', { name: ep.name, url: ep.url, error: e.message });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // _checkPort — probe one TCP port for liveness
  // ---------------------------------------------------------------------------
  async function _checkPort(mon) {
    _stats.checks++;
    mon.lastChecked = new Date().toISOString();

    if (!network) {
      mon.active = null;
      return;
    }

    try {
      const conn = await network.tcp.connect(mon.host, mon.port, { timeout: mon.timeout });
      conn.close();
      const wasActive = mon.active;
      mon.active   = true;
      mon.failures = 0;
      if (wasActive === false) {
        _stats.recovered++;
        _emit('health:port:recovered', { name: mon.name, host: mon.host, port: mon.port });
      }
    } catch (_) {
      const wasActive = mon.active;
      mon.active = false;
      mon.failures++;
      _stats.failures++;
      if (wasActive !== false) {
        _emit('health:port:down', { name: mon.name, host: mon.host, port: mon.port });
      }
    }
  }

  // ---------------------------------------------------------------------------
  // runChecks — check all registered endpoints and ports concurrently
  // Failures in individual checks are isolated and never crash the monitor.
  // ---------------------------------------------------------------------------
  async function runChecks() {
    const tasks = [];
    for (const ep  of _endpoints.values()) tasks.push(_checkEndpoint(ep));
    for (const mon of _ports.values())     tasks.push(_checkPort(mon));

    // Check host memory via hostBridge
    if (hostBridge) {
      try {
        const m = hostBridge.memInfo();
        if (m.ok && m.freeMB < LOW_MEMORY_THRESHOLD_MB) {
          _emit('health:memory:low', { freeMB: m.freeMB, totalMB: m.totalMB });
        }
      } catch (_) {}
    }

    // Run all checks concurrently; individual failures are isolated
    await Promise.allSettled(tasks);
    _emit('health:checks:done', { endpoints: _endpoints.size, ports: _ports.size });
  }

  // ---------------------------------------------------------------------------
  // start / stop the monitor loop
  // ---------------------------------------------------------------------------
  function start(intervalMs) {
    if (_running) return;
    _running = true;
    const ms = intervalMs || 60000;
    // Immediate first check, then on interval
    runChecks().catch(() => {});
    _interval = setInterval(() => runChecks().catch(() => {}), ms);
    if (typeof _interval.unref === 'function') _interval.unref();
    _emit('health:monitor:started', { intervalMs: ms });
  }

  function stop() {
    _running = false;
    if (_interval) { clearInterval(_interval); _interval = null; }
    _emit('health:monitor:stopped', {});
  }

  // ---------------------------------------------------------------------------
  // report — return current health summary snapshot
  // ---------------------------------------------------------------------------
  function report() {
    const endpoints = Array.from(_endpoints.values()).map(ep => ({
      name:        ep.name,
      url:         ep.url,
      healthy:     ep.healthy,
      lastStatus:  ep.lastStatus,
      lastChecked: ep.lastChecked,
      failures:    ep.failures,
    }));
    const ports = Array.from(_ports.values()).map(mon => ({
      name:        mon.name,
      host:        mon.host,
      port:        mon.port,
      active:      mon.active,
      lastChecked: mon.lastChecked,
      failures:    mon.failures,
    }));
    return {
      running:   _running,
      stats:     Object.assign({}, _stats),
      endpoints,
      ports,
    };
  }

  // ---------------------------------------------------------------------------
  // Router command module interface
  // ---------------------------------------------------------------------------
  const commands = {
    health: async (args) => {
      const sub = (args[0] || '').toLowerCase();

      if (sub === 'check') {
        await runChecks();
        return { status: 'ok', result: 'Health check completed.' };
      }

      const r = report();
      const lines = [
        `Health Monitor : ${r.running ? 'running' : 'stopped'}`,
        `Checks: ${r.stats.checks}  Failures: ${r.stats.failures}  Recovered: ${r.stats.recovered}`,
      ];

      if (r.endpoints.length) {
        lines.push('', 'Endpoints:');
        for (const ep of r.endpoints) {
          const icon = ep.healthy === null ? '?' : ep.healthy ? '✓' : '✗';
          const statusStr = ep.lastStatus != null ? `HTTP ${ep.lastStatus}` : 'n/a';
          lines.push(`  ${icon}  ${ep.name.padEnd(20)} ${ep.url.slice(0, 50).padEnd(52)} (${statusStr})`);
        }
      }

      if (r.ports.length) {
        lines.push('', 'Ports:');
        for (const p of r.ports) {
          const icon = p.active === null ? '?' : p.active ? '✓' : '✗';
          lines.push(`  ${icon}  ${p.name.padEnd(20)} ${p.host}:${p.port}`);
        }
      }

      if (!r.endpoints.length && !r.ports.length) {
        lines.push('', 'No endpoints or ports registered.');
        lines.push('Register them via: registerEndpoint(name, url) / registerPort(name, host, port)');
      }

      lines.push('', 'Usage: health | health check');
      return { status: 'ok', result: lines.join('\n') };
    },
  };

  return {
    name:               'health-monitor',
    version:            '4.0.0',
    registerEndpoint,
    unregisterEndpoint,
    registerPort,
    unregisterPort,
    runChecks,
    start,
    stop,
    report,
    stats:              () => Object.assign({}, _stats),
    commands,
  };
}

module.exports = { createHealthMonitor };
