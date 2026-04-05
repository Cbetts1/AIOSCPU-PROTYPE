'use strict';

const { createKernel } = require('../core/kernel');
const { createCapabilityEngine, CAPS } = require('../core/capability-engine');

describe('CapabilityEngine', () => {
  let kernel, capEngine;

  beforeEach(() => {
    kernel = createKernel();
    kernel.boot();
    // Default user level (no permSystem)
    capEngine = createCapabilityEngine(kernel, null);
  });

  afterEach(() => {
    kernel.shutdown();
  });

  describe('CAPS constants', () => {
    test('CAPS is frozen', () => {
      expect(Object.isFrozen(CAPS)).toBe(true);
    });

    test('contains expected capabilities', () => {
      expect(CAPS.SYS_ADMIN).toBe('cap_sys_admin');
      expect(CAPS.AI_ADMIN).toBe('cap_ai_admin');
      expect(CAPS.HOST_EXEC).toBe('cap_host_exec');
      expect(CAPS.DEBUG).toBe('cap_debug');
    });
  });

  describe('user level capabilities', () => {
    test('user level has HOST_READ', () => {
      expect(capEngine.has(CAPS.HOST_READ)).toBe(true);
    });

    test('user level has AI_WRITE', () => {
      expect(capEngine.has(CAPS.AI_WRITE)).toBe(true);
    });

    test('user level has AUDIT_READ', () => {
      expect(capEngine.has(CAPS.AUDIT_READ)).toBe(true);
    });

    test('user level does not have SYS_ADMIN', () => {
      expect(capEngine.has(CAPS.SYS_ADMIN)).toBe(false);
    });

    test('user level does not have HOST_EXEC', () => {
      expect(capEngine.has(CAPS.HOST_EXEC)).toBe(false);
    });
  });

  describe('check', () => {
    test('check succeeds for granted capability', () => {
      expect(capEngine.check(CAPS.HOST_READ)).toBe(true);
    });

    test('check throws for missing capability', () => {
      expect(() => capEngine.check(CAPS.SYS_ADMIN)).toThrow(/Permission denied/);
    });
  });

  describe('per-process capabilities', () => {
    test('grant adds capability to process', () => {
      capEngine.grant(1, CAPS.SYS_ADMIN);
      expect(capEngine.processHas(1, CAPS.SYS_ADMIN)).toBe(true);
    });

    test('revoke removes capability from process', () => {
      capEngine.grant(1, CAPS.SYS_ADMIN);
      capEngine.revoke(1, CAPS.SYS_ADMIN);
      expect(capEngine.processHas(1, CAPS.SYS_ADMIN)).toBe(false);
    });

    test('processHas returns false for non-existent process', () => {
      expect(capEngine.processHas(999, CAPS.SYS_ADMIN)).toBe(false);
    });

    test('grant emits cap:granted event', () => {
      const handler = jest.fn();
      kernel.bus.on('cap:granted', handler);
      capEngine.grant(1, CAPS.DEBUG);
      expect(handler).toHaveBeenCalledWith({ pid: 1, cap: CAPS.DEBUG });
    });

    test('revoke emits cap:revoked event', () => {
      const handler = jest.fn();
      kernel.bus.on('cap:revoked', handler);
      capEngine.grant(1, CAPS.DEBUG);
      capEngine.revoke(1, CAPS.DEBUG);
      expect(handler).toHaveBeenCalledWith({ pid: 1, cap: CAPS.DEBUG });
    });

    test('revoke on non-existent process does not throw', () => {
      expect(() => capEngine.revoke(999, CAPS.SYS_ADMIN)).not.toThrow();
    });
  });

  describe('list / listAll', () => {
    test('list returns current capabilities', () => {
      const caps = capEngine.list();
      expect(caps).toContain(CAPS.HOST_READ);
      expect(caps).toContain(CAPS.AI_WRITE);
    });

    test('listAll returns all capabilities with granted status', () => {
      const all = capEngine.listAll();
      expect(all.length).toBeGreaterThan(0);
      const hostRead = all.find(c => c.value === CAPS.HOST_READ);
      expect(hostRead.granted).toBe(true);
      const sysAdmin = all.find(c => c.value === CAPS.SYS_ADMIN);
      expect(sysAdmin.granted).toBe(false);
    });
  });

  describe('with permission system', () => {
    test('syncs level from permission system', () => {
      const permSystem = { getLevel: () => 'root' };
      const engine = createCapabilityEngine(kernel, permSystem);
      // After syncing with root level, should have all caps
      const caps = engine.list();
      expect(caps).toContain(CAPS.SYS_ADMIN);
      expect(caps).toContain(CAPS.HOST_EXEC);
      expect(caps).toContain(CAPS.DEBUG);
    });

    test('syncs to operator level', () => {
      const permSystem = { getLevel: () => 'operator' };
      const engine = createCapabilityEngine(kernel, permSystem);
      expect(engine.has(CAPS.HOST_EXEC)).toBe(true);
      expect(engine.has(CAPS.AI_ADMIN)).toBe(true);
      expect(engine.has(CAPS.SYS_ADMIN)).toBe(false);
    });

    test('syncs to admin level', () => {
      const permSystem = { getLevel: () => 'admin' };
      const engine = createCapabilityEngine(kernel, permSystem);
      expect(engine.has(CAPS.SYS_ADMIN)).toBe(true);
      expect(engine.has(CAPS.MODULE_LOAD)).toBe(true);
    });
  });

  describe('commands interface', () => {
    test('caps list command', () => {
      const result = capEngine.commands.caps(['list']);
      expect(result.status).toBe('ok');
      expect(result.result).toContain('Capabilities');
    });

    test('caps check command for granted cap', () => {
      const result = capEngine.commands.caps(['check', 'cap_host_read']);
      expect(result.status).toBe('ok');
      expect(result.result).toContain('GRANTED');
    });

    test('caps check command for denied cap', () => {
      const result = capEngine.commands.caps(['check', 'cap_sys_admin']);
      expect(result.status).toBe('ok');
      expect(result.result).toContain('DENIED');
    });

    test('caps check unknown cap', () => {
      const result = capEngine.commands.caps(['check', 'unknown_cap']);
      expect(result.status).toBe('error');
      expect(result.result).toContain('Unknown capability');
    });

    test('caps default shows list', () => {
      const result = capEngine.commands.caps([]);
      expect(result.status).toBe('ok');
      expect(result.result).toContain('Capabilities');
    });
  });
});
