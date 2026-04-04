'use strict';
/**
 * network.js — AIOS Network Module v2.0.0
 *
 * Full networking stack for AIOS using Node.js built-in modules only.
 *
 * Features:
 *   HTTP/HTTPS  : GET, POST, PUT, DELETE, HEAD with redirects
 *   DNS         : lookup, resolve, reverse
 *   TCP Client  : connect, send, receive
 *   TCP Server  : listen, accept connections (used by IPC)
 *   Ping        : ICMP via shell fallback
 *   WebSocket   : basic ws:// client (RFC 6455, no external deps)
 *   Download    : save HTTP response to AIOS VFS
 *
 * Zero external npm dependencies. Uses: http, https, net, dns, url, crypto.
 */

const http    = require('http');
const https   = require('https');
const net     = require('net');
const dns     = require('dns');
const { URL } = require('url');
const crypto  = require('crypto');

// ---------------------------------------------------------------------------
// HTTP/HTTPS client
// ---------------------------------------------------------------------------
function _httpRequest(method, urlStr, opts) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try { parsedUrl = new URL(urlStr); }
    catch (e) { return reject(new Error('Invalid URL: ' + urlStr)); }

    const isHttps = parsedUrl.protocol === 'https:';
    const lib     = isHttps ? https : http;
    const timeout = opts.timeout || 15000;

    const reqOpts = {
      hostname: parsedUrl.hostname,
      port:     parsedUrl.port || (isHttps ? 443 : 80),
      path:     parsedUrl.pathname + parsedUrl.search,
      method:   method.toUpperCase(),
      headers:  Object.assign({
        'User-Agent': 'AIOS-Network/2.0.0',
        'Accept':     '*/*',
      }, opts.headers || {}),
    };

    if (opts.body) {
      const body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
      reqOpts.headers['Content-Length'] = Buffer.byteLength(body);
      if (!reqOpts.headers['Content-Type']) {
        reqOpts.headers['Content-Type'] = 'application/json';
      }
    }

    const req = lib.request(reqOpts, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        // Follow redirects (max 5)
        const redirectCount = (opts._redirects || 0);
        if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location && redirectCount < 5) {
          const newUrl = res.headers.location.startsWith('http')
            ? res.headers.location
            : parsedUrl.origin + res.headers.location;
          return _httpRequest(method, newUrl, Object.assign({}, opts, { _redirects: redirectCount + 1 }))
            .then(resolve).catch(reject);
        }
        resolve({
          ok:          res.statusCode >= 200 && res.statusCode < 300,
          status:      res.statusCode,
          statusText:  res.statusMessage,
          headers:     res.headers,
          body:        data,
          json() { try { return JSON.parse(data); } catch(_) { return null; } },
          url:         urlStr,
        });
      });
    });

    req.setTimeout(timeout, () => { req.destroy(); reject(new Error('Request timeout')); });
    req.on('error', reject);

    if (opts.body) {
      const body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
      req.write(body);
    }
    req.end();
  });
}

// ---------------------------------------------------------------------------
// DNS helpers
// ---------------------------------------------------------------------------
function dnsLookup(hostname) {
  return new Promise((resolve, reject) => {
    dns.lookup(hostname, (err, address, family) => {
      if (err) return reject(err);
      resolve({ ok: true, address, family: 'IPv' + family });
    });
  });
}

function dnsResolve(hostname, type) {
  return new Promise((resolve, reject) => {
    dns.resolve(hostname, type || 'A', (err, records) => {
      if (err) return reject(err);
      resolve({ ok: true, records });
    });
  });
}

function dnsReverse(ip) {
  return new Promise((resolve, reject) => {
    dns.reverse(ip, (err, hostnames) => {
      if (err) return reject(err);
      resolve({ ok: true, hostnames });
    });
  });
}

// ---------------------------------------------------------------------------
// TCP Client
// ---------------------------------------------------------------------------
function tcpConnect(host, port, opts) {
  return new Promise((resolve, reject) => {
    const timeout = (opts && opts.timeout) || 10000;
    const socket  = new net.Socket();
    const received = [];

    socket.setTimeout(timeout);

    socket.on('connect', () => {
      resolve({
        ok: true,
        send(data) {
          socket.write(typeof data === 'string' ? data : JSON.stringify(data));
        },
        close() { socket.destroy(); },
        onData(fn) { socket.on('data', d => fn(d.toString())); },
        socket,
      });
    });

    socket.on('error', reject);
    socket.on('timeout', () => { socket.destroy(); reject(new Error('TCP timeout')); });

    socket.connect(port, host);
  });
}

// ---------------------------------------------------------------------------
// TCP Server
// ---------------------------------------------------------------------------
function tcpListen(port, handler, opts) {
  return new Promise((resolve, reject) => {
    const host = (opts && opts.host) || '127.0.0.1';
    const server = net.createServer((socket) => {
      handler({
        remoteAddress: socket.remoteAddress,
        remotePort:    socket.remotePort,
        send(data) { socket.write(String(data)); },
        close() { socket.destroy(); },
        onData(fn) { socket.on('data', d => fn(d.toString())); },
        onClose(fn) { socket.on('close', fn); },
      });
    });
    server.on('error', reject);
    server.listen(port, host, () => {
      resolve({
        ok:    true,
        port:  server.address().port,
        host,
        close: () => new Promise(r => server.close(r)),
      });
    });
  });
}

// ---------------------------------------------------------------------------
// WebSocket client (RFC 6455, no external deps)
// ---------------------------------------------------------------------------
function wsConnect(urlStr, opts) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try { parsedUrl = new URL(urlStr); }
    catch(e) { return reject(new Error('Invalid WebSocket URL: ' + urlStr)); }

    const isSecure = parsedUrl.protocol === 'wss:';
    const lib      = isSecure ? require('tls') : net;
    const port     = parsedUrl.port || (isSecure ? 443 : 80);
    const key      = crypto.randomBytes(16).toString('base64');
    const expectedAccept = crypto.createHash('sha1')
      .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
      .digest('base64');

    const headers = [
      'GET ' + (parsedUrl.pathname || '/') + ' HTTP/1.1',
      'Host: ' + parsedUrl.host,
      'Upgrade: websocket',
      'Connection: Upgrade',
      'Sec-WebSocket-Key: ' + key,
      'Sec-WebSocket-Version: 13',
      '',
      '',
    ].join('\r\n');

    let socket;
    if (isSecure) {
      socket = require('tls').connect({ host: parsedUrl.hostname, port: parseInt(port) });
    } else {
      socket = net.connect({ host: parsedUrl.hostname, port: parseInt(port) });
    }

    let upgraded = false;
    let buf = Buffer.alloc(0);

    socket.on('error', reject);
    socket.on('timeout', () => { socket.destroy(); reject(new Error('WS timeout')); });
    socket.setTimeout((opts && opts.timeout) || 15000);

    socket.once('connect', () => { socket.write(headers); });

    socket.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);

      if (!upgraded) {
        const header = buf.toString();
        if (!header.includes('\r\n\r\n')) return;
        if (!header.includes('101')) {
          return reject(new Error('WebSocket upgrade failed: ' + header.slice(0, 200)));
        }
        upgraded = true;
        buf = buf.slice(buf.indexOf('\r\n\r\n') + 4);
        resolve({
          ok: true,
          send(msg) {
            const data = Buffer.from(msg);
            const frame = Buffer.alloc(data.length + 6);
            frame[0] = 0x81; // FIN + text frame
            frame[1] = 0x80 | data.length; // masked
            const mask = crypto.randomBytes(4);
            mask.copy(frame, 2);
            for (let i = 0; i < data.length; i++) {
              frame[6 + i] = data[i] ^ mask[i % 4];
            }
            socket.write(frame);
          },
          close() {
            // Send close frame
            socket.write(Buffer.from([0x88, 0x80, 0, 0, 0, 0]));
            socket.destroy();
          },
          onMessage(fn) {
            socket.on('data', (d) => {
              // Minimal frame parser: FIN + opcode 1 (text), no mask
              if (d[0] === 0x81) {
                const len = d[1] & 0x7F;
                fn(d.slice(2, 2 + len).toString());
              }
            });
          },
          onClose(fn) { socket.on('close', fn); },
          socket,
        });
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Network Module factory
// ---------------------------------------------------------------------------
function createNetwork(kernel, filesystem) {
  function _emit(event, data) {
    if (kernel) kernel.bus.emit(event, data);
  }

  // ---------------------------------------------------------------------------
  // Public methods
  // ---------------------------------------------------------------------------
  const net_module = {
    name:    'network',
    version: '2.0.0',

    // HTTP convenience methods
    get:    (url, opts)        => _httpRequest('GET',    url, opts || {}),
    post:   (url, body, opts)  => _httpRequest('POST',   url, Object.assign({ body }, opts || {})),
    put:    (url, body, opts)  => _httpRequest('PUT',    url, Object.assign({ body }, opts || {})),
    delete: (url, opts)        => _httpRequest('DELETE', url, opts || {}),
    head:   (url, opts)        => _httpRequest('HEAD',   url, opts || {}),
    fetch:  (url, opts)        => {
      const method = (opts && opts.method) || 'GET';
      return _httpRequest(method, url, opts || {});
    },

    // Download URL → AIOS VFS file
    async download(url, destPath) {
      if (!filesystem) return { ok: false, error: 'No filesystem available' };
      try {
        const r = await _httpRequest('GET', url, { headers: { Accept: '*/*' } });
        if (!r.ok) return { ok: false, error: 'HTTP ' + r.status };
        filesystem.write(destPath, r.body);
        _emit('network:download', { url, destPath, bytes: r.body.length });
        return { ok: true, bytes: r.body.length, path: destPath };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    },

    // DNS
    dns: { lookup: dnsLookup, resolve: dnsResolve, reverse: dnsReverse },

    // TCP
    tcp: { connect: tcpConnect, listen: tcpListen },

    // WebSocket
    ws: { connect: wsConnect },

    // Ping (via host shell)
    async ping(host, count) {
      const { spawnSync } = require('child_process');
      const n = String(count || 4);
      const r = spawnSync('ping', ['-c', n, host], { encoding: 'utf8', timeout: 10000 });
      return { ok: r.status === 0, output: (r.stdout || '') + (r.stderr || '') };
    },

    // ---------------------------------------------------------------------------
    // Router command module interface
    // ---------------------------------------------------------------------------
    commands: {
      curl: async (args) => {
        if (!args.length) return { status: 'error', result: 'Usage: curl <url> [-X method] [-d body] [-H header] [-o file]' };

        let url = null, method = 'GET', body = null, outFile = null;
        const headers = {};

        for (let i = 0; i < args.length; i++) {
          if (args[i] === '-X' || args[i] === '--request') { method = args[++i]; }
          else if (args[i] === '-d' || args[i] === '--data') { body = args[++i]; method = method === 'GET' ? 'POST' : method; }
          else if (args[i] === '-H' || args[i] === '--header') {
            const h = args[++i]; const ci = h.indexOf(':');
            if (ci > 0) headers[h.slice(0,ci).trim()] = h.slice(ci+1).trim();
          }
          else if (args[i] === '-o' || args[i] === '--output') { outFile = args[++i]; }
          else if (!args[i].startsWith('-')) url = args[i];
        }

        if (!url) return { status: 'error', result: 'No URL provided' };

        try {
          const r = await _httpRequest(method, url, { headers, body });
          if (outFile && filesystem) {
            filesystem.write(outFile, r.body);
            return { status: 'ok', result: 'Saved to ' + outFile + ' (' + r.body.length + ' bytes). HTTP ' + r.status };
          }
          const out = [
            'HTTP ' + r.status + ' ' + r.statusText,
            '',
            r.body.length > 4096 ? r.body.slice(0, 4096) + '\n... (truncated)' : r.body,
          ].join('\n');
          return { status: r.ok ? 'ok' : 'error', result: out };
        } catch (e) {
          return { status: 'error', result: e.message };
        }
      },

      wget: async (args) => {
        if (!args.length) return { status: 'error', result: 'Usage: wget <url> [-O output-file]' };
        const url = args.find(a => !a.startsWith('-'));
        const oIdx = args.indexOf('-O');
        const outFile = oIdx >= 0 ? args[oIdx+1] : (url ? url.split('/').pop() || 'index.html' : 'index.html');
        if (!url) return { status: 'error', result: 'No URL provided' };
        const r = await net_module.download(url, '/home/user/downloads/' + outFile);
        return r.ok
          ? { status: 'ok',    result: 'Downloaded to ' + r.path + ' (' + r.bytes + ' bytes)' }
          : { status: 'error', result: r.error };
      },

      dns: async (args) => {
        if (!args.length) return { status: 'error', result: 'Usage: dns <hostname> [A|MX|TXT|CNAME]' };
        const hostname = args[0];
        const type     = args[1] || 'A';
        try {
          const r = await dnsResolve(hostname, type);
          return { status: 'ok', result: JSON.stringify(r.records, null, 2) };
        } catch (e) {
          return { status: 'error', result: e.message };
        }
      },

      ping: async (args) => {
        if (!args.length) return { status: 'error', result: 'Usage: ping <host> [count]' };
        const r = await net_module.ping(args[0], parseInt(args[1]) || 4);
        return { status: r.ok ? 'ok' : 'error', result: r.output };
      },

      netstat: (_args) => {
        const os = require('os');
        const ifaces = os.networkInterfaces();
        const lines = ['Interface       Family   Address'];
        for (const [name, addrs] of Object.entries(ifaces)) {
          for (const addr of addrs) {
            lines.push(name.padEnd(16) + addr.family.padEnd(9) + addr.address);
          }
        }
        return { status: 'ok', result: lines.join('\n') };
      },
    },
  };

  return net_module;
}

module.exports = { createNetwork };
