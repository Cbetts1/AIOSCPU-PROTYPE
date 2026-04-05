'use strict';

const { createKernel } = require('../core/kernel');
const { createFilesystem } = require('../core/filesystem');
const { createEnvLoader } = require('../core/env-loader');

describe('EnvLoader', () => {
  let kernel, fs, env;

  beforeEach(() => {
    kernel = createKernel();
    kernel.boot();
    fs = createFilesystem();
    fs.mkdir('/proc', { parents: true });
    fs.mkdir('/etc', { parents: true });
    fs.mkdir('/home/user', { parents: true });
    env = createEnvLoader(kernel, fs, null, null);
  });

  afterEach(() => {
    kernel.shutdown();
  });

  describe('load', () => {
    test('loads default environment', () => {
      const result = env.load();
      expect(result.AIOS_OS).toBe('AIOS UniKernel');
      expect(result.AIOS_VERSION).toBe('3.0.0');
      expect(result.HOME).toBe('/home/user');
      expect(result.USER).toBe('aios');
      expect(result.SHELL).toBe('/bin/aios-shell');
      expect(result.PATH).toBe('/bin:/usr/bin:/usr/local/bin');
    });

    test('writes to /proc/env', () => {
      env.load();
      const content = fs.read('/proc/env');
      expect(content.ok).toBe(true);
      expect(content.content).toContain('AIOS_OS=');
    });

    test('loads /etc/environment if present', () => {
      fs.write('/etc/environment', 'CUSTOM_VAR=hello\nANOTHER=world\n');
      env.load();
      expect(env.get('CUSTOM_VAR')).toBe('hello');
      expect(env.get('ANOTHER')).toBe('world');
    });

    test('loads /home/user/.profile if present', () => {
      fs.write('/home/user/.profile', 'MY_VAR=profile_value\n');
      env.load();
      expect(env.get('MY_VAR')).toBe('profile_value');
    });

    test('profile overrides /etc/environment', () => {
      fs.write('/etc/environment', 'VAR=from_etc\n');
      fs.write('/home/user/.profile', 'VAR=from_profile\n');
      env.load();
      expect(env.get('VAR')).toBe('from_profile');
    });

    test('strips quotes from values', () => {
      fs.write('/etc/environment', 'QUOTED="hello world"\nSINGLE=\'single\'\n');
      env.load();
      expect(env.get('QUOTED')).toBe('hello world');
      expect(env.get('SINGLE')).toBe('single');
    });

    test('ignores comments and blank lines', () => {
      fs.write('/etc/environment', '# comment\n\nVAR=value\n');
      env.load();
      expect(env.get('VAR')).toBe('value');
    });

    test('emits env:loaded event', () => {
      const handler = jest.fn();
      kernel.bus.on('env:loaded', handler);
      env.load();
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        count: expect.any(Number),
      }));
    });

    test('includes kernel info', () => {
      env.load();
      expect(env.get('AIOS_KERNEL_ID')).toBe(kernel.id);
      expect(env.get('NODE_VERSION')).toBe(process.version);
    });
  });

  describe('get / set / unset', () => {
    test('get returns single variable', () => {
      env.load();
      expect(env.get('HOME')).toBe('/home/user');
    });

    test('get without key returns all variables', () => {
      env.load();
      const all = env.get();
      expect(typeof all).toBe('object');
      expect(all.HOME).toBe('/home/user');
    });

    test('set adds/updates a variable', () => {
      env.load();
      env.set('MY_VAR', 'test');
      expect(env.get('MY_VAR')).toBe('test');
    });

    test('set converts value to string', () => {
      env.load();
      env.set('NUM', 42);
      expect(env.get('NUM')).toBe('42');
    });

    test('set flushes to VFS', () => {
      env.load();
      env.set('FLUSH_TEST', 'yes');
      const content = fs.read('/proc/env');
      expect(content.content).toContain('FLUSH_TEST=yes');
    });

    test('set emits env:set event', () => {
      env.load();
      const handler = jest.fn();
      kernel.bus.on('env:set', handler);
      env.set('KEY', 'val');
      expect(handler).toHaveBeenCalledWith({ key: 'KEY', value: 'val' });
    });

    test('unset removes a variable', () => {
      env.load();
      env.set('TEMP', 'x');
      env.unset('TEMP');
      expect(env.get('TEMP')).toBeUndefined();
    });

    test('unset emits env:unset event', () => {
      env.load();
      const handler = jest.fn();
      kernel.bus.on('env:unset', handler);
      env.set('TEMP', 'x');
      env.unset('TEMP');
      expect(handler).toHaveBeenCalledWith({ key: 'TEMP' });
    });

    test('set ignores empty key', () => {
      env.load();
      env.set('', 'value');
      env.set(null, 'value');
      // Should not throw
    });
  });

  describe('with hostBridge', () => {
    test('loads platform-specific variables', () => {
      const hostBridge = {
        platform: { name: 'linux', isTermux: false, isMac: false },
        root: { available: false },
      };
      const envWithHost = createEnvLoader(kernel, fs, hostBridge, null);
      envWithHost.load();
      expect(envWithHost.get('AIOS_PLATFORM')).toBe('linux');
      expect(envWithHost.get('AIOS_ROOT')).toBe('false');
    });

    test('loads Termux-specific variables', () => {
      const hostBridge = {
        platform: { name: 'termux', isTermux: true, isMac: false },
        root: { available: false },
      };
      const envWithHost = createEnvLoader(kernel, fs, hostBridge, null);
      envWithHost.load();
      expect(envWithHost.get('TERMUX_APP')).toBe('com.termux');
    });

    test('loads Mac-specific variables', () => {
      const hostBridge = {
        platform: { name: 'darwin', isTermux: false, isMac: true },
        root: { available: false },
      };
      const envWithHost = createEnvLoader(kernel, fs, hostBridge, null);
      envWithHost.load();
      expect(envWithHost.get('MACOS')).toBe('true');
    });
  });

  describe('with identity', () => {
    test('loads identity variables', () => {
      const identity = {
        get: () => ({ id: 'test-id', arch: 'x64', bootTime: '2024-01-01' }),
      };
      const envWithId = createEnvLoader(kernel, fs, null, identity);
      envWithId.load();
      expect(envWithId.get('AIOS_ID')).toBe('test-id');
      expect(envWithId.get('AIOS_ARCH')).toBe('x64');
    });

    test('handles null identity manifest', () => {
      const identity = { get: () => null };
      const envWithId = createEnvLoader(kernel, fs, null, identity);
      envWithId.load(); // should not throw
    });
  });

  describe('commands interface', () => {
    beforeEach(() => {
      env.load();
    });

    test('env command lists all variables', () => {
      const result = env.commands.env([]);
      expect(result.status).toBe('ok');
      expect(result.result).toContain('AIOS_OS=');
    });

    test('env get command', () => {
      const result = env.commands.env(['get', 'HOME']);
      expect(result.status).toBe('ok');
      expect(result.result).toContain('/home/user');
    });

    test('env get for non-existent variable', () => {
      const result = env.commands.env(['get', 'NONEXISTENT']);
      expect(result.status).toBe('ok');
      expect(result.result).toContain('not set');
    });

    test('env set command', () => {
      const result = env.commands.env(['set', 'MY_VAR', 'hello', 'world']);
      expect(result.status).toBe('ok');
      expect(env.get('MY_VAR')).toBe('hello world');
    });

    test('env unset command', () => {
      env.set('TEMP', 'val');
      const result = env.commands.env(['unset', 'TEMP']);
      expect(result.status).toBe('ok');
      expect(env.get('TEMP')).toBeUndefined();
    });

    test('export command', () => {
      const result = env.commands.export(['MY_EXPORT=exported']);
      expect(result.status).toBe('ok');
      expect(env.get('MY_EXPORT')).toBe('exported');
    });

    test('export without args shows error', () => {
      const result = env.commands.export([]);
      expect(result.status).toBe('error');
    });

    test('export without = shows error', () => {
      const result = env.commands.export(['NO_EQUALS']);
      expect(result.status).toBe('error');
    });
  });

  describe('without kernel/fs', () => {
    test('works without dependencies', () => {
      const envMin = createEnvLoader(null, null, null, null);
      const result = envMin.load();
      expect(result.AIOS_OS).toBe('AIOS UniKernel');
    });
  });
});
