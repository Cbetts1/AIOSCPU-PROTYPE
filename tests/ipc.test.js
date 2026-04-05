'use strict';

const { createKernel } = require('../core/kernel');
const { createFilesystem } = require('../core/filesystem');
const { createIPC } = require('../core/ipc');

describe('IPC', () => {
  let kernel, fs, ipc;

  beforeEach(() => {
    kernel = createKernel();
    kernel.boot();
    fs = createFilesystem();
    fs.mkdir('/var/run/ipc/pipes', { parents: true });
    ipc = createIPC(kernel, fs);
  });

  afterEach(() => {
    kernel.shutdown();
  });

  describe('Named Pipes', () => {
    test('createPipe creates a new pipe', () => {
      const result = ipc.createPipe('test');
      expect(result.ok).toBe(true);
    });

    test('createPipe returns ok for existing pipe', () => {
      ipc.createPipe('test');
      const result = ipc.createPipe('test');
      expect(result.ok).toBe(true);
      expect(result.note).toBe('already exists');
    });

    test('writePipe and readPipe transfer data', () => {
      ipc.createPipe('test');
      ipc.writePipe('test', 'hello');
      const result = ipc.readPipe('test');
      expect(result.ok).toBe(true);
      expect(result.data).toBe('hello');
    });

    test('readPipe returns null when buffer is empty', () => {
      ipc.createPipe('test');
      const result = ipc.readPipe('test');
      expect(result.ok).toBe(true);
      expect(result.data).toBeNull();
    });

    test('readPipe fails for non-existent pipe', () => {
      const result = ipc.readPipe('nonexistent');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('Pipe not found');
    });

    test('writePipe auto-creates pipe', () => {
      ipc.writePipe('auto-pipe', 'data');
      const result = ipc.readPipe('auto-pipe');
      expect(result.ok).toBe(true);
      expect(result.data).toBe('data');
    });

    test('peekPipe shows pending count', () => {
      ipc.createPipe('test');
      ipc.writePipe('test', 'msg1');
      ipc.writePipe('test', 'msg2');
      const result = ipc.peekPipe('test');
      expect(result.ok).toBe(true);
      expect(result.pending).toBe(2);
    });

    test('peekPipe fails for non-existent pipe', () => {
      const result = ipc.peekPipe('nonexistent');
      expect(result.ok).toBe(false);
    });

    test('watchPipe notifies listeners', () => {
      const handler = jest.fn();
      ipc.createPipe('test');
      ipc.watchPipe('test', handler);
      ipc.writePipe('test', 'hello');
      expect(handler).toHaveBeenCalledWith('hello', expect.any(Number));
    });

    test('watchPipe returns unsubscribe function', () => {
      const handler = jest.fn();
      ipc.createPipe('test');
      const unsub = ipc.watchPipe('test', handler);
      unsub();
      ipc.writePipe('test', 'hello');
      expect(handler).not.toHaveBeenCalled();
    });

    test('destroyPipe removes pipe', () => {
      ipc.createPipe('test');
      ipc.destroyPipe('test');
      const result = ipc.readPipe('test');
      expect(result.ok).toBe(false);
    });

    test('pipe buffer bounded at 1000', () => {
      ipc.createPipe('test');
      for (let i = 0; i < 1010; i++) {
        ipc.writePipe('test', `msg-${i}`);
      }
      const peek = ipc.peekPipe('test');
      expect(peek.pending).toBeLessThanOrEqual(1000);
    });

    test('writePipe emits ipc:pipe-write event', () => {
      const handler = jest.fn();
      kernel.bus.on('ipc:pipe-write', handler);
      ipc.createPipe('test');
      ipc.writePipe('test', 'data');
      expect(handler).toHaveBeenCalledWith({ name: 'test', data: 'data' });
    });
  });

  describe('Message Queues', () => {
    test('createQueue creates a new queue', () => {
      const result = ipc.createQueue('q1');
      expect(result.ok).toBe(true);
    });

    test('createQueue returns ok for existing queue', () => {
      ipc.createQueue('q1');
      const result = ipc.createQueue('q1');
      expect(result.ok).toBe(true);
      expect(result.note).toBe('already exists');
    });

    test('enqueue and dequeue transfer messages', () => {
      ipc.createQueue('q1');
      ipc.enqueue('q1', 'hello');
      const result = ipc.dequeue('q1');
      expect(result.ok).toBe(true);
      expect(result.message).toBe('hello');
    });

    test('dequeue returns null for empty queue', () => {
      ipc.createQueue('q1');
      const result = ipc.dequeue('q1');
      expect(result.ok).toBe(true);
      expect(result.message).toBeNull();
    });

    test('dequeue fails for non-existent queue', () => {
      const result = ipc.dequeue('nonexistent');
      expect(result.ok).toBe(false);
    });

    test('enqueue auto-creates queue', () => {
      ipc.enqueue('auto-q', 'test');
      const result = ipc.dequeue('auto-q');
      expect(result.ok).toBe(true);
      expect(result.message).toBe('test');
    });

    test('priority ordering', () => {
      ipc.createQueue('q1');
      ipc.enqueue('q1', 'low', 0);
      ipc.enqueue('q1', 'high', 10);
      ipc.enqueue('q1', 'medium', 5);
      // High priority dequeued first
      expect(ipc.dequeue('q1').message).toBe('high');
      expect(ipc.dequeue('q1').message).toBe('medium');
      expect(ipc.dequeue('q1').message).toBe('low');
    });

    test('peekQueue shows queue info', () => {
      ipc.createQueue('q1');
      ipc.enqueue('q1', 'test');
      const result = ipc.peekQueue('q1');
      expect(result.ok).toBe(true);
      expect(result.length).toBe(1);
      expect(result.next).toBeDefined();
    });

    test('peekQueue fails for non-existent queue', () => {
      const result = ipc.peekQueue('nonexistent');
      expect(result.ok).toBe(false);
    });

    test('purgeQueue clears all messages', () => {
      ipc.createQueue('q1');
      ipc.enqueue('q1', 'a');
      ipc.enqueue('q1', 'b');
      const result = ipc.purgeQueue('q1');
      expect(result.ok).toBe(true);
      expect(ipc.peekQueue('q1').length).toBe(0);
    });

    test('purgeQueue fails for non-existent queue', () => {
      const result = ipc.purgeQueue('nonexistent');
      expect(result.ok).toBe(false);
    });
  });

  describe('Signals', () => {
    test('SIGNALS constants are frozen', () => {
      expect(Object.isFrozen(ipc.SIGNALS)).toBe(true);
    });

    test('sendSignal sends named signal', () => {
      const result = ipc.sendSignal(1, 'SIGTERM');
      expect(result.ok).toBe(true);
      expect(result.sigName).toBe('SIGTERM');
      expect(result.sigNum).toBe(15);
    });

    test('sendSignal sends numeric signal', () => {
      const result = ipc.sendSignal(1, 9);
      expect(result.ok).toBe(true);
      expect(result.sigName).toBe('SIGKILL');
    });

    test('onSignal receives signals for target PID', () => {
      const handler = jest.fn();
      ipc.onSignal(42, handler);
      ipc.sendSignal(42, 'SIGUSR1', { info: 'test' });
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        sigNum: 10,
        sigName: 'SIGUSR1',
      }));
    });

    test('onSignal returns unsubscribe function', () => {
      const handler = jest.fn();
      const unsub = ipc.onSignal(42, handler);
      unsub();
      ipc.sendSignal(42, 'SIGUSR1');
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('Shared Memory', () => {
    test('shmAlloc allocates shared memory', () => {
      const result = ipc.shmAlloc('mem1', 1024);
      expect(result.ok).toBe(true);
      expect(result.size).toBe(1024);
    });

    test('shmAlloc returns ok for existing key', () => {
      ipc.shmAlloc('mem1', 1024);
      const result = ipc.shmAlloc('mem1', 2048);
      expect(result.ok).toBe(true);
      expect(result.note).toBe('already allocated');
    });

    test('shmWrite and shmRead transfer data', () => {
      ipc.shmAlloc('mem1', 4096);
      ipc.shmWrite('mem1', 'hello world');
      const result = ipc.shmRead('mem1', 0, 11);
      expect(result.ok).toBe(true);
      expect(result.data).toBe('hello world');
    });

    test('shmWrite auto-allocates if key not found', () => {
      const result = ipc.shmWrite('auto-mem', 'test data');
      expect(result.ok).toBe(true);
    });

    test('shmRead fails for non-existent key', () => {
      const result = ipc.shmRead('nonexistent');
      expect(result.ok).toBe(false);
      expect(result.error).toContain('SHM key not found');
    });

    test('shmFree releases shared memory', () => {
      ipc.shmAlloc('mem1');
      ipc.shmFree('mem1');
      const result = ipc.shmRead('mem1');
      expect(result.ok).toBe(false);
    });

    test('shmWrite with offset', () => {
      ipc.shmAlloc('mem1', 4096);
      ipc.shmWrite('mem1', 'hello', 0);
      ipc.shmWrite('mem1', 'world', 10);
      const r1 = ipc.shmRead('mem1', 0, 5);
      expect(r1.data).toBe('hello');
      const r2 = ipc.shmRead('mem1', 10, 5);
      expect(r2.data).toBe('world');
    });

    test('shmWrite with object data', () => {
      ipc.shmAlloc('mem1', 4096);
      ipc.shmWrite('mem1', { key: 'value' });
      const result = ipc.shmRead('mem1', 0, 50);
      expect(result.ok).toBe(true);
      expect(JSON.parse(result.data)).toEqual({ key: 'value' });
    });
  });

  describe('Broadcast', () => {
    test('broadcast sends message on channel', () => {
      const handler = jest.fn();
      ipc.subscribeBroadcast('news', handler);
      ipc.broadcast('news', 'breaking!');
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        message: 'breaking!',
      }));
    });

    test('subscribeBroadcast returns unsubscribe function', () => {
      const handler = jest.fn();
      const unsub = ipc.subscribeBroadcast('news', handler);
      unsub();
      ipc.broadcast('news', 'test');
      expect(handler).not.toHaveBeenCalled();
    });

    test('broadcast emits global event', () => {
      const handler = jest.fn();
      kernel.bus.on('ipc:broadcast', handler);
      ipc.broadcast('chan', 'msg');
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({
        channel: 'chan',
        message: 'msg',
      }));
    });
  });

  describe('status', () => {
    test('returns status summary', () => {
      ipc.createPipe('p1');
      ipc.createQueue('q1');
      ipc.shmAlloc('m1');
      const s = ipc.status();
      expect(s.pipes).toHaveLength(1);
      expect(s.queues).toHaveLength(1);
      expect(s.shm).toContain('m1');
    });
  });

  describe('commands interface', () => {
    test('ipc status command', () => {
      const result = ipc.commands.ipc(['status']);
      expect(result.status).toBe('ok');
      expect(result.result).toContain('IPC Status');
    });

    test('ipc pipe create/write/read', () => {
      ipc.commands.ipc(['pipe', 'create', 'test']);
      ipc.commands.ipc(['pipe', 'write', 'test', 'hello']);
      const result = ipc.commands.ipc(['pipe', 'read', 'test']);
      expect(result.status).toBe('ok');
      expect(result.result).toBe('hello');
    });

    test('ipc pipe peek', () => {
      ipc.createPipe('test');
      ipc.writePipe('test', 'msg');
      const result = ipc.commands.ipc(['pipe', 'peek', 'test']);
      expect(result.status).toBe('ok');
      expect(result.result).toContain('Pending');
    });

    test('ipc pipe destroy', () => {
      ipc.createPipe('test');
      const result = ipc.commands.ipc(['pipe', 'destroy', 'test']);
      expect(result.status).toBe('ok');
    });

    test('ipc pipe without action shows usage', () => {
      const result = ipc.commands.ipc(['pipe']);
      expect(result.status).toBe('error');
      expect(result.result).toContain('Usage');
    });

    test('ipc queue create/enqueue/dequeue', () => {
      ipc.commands.ipc(['queue', 'create', 'q1']);
      ipc.commands.ipc(['queue', 'enqueue', 'q1', 'message']);
      const result = ipc.commands.ipc(['queue', 'dequeue', 'q1']);
      expect(result.status).toBe('ok');
      expect(result.result).toBe('message');
    });

    test('ipc queue peek and purge', () => {
      ipc.createQueue('q1');
      ipc.enqueue('q1', 'msg');
      const peek = ipc.commands.ipc(['queue', 'peek', 'q1']);
      expect(peek.result).toContain('Length');

      ipc.commands.ipc(['queue', 'purge', 'q1']);
      expect(ipc.peekQueue('q1').length).toBe(0);
    });

    test('ipc queue without action shows usage', () => {
      const result = ipc.commands.ipc(['queue']);
      expect(result.status).toBe('error');
    });

    test('ipc signal command', () => {
      const result = ipc.commands.ipc(['signal', '1', 'SIGTERM']);
      expect(result.status).toBe('ok');
      expect(result.result).toContain('SIGTERM');
    });

    test('ipc signal with invalid PID', () => {
      const result = ipc.commands.ipc(['signal', 'abc']);
      expect(result.status).toBe('error');
    });

    test('ipc broadcast command', () => {
      const result = ipc.commands.ipc(['broadcast', 'news', 'hello', 'world']);
      expect(result.status).toBe('ok');
    });

    test('ipc broadcast without channel shows error', () => {
      const result = ipc.commands.ipc(['broadcast']);
      expect(result.status).toBe('error');
    });

    test('ipc shm alloc/write/read/free', () => {
      ipc.commands.ipc(['shm', 'alloc', 'mem1', '1024']);
      ipc.commands.ipc(['shm', 'write', 'mem1', 'hello']);
      const result = ipc.commands.ipc(['shm', 'read', 'mem1']);
      expect(result.status).toBe('ok');
      ipc.commands.ipc(['shm', 'free', 'mem1']);
    });

    test('ipc shm without action shows usage', () => {
      const result = ipc.commands.ipc(['shm']);
      expect(result.status).toBe('error');
    });

    test('ipc unknown subcommand shows usage', () => {
      const result = ipc.commands.ipc(['unknown']);
      expect(result.status).toBe('error');
      expect(result.result).toContain('Usage');
    });

    test('ipc default shows status', () => {
      const result = ipc.commands.ipc([]);
      expect(result.status).toBe('ok');
      expect(result.result).toContain('IPC Status');
    });
  });

  describe('without kernel/fs', () => {
    test('works without kernel', () => {
      const ipcNoKernel = createIPC(null, null);
      ipcNoKernel.createPipe('test');
      ipcNoKernel.writePipe('test', 'data');
      expect(ipcNoKernel.readPipe('test').data).toBe('data');
    });

    test('onSignal returns noop when no kernel', () => {
      const ipcNoKernel = createIPC(null, null);
      const unsub = ipcNoKernel.onSignal(1, jest.fn());
      expect(typeof unsub).toBe('function');
    });
  });
});
