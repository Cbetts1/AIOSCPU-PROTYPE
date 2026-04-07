'use strict';

const { createKernel } = require('../core/kernel');
const { createDiagnosticsEngine, STATUS } = require('../core/diagnostics-engine');

describe('DiagnosticsEngine', () => {
  let kernel;
  let diag;

  beforeEach(() => {
    kernel = createKernel();
    kernel.boot();
    diag = createDiagnosticsEngine(kernel, null, { pollIntervalMs: 0 });
  });

  afterEach(() => {
    diag.stop();
    kernel.shutdown();
  });

  describe('createDiagnosticsEngine', () => {
    test('returns object with expected API', () => {
      expect(diag.name).toBe('diagnostics-engine');
      expect(diag.version).toBe('4.0.0');
      expect(typeof diag.captureHealth).toBe('function');
      expect(typeof diag.getHealth).toBe('function');
      expect(typeof diag.getSnapshots).toBe('function');
      expect(typeof diag.registerModel).toBe('function');
      expect(typeof diag.reportModel).toBe('function');
      expect(typeof diag.getModels).toBe('function');
      expect(typeof diag.registerPort).toBe('function');
      expect(typeof diag.reportPort).toBe('function');
      expect(typeof diag.getPorts).toBe('function');
      expect(typeof diag.start).toBe('function');
      expect(typeof diag.stop).toBe('function');
      expect(typeof diag.commands).toBe('object');
    });

    test('STATUS constants are defined', () => {
      expect(STATUS.OK).toBe('ok');
      expect(STATUS.WARN).toBe('warn');
      expect(STATUS.FAIL).toBe('fail');
      expect(STATUS.UNKNOWN).toBe('unknown');
    });
  });

  describe('captureHealth', () => {
    test('returns a health snapshot with expected fields', () => {
      const h = diag.captureHealth();
      expect(h).toHaveProperty('ts');
      expect(h).toHaveProperty('cpu');
      expect(h).toHaveProperty('memory');
      expect(h).toHaveProperty('uptime');
      expect(h).toHaveProperty('status');
      expect(typeof h.cpu.cores).toBe('number');
      expect(h.cpu.cores).toBeGreaterThan(0);
      expect(typeof h.memory.totalMB).toBe('number');
      expect(h.memory.totalMB).toBeGreaterThan(0);
      expect(h.memory.usedPct).toBeGreaterThanOrEqual(0);
      expect(h.memory.usedPct).toBeLessThanOrEqual(100);
    });

    test('stores snapshot in history', () => {
      diag.captureHealth();
      expect(diag.getSnapshots(10).length).toBeGreaterThan(0);
    });

    test('getHealth returns a snapshot even when none cached', () => {
      const diag2 = createDiagnosticsEngine(null, null, { pollIntervalMs: 0 });
      const h = diag2.getHealth();
      expect(h).toHaveProperty('status');
    });
  });

  describe('model monitoring', () => {
    test('registers and reports a model', () => {
      diag.registerModel('llama3', 'http://localhost:11434');
      const models = diag.getModels();
      expect(models.length).toBe(1);
      expect(models[0].name).toBe('llama3');
      expect(models[0].status).toBe(STATUS.UNKNOWN);

      diag.reportModel('llama3', true, 42);
      const updated = diag.getModels();
      expect(updated[0].status).toBe(STATUS.OK);
      expect(updated[0].latencyMs).toBe(42);
    });

    test('reportModel fails gracefully for unknown model', () => {
      const r = diag.reportModel('nonexistent', true);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/not registered/i);
    });

    test('reportModel fail status for unreachable model', () => {
      diag.registerModel('offline-model', 'http://no-server');
      diag.reportModel('offline-model', false);
      const m = diag.getModels()[0];
      expect(m.status).toBe(STATUS.FAIL);
    });

    test('emits diagnostics:model kernel event', () => {
      const events = [];
      kernel.bus.on('diagnostics:model', (d) => events.push(d));
      diag.registerModel('m1', 'http://x');
      diag.reportModel('m1', true);
      expect(events.length).toBe(1);
      expect(events[0].name).toBe('m1');
      expect(events[0].status).toBe(STATUS.OK);
    });
  });

  describe('port monitoring', () => {
    test('registers and reports a port', () => {
      diag.registerPort(7700, 'tcp', 'AIOS Port Server');
      const ports = diag.getPorts();
      expect(ports.length).toBe(1);
      expect(ports[0].port).toBe(7700);
      expect(ports[0].status).toBe(STATUS.UNKNOWN);

      diag.reportPort(7700, true);
      expect(diag.getPorts()[0].status).toBe(STATUS.OK);
    });

    test('reportPort fails gracefully for unregistered port', () => {
      const r = diag.reportPort(9999, true);
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/not registered/i);
    });

    test('emits diagnostics:port kernel event', () => {
      const events = [];
      kernel.bus.on('diagnostics:port', (d) => events.push(d));
      diag.registerPort(7700, 'tcp', 'test');
      diag.reportPort(7700, false);
      expect(events.length).toBe(1);
      expect(events[0].port).toBe(7700);
      expect(events[0].status).toBe(STATUS.FAIL);
    });
  });

  describe('commands interface', () => {
    test('diagnostics status returns status text', () => {
      const r = diag.commands.diagnostics(['status']);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('Diagnostics Engine');
    });

    test('diagnostics models with no models', () => {
      const r = diag.commands.diagnostics(['models']);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('No models');
    });

    test('diagnostics models with one model', () => {
      diag.registerModel('m1', 'http://x');
      const r = diag.commands.diagnostics(['models']);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('m1');
    });

    test('diagnostics ports with no ports', () => {
      const r = diag.commands.diagnostics(['ports']);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('No ports');
    });

    test('diagnostics check runs a health capture', () => {
      const r = diag.commands.diagnostics(['check']);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('Health check complete');
    });

    test('diagnostics history shows history', () => {
      diag.captureHealth();
      const r = diag.commands.diagnostics(['history', '3']);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('Health history');
    });

    test('diagnostics unknown sub returns usage', () => {
      const r = diag.commands.diagnostics(['unknown-sub']);
      expect(r.status).toBe('ok');
      expect(r.result).toContain('Usage');
    });
  });
});
