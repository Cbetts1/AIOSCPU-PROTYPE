'use strict';

const { createKernel } = require('../core/kernel');
const { createPermissionSystem, LEVELS, CAPS } = require('../core/permission-system');

describe('PermissionSystem', () => {
  let kernel, perm;

  beforeEach(() => {
    kernel = createKernel();
    kernel.boot();
    perm = createPermissionSystem(kernel, null);
  });

  afterEach(() => {
    kernel.shutdown();
  });

  describe('LEVELS / CAPS constants', () => {
    test('LEVELS is frozen', () => {
      expect(Object.isFrozen(LEVELS)).toBe(true);
    });

    test('CAPS is frozen', () => {
      expect(Object.isFrozen(CAPS)).toBe(true);
    });

    test('LEVELS contains expected values', () => {
      expect(LEVELS.user).toBe(0);
      expect(LEVELS.operator).toBe(1);
      expect(LEVELS.admin).toBe(2);
      expect(LEVELS.root).toBe(3);
    });
  });

  describe('initial state', () => {
    test('starts at user level', () => {
      expect(perm.getLevel()).toBe('user');
    });

    test('user level has basic capabilities', () => {
      expect(perm.has('fs:read')).toBe(true);
      expect(perm.has('fs:write')).toBe(true);
      expect(perm.has('cpu:run')).toBe(true);
      expect(perm.has('svc:read')).toBe(true);
    });

    test('user level does not have operator capabilities', () => {
      expect(perm.has('svc:manage')).toBe(false);
      expect(perm.has('host:read')).toBe(false);
    });
  });

  describe('escalate', () => {
    test('escalates to operator', () => {
      const result = perm.escalate('operator');
      expect(result.ok).toBe(true);
      expect(result.level).toBe('operator');
      expect(perm.getLevel()).toBe('operator');
    });

    test('operator has additional capabilities', () => {
      perm.escalate('operator');
      expect(perm.has('svc:manage')).toBe(true);
      expect(perm.has('host:read')).toBe(true);
      expect(perm.has('net:read')).toBe(true);
    });

    test('escalates to admin', () => {
      const result = perm.escalate('admin');
      expect(result.ok).toBe(true);
      expect(perm.has('host:shell')).toBe(true);
      expect(perm.has('host:write')).toBe(true);
    });

    test('escalates to root', () => {
      const result = perm.escalate('root');
      expect(result.ok).toBe(true);
      expect(perm.has('kernel:debug')).toBe(true);
      expect(perm.has('permission:grant')).toBe(true);
    });

    test('fails for unknown level', () => {
      const result = perm.escalate('superuser');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Unknown level');
    });

    test('fails when trying to escalate down', () => {
      perm.escalate('admin');
      const result = perm.escalate('user');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Cannot escalate down');
    });

    test('emits permission:escalated event', () => {
      const handler = jest.fn();
      kernel.bus.on('permission:escalated', handler);
      perm.escalate('admin');
      expect(handler).toHaveBeenCalledWith({ from: 'user', to: 'admin' });
    });
  });

  describe('demote', () => {
    test('demotes from higher level', () => {
      perm.escalate('admin');
      const result = perm.demote('user');
      expect(result.ok).toBe(true);
      expect(perm.getLevel()).toBe('user');
    });

    test('loses capabilities on demote', () => {
      perm.escalate('admin');
      expect(perm.has('host:shell')).toBe(true);
      perm.demote('user');
      expect(perm.has('host:shell')).toBe(false);
    });

    test('fails for unknown level', () => {
      const result = perm.demote('unknown');
      expect(result.ok).toBe(false);
    });

    test('emits permission:demoted event', () => {
      perm.escalate('admin');
      const handler = jest.fn();
      kernel.bus.on('permission:demoted', handler);
      perm.demote('user');
      expect(handler).toHaveBeenCalledWith({ from: 'admin', to: 'user' });
    });
  });

  describe('require', () => {
    test('succeeds for granted capability', () => {
      expect(perm.require('fs:read')).toBe(true);
    });

    test('throws for missing capability', () => {
      expect(() => perm.require('host:shell')).toThrow(/Permission denied/);
    });

    test('thrown error has EPERM code', () => {
      try {
        perm.require('host:shell');
      } catch (e) {
        expect(e.code).toBe('EPERM');
      }
    });
  });

  describe('sudo', () => {
    test('executes command at root level', () => {
      const result = perm.sudo(() => {
        return perm.has('permission:grant');
      });
      expect(result).toBe(true);
    });

    test('restores previous level after sudo', () => {
      perm.escalate('operator');
      perm.sudo(() => {});
      expect(perm.getLevel()).toBe('operator');
    });

    test('restores level even if command throws', () => {
      try {
        perm.sudo(() => { throw new Error('fail'); });
      } catch (_) {}
      expect(perm.getLevel()).toBe('user');
    });
  });

  describe('grant / revoke', () => {
    test('grant requires root permission', () => {
      const result = perm.grant('host:shell');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('permission:grant');
    });

    test('grant works at root level', () => {
      perm.escalate('root');
      const result = perm.grant('host:shell');
      expect(result.ok).toBe(true);
    });

    test('grant fails for unknown capability', () => {
      perm.escalate('root');
      const result = perm.grant('unknown:cap');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Unknown capability');
    });

    test('revoke requires root permission', () => {
      const result = perm.revoke('fs:read');
      expect(result.ok).toBe(false);
    });

    test('revoke works at root level', () => {
      perm.escalate('root');
      const result = perm.revoke('fs:read');
      expect(result.ok).toBe(true);
      expect(perm.has('fs:read')).toBe(false);
    });
  });

  describe('info', () => {
    test('returns current state', () => {
      const info = perm.info();
      expect(info.level).toBe('user');
      expect(info.levelNum).toBe(0);
      expect(info.hostRoot).toBe(false);
      expect(info.sudoActive).toBe(false);
      expect(Array.isArray(info.tokens)).toBe(true);
    });
  });

  describe('auditLog', () => {
    test('records escalations', () => {
      perm.escalate('admin');
      const log = perm.auditLog();
      expect(log.length).toBeGreaterThan(0);
      expect(log[0].action).toBe('escalate');
    });

    test('records denials', () => {
      try { perm.require('host:shell'); } catch (_) {}
      const log = perm.auditLog();
      const denied = log.find(e => e.action === 'denied');
      expect(denied).toBeDefined();
    });
  });

  describe('commands interface', () => {
    test('whoami command', () => {
      const result = perm.commands.whoami([]);
      expect(result.status).toBe('ok');
      expect(result.result).toContain('user');
    });

    test('capabilities command', () => {
      const result = perm.commands.capabilities([]);
      expect(result.status).toBe('ok');
      expect(result.result).toContain('fs:read');
    });

    test('su command escalates', () => {
      const result = perm.commands.su(['admin']);
      expect(result.status).toBe('ok');
      expect(perm.getLevel()).toBe('admin');
    });

    test('su unknown level returns error', () => {
      const result = perm.commands.su(['superuser']);
      expect(result.status).toBe('error');
    });

    test('su defaults to root', () => {
      const result = perm.commands.su([]);
      expect(result.status).toBe('ok');
      expect(perm.getLevel()).toBe('root');
    });

    test('sudo command returns marker', () => {
      const result = perm.commands.sudo(['ls', '/']);
      expect(result.status).toBe('ok');
      expect(result._sudoCmd).toEqual(['ls', '/']);
    });

    test('sudo without args returns error', () => {
      const result = perm.commands.sudo([]);
      expect(result.status).toBe('error');
    });
  });

  describe('with hostBridge root available', () => {
    test('root level gets host:root cap when host root available', () => {
      const permWithRoot = createPermissionSystem(kernel, {
        root: { available: true },
      });
      permWithRoot.escalate('root');
      expect(permWithRoot.has('host:root')).toBe(true);
    });

    test('root level still has host:root in CAPS even without host root (as CAPS defines it at level 3)', () => {
      perm.escalate('root');
      // host:root is defined as level 3 in CAPS, so it is granted at root level
      // The hostBridge check only adds it additionally; recompute includes it from CAPS
      expect(perm.has('host:root')).toBe(true);
    });
  });
});
