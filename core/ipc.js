'use strict';
/**
 * ipc.js — AIOS IPC v4.0.0
 *
 * Full IPC system: named pipes, message queues, signals, shared memory.
 * All IPC state is mirrored into the AIOS VFS under /var/run/ipc/.
 *
 * Features:
 *   Named Pipes     : createPipe / writePipe / readPipe / watchPipe
 *   Message Queues  : createQueue / enqueue / dequeue / peekQueue
 *   Signals         : send / on / off  (kernel-bus-backed)
 *   Shared Memory   : alloc / read / write / free
 *   Broadcast       : broadcast to all listening processes
 *
 * Zero external npm dependencies.
 */

function createIPC(kernel, filesystem) {
  // ── Named Pipes ────────────────────────────────────────────────────────────
  const _pipes     = new Map();   // name → { buffer, listeners[] }

  function createPipe(name) {
    if (_pipes.has(name)) return { ok: true, note: 'already exists' };
    _pipes.set(name, { buffer: [], listeners: [] });
    if (filesystem) {
      filesystem.mkdir('/var/run/ipc/pipes', { parents: true });
      filesystem.write('/var/run/ipc/pipes/' + name, '');
    }
    if (kernel) kernel.bus.emit('ipc:pipe-created', { name });
    return { ok: true };
  }

  function writePipe(name, data) {
    if (!_pipes.has(name)) createPipe(name);
    const pipe = _pipes.get(name);
    const msg  = { data, ts: Date.now() };
    pipe.buffer.push(msg);
    // Keep pipe bounded (max 1000 messages)
    if (pipe.buffer.length > 1000) pipe.buffer.shift();
    // Mirror to VFS
    if (filesystem) {
      const existing = filesystem.read('/var/run/ipc/pipes/' + name);
      const content  = (existing.ok ? existing.content : '') + JSON.stringify(msg) + '\n';
      filesystem.write('/var/run/ipc/pipes/' + name, content.slice(-65536));
    }
    // Notify listeners
    pipe.listeners.forEach(fn => { try { fn(data, msg.ts); } catch(_) {} });
    if (kernel) kernel.bus.emit('ipc:pipe-write', { name, data });
    return { ok: true };
  }

  function readPipe(name) {
    const pipe = _pipes.get(name);
    if (!pipe) return { ok: false, error: 'Pipe not found: ' + name };
    const msg = pipe.buffer.shift();
    return msg ? { ok: true, data: msg.data, ts: msg.ts } : { ok: true, data: null };
  }

  function peekPipe(name) {
    const pipe = _pipes.get(name);
    if (!pipe) return { ok: false, error: 'Pipe not found: ' + name };
    return { ok: true, pending: pipe.buffer.length };
  }

  function watchPipe(name, fn) {
    if (!_pipes.has(name)) createPipe(name);
    _pipes.get(name).listeners.push(fn);
    return () => {
      const p = _pipes.get(name);
      if (p) p.listeners = p.listeners.filter(l => l !== fn);
    };
  }

  function destroyPipe(name) {
    _pipes.delete(name);
    if (filesystem) {
      try { filesystem.rm('/var/run/ipc/pipes/' + name); } catch(_) {}
    }
    return { ok: true };
  }

  // ── Message Queues ─────────────────────────────────────────────────────────
  const _queues = new Map();  // name → { messages[], maxLen }

  function createQueue(name, maxLen) {
    if (_queues.has(name)) return { ok: true, note: 'already exists' };
    _queues.set(name, { messages: [], maxLen: maxLen || 10000 });
    if (kernel) kernel.bus.emit('ipc:queue-created', { name });
    return { ok: true };
  }

  function enqueue(name, message, priority) {
    if (!_queues.has(name)) createQueue(name);
    const q   = _queues.get(name);
    const msg = { message, priority: priority || 0, ts: Date.now() };
    // Insert by priority (high priority first)
    let i = q.messages.length;
    while (i > 0 && q.messages[i-1].priority < msg.priority) i--;
    q.messages.splice(i, 0, msg);
    if (q.messages.length > q.maxLen) q.messages.pop();
    if (kernel) kernel.bus.emit('ipc:enqueue', { name, priority: msg.priority });
    return { ok: true, queueLength: q.messages.length };
  }

  function dequeue(name) {
    const q = _queues.get(name);
    if (!q) return { ok: false, error: 'Queue not found: ' + name };
    const msg = q.messages.shift();
    return msg ? { ok: true, message: msg.message, priority: msg.priority, ts: msg.ts }
               : { ok: true, message: null };
  }

  function peekQueue(name) {
    const q = _queues.get(name);
    if (!q) return { ok: false, error: 'Queue not found: ' + name };
    return { ok: true, length: q.messages.length, next: q.messages[0] || null };
  }

  function purgeQueue(name) {
    const q = _queues.get(name);
    if (!q) return { ok: false, error: 'Queue not found: ' + name };
    q.messages = [];
    return { ok: true };
  }

  // ── Signals ────────────────────────────────────────────────────────────────
  // Signals are just typed kernel bus events with source/target PID tracking.
  const SIGNALS = Object.freeze({
    SIGTERM:  15, SIGKILL: 9,  SIGINT:  2,  SIGHUP:  1,
    SIGUSR1:  10, SIGUSR2: 12, SIGALRM: 14, SIGCHLD: 17,
    SIGSTOP:  19, SIGCONT: 18,
  });

  function sendSignal(targetPid, signal, data) {
    const sigNum  = typeof signal === 'number' ? signal : (SIGNALS[signal] || 0);
    const sigName = Object.keys(SIGNALS).find(k => SIGNALS[k] === sigNum) || 'SIG' + sigNum;
    if (kernel) {
      kernel.bus.emit('ipc:signal', { targetPid, sigNum, sigName, data, ts: Date.now() });
      kernel.bus.emit('ipc:signal:' + targetPid, { sigNum, sigName, data });
    }
    return { ok: true, sigName, sigNum };
  }

  function onSignal(pid, handler) {
    if (!kernel) return () => {};
    const event = 'ipc:signal:' + pid;
    kernel.bus.on(event, handler);
    return () => kernel.bus.off(event, handler);
  }

  // ── Shared Memory ──────────────────────────────────────────────────────────
  const _shm = new Map();  // key → Buffer / any

  function shmAlloc(key, size) {
    if (_shm.has(key)) return { ok: true, note: 'already allocated', size: _shm.get(key).length };
    const buf = Buffer.alloc(size || 4096);
    _shm.set(key, buf);
    if (kernel) kernel.bus.emit('ipc:shm-alloc', { key, size });
    return { ok: true, key, size };
  }

  function shmWrite(key, data, offset) {
    if (!_shm.has(key)) shmAlloc(key, 65536);
    const buf = _shm.get(key);
    const str = typeof data === 'string' ? data : JSON.stringify(data);
    const bytes = Buffer.from(str, 'utf8');
    bytes.copy(buf, offset || 0);
    return { ok: true, bytesWritten: bytes.length };
  }

  function shmRead(key, offset, length) {
    const buf = _shm.get(key);
    if (!buf) return { ok: false, error: 'SHM key not found: ' + key };
    const slice = buf.slice(offset || 0, length ? (offset || 0) + length : undefined);
    // Trim null bytes and parse
    const str = slice.toString('utf8').replace(/\0+$/, '');
    return { ok: true, data: str };
  }

  function shmFree(key) {
    _shm.delete(key);
    if (kernel) kernel.bus.emit('ipc:shm-free', { key });
    return { ok: true };
  }

  // ── Broadcast ─────────────────────────────────────────────────────────────
  function broadcast(channel, message) {
    if (kernel) {
      kernel.bus.emit('ipc:broadcast:' + channel, { message, ts: Date.now() });
      kernel.bus.emit('ipc:broadcast', { channel, message, ts: Date.now() });
    }
    return { ok: true };
  }

  function subscribeBroadcast(channel, handler) {
    if (!kernel) return () => {};
    const event = 'ipc:broadcast:' + channel;
    kernel.bus.on(event, handler);
    return () => kernel.bus.off(event, handler);
  }

  // ── Status ─────────────────────────────────────────────────────────────────
  function status() {
    return {
      pipes:  Array.from(_pipes.entries()).map(([n, p]) => ({ name: n, pending: p.buffer.length, listeners: p.listeners.length })),
      queues: Array.from(_queues.entries()).map(([n, q]) => ({ name: n, length: q.messages.length, maxLen: q.maxLen })),
      shm:    Array.from(_shm.keys()),
    };
  }

  // ── Router commands ────────────────────────────────────────────────────────
  const commands = {
    ipc: (args) => {
      const sub = (args[0] || '').toLowerCase();

      if (!sub || sub === 'status') {
        const s = status();
        const out = [
          'IPC Status:',
          '  Pipes  : ' + s.pipes.length + (s.pipes.length ? ' — ' + s.pipes.map(p => p.name + '(' + p.pending + ')').join(', ') : ''),
          '  Queues : ' + s.queues.length + (s.queues.length ? ' — ' + s.queues.map(q => q.name + '[' + q.length + ']').join(', ') : ''),
          '  SHM    : ' + (s.shm.length ? s.shm.join(', ') : 'none'),
        ];
        return { status: 'ok', result: out.join('\n') };
      }

      if (sub === 'pipe') {
        const action = args[1], name = args[2], data = args.slice(3).join(' ');
        if (!action) return { status: 'error', result: 'Usage: ipc pipe <create|write|read|peek|destroy> <name> [data]' };
        if (action === 'create')  { const r = createPipe(name); return { status: 'ok', result: r.note || 'Pipe "' + name + '" created.' }; }
        if (action === 'write')   { writePipe(name, data); return { status: 'ok', result: 'Written to pipe "' + name + '".' }; }
        if (action === 'read')    { const r = readPipe(name); return { status: r.ok ? 'ok' : 'error', result: r.ok ? (r.data !== null ? String(r.data) : '(empty)') : r.error }; }
        if (action === 'peek')    { const r = peekPipe(name); return { status: 'ok', result: 'Pending: ' + r.pending }; }
        if (action === 'destroy') { destroyPipe(name); return { status: 'ok', result: 'Pipe "' + name + '" destroyed.' }; }
      }

      if (sub === 'queue') {
        const action = args[1], name = args[2], data = args.slice(3).join(' ');
        if (!action) return { status: 'error', result: 'Usage: ipc queue <create|enqueue|dequeue|peek|purge> <name> [data]' };
        if (action === 'create')  { createQueue(name); return { status: 'ok', result: 'Queue "' + name + '" created.' }; }
        if (action === 'enqueue') { const r = enqueue(name, data); return { status: 'ok', result: 'Enqueued. Queue length: ' + r.queueLength }; }
        if (action === 'dequeue') { const r = dequeue(name); return { status: r.ok ? 'ok' : 'error', result: r.ok ? (r.message !== null ? String(r.message) : '(empty)') : r.error }; }
        if (action === 'peek')    { const r = peekQueue(name); return { status: 'ok', result: 'Length: ' + r.length + (r.next ? ', next: ' + r.next.message : '') }; }
        if (action === 'purge')   { purgeQueue(name); return { status: 'ok', result: 'Queue purged.' }; }
      }

      if (sub === 'signal') {
        const pid = parseInt(args[1], 10);
        const sig = args[2] || 'SIGTERM';
        if (isNaN(pid)) return { status: 'error', result: 'Usage: ipc signal <pid> <signal>' };
        const r = sendSignal(pid, sig);
        return { status: 'ok', result: 'Sent ' + r.sigName + ' to PID ' + pid };
      }

      if (sub === 'broadcast') {
        const channel = args[1], msg = args.slice(2).join(' ');
        if (!channel) return { status: 'error', result: 'Usage: ipc broadcast <channel> <message>' };
        broadcast(channel, msg);
        return { status: 'ok', result: 'Broadcast sent on channel "' + channel + '".' };
      }

      if (sub === 'shm') {
        const action = args[1], key = args[2];
        if (!action) return { status: 'error', result: 'Usage: ipc shm <alloc|read|write|free> <key> [data]' };
        if (action === 'alloc') { const r = shmAlloc(key, parseInt(args[3]||'4096')); return { status: 'ok', result: 'SHM "' + key + '" allocated (' + r.size + ' bytes).' }; }
        if (action === 'write') { const r = shmWrite(key, args.slice(3).join(' ')); return { status: r.ok ? 'ok' : 'error', result: r.ok ? 'Written ' + r.bytesWritten + ' bytes.' : r.error }; }
        if (action === 'read')  { const r = shmRead(key); return { status: r.ok ? 'ok' : 'error', result: r.ok ? r.data : r.error }; }
        if (action === 'free')  { shmFree(key); return { status: 'ok', result: 'SHM "' + key + '" freed.' }; }
      }

      return { status: 'error', result: 'Usage: ipc <status|pipe|queue|signal|broadcast|shm>' };
    },
  };

  return {
    name: 'ipc', version: '4.0.0',
    SIGNALS,
    createPipe, writePipe, readPipe, peekPipe, watchPipe, destroyPipe,
    createQueue, enqueue, dequeue, peekQueue, purgeQueue,
    sendSignal, onSignal,
    shmAlloc, shmWrite, shmRead, shmFree,
    broadcast, subscribeBroadcast,
    status,
    commands,
  };
}

module.exports = { createIPC };
