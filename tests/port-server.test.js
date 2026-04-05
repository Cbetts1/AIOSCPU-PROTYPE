'use strict';

const net = require('net');
const { createKernel } = require('../core/kernel');
const { createRouter } = require('../core/router');
const { createPortServer } = require('../core/port-server');

// Pick a random high port to avoid conflicts across parallel test runs
const TEST_PORT = 17700 + Math.floor(Math.random() * 100);

describe('PortServer', () => {
  let kernel;
  let router;
  let srv;

  beforeEach(() => {
    kernel = createKernel();
    kernel.boot();
    router = createRouter({ logger: null });
    router.registerCommand('ping', () => ({ status: 'ok', result: 'pong' }));
    srv = createPortServer(kernel, router, null, { port: TEST_PORT });
  });

  afterEach(async () => {
    await srv.stop();
    kernel.shutdown();
  });

  describe('createPortServer', () => {
    test('returns object with expected API', () => {
      expect(srv.name).toBe('port-server');
      expect(srv.version).toBe('1.0.0');
      expect(typeof srv.start).toBe('function');
      expect(typeof srv.stop).toBe('function');
      expect(typeof srv.canBind).toBe('function');
      expect(typeof srv.info).toBe('function');
      expect(typeof srv.commands).toBe('object');
      expect(typeof srv.commands['port-server']).toBe('function');
    });

    test('info shows initial state', () => {
      const i = srv.info();
      expect(i.running).toBe(false);
      expect(i.port).toBe(TEST_PORT);
      expect(i.connections).toBe(0);
      expect(i.requests).toBe(0);
    });
  });

  describe('canBind', () => {
    test('returns ok when port is free', async () => {
      const r = await srv.canBind();
      expect(r.ok).toBe(true);
      expect(r.port).toBe(TEST_PORT);
    });

    test('returns ok when server is already running', async () => {
      await srv.start();
      const r = await srv.canBind();
      expect(r.ok).toBe(true);
    });

    test('returns error when port is taken', async () => {
      // Occupy the port with a different server
      const blocker = net.createServer();
      await new Promise(res => blocker.listen(TEST_PORT, '127.0.0.1', res));
      try {
        const r = await srv.canBind();
        expect(r.ok).toBe(false);
        expect(r.error).toBeTruthy();
      } finally {
        await new Promise(res => blocker.close(res));
      }
    });
  });

  describe('start / stop', () => {
    test('starts the server', async () => {
      const r = await srv.start();
      expect(r.ok).toBe(true);
      expect(r.port).toBe(TEST_PORT);
      expect(srv.info().running).toBe(true);
    });

    test('start is idempotent when already running', async () => {
      await srv.start();
      const r2 = await srv.start();
      expect(r2.ok).toBe(true);
    });

    test('stop sets running to false', async () => {
      await srv.start();
      await srv.stop();
      expect(srv.info().running).toBe(false);
    });

    test('stop is safe when not running', async () => {
      const r = await srv.stop();
      expect(r.ok).toBe(true);
    });

    test('emits kernel bus events on start and stop', async () => {
      const events = [];
      kernel.bus.on('port-server:started', (d) => events.push({ type: 'start', ...d }));
      kernel.bus.on('port-server:stopped', (d) => events.push({ type: 'stop',  ...d }));

      await srv.start();
      await srv.stop();

      expect(events.find(e => e.type === 'start')).toBeTruthy();
      expect(events.find(e => e.type === 'stop')).toBeTruthy();
    });
  });

  describe('JSON protocol', () => {
    test('handles a valid request and returns JSON response', async () => {
      await srv.start();

      const response = await new Promise((resolve, reject) => {
        const client = net.connect(TEST_PORT, '127.0.0.1', () => {
          client.write(JSON.stringify({ id: 1, command: 'ping' }) + '\n');
        });
        let buf = '';
        client.on('data', (chunk) => {
          buf += chunk.toString();
          if (buf.includes('\n')) {
            client.destroy();
            try { resolve(JSON.parse(buf.trim())); } catch (e) { reject(e); }
          }
        });
        client.on('error', reject);
        setTimeout(() => reject(new Error('timeout')), 3000);
      });

      expect(response.id).toBe(1);
      expect(response.status).toBe('ok');
      expect(response.result).toBe('pong');
    });

    test('returns error for invalid JSON', async () => {
      await srv.start();

      const response = await new Promise((resolve, reject) => {
        const client = net.connect(TEST_PORT, '127.0.0.1', () => {
          client.write('not-valid-json\n');
        });
        let buf = '';
        client.on('data', (chunk) => {
          buf += chunk.toString();
          if (buf.includes('\n')) {
            client.destroy();
            try { resolve(JSON.parse(buf.trim())); } catch (e) { reject(e); }
          }
        });
        client.on('error', reject);
        setTimeout(() => reject(new Error('timeout')), 3000);
      });

      expect(response.status).toBe('error');
      expect(response.result).toMatch(/invalid json/i);
    });

    test('returns error for missing command', async () => {
      await srv.start();

      const response = await new Promise((resolve, reject) => {
        const client = net.connect(TEST_PORT, '127.0.0.1', () => {
          client.write(JSON.stringify({ id: 2 }) + '\n');
        });
        let buf = '';
        client.on('data', (chunk) => {
          buf += chunk.toString();
          if (buf.includes('\n')) {
            client.destroy();
            try { resolve(JSON.parse(buf.trim())); } catch (e) { reject(e); }
          }
        });
        client.on('error', reject);
        setTimeout(() => reject(new Error('timeout')), 3000);
      });

      expect(response.status).toBe('error');
      expect(response.result).toMatch(/missing command/i);
    });
  });

  describe('commands interface', () => {
    test('port-server status when stopped', () => {
      const r = srv.commands['port-server'](['status']);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('Port Server');
      expect(r.result).toContain('false');
    });

    test('port-server unknown sub returns usage', () => {
      const r = srv.commands['port-server'](['unknown']);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('Usage');
    });
  });
});
