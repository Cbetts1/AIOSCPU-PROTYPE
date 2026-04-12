'use strict';
/**
 * core/command-center-agent.js — AIOS Command Center Agent v1.0.0
 *
 * Makes this AIOS node a first-class citizen inside a virtual network of repos.
 * Handles:
 *   - Unique virtual identity registration with a remote Command Center
 *   - Periodic heartbeat / health reporting
 *   - Inbound remote command execution (routed through the AIOS router)
 *   - Sibling-node discovery and peer capability exchange
 *   - Config/state sync (push local snapshot, pull remote updates)
 *   - Graceful offline/reconnect with exponential back-off
 *
 * Transport: HTTP/JSON only — no sockets, no root, Termux-safe.
 * All requests are outbound (this node → Command Center) so no privileged
 * port is required on the device.
 *
 * Configuration (environment variables or runtime options):
 *   AIOS_CC_URL      Command Center base URL  (default: http://localhost:5000)
 *   AIOS_CC_TOKEN    Shared bearer token      (default: '')
 *   AIOS_CC_INTERVAL Heartbeat ms             (default: 30 000)
 *
 * Terminal commands:
 *   cc               Show Command Center status
 *   cc status        Same as above
 *   cc register      Force re-registration
 *   cc heartbeat     Send a heartbeat now
 *   cc sync          Push state snapshot to Command Center
 *   cc peers         List known sibling nodes
 *   cc disconnect    Stop heartbeat and unregister
 *
 * Integration (bootstrap.js):
 *   const { createCommandCenterAgent } = require('../core/command-center-agent');
 *   const ccAgent = createCommandCenterAgent(kernel, router, identity, diagnostics, svcMgr);
 *   await ccAgent.register();
 *   router.use('command-center-agent', ccAgent);
 *
 * Zero external npm dependencies — uses Node.js built-in `http` / `https`.
 */

const http  = require('http');
const https = require('https');
const os    = require('os');

const VERSION = '1.0.0';

// Default configuration
const DEFAULTS = {
  ccUrl:    process.env.AIOS_CC_URL      || 'http://localhost:5000',
  token:    process.env.AIOS_CC_TOKEN    || '',
  interval: parseInt(process.env.AIOS_CC_INTERVAL, 10) || 30_000,
};

// Back-off constants for failed requests
const BACKOFF_INITIAL  = 2_000;   // 2 s
const BACKOFF_MAX      = 60_000;  // 60 s
const BACKOFF_FACTOR   = 2;

// ---------------------------------------------------------------------------
// createCommandCenterAgent — factory
// ---------------------------------------------------------------------------
function createCommandCenterAgent(kernel, router, identity, diagnostics, svcMgr) {

  const _bus = (kernel && kernel.bus) ? kernel.bus : { emit: () => {}, on: () => {} };

  // ── Runtime state ─────────────────────────────────────────────────────────
  let _registered   = false;
  let _connected    = false;
  let _ccUrl        = DEFAULTS.ccUrl;
  let _token        = DEFAULTS.token;
  let _intervalMs   = DEFAULTS.interval;
  let _heartbeatTimer = null;
  let _backoff      = BACKOFF_INITIAL;
  let _peers        = new Map();   // nodeId → peerInfo
  let _stats        = { heartbeats: 0, commands: 0, syncPushes: 0, errors: 0 };
  let _lastError    = null;
  let _nodeId       = null;        // filled at registration time

  // ── Helpers ───────────────────────────────────────────────────────────────

  function _getNodeId() {
    if (_nodeId) return _nodeId;
    if (identity && typeof identity.manifest === 'function') {
      const m = identity.manifest();
      if (m && m.id) { _nodeId = m.id; return _nodeId; }
    }
    if (identity && identity.id) { _nodeId = identity.id; return _nodeId; }
    _nodeId = `aios-node-${os.hostname()}-${process.pid}`;
    return _nodeId;
  }

  function _buildHeaders() {
    const h = { 'Content-Type': 'application/json', 'X-AIOS': `command-center-agent/${VERSION}` };
    if (_token) h['Authorization'] = `Bearer ${_token}`;
    return h;
  }

  /**
   * Low-level HTTP/HTTPS JSON request.
   * Returns { ok, status, body } — never throws.
   */
  function _request(method, path, payload) {
    return new Promise((resolve) => {
      const url   = `${_ccUrl}${path}`;
      let parsed;
      try { parsed = new URL(url); } catch (_) {
        resolve({ ok: false, status: 0, body: null, error: `Invalid URL: ${url}` });
        return;
      }

      const transport = parsed.protocol === 'https:' ? https : http;
      const body      = payload ? JSON.stringify(payload) : undefined;
      const headers   = _buildHeaders();
      if (body) headers['Content-Length'] = Buffer.byteLength(body);

      const opts = {
        hostname: parsed.hostname,
        port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path:     parsed.pathname + parsed.search,
        method,
        headers,
        timeout: 8_000,
      };

      const req = transport.request(opts, (res) => {
        let raw = '';
        res.on('data', c => { raw += c; });
        res.on('end', () => {
          let parsed_body = null;
          try { parsed_body = JSON.parse(raw); } catch (_) { parsed_body = raw; }
          resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, body: parsed_body });
        });
      });

      req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: 0, body: null, error: 'timeout' }); });
      req.on('error',   (e)  => { resolve({ ok: false, status: 0, body: null, error: e.message }); });

      if (body) req.write(body);
      req.end();
    });
  }

  function _buildCapabilities() {
    const caps = ['aios-node', 'http-api', 'ai-inference', 'virtual-cpu', 'virtual-fs'];
    if (kernel)      caps.push('kernel');
    if (diagnostics) caps.push('diagnostics');
    if (svcMgr)      caps.push('service-manager');
    return caps;
  }

  function _buildRegistrationPayload() {
    const mem = process.memoryUsage();
    return {
      nodeId:      _getNodeId(),
      nodeName:    `AIOSCPU-${os.hostname()}`,
      version:     VERSION,
      aiosVersion: '4.0.0',
      platform:    process.platform,
      arch:        process.arch,
      nodeVersion: process.version,
      hostname:    os.hostname(),
      pid:         process.pid,
      capabilities: _buildCapabilities(),
      registeredAt: new Date().toISOString(),
      uptime:      kernel ? kernel.uptime() : Math.floor(process.uptime()),
      memory: {
        heapUsedMB:  Math.round(mem.heapUsed  / 1024 / 1024),
        heapTotalMB: Math.round(mem.heapTotal / 1024 / 1024),
        rssMB:       Math.round(mem.rss       / 1024 / 1024),
      },
    };
  }

  function _buildHeartbeatPayload() {
    const mem = process.memoryUsage();
    let health = {};
    if (diagnostics && typeof diagnostics.captureHealth === 'function') {
      try { health = diagnostics.captureHealth(); } catch (_) {}
    }
    return {
      nodeId:  _getNodeId(),
      ts:      new Date().toISOString(),
      uptime:  kernel ? kernel.uptime() : Math.floor(process.uptime()),
      memory:  { heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024) },
      services: svcMgr ? svcMgr.list().map(s => ({ name: s.name, state: s.state })) : [],
      health,
    };
  }

  function _buildStateSnapshot() {
    const snap = {
      nodeId:   _getNodeId(),
      ts:       new Date().toISOString(),
      stats:    { ..._stats },
      peers:    [..._peers.values()],
    };
    if (kernel && typeof kernel.uptime === 'function') snap.uptime = kernel.uptime();
    return snap;
  }

  function _resetBackoff() { _backoff = BACKOFF_INITIAL; }
  function _increaseBackoff() {
    _backoff = Math.min(_backoff * BACKOFF_FACTOR, BACKOFF_MAX);
  }

  // ── Core operations ───────────────────────────────────────────────────────

  async function register(opts) {
    if (opts) {
      if (opts.ccUrl)   _ccUrl      = opts.ccUrl;
      if (opts.token)   _token      = opts.token;
      if (opts.interval) _intervalMs = opts.interval;
    }

    const payload = _buildRegistrationPayload();
    const result  = await _request('POST', '/api/nodes/register', payload);

    if (result.ok) {
      _registered = true;
      _connected  = true;
      _resetBackoff();
      _bus.emit('cc:registered', { nodeId: _getNodeId(), ccUrl: _ccUrl });

      // Process any peers returned by the Command Center
      if (result.body && Array.isArray(result.body.peers)) {
        for (const p of result.body.peers) {
          if (p.nodeId && p.nodeId !== _getNodeId()) {
            _peers.set(p.nodeId, p);
          }
        }
      }
    } else {
      _lastError = result.error || `HTTP ${result.status}`;
      _stats.errors++;
      _bus.emit('cc:error', { op: 'register', error: _lastError });
    }

    return result;
  }

  async function heartbeat() {
    if (!_registered) return { ok: false, error: 'not registered' };

    const payload = _buildHeartbeatPayload();
    const result  = await _request('POST', '/api/nodes/heartbeat', payload);

    _stats.heartbeats++;

    if (result.ok) {
      _connected = true;
      _resetBackoff();
      _bus.emit('cc:heartbeat', { nodeId: _getNodeId(), ts: payload.ts });

      // Accept new commands pushed by Command Center with the heartbeat ACK
      if (result.body && Array.isArray(result.body.commands)) {
        for (const cmd of result.body.commands) {
          await _executeRemoteCommand(cmd);
        }
      }
      // Update peer list if included
      if (result.body && Array.isArray(result.body.peers)) {
        for (const p of result.body.peers) {
          if (p.nodeId && p.nodeId !== _getNodeId()) _peers.set(p.nodeId, p);
        }
      }
    } else {
      _connected = false;
      _lastError = result.error || `HTTP ${result.status}`;
      _stats.errors++;
      _increaseBackoff();
      _bus.emit('cc:disconnected', { reason: _lastError });
    }

    return result;
  }

  async function syncState() {
    if (!_registered) return { ok: false, error: 'not registered' };

    const snap   = _buildStateSnapshot();
    const result = await _request('POST', '/api/nodes/state', snap);

    if (result.ok) {
      _stats.syncPushes++;
      _resetBackoff();
      _bus.emit('cc:sync', { nodeId: _getNodeId() });
    } else {
      _lastError = result.error || `HTTP ${result.status}`;
      _stats.errors++;
    }

    return result;
  }

  async function unregister() {
    stopHeartbeat();
    if (!_registered) return { ok: true };

    const result = await _request('DELETE', `/api/nodes/${encodeURIComponent(_getNodeId())}`, null);
    _registered = false;
    _connected  = false;
    _bus.emit('cc:unregistered', { nodeId: _getNodeId() });
    return result;
  }

  // ── Remote command execution ──────────────────────────────────────────────

  async function _executeRemoteCommand(cmd) {
    if (!cmd || !cmd.command) return;
    _stats.commands++;
    _bus.emit('cc:remote-command', { command: cmd.command, args: cmd.args });

    let result = null;
    if (router && typeof router.dispatch === 'function') {
      try {
        result = await router.dispatch(cmd.command, cmd.args || []);
      } catch (e) {
        result = { error: e.message };
      }
    } else if (router && typeof router.route === 'function') {
      try {
        result = await router.route(cmd.command, cmd.args || []);
      } catch (e) {
        result = { error: e.message };
      }
    }

    // Report result back to Command Center if a callback URL is provided
    if (cmd.callbackId) {
      await _request('POST', '/api/nodes/command-result', {
        nodeId:     _getNodeId(),
        callbackId: cmd.callbackId,
        result,
        ts:         new Date().toISOString(),
      });
    }

    return result;
  }

  // ── Heartbeat timer ───────────────────────────────────────────────────────

  function startHeartbeat() {
    stopHeartbeat();
    _heartbeatTimer = setInterval(async () => {
      await heartbeat();
    }, _intervalMs);
    if (_heartbeatTimer.unref) _heartbeatTimer.unref();
  }

  function stopHeartbeat() {
    if (_heartbeatTimer) {
      clearInterval(_heartbeatTimer);
      _heartbeatTimer = null;
    }
  }

  // ── Status ────────────────────────────────────────────────────────────────

  function status() {
    return {
      nodeId:     _getNodeId(),
      ccUrl:      _ccUrl,
      registered: _registered,
      connected:  _connected,
      peers:      _peers.size,
      stats:      { ..._stats },
      lastError:  _lastError,
      backoffMs:  _backoff,
      intervalMs: _intervalMs,
    };
  }

  // ── Terminal commands ─────────────────────────────────────────────────────

  function _statusTable() {
    const s = status();
    const lines = [
      '╔══════════════════════════════════════════════════════╗',
      '║          AIOS Command Center Agent  v' + VERSION.padEnd(18) + '║',
      '╠══════════════════════════════════════════════════════╣',
      `║  Node ID    : ${String(s.nodeId).slice(0, 38).padEnd(38)} ║`,
      `║  CC URL     : ${String(s.ccUrl).slice(0, 38).padEnd(38)} ║`,
      `║  Registered : ${String(s.registered).padEnd(38)} ║`,
      `║  Connected  : ${String(s.connected).padEnd(38)} ║`,
      `║  Peers      : ${String(s.peers).padEnd(38)} ║`,
      `║  Heartbeats : ${String(s.stats.heartbeats).padEnd(38)} ║`,
      `║  Commands   : ${String(s.stats.commands).padEnd(38)} ║`,
      `║  Sync pushes: ${String(s.stats.syncPushes).padEnd(38)} ║`,
      `║  Errors     : ${String(s.stats.errors).padEnd(38)} ║`,
      `║  Last error : ${String(s.lastError || 'none').slice(0, 38).padEnd(38)} ║`,
      '╚══════════════════════════════════════════════════════╝',
    ];
    return { status: 'ok', result: lines.join('\n') };
  }

  const commands = {
    cc: async (args) => {
      const sub = Array.isArray(args) ? args[0] : args;

      if (!sub || sub === 'status') return _statusTable();

      if (sub === 'register') {
        const r = await register();
        return { status: r.ok ? 'ok' : 'error', result: r.ok ? 'Registered with Command Center.' : `Registration failed: ${r.error || 'HTTP ' + r.status}` };
      }

      if (sub === 'heartbeat') {
        const r = await heartbeat();
        return { status: r.ok ? 'ok' : 'error', result: r.ok ? 'Heartbeat sent.' : `Heartbeat failed: ${r.error || 'HTTP ' + r.status}` };
      }

      if (sub === 'sync') {
        const r = await syncState();
        return { status: r.ok ? 'ok' : 'error', result: r.ok ? 'State snapshot pushed.' : `Sync failed: ${r.error || 'HTTP ' + r.status}` };
      }

      if (sub === 'peers') {
        if (_peers.size === 0) return { status: 'ok', result: 'No peers discovered yet.' };
        const lines = ['Known sibling nodes:', ''];
        for (const [id, p] of _peers) {
          lines.push(`  ${id.slice(0, 40)}  (${p.aiosVersion || 'unknown version'})`);
        }
        return { status: 'ok', result: lines.join('\n') };
      }

      if (sub === 'disconnect') {
        await unregister();
        return { status: 'ok', result: 'Disconnected from Command Center.' };
      }

      return {
        status: 'ok',
        result: [
          'Usage: cc <sub-command>',
          '  cc status      — show agent status',
          '  cc register    — register with Command Center',
          '  cc heartbeat   — send heartbeat now',
          '  cc sync        — push state snapshot',
          '  cc peers       — list sibling nodes',
          '  cc disconnect  — stop and unregister',
        ].join('\n'),
      };
    },
  };

  // ── Public API ────────────────────────────────────────────────────────────

  return {
    name:    'command-center-agent',
    version: VERSION,

    // Lifecycle
    register,
    unregister,
    startHeartbeat,
    stopHeartbeat,
    heartbeat,
    syncState,

    // Status / peers
    status,
    getPeers: () => [..._peers.values()],

    // Config
    configure(opts) {
      if (opts.ccUrl)    _ccUrl      = opts.ccUrl;
      if (opts.token)    _token      = opts.token;
      if (opts.interval) _intervalMs = opts.interval;
    },

    // Execute a remote command directly (used in tests / integration)
    executeRemoteCommand: _executeRemoteCommand,

    // Terminal
    commands,
  };
}

module.exports = { createCommandCenterAgent, VERSION };
