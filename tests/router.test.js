'use strict';

const { createRouter } = require('../core/router');

describe('Router', () => {
  let router;

  beforeEach(() => {
    router = createRouter({ logger: null });
  });

  describe('createRouter', () => {
    test('returns router with expected API', () => {
      expect(typeof router.handle).toBe('function');
      expect(typeof router.registerCommand).toBe('function');
      expect(typeof router.unregisterCommand).toBe('function');
      expect(typeof router.use).toBe('function');
      expect(typeof router.unuse).toBe('function');
      expect(typeof router.getCommands).toBe('function');
      expect(typeof router.getModules).toBe('function');
      expect(router.version).toBe('4.0.0');
    });
  });

  describe('Built-in commands', () => {
    test('help command lists all commands', async () => {
      const result = await router.handle('help');
      expect(result.status).toBe('ok');
      expect(result.result).toContain('help');
      expect(result.result).toContain('echo');
      expect(result.result).toContain('version');
    });

    test('echo command echoes arguments', async () => {
      const result = await router.handle('echo hello world');
      expect(result.status).toBe('ok');
      expect(result.result).toBe('hello world');
    });

    test('version command returns version', async () => {
      const result = await router.handle('version');
      expect(result.status).toBe('ok');
      expect(result.result).toContain('4.0.0');
    });
  });

  describe('registerCommand / unregisterCommand', () => {
    test('registers and handles a custom command', async () => {
      router.registerCommand('test', () => ({ status: 'ok', result: 'it works' }));
      const result = await router.handle('test');
      expect(result.status).toBe('ok');
      expect(result.result).toBe('it works');
    });

    test('passes args to handler', async () => {
      router.registerCommand('add', (args) => ({
        status: 'ok',
        result: String(parseInt(args[0]) + parseInt(args[1])),
      }));
      const result = await router.handle('add 3 4');
      expect(result.result).toBe('7');
    });

    test('unregisters a command', async () => {
      router.registerCommand('test', () => ({ status: 'ok', result: 'ok' }));
      const removed = router.unregisterCommand('test');
      expect(removed).toBe(true);
      const result = await router.handle('test');
      expect(result.status).toBe('error');
    });

    test('unregisterCommand returns false for non-existent command', () => {
      const removed = router.unregisterCommand('nonexistent');
      expect(removed).toBe(false);
    });

    test('throws for invalid command name', () => {
      expect(() => router.registerCommand('', () => {})).toThrow(TypeError);
      expect(() => router.registerCommand(123, () => {})).toThrow(TypeError);
    });

    test('throws for non-function handler', () => {
      expect(() => router.registerCommand('test', 'string')).toThrow(TypeError);
    });
  });

  describe('handle', () => {
    test('handles unknown command with fallback', async () => {
      const result = await router.handle('nonexistent');
      expect(result.status).toBe('error');
      expect(result.result).toContain('Unknown command');
    });

    test('handles empty input', async () => {
      const result = await router.handle('');
      expect(result.status).toBe('error');
      expect(result.result).toContain('No command provided');
    });

    test('handles object input', async () => {
      const result = await router.handle({ command: 'echo', args: ['hi'] });
      expect(result.status).toBe('ok');
      expect(result.result).toBe('hi');
    });

    test('handles async command handlers', async () => {
      router.registerCommand('async-test', async () => {
        return { status: 'ok', result: 'async result' };
      });
      const result = await router.handle('async-test');
      expect(result.status).toBe('ok');
      expect(result.result).toBe('async result');
    });

    test('catches handler errors gracefully', async () => {
      router.registerCommand('throw', () => { throw new Error('oops'); });
      const result = await router.handle('throw');
      expect(result.status).toBe('error');
      expect(result.result).toContain('Handler error: oops');
    });

    test('commands are case insensitive', async () => {
      const result = await router.handle('HELP');
      expect(result.status).toBe('ok');
    });

    test('custom fallback handler', async () => {
      const custom = createRouter({
        logger: null,
        fallback: (parsed) => ({ status: 'custom', result: parsed.command }),
      });
      const result = await custom.handle('unknown');
      expect(result.status).toBe('custom');
    });
  });

  describe('Module mounting (use/unuse)', () => {
    test('use() mounts module and registers its commands', async () => {
      const module = {
        commands: {
          greet: () => ({ status: 'ok', result: 'hello!' }),
        },
      };
      router.use('greet-mod', module);
      const result = await router.handle('greet');
      expect(result.status).toBe('ok');
      expect(result.result).toBe('hello!');
    });

    test('unuse() removes module and its commands', async () => {
      const module = {
        commands: {
          greet: () => ({ status: 'ok', result: 'hello!' }),
        },
      };
      router.use('greet-mod', module);
      const removed = router.unuse('greet-mod');
      expect(removed).toBe(true);
      const result = await router.handle('greet');
      expect(result.status).toBe('error');
    });

    test('use() calls onMount on module', () => {
      const onMount = jest.fn();
      router.use('test', { onMount });
      expect(onMount).toHaveBeenCalledWith(router);
    });

    test('unuse() calls onUnmount on module', () => {
      const onUnmount = jest.fn();
      router.use('test', { onUnmount });
      router.unuse('test');
      expect(onUnmount).toHaveBeenCalledWith(router);
    });

    test('use() replaces existing module', async () => {
      router.use('mod', { commands: { cmd: () => ({ result: 'v1' }) } });
      router.use('mod', { commands: { cmd: () => ({ result: 'v2' }) } });
      const result = await router.handle('cmd');
      expect(result.result).toBe('v2');
    });

    test('throws for invalid module name', () => {
      expect(() => router.use('', {})).toThrow(TypeError);
      expect(() => router.use(123, {})).toThrow(TypeError);
    });

    test('throws for non-object module', () => {
      expect(() => router.use('mod', null)).toThrow(TypeError);
      expect(() => router.use('mod', 'string')).toThrow(TypeError);
    });

    test('unuse returns false for non-existent module', () => {
      expect(router.unuse('nonexistent')).toBe(false);
    });
  });

  describe('getCommands / getModules', () => {
    test('getCommands returns sorted list', () => {
      const cmds = router.getCommands();
      expect(cmds).toEqual(expect.arrayContaining(['echo', 'help', 'version']));
      expect(cmds).toEqual([...cmds].sort());
    });

    test('getModules returns mounted module names', () => {
      router.use('mod-a', {});
      router.use('mod-b', {});
      const mods = router.getModules();
      expect(mods).toEqual(expect.arrayContaining(['mod-a', 'mod-b']));
    });
  });

  describe('Event bus', () => {
    test('on/emit for command:registered event', () => {
      const handler = jest.fn();
      router.on('command:registered', handler);
      router.registerCommand('test', () => {});
      expect(handler).toHaveBeenCalledWith('test');
    });

    test('on/emit for command:before and command:after events', async () => {
      const before = jest.fn();
      const after = jest.fn();
      router.on('command:before', before);
      router.on('command:after', after);
      await router.handle('echo hello');
      expect(before).toHaveBeenCalled();
      expect(after).toHaveBeenCalled();
    });

    test('once fires only once', async () => {
      const handler = jest.fn();
      router.once('command:before', handler);
      await router.handle('echo a');
      await router.handle('echo b');
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});
