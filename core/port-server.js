'use strict';
/**
 * port-server.js — AIOS Port Server v1.0.0
 *
 * A single HTTP port server that exposes AIOS functionality over the network.
 *
 * Endpoints:
 *   GET  /              → welcome + status
 *   GET  /status        → JSON system status
 *   GET  /report        → diagnostics report
 *   GET  /models        → registered model list
 *   POST /ai            → route to AI consciousness (body: { input, mode })
 *   POST /command       → route to AIOS router    (body: { command })
 *
 * Default port: 4000 (override via AIOS_PORT env var or start({ port }) option)
 *
 * Zero external npm dependencies (Node.js built-in http module only).
 */

const http = require('http');

// ---------------------------------------------------------------------------
// Port Server factory
// ---------------------------------------------------------------------------
function createPortServer(kernel, router, consciousness, diagnosticsEngine) {
  let _server   = null;
  let _port     = parseInt(process.env.AIOS_PORT, 10) || 4000;
  let _started  = false;
  let _requests = 0;
  let _errors   = 0;

  // ── Helpers ──────────────────────────────────────────────────────────────

  function _json(res, code, data) {
    const body = JSON.stringify(data, null, 2);
    res.writeHead(code, {
      'Content-Type':   'application/json',
      'Content-Length': Buffer.byteLength(body),
      'X-AIOS':         'port-server/1.0.0',
    });
    res.end(body);
  }

  function _text(res, code, text) {
    const body = String(text);
    res.writeHead(code, {
      'Content-Type':   'text/plain; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'X-AIOS':         'port-server/1.0.0',
    });
    res.end(body);
  }

  function _readBody(req) {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', chunk => {
        body += chunk;
        if (body.length > 64 * 1024) { req.destroy(); reject(new Error('Request too large')); }
      });
      req.on('end',   () => resolve(body));
      req.on('error', reject);
    });
  }

  // ── Request handler ───────────────────────────────────────────────────────

  async function _handleRequest(req, res) {
    _requests++;
    const url    = req.url.split('?')[0].replace(/\/$/, '') || '/';
    const method = req.method.toUpperCase();

    if (kernel) kernel.bus.emit('port:request', { method, url });

    try {
      // GET /
      if (method === 'GET' && (url === '/' || url === '')) {
        return _json(res, 200, {
          system:  'AIOS',
          version: '1.0.0',
          port:    _port,
          uptime:  kernel ? kernel.uptime() : 0,
          endpoints: ['GET /', 'GET /status', 'GET /report', 'GET /models', 'POST /ai', 'POST /command'],
        });
      }

      // GET /status
      if (method === 'GET' && url === '/status') {
        return _json(res, 200, {
          ts:       new Date().toISOString(),
          healthy:  kernel ? kernel.isBooted() : false,
          uptime:   kernel ? kernel.uptime() : 0,
          requests: _requests,
          errors:   _errors,
          port:     _port,
        });
      }

      // GET /report
      if (method === 'GET' && url === '/report') {
        if (diagnosticsEngine) {
          const report = await diagnosticsEngine.generateReport();
          return _text(res, 200, report);
        }
        return _json(res, 503, { error: 'Diagnostics engine not available' });
      }

      // GET /models
      if (method === 'GET' && url === '/models') {
        if (consciousness && consciousness.getContext) {
          // Try to get model list from consciousness
        }
        return _json(res, 200, { note: 'Use /status for model information' });
      }

      // POST /ai
      if (method === 'POST' && url === '/ai') {
        const rawBody = await _readBody(req);
        let parsed;
        try { parsed = JSON.parse(rawBody); }
        catch (_) { return _json(res, 400, { error: 'Invalid JSON body' }); }

        const input = String(parsed.input || '').trim();
        const mode  = String(parsed.mode  || 'chat').trim();
        if (!input) return _json(res, 400, { error: '`input` field is required' });

        if (consciousness) {
          const result = await consciousness.query(input, { mode });
          return _json(res, 200, { status: 'ok', result: result.result, model: result.model, mode });
        }
        if (router) {
          const result = await router.handle(`ai ${input}`);
          return _json(res, 200, result);
        }
        return _json(res, 503, { error: 'AI not available' });
      }

      // POST /command
      if (method === 'POST' && url === '/command') {
        const rawBody = await _readBody(req);
        let parsed;
        try { parsed = JSON.parse(rawBody); }
        catch (_) { return _json(res, 400, { error: 'Invalid JSON body' }); }

        const command = String(parsed.command || '').trim();
        if (!command) return _json(res, 400, { error: '`command` field is required' });

        if (!router) return _json(res, 503, { error: 'Router not available' });
        const result = await router.handle(command);
        return _json(res, 200, result);
      }

      // 404
      return _json(res, 404, { error: `No route for ${method} ${url}` });

    } catch (e) {
      _errors++;
      if (kernel) kernel.bus.emit('port:error', { method, url, error: e.message });
      return _json(res, 500, { error: e.message });
    }
  }

  // ── Start / stop ──────────────────────────────────────────────────────────

  /**
   * Start the port server.
   * @param {{ port?: number, hostname?: string }} [opts]
   * @returns {{ ok: boolean, port: number, error?: string }}
   */
  function start(opts) {
    if (_started) return { ok: true, port: _port, note: 'already running' };

    const port     = (opts && opts.port) ? opts.port : _port;
    const hostname = (opts && opts.hostname) ? opts.hostname : '127.0.0.1';

    _port   = port;
    _server = http.createServer(_handleRequest);

    return new Promise((resolve) => {
      _server.on('error', (e) => {
        _started = false;
        if (kernel) kernel.bus.emit('port:start-error', { error: e.message });
        resolve({ ok: false, port, error: e.message });
      });

      _server.listen(port, hostname, () => {
        _started = true;
        if (kernel) kernel.bus.emit('port:started', { port, hostname });
        resolve({ ok: true, port, hostname });
      });
    });
  }

  /**
   * Stop the port server.
   * @returns {Promise<{ ok: boolean }>}
   */
  function stop() {
    if (!_started || !_server) return Promise.resolve({ ok: true });
    return new Promise((resolve) => {
      _server.close(() => {
        _started = false;
        if (kernel) kernel.bus.emit('port:stopped', {});
        resolve({ ok: true });
      });
    });
  }

  /** Return current port server status. */
  function status() {
    return {
      started:  _started,
      port:     _port,
      requests: _requests,
      errors:   _errors,
    };
  }

  /** Return basic info about the port server (port, version). */
  function info() {
    return {
      port:    _port,
      version: '1.0.0',
      started: _started,
    };
  }

  /**
   * Test whether the configured port is available to bind.
   * Creates a temporary server, attempts to listen, then closes it.
   * @returns {Promise<{ ok: boolean, port: number, error?: string }>}
   */
  function canBind() {
    return new Promise((resolve) => {
      const testServer = http.createServer();
      testServer.once('error', (e) => {
        resolve({ ok: false, port: _port, error: e.message });
      });
      testServer.listen(_port, '127.0.0.1', () => {
        testServer.close(() => resolve({ ok: true, port: _port }));
      });
    });
  }

  // ── Router command interface ───────────────────────────────────────────────

  const commands = {
    async port(args) {
      const sub = (args[0] || 'status').toLowerCase();

      if (sub === 'status') {
        const s = status();
        return {
          status: 'ok',
          result: [
            `Port Server v1.0.0`,
            `Status   : ${s.started ? 'running' : 'stopped'}`,
            `Port     : ${s.port}`,
            `Requests : ${s.requests}`,
            `Errors   : ${s.errors}`,
          ].join('\n'),
        };
      }

      if (sub === 'start') {
        const p = parseInt(args[1], 10) || _port;
        const r = await start({ port: p });
        return r.ok
          ? { status: 'ok',    result: `Port server started on ${r.hostname || '127.0.0.1'}:${r.port}` }
          : { status: 'error', result: `Failed to start: ${r.error}` };
      }

      if (sub === 'stop') {
        await stop();
        return { status: 'ok', result: 'Port server stopped.' };
      }

      return {
        status: 'ok',
        result: 'Usage: port <status|start [port]|stop>',
      };
    },
  };

  return {
    name:     'port-server',
    version:  '1.0.0',
    start,
    stop,
    status,
    info,
    canBind,
    commands,
  };
}

module.exports = { createPortServer };
