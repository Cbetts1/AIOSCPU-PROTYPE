'use strict';
/**
 * port-server.js — AIOS Port Server v1.0.0
 *
 * Opens a single TCP communication port to accept JSON-encoded queries from
 * external processes, forwards them through the AIOS router, and returns
 * JSON-encoded responses.
 *
 * Wire protocol (newline-delimited JSON):
 *   Request  → { "id": <number|string>, "command": "<cmd>", "args": [...] }
 *   Response → { "id": <same>, "status": "ok"|"error", "result": <string> }
 *
 * Security: by default the server binds to 127.0.0.1 (loopback only).
 * It accepts one connection at a time to keep resource usage minimal.
 *
 * Zero external npm dependencies.
 */

const net = require('net');

const PORT_SERVER_VERSION = '1.0.0';
const DEFAULT_HOST        = '127.0.0.1';
const DEFAULT_PORT        = 7700;

// ---------------------------------------------------------------------------
// createPortServer
// ---------------------------------------------------------------------------
/**
 * @param {object} kernel          - AIOS kernel instance
 * @param {object} router          - AIOS router (must have .dispatch())
 * @param {object} [diagnostics]   - optional diagnostics engine for port registration
 * @param {object} [opts]
 * @param {number} [opts.port]     - TCP port to listen on (default 7700)
 * @param {string} [opts.host]     - bind address (default '127.0.0.1')
 */
function createPortServer(kernel, router, diagnostics, opts = {}) {
  const _port = opts.port != null ? Number(opts.port) : DEFAULT_PORT;
  const _host = String(opts.host || DEFAULT_HOST);

  let _server  = null;
  let _running = false;
  let _connCount = 0;
  let _reqCount  = 0;

  // ── Helpers ───────────────────────────────────────────────────────────────
  function _ts() { return new Date().toISOString().slice(11, 19); }

  function _log(msg) {
    process.stdout.write(`  \x1b[36m[PORT]\x1b[0m  [${_ts()}] ${msg}\n`);
  }

  // ── Handle one socket connection ──────────────────────────────────────────
  function _handleSocket(socket) {
    _connCount++;
    const remote = `${socket.remoteAddress}:${socket.remotePort}`;
    _log(`Connection from ${remote}`);

    let _buf = '';

    socket.setEncoding('utf8');

    socket.on('data', async (chunk) => {
      _buf += chunk;
      let newline;
      // Process each newline-delimited JSON message
      while ((newline = _buf.indexOf('\n')) !== -1) {
        const line = _buf.slice(0, newline).trim();
        _buf        = _buf.slice(newline + 1);
        if (!line) continue;

        _reqCount++;
        let req;
        try {
          req = JSON.parse(line);
        } catch (_) {
          const errResp = JSON.stringify({ id: null, status: 'error', result: 'Invalid JSON' });
          socket.write(errResp + '\n');
          continue;
        }

        const id      = req.id != null ? req.id : null;
        const command = String(req.command || '').trim();
        const args    = Array.isArray(req.args) ? req.args.map(String) : [];

        if (!command) {
          socket.write(JSON.stringify({ id, status: 'error', result: 'Missing command' }) + '\n');
          continue;
        }

        // Dispatch through AIOS router
        let result;
        try {
          const input = args.length ? `${command} ${args.join(' ')}` : command;
          const r = await router.handle(input);
          result = { id, status: r.status || 'ok', result: r.result != null ? String(r.result) : '' };
        } catch (e) {
          result = { id, status: 'error', result: `Dispatch error: ${e.message}` };
        }

        socket.write(JSON.stringify(result) + '\n');
      }
    });

    socket.on('error', (err) => {
      _log(`Socket error from ${remote}: ${err.message}`);
    });

    socket.on('close', () => {
      _connCount = Math.max(0, _connCount - 1);
    });
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Start the port server.
   * @returns {Promise<{ ok: boolean, port?: number, host?: string, error?: string }>}
   */
  function start() {
    if (_running) {
      return Promise.resolve({ ok: true, port: _port, host: _host });
    }

    return new Promise((resolve) => {
      _server = net.createServer({ allowHalfOpen: false });

      _server.on('connection', _handleSocket);

      _server.on('error', (err) => {
        _running = false;
        _log(`Server error: ${err.message}`);
        if (diagnostics) diagnostics.reportPort(_port, false);
        if (kernel && kernel.bus) {
          kernel.bus.emit('port-server:error', { port: _port, error: err.message });
        }
        resolve({ ok: false, error: err.message });
      });

      _server.listen(_port, _host, () => {
        _running = true;
        _log(`Listening on ${_host}:${_port}`);
        if (diagnostics) {
          diagnostics.registerPort(_port, 'tcp', 'AIOS Port Server');
          diagnostics.reportPort(_port, true);
        }
        if (kernel && kernel.bus) {
          kernel.bus.emit('port-server:started', { port: _port, host: _host });
        }
        resolve({ ok: true, port: _port, host: _host });
      });
    });
  }

  /**
   * Stop the port server.
   * @returns {Promise<{ ok: boolean }>}
   */
  function stop() {
    if (!_running || !_server) return Promise.resolve({ ok: true });

    return new Promise((resolve) => {
      _server.close(() => {
        _running = false;
        _server  = null;
        _log(`Stopped`);
        if (diagnostics) diagnostics.reportPort(_port, false);
        if (kernel && kernel.bus) {
          kernel.bus.emit('port-server:stopped', { port: _port });
        }
        resolve({ ok: true });
      });
    });
  }

  /**
   * Attempt to open the port without keeping it listening.
   * Used by the self-check to confirm the port is available.
   * @returns {Promise<{ ok: boolean, port?: number, error?: string }>}
   */
  function canBind() {
    return new Promise((resolve) => {
      if (_running) {
        resolve({ ok: true, port: _port });
        return;
      }
      const probe = net.createServer();
      probe.on('error', (err) => {
        probe.close();
        resolve({ ok: false, port: _port, error: err.message });
      });
      probe.listen(_port, _host, () => {
        probe.close(() => resolve({ ok: true, port: _port }));
      });
    });
  }

  /** Current server statistics */
  function info() {
    return {
      running:     _running,
      host:        _host,
      port:        _port,
      connections: _connCount,
      requests:    _reqCount,
    };
  }

  // ── Router command interface ───────────────────────────────────────────────
  function dispatch(args) {
    const sub = (args[0] || 'status').toLowerCase().trim();

    if (sub === 'status') {
      const i = info();
      return {
        status: 'ok',
        result: [
          `Port Server v${PORT_SERVER_VERSION}`,
          `  Running    : ${i.running}`,
          `  Address    : ${i.host}:${i.port}`,
          `  Connections: ${i.connections}`,
          `  Requests   : ${i.requests}`,
        ].join('\n'),
      };
    }

    if (sub === 'start') {
      start().then(r => {
        if (r.ok) process.stdout.write(`  \x1b[32m[ OK ]\x1b[0m  Port Server started on ${r.host}:${r.port}\n`);
        else      process.stdout.write(`  \x1b[31m[FAIL]\x1b[0m  Port Server start failed: ${r.error}\n`);
      });
      return { status: 'ok', result: `Starting port server on ${_host}:${_port}…` };
    }

    if (sub === 'stop') {
      stop().then(() => {
        process.stdout.write('  \x1b[32m[ OK ]\x1b[0m  Port Server stopped\n');
      });
      return { status: 'ok', result: 'Stopping port server…' };
    }

    return {
      status: 'ok',
      result: 'Usage: port-server <status|start|stop>',
    };
  }

  return {
    name:    'port-server',
    version: PORT_SERVER_VERSION,
    // Core API
    start,
    stop,
    canBind,
    info,
    // Router integration
    commands: { 'port-server': dispatch },
  };
}

module.exports = { createPortServer };
