'use strict';

const { createHealthMonitor } = require('../core/health-monitor');
const { createKernel }        = require('../core/kernel');

describe('HealthMonitor', () => {
  let kernel, monitor;

  beforeEach(() => {
    kernel  = createKernel();
    kernel.boot();
    monitor = createHealthMonitor(kernel, null, null);
  });

  afterEach(() => {
    monitor.stop();
    kernel.shutdown();
  });

  // ── API shape ─────────────────────────────────────────────────────────────
  describe('createHealthMonitor', () => {
    test('returns monitor with expected API', () => {
      expect(monitor.name).toBe('health-monitor');
      expect(monitor.version).toBe('1.0.0');
      expect(typeof monitor.registerEndpoint).toBe('function');
      expect(typeof monitor.unregisterEndpoint).toBe('function');
      expect(typeof monitor.registerPort).toBe('function');
      expect(typeof monitor.unregisterPort).toBe('function');
      expect(typeof monitor.runChecks).toBe('function');
      expect(typeof monitor.start).toBe('function');
      expect(typeof monitor.stop).toBe('function');
      expect(typeof monitor.report).toBe('function');
      expect(typeof monitor.stats).toBe('function');
      expect(typeof monitor.commands).toBe('object');
    });
  });

  // ── registerEndpoint ──────────────────────────────────────────────────────
  describe('registerEndpoint', () => {
    test('registers an endpoint', () => {
      monitor.registerEndpoint('api', 'http://localhost:3000/health');
      const r = monitor.report();
      expect(r.endpoints).toHaveLength(1);
      expect(r.endpoints[0].name).toBe('api');
      expect(r.endpoints[0].url).toBe('http://localhost:3000/health');
      expect(r.endpoints[0].healthy).toBeNull();
    });

    test('registers multiple endpoints', () => {
      monitor.registerEndpoint('ep1', 'http://localhost:3000');
      monitor.registerEndpoint('ep2', 'http://localhost:4000');
      expect(monitor.report().endpoints).toHaveLength(2);
    });

    test('throws on missing name', () => {
      expect(() => monitor.registerEndpoint('', 'http://x.com')).toThrow(TypeError);
    });

    test('throws on missing url', () => {
      expect(() => monitor.registerEndpoint('ep', '')).toThrow(TypeError);
    });

    test('throws on non-string name', () => {
      expect(() => monitor.registerEndpoint(null, 'http://x.com')).toThrow(TypeError);
    });
  });

  // ── unregisterEndpoint ────────────────────────────────────────────────────
  describe('unregisterEndpoint', () => {
    test('removes a registered endpoint', () => {
      monitor.registerEndpoint('ep', 'http://localhost:3000');
      const removed = monitor.unregisterEndpoint('ep');
      expect(removed).toBe(true);
      expect(monitor.report().endpoints).toHaveLength(0);
    });

    test('returns false for unknown endpoint', () => {
      expect(monitor.unregisterEndpoint('nope')).toBe(false);
    });
  });

  // ── registerPort ──────────────────────────────────────────────────────────
  describe('registerPort', () => {
    test('registers a port', () => {
      monitor.registerPort('redis', '127.0.0.1', 6379);
      const r = monitor.report();
      expect(r.ports).toHaveLength(1);
      expect(r.ports[0].name).toBe('redis');
      expect(r.ports[0].port).toBe(6379);
      expect(r.ports[0].active).toBeNull();
    });

    test('registers multiple ports', () => {
      monitor.registerPort('p1', '127.0.0.1', 3000);
      monitor.registerPort('p2', '127.0.0.1', 4000);
      expect(monitor.report().ports).toHaveLength(2);
    });

    test('throws on missing name', () => {
      expect(() => monitor.registerPort('', '127.0.0.1', 3000)).toThrow(TypeError);
    });

    test('throws on invalid port number', () => {
      expect(() => monitor.registerPort('p', '127.0.0.1', 0)).toThrow(TypeError);
    });

    test('throws on port > 65535', () => {
      expect(() => monitor.registerPort('p', '127.0.0.1', 99999)).toThrow(TypeError);
    });
  });

  // ── unregisterPort ────────────────────────────────────────────────────────
  describe('unregisterPort', () => {
    test('removes a registered port', () => {
      monitor.registerPort('redis', '127.0.0.1', 6379);
      expect(monitor.unregisterPort('redis')).toBe(true);
      expect(monitor.report().ports).toHaveLength(0);
    });

    test('returns false for unknown port', () => {
      expect(monitor.unregisterPort('nope')).toBe(false);
    });
  });

  // ── report ────────────────────────────────────────────────────────────────
  describe('report', () => {
    test('returns running=false before start', () => {
      expect(monitor.report().running).toBe(false);
    });

    test('returns empty endpoints and ports initially', () => {
      const r = monitor.report();
      expect(r.endpoints).toEqual([]);
      expect(r.ports).toEqual([]);
    });

    test('stats starts at zero', () => {
      const s = monitor.stats();
      expect(s.checks).toBe(0);
      expect(s.failures).toBe(0);
      expect(s.recovered).toBe(0);
    });
  });

  // ── runChecks — with mocked network ──────────────────────────────────────
  describe('runChecks with mocked network', () => {
    test('marks endpoint healthy on 200 response', async () => {
      const net = {
        get:  jest.fn().mockResolvedValue({ ok: true, status: 200 }),
        tcp:  { connect: jest.fn() },
      };
      const m = createHealthMonitor(kernel, net, null);
      m.registerEndpoint('api', 'http://localhost:3000');
      await m.runChecks();
      const r = m.report();
      expect(r.endpoints[0].healthy).toBe(true);
      expect(r.endpoints[0].lastStatus).toBe(200);
    });

    test('marks endpoint unhealthy on non-200 response', async () => {
      const net = {
        get:  jest.fn().mockResolvedValue({ ok: false, status: 503 }),
        tcp:  { connect: jest.fn() },
      };
      const m = createHealthMonitor(kernel, net, null);
      m.registerEndpoint('api', 'http://localhost:3000');
      await m.runChecks();
      expect(m.report().endpoints[0].healthy).toBe(false);
      expect(m.report().endpoints[0].lastStatus).toBe(503);
    });

    test('marks endpoint unhealthy on network error', async () => {
      const net = {
        get:  jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
        tcp:  { connect: jest.fn() },
      };
      const m = createHealthMonitor(kernel, net, null);
      m.registerEndpoint('api', 'http://localhost:3000');
      await m.runChecks();
      expect(m.report().endpoints[0].healthy).toBe(false);
      expect(m.report().endpoints[0].lastStatus).toBe(0);
    });

    test('marks port active when TCP connects', async () => {
      const net = {
        get:  jest.fn(),
        tcp:  { connect: jest.fn().mockResolvedValue({ close: jest.fn() }) },
      };
      const m = createHealthMonitor(kernel, net, null);
      m.registerPort('redis', '127.0.0.1', 6379);
      await m.runChecks();
      expect(m.report().ports[0].active).toBe(true);
    });

    test('marks port inactive when TCP fails', async () => {
      const net = {
        get:  jest.fn(),
        tcp:  { connect: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) },
      };
      const m = createHealthMonitor(kernel, net, null);
      m.registerPort('redis', '127.0.0.1', 6379);
      await m.runChecks();
      expect(m.report().ports[0].active).toBe(false);
    });

    test('increments failure stats on endpoint down', async () => {
      const net = {
        get:  jest.fn().mockRejectedValue(new Error('down')),
        tcp:  { connect: jest.fn() },
      };
      const m = createHealthMonitor(kernel, net, null);
      m.registerEndpoint('api', 'http://localhost:3000');
      await m.runChecks();
      expect(m.stats().failures).toBe(1);
      expect(m.stats().checks).toBe(1);
    });

    test('increments recovered stats on endpoint recovery', async () => {
      const net = { get: jest.fn(), tcp: { connect: jest.fn() } };
      const m = createHealthMonitor(kernel, net, null);
      m.registerEndpoint('api', 'http://localhost:3000');

      // First check: down
      net.get.mockRejectedValueOnce(new Error('down'));
      await m.runChecks();
      expect(m.report().endpoints[0].healthy).toBe(false);

      // Second check: recovered
      net.get.mockResolvedValueOnce({ ok: true, status: 200 });
      await m.runChecks();
      expect(m.report().endpoints[0].healthy).toBe(true);
      expect(m.stats().recovered).toBe(1);
    });

    test('one failing check does not abort others', async () => {
      const net = {
        get: jest.fn()
          .mockRejectedValueOnce(new Error('ep1 down'))
          .mockResolvedValueOnce({ ok: true, status: 200 }),
        tcp: { connect: jest.fn().mockResolvedValue({ close: jest.fn() }) },
      };
      const m = createHealthMonitor(kernel, net, null);
      m.registerEndpoint('ep1', 'http://localhost:3000');
      m.registerEndpoint('ep2', 'http://localhost:4000');
      m.registerPort('p1', '127.0.0.1', 6379);
      await m.runChecks();
      const r = m.report();
      expect(r.endpoints[0].healthy).toBe(false);
      expect(r.endpoints[1].healthy).toBe(true);
      expect(r.ports[0].active).toBe(true);
    });
  });

  // ── kernel bus events ─────────────────────────────────────────────────────
  describe('kernel bus events', () => {
    test('emits health:endpoint:down when endpoint fails', async () => {
      const net = {
        get:  jest.fn().mockRejectedValue(new Error('down')),
        tcp:  { connect: jest.fn() },
      };
      const m = createHealthMonitor(kernel, net, null);
      m.registerEndpoint('api', 'http://localhost:3000');
      const events = [];
      kernel.bus.on('health:endpoint:down', d => events.push(d));
      await m.runChecks();
      expect(events).toHaveLength(1);
      expect(events[0].name).toBe('api');
    });

    test('emits health:endpoint:recovered when endpoint recovers', async () => {
      const net = { get: jest.fn(), tcp: { connect: jest.fn() } };
      const m = createHealthMonitor(kernel, net, null);
      m.registerEndpoint('api', 'http://localhost:3000');
      net.get.mockRejectedValueOnce(new Error('down'));
      await m.runChecks();
      const events = [];
      kernel.bus.on('health:endpoint:recovered', d => events.push(d));
      net.get.mockResolvedValueOnce({ ok: true, status: 200 });
      await m.runChecks();
      expect(events).toHaveLength(1);
    });

    test('emits health:port:down when port fails', async () => {
      const net = {
        get:  jest.fn(),
        tcp:  { connect: jest.fn().mockRejectedValue(new Error('refused')) },
      };
      const m = createHealthMonitor(kernel, net, null);
      m.registerPort('redis', '127.0.0.1', 6379);
      const events = [];
      kernel.bus.on('health:port:down', d => events.push(d));
      await m.runChecks();
      expect(events).toHaveLength(1);
      expect(events[0].port).toBe(6379);
    });

    test('emits health:port:recovered when port comes back', async () => {
      const net = {
        get:  jest.fn(),
        tcp:  { connect: jest.fn() },
      };
      const m = createHealthMonitor(kernel, net, null);
      m.registerPort('redis', '127.0.0.1', 6379);
      net.tcp.connect.mockRejectedValueOnce(new Error('refused'));
      await m.runChecks();
      const events = [];
      kernel.bus.on('health:port:recovered', d => events.push(d));
      net.tcp.connect.mockResolvedValueOnce({ close: jest.fn() });
      await m.runChecks();
      expect(events).toHaveLength(1);
    });

    test('emits health:checks:done after each runChecks', async () => {
      const events = [];
      kernel.bus.on('health:checks:done', d => events.push(d));
      await monitor.runChecks();
      expect(events).toHaveLength(1);
    });

    test('emits health:monitor:started on start', () => {
      jest.useFakeTimers();
      const events = [];
      kernel.bus.on('health:monitor:started', d => events.push(d));
      monitor.start(5000);
      expect(events).toHaveLength(1);
      expect(events[0].intervalMs).toBe(5000);
      monitor.stop();
      jest.useRealTimers();
    });

    test('emits health:monitor:stopped on stop', () => {
      jest.useFakeTimers();
      monitor.start(5000);
      const events = [];
      kernel.bus.on('health:monitor:stopped', d => events.push(d));
      monitor.stop();
      expect(events).toHaveLength(1);
      jest.useRealTimers();
    });
  });

  // ── hostBridge memory checks ──────────────────────────────────────────────
  describe('hostBridge memory checks', () => {
    test('emits health:memory:low when free memory is below 50MB', async () => {
      const hb = { memInfo: jest.fn().mockReturnValue({ ok: true, freeMB: 30, totalMB: 1000 }) };
      const m = createHealthMonitor(kernel, null, hb);
      const events = [];
      kernel.bus.on('health:memory:low', d => events.push(d));
      await m.runChecks();
      expect(events).toHaveLength(1);
      expect(events[0].freeMB).toBe(30);
    });

    test('does not emit health:memory:low when memory is sufficient', async () => {
      const hb = { memInfo: jest.fn().mockReturnValue({ ok: true, freeMB: 200, totalMB: 1000 }) };
      const m = createHealthMonitor(kernel, null, hb);
      const events = [];
      kernel.bus.on('health:memory:low', d => events.push(d));
      await m.runChecks();
      expect(events).toHaveLength(0);
    });

    test('handles hostBridge memInfo throwing', async () => {
      const hb = { memInfo: jest.fn().mockImplementation(() => { throw new Error('no hostBridge'); }) };
      const m = createHealthMonitor(kernel, null, hb);
      await expect(m.runChecks()).resolves.toBeUndefined();
    });
  });

  // ── start / stop ──────────────────────────────────────────────────────────
  describe('start / stop', () => {
    test('sets running=true on start', () => {
      jest.useFakeTimers();
      monitor.start(60000);
      expect(monitor.report().running).toBe(true);
      monitor.stop();
      jest.useRealTimers();
    });

    test('sets running=false on stop', () => {
      jest.useFakeTimers();
      monitor.start(60000);
      monitor.stop();
      expect(monitor.report().running).toBe(false);
      jest.useRealTimers();
    });

    test('start is idempotent', () => {
      jest.useFakeTimers();
      const events = [];
      kernel.bus.on('health:monitor:started', d => events.push(d));
      monitor.start(60000);
      monitor.start(60000); // second call should be no-op
      expect(events).toHaveLength(1);
      monitor.stop();
      jest.useRealTimers();
    });
  });

  // ── commands ──────────────────────────────────────────────────────────────
  describe('commands.health', () => {
    test('health command returns report string', async () => {
      const r = await monitor.commands.health([]);
      expect(r.status).toBe('ok');
      expect(typeof r.result).toBe('string');
      expect(r.result).toContain('Health Monitor');
    });

    test('health check sub-command returns completion message', async () => {
      const r = await monitor.commands.health(['check']);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('completed');
    });

    test('health command lists registered endpoints', async () => {
      monitor.registerEndpoint('myapi', 'http://localhost:3000');
      const r = await monitor.commands.health([]);
      expect(r.result).toContain('myapi');
    });

    test('health command lists registered ports', async () => {
      monitor.registerPort('redis', '127.0.0.1', 6379);
      const r = await monitor.commands.health([]);
      expect(r.result).toContain('redis');
      expect(r.result).toContain('6379');
    });

    test('health command shows no-items message when empty', async () => {
      const r = await monitor.commands.health([]);
      expect(r.result).toContain('No endpoints or ports registered');
    });
  });
});
