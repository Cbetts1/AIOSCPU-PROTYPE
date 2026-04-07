'use strict';

const { createPortServer }  = require('../core/port-server');
const { createKernel }      = require('../core/kernel');
const http                  = require('http');

// ---------------------------------------------------------------------------
// Helper — simple HTTP request for tests
// ---------------------------------------------------------------------------
function request(opts, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined;
    const reqOpts = Object.assign({
      hostname: '127.0.0.1',
      headers:  {},
    }, opts);
    if (payload) {
      reqOpts.headers['Content-Type']   = 'application/json';
      reqOpts.headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = http.request(reqOpts, (res) => {
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end',  () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (_) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('PortServer', () => {
  let kernel;
  let server;
  let testPort;

  beforeEach(async () => {
    kernel = createKernel();
    kernel.boot();
    // Use a random high port to avoid conflicts
    testPort = 14000 + Math.floor(Math.random() * 1000);
    server   = createPortServer(kernel, null, null, null);
    await server.start({ port: testPort });
  });

  afterEach(async () => {
    await server.stop();
    kernel.shutdown();
  });

  describe('createPortServer', () => {
    test('returns object with expected API', () => {
      expect(server).toBeDefined();
      expect(server.name).toBe('port-server');
      expect(server.version).toBe('4.0.0');
      expect(typeof server.start).toBe('function');
      expect(typeof server.stop).toBe('function');
      expect(typeof server.status).toBe('function');
      expect(server.commands).toBeDefined();
    });
  });

  describe('start / stop', () => {
    test('status is started after start()', () => {
      expect(server.status().started).toBe(true);
    });

    test('status is stopped after stop()', async () => {
      await server.stop();
      expect(server.status().started).toBe(false);
    });

    test('start twice returns "already running" note', async () => {
      const r = await server.start({ port: testPort });
      expect(r.ok).toBe(true);
      expect(r.note).toContain('already');
    });

    test('stop when not running returns ok', async () => {
      await server.stop();
      const r = await server.stop();
      expect(r.ok).toBe(true);
    });

    test('emits port:started event', async () => {
      const p2   = testPort + 500;
      const srv2 = createPortServer(kernel, null, null, null);
      const handler = jest.fn();
      kernel.bus.on('port:started', handler);
      await srv2.start({ port: p2 });
      await srv2.stop();
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('HTTP endpoints', () => {
    test('GET / returns welcome JSON', async () => {
      const r = await request({ method: 'GET', port: testPort, path: '/' });
      expect(r.status).toBe(200);
      expect(r.body.system).toBe('AIOS');
      expect(Array.isArray(r.body.endpoints)).toBe(true);
    });

    test('GET /status returns status JSON', async () => {
      const r = await request({ method: 'GET', port: testPort, path: '/status' });
      expect(r.status).toBe(200);
      expect(typeof r.body.uptime).toBe('number');
      expect(typeof r.body.requests).toBe('number');
    });

    test('GET /report returns text (503 when no diagnostics engine)', async () => {
      const r = await request({ method: 'GET', port: testPort, path: '/report' });
      expect([200, 503]).toContain(r.status);
    });

    test('GET /models returns JSON', async () => {
      const r = await request({ method: 'GET', port: testPort, path: '/models' });
      expect(r.status).toBe(200);
    });

    test('POST /ai with no router returns 503', async () => {
      const r = await request(
        { method: 'POST', port: testPort, path: '/ai' },
        { input: 'hello', mode: 'chat' }
      );
      expect(r.status).toBe(503);
    });

    test('POST /ai with empty input returns 400', async () => {
      const r = await request(
        { method: 'POST', port: testPort, path: '/ai' },
        { input: '' }
      );
      expect(r.status).toBe(400);
    });

    test('POST /command with no router returns 503', async () => {
      const r = await request(
        { method: 'POST', port: testPort, path: '/command' },
        { command: 'help' }
      );
      expect(r.status).toBe(503);
    });

    test('POST /command with empty command returns 400', async () => {
      const r = await request(
        { method: 'POST', port: testPort, path: '/command' },
        { command: '' }
      );
      expect(r.status).toBe(400);
    });

    test('POST /ai with invalid JSON returns 400', async () => {
      await new Promise((resolve, reject) => {
        const req = http.request({
          hostname: '127.0.0.1',
          port:     testPort,
          path:     '/ai',
          method:   'POST',
          headers:  { 'Content-Type': 'application/json', 'Content-Length': 5 },
        }, (res) => {
          res.resume();
          resolve(res.statusCode);
        });
        req.on('error', reject);
        req.write('not{j');
        req.end();
      }).then(status => { expect(status).toBe(400); });
    });

    test('GET /unknown returns 404', async () => {
      const r = await request({ method: 'GET', port: testPort, path: '/does-not-exist' });
      expect(r.status).toBe(404);
    });

    test('requests counter increments', async () => {
      const before = server.status().requests;
      await request({ method: 'GET', port: testPort, path: '/status' });
      await request({ method: 'GET', port: testPort, path: '/status' });
      expect(server.status().requests).toBe(before + 2);
    });
  });

  describe('commands', () => {
    test('port status command', async () => {
      const r = await server.commands.port(['status']);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('running');
      expect(r.result).toContain(String(testPort));
    });

    test('port start command (already running)', async () => {
      const r = await server.commands.port(['start', String(testPort)]);
      expect(r.status).toBe('ok');
    });

    test('port stop command', async () => {
      const r = await server.commands.port(['stop']);
      expect(r.status).toBe('ok');
      expect(server.status().started).toBe(false);
      // Re-start for afterEach cleanup
      await server.start({ port: testPort });
    });

    test('port unknown sub returns usage', async () => {
      const r = await server.commands.port(['unknown']);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('Usage');
    });
  });

  describe('with router', () => {
    test('POST /command routes to router', async () => {
      const { createRouter } = require('../core/router');
      const router = createRouter({ logger: null });
      const srv2   = createPortServer(kernel, router, null, null);
      const p2     = testPort + 600;
      await srv2.start({ port: p2 });

      const r = await request(
        { method: 'POST', port: p2, path: '/command' },
        { command: 'help' }
      );
      await srv2.stop();

      expect(r.status).toBe(200);
      expect(r.body.status).toBe('ok');
    });
  });
});
