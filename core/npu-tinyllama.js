'use strict';
/**
 * core/npu-tinyllama.js — AIOS TinyLlama Neural Processing Unit Driver v1.0.0
 *
 * Makes TinyLlama a first-class kernel subsystem rather than an external
 * Ollama fallback.  Registers itself with VHAL as a device of type "npu"
 * and exposes a kernel syscall (NPU_INFER = 30) so any kernel process
 * can perform inference without knowing about Ollama.
 *
 * Features
 * ─────────
 *   - Registers with VHAL: id="npu-0", type="npu", model="tinyllama"
 *   - On init(): pings Ollama /api/tags; if tinyllama is absent, runs
 *     `ollama pull tinyllama` asynchronously — kernel continues booting
 *   - Exposes SYSCALL 30 (NPU_INFER): args=[prompt] → result=response
 *   - Subscribes to kernel bus events: kernel:query, ai:request
 *   - Responds via npu:response events on the kernel bus
 *   - Queues requests when Ollama is offline; replays when it comes back
 *   - Stores every inference in memory-core.js (if wired)
 *
 * Emits on kernel bus:
 *   npu:ready       { model, ollamaOnline }
 *   npu:infer:start { requestId, prompt }
 *   npu:response    { requestId, prompt, response, model, latencyMs }
 *   npu:error       { requestId, error }
 *   npu:queue:flush { count }
 *
 * Zero external npm dependencies.
 */

const http  = require('http');
const cp    = require('child_process');

const MODEL      = 'tinyllama';
const OLLAMA_HOST = '127.0.0.1';
const OLLAMA_PORT = 11434;
const TIMEOUT_MS  = 30000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function _uid() {
  return Math.random().toString(36).slice(2, 10);
}

function _httpPost(path, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const req = http.request({
      hostname: OLLAMA_HOST,
      port:     OLLAMA_PORT,
      path,
      method:   'POST',
      headers:  { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, (res) => {
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end',  () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs || TIMEOUT_MS, () => { req.destroy(new Error('NPU request timeout')); });
    req.write(payload);
    req.end();
  });
}

function _httpGet(path) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: OLLAMA_HOST, port: OLLAMA_PORT, path, method: 'GET',
    }, (res) => {
      let data = '';
      res.on('data', d => { data += d; });
      res.on('end',  () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(new Error('timeout')); });
    req.end();
  });
}

// ---------------------------------------------------------------------------
// createNPUTinyLlama — factory
// ---------------------------------------------------------------------------
function createNPUTinyLlama(kernel, options) {
  const opts      = options || {};
  const VERSION   = '1.0.0';
  const _bus      = (kernel && kernel.bus) ? kernel.bus : { emit: () => {}, on: () => {} };
  const _memCore  = opts.memoryCore || null;

  let _ollamaOnline  = false;
  let _modelReady    = false;
  const _queue       = [];   // offline request queue: { requestId, prompt, resolve, reject }
  let   _flushTimer  = null;

  // ── probe Ollama ──────────────────────────────────────────────────────────
  async function _probeOllama() {
    try {
      const r = await _httpGet('/api/tags');
      if (r.status === 200) {
        const data = JSON.parse(r.body);
        const models = (data.models || []).map(m => m.name || m);
        _ollamaOnline = true;
        _modelReady   = models.some(m => m.startsWith(MODEL));
        return { online: true, modelReady: _modelReady, models };
      }
    } catch (_) {}
    _ollamaOnline = false;
    _modelReady   = false;
    return { online: false, modelReady: false };
  }

  // ── pull model ────────────────────────────────────────────────────────────
  function _pullModel() {
    try {
      const child = cp.spawn('ollama', ['pull', MODEL], { stdio: 'ignore', detached: true });
      child.unref();
    } catch (_) { /* ollama not in PATH — ignore */ }
  }

  // ── raw infer ─────────────────────────────────────────────────────────────
  async function _infer(prompt, context) {
    const messages = [];
    if (context && context.length) {
      for (const item of context) {
        if (item.role && item.content) messages.push(item);
      }
    }
    messages.push({ role: 'user', content: String(prompt) });

    const r = await _httpPost('/api/chat', {
      model:  MODEL,
      stream: false,
      messages,
    }, TIMEOUT_MS);

    if (r.status !== 200) throw new Error(`Ollama HTTP ${r.status}`);
    const data = JSON.parse(r.body);
    const response = (data.message && data.message.content) || data.response || '';
    return response.trim();
  }

  // ── infer (public) ────────────────────────────────────────────────────────
  async function infer(prompt, requestId) {
    const id       = requestId || _uid();
    const started  = Date.now();
    _bus.emit('npu:infer:start', { requestId: id, prompt: String(prompt).slice(0, 200) });

    if (!_ollamaOnline || !_modelReady) {
      return new Promise((resolve, reject) => {
        _queue.push({ requestId: id, prompt, resolve, reject });
        _scheduleFlush();
      });
    }

    try {
      const response  = await _infer(prompt);
      const latencyMs = Date.now() - started;
      const result    = { requestId: id, prompt, response, model: MODEL, latencyMs };
      _bus.emit('npu:response', result);
      if (_memCore) _memCore.record('npu:infer', String(prompt).slice(0, 300), response.slice(0, 300), null);
      return result;
    } catch (e) {
      _ollamaOnline = false;
      _bus.emit('npu:error', { requestId: id, error: e.message });
      if (_memCore) _memCore.record('npu:infer', String(prompt).slice(0, 300), '', e.message);
      throw e;
    }
  }

  // ── queue flush ───────────────────────────────────────────────────────────
  function _scheduleFlush() {
    if (_flushTimer) return;
    _flushTimer = setTimeout(async () => {
      _flushTimer = null;
      const probe = await _probeOllama();
      if (!probe.online) { _scheduleFlush(); return; }

      const pending = _queue.splice(0);
      _bus.emit('npu:queue:flush', { count: pending.length });
      for (const item of pending) {
        try {
          const started  = Date.now();
          const response = await _infer(item.prompt);
          const result   = { requestId: item.requestId, prompt: item.prompt, response, model: MODEL, latencyMs: Date.now() - started };
          _bus.emit('npu:response', result);
          if (_memCore) _memCore.record('npu:infer', String(item.prompt).slice(0, 300), response.slice(0, 300), null);
          item.resolve(result);
        } catch (e) {
          _bus.emit('npu:error', { requestId: item.requestId, error: e.message });
          item.reject(e);
        }
      }
    }, 5000);
  }

  // ── init ─────────────────────────────────────────────────────────────────
  async function init() {
    const probe = await _probeOllama();
    if (!probe.online) {
      _bus.emit('npu:ready', { model: MODEL, ollamaOnline: false, note: 'Ollama offline — requests will be queued' });
      return { ok: true, ollamaOnline: false, modelReady: false };
    }
    if (!probe.modelReady) {
      _bus.emit('npu:ready', { model: MODEL, ollamaOnline: true, note: 'pulling tinyllama in background' });
      _pullModel();
      _scheduleFlush();
      return { ok: true, ollamaOnline: true, modelReady: false };
    }
    _bus.emit('npu:ready', { model: MODEL, ollamaOnline: true });
    return { ok: true, ollamaOnline: true, modelReady: true };
  }

  // ── Register kernel bus subscriptions ────────────────────────────────────
  _bus.on('kernel:query', async (data) => {
    if (!data || !data.prompt) return;
    try { await infer(data.prompt, data.requestId); }
    catch (_) {}
  });

  _bus.on('ai:request', async (data) => {
    if (!data || !data.prompt) return;
    try { await infer(data.prompt, data.requestId); }
    catch (_) {}
  });

  // ── Register kernel syscall NPU_INFER (30) ────────────────────────────────
  if (kernel && typeof kernel.registerSyscall === 'function') {
    kernel.registerSyscall(30, (args) => infer(args[0], args[1]));
  }

  // ── VHAL device descriptor ────────────────────────────────────────────────
  const device = {
    id:      'npu-0',
    type:    'npu',
    version: VERSION,
    caps:    ['infer', 'chat', 'tinyllama', 'ollama'],
    init,
    read:    (_addr) => ({ model: MODEL, online: _ollamaOnline, ready: _modelReady, queued: _queue.length }),
    write:   (_addr, val) => {
      if (val && val.prompt) infer(val.prompt, val.requestId).catch(() => {});
    },
    ioctl:   (cmd, args) => {
      if (cmd === 'infer')  return infer((args && args.prompt) || '', args && args.requestId);
      if (cmd === 'status') return { ok: true, model: MODEL, online: _ollamaOnline, ready: _modelReady, queued: _queue.length };
      if (cmd === 'probe')  return _probeOllama();
      return null;
    },
    hotplug: () => init().catch(() => {}),
    unplug:  () => { if (_flushTimer) { clearTimeout(_flushTimer); _flushTimer = null; } },
  };

  return {
    name:    'npu-tinyllama',
    version: VERSION,
    model:   MODEL,
    device,
    init,
    infer,
    isOnline:    () => _ollamaOnline,
    isReady:     () => _modelReady,
    queueLength: () => _queue.length,
  };
}

module.exports = { createNPUTinyLlama };
