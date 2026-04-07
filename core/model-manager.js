'use strict';
/**
 * model-manager.js — AIOS Model Manager v1.0.0
 *
 * Manages local and remote AI model connections, mode routing, memory
 * mapping, connection validation, and idle low-power logic.
 *
 * Mode assignments:
 *   Lightweight local models → chat / help / quickfix
 *   Heavy remote models      → code / fix  / learn
 *
 * Virtual channels are IPC named pipes (model:channel:<id>) backed by
 * shared memory (model:output:<id>) — both live under the AIOS IPC layer.
 *
 * Zero external npm dependencies.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default AIOS virtual-channel port identifier */
const AIOS_PORT = 7700;

/** Mode → model-type routing table */
const MODE_ASSIGNMENTS = Object.freeze({
  chat:     'local',
  help:     'local',
  quickfix: 'local',
  code:     'remote',
  fix:      'remote',
  learn:    'remote',
});

const MODEL_TYPES = Object.freeze({
  LOCAL:  'local',
  REMOTE: 'remote',
});

const MODEL_STATES = Object.freeze({
  OFFLINE:    'offline',
  CONNECTING: 'connecting',
  ONLINE:     'online',
  IDLE:       'idle',
  ERROR:      'error',
});

/** Sample prompt sent during connection validation */
const VALIDATION_PROMPT = 'ping';

/** Default idle timeout before a model enters low-power mode (ms) */
const DEFAULT_IDLE_MS = 30000;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * createModelManager(kernel, ipc, network)
 *
 * @param {object} kernel   - AIOS kernel (may be null in tests)
 * @param {object} ipc      - createIPC() instance (may be null)
 * @param {object} network  - createNetwork() instance (may be null)
 */
function createModelManager(kernel, ipc, network) {

  /** @type {Map<string, object>} modelId → model descriptor */
  const _models      = new Map();
  /** @type {Map<string, ReturnType<typeof setTimeout>>} modelId → idle timer */
  const _idleTimers  = new Map();
  /** @type {Map<string, number>} modelId → last-activity epoch ms */
  const _lastActivity = new Map();
  /** @type {Map<string, string>} modelId → IPC pipe name */
  const _channels    = new Map();

  // ── Helper: kernel bus emit (safe when kernel is absent) ─────────────────

  function _emit(event, data) {
    if (kernel) kernel.bus.emit(event, data);
  }

  // ── Model registration ────────────────────────────────────────────────────

  /**
   * Register a model with the manager.
   *
   * @param {object} descriptor
   * @param {string}  descriptor.id            - Unique model identifier
   * @param {string}  descriptor.name          - Human-readable name
   * @param {string}  descriptor.type          - 'local' | 'remote'
   * @param {string}  [descriptor.endpoint]    - HTTP endpoint for remote models
   * @param {number}  [descriptor.idleTimeoutMs] - ms before idle (default 30,000)
   */
  function registerModel(descriptor) {
    const { id, name, type, endpoint, idleTimeoutMs } = descriptor || {};
    if (!id)   throw new Error('registerModel: descriptor.id is required');
    if (!name) throw new Error('registerModel: descriptor.name is required');
    if (!type) throw new Error('registerModel: descriptor.type is required');

    const normalizedType = type.toLowerCase();
    if (normalizedType !== MODEL_TYPES.LOCAL && normalizedType !== MODEL_TYPES.REMOTE) {
      throw new TypeError(`registerModel: unknown type "${type}". Use "local" or "remote".`);
    }

    _models.set(id, {
      id,
      name,
      type:         normalizedType,
      endpoint:     endpoint || null,
      idleTimeoutMs: idleTimeoutMs || DEFAULT_IDLE_MS,
      state:        MODEL_STATES.OFFLINE,
      modes:        Object.keys(MODE_ASSIGNMENTS).filter(m => MODE_ASSIGNMENTS[m] === normalizedType),
      queryCount:   0,
      lastError:    null,
      _backend:     null,
    });

    _emit('model:registered', { id, name, type: normalizedType });
    return { ok: true, id };
  }

  // ── Virtual channel management (IPC pipes + shared memory) ───────────────

  function _openChannel(modelId) {
    const pipeName = `model:channel:${modelId}`;
    if (ipc) {
      ipc.createPipe(pipeName);
      ipc.shmAlloc(`model:output:${modelId}`, 65536);
    }
    _channels.set(modelId, pipeName);
    _emit('model:channel-opened', { modelId, pipe: pipeName, port: AIOS_PORT });
    return pipeName;
  }

  function _closeChannel(modelId) {
    const pipeName = _channels.get(modelId);
    if (pipeName && ipc) {
      ipc.destroyPipe(pipeName);
      ipc.shmFree(`model:output:${modelId}`);
    }
    _channels.delete(modelId);
  }

  // ── Output → AIOS memory ──────────────────────────────────────────────────

  function _storeOutput(modelId, response) {
    if (!ipc) return;
    const payload = JSON.stringify({ modelId, ts: Date.now(), response });
    ipc.shmWrite(`model:output:${modelId}`, payload);
    const pipeName = _channels.get(modelId);
    if (pipeName) ipc.writePipe(pipeName, payload);
    _emit('model:output', { modelId, ts: Date.now() });
  }

  // ── Idle / low-power management ───────────────────────────────────────────

  function _cancelIdleTimer(modelId) {
    const t = _idleTimers.get(modelId);
    if (t !== undefined) {
      clearTimeout(t);
      _idleTimers.delete(modelId);
    }
  }

  function _scheduleIdleTimer(modelId) {
    const model = _models.get(modelId);
    if (!model || model.state !== MODEL_STATES.ONLINE) return;

    _cancelIdleTimer(modelId);

    const timer = setTimeout(() => {
      const m = _models.get(modelId);
      if (!m || m.state !== MODEL_STATES.ONLINE) return;
      m.state = MODEL_STATES.IDLE;
      _emit('model:idle', { modelId, idleMs: m.idleTimeoutMs });
    }, model.idleTimeoutMs);

    if (typeof timer.unref === 'function') timer.unref();
    _idleTimers.set(modelId, timer);
  }

  function _recordActivity(modelId) {
    _lastActivity.set(modelId, Date.now());
  }

  /** Wake a model from idle back to online and reset its idle timer. */
  function _wakeIfIdle(modelId) {
    const model = _models.get(modelId);
    if (!model) return;
    if (model.state === MODEL_STATES.IDLE) {
      model.state = MODEL_STATES.ONLINE;
      _emit('model:wake', { modelId });
    }
    _recordActivity(modelId);
    _scheduleIdleTimer(modelId);
  }

  // ── Query a model directly ────────────────────────────────────────────────

  /**
   * Send a prompt to a specific model.
   * @returns {Promise<{ok:boolean, modelId?:string, response?:string, error?:string}>}
   */
  async function query(modelId, prompt) {
    const model = _models.get(modelId);
    if (!model) return { ok: false, error: `Model not found: ${modelId}` };

    if (model.state === MODEL_STATES.OFFLINE || model.state === MODEL_STATES.ERROR) {
      return { ok: false, error: `Model "${modelId}" is ${model.state}` };
    }

    _wakeIfIdle(modelId);
    model.queryCount++;

    let response;
    try {
      if (model.type === MODEL_TYPES.REMOTE && model.endpoint && network) {
        // Remote model via HTTP (ollama / OpenAI-compatible endpoint)
        const res = await network.post(
          model.endpoint,
          { model: model.name, prompt, stream: false },
          { headers: { 'Content-Type': 'application/json' }, timeout: 15000 }
        );
        if (res.ok) {
          const json = res.json();
          response = (json && (json.response || json.content || json.text)) || res.body;
        } else {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
      } else if (model._backend && typeof model._backend.query === 'function') {
        // Pluggable local backend (e.g. llama.cpp, test stub)
        response = await model._backend.query(prompt);
      } else {
        // Offline fallback
        response = `[${model.name}] offline — no backend configured`;
      }
    } catch (e) {
      model.lastError = e.message;
      _emit('model:error', { modelId, error: e.message });
      return { ok: false, error: e.message };
    }

    _storeOutput(modelId, response);
    return { ok: true, modelId, response };
  }

  // ── Mode Manager: route query by mode ────────────────────────────────────

  /**
   * Route a prompt to the best available model for the given mode.
   * @param {string} mode   - One of: chat | help | quickfix | code | fix | learn
   * @param {string} prompt
   * @returns {Promise<{ok:boolean, modelId?:string, response?:string, error?:string}>}
   */
  async function queryByMode(mode, prompt) {
    const normalizedMode = (mode || '').toLowerCase();
    const targetType = MODE_ASSIGNMENTS[normalizedMode];

    if (!targetType) {
      return {
        ok:    false,
        error: `Unknown mode: "${mode}". Valid modes: ${Object.keys(MODE_ASSIGNMENTS).join(', ')}`,
      };
    }

    // Collect reachable models of the right type
    const candidates = Array.from(_models.values()).filter(m =>
      m.type === targetType &&
      (m.state === MODEL_STATES.ONLINE || m.state === MODEL_STATES.IDLE)
    );

    if (!candidates.length) {
      return {
        ok:    false,
        error: `No ${targetType} model is online for mode "${mode}"`,
      };
    }

    // Prefer ONLINE over IDLE; among equals, prefer lowest queryCount
    candidates.sort((a, b) => {
      if (a.state !== b.state) return a.state === MODEL_STATES.ONLINE ? -1 : 1;
      return a.queryCount - b.queryCount;
    });

    return query(candidates[0].id, prompt);
  }

  // ── Connection (open channel + validate) ─────────────────────────────────

  /**
   * Open a virtual channel for a model and validate the connection by
   * sending a sample query.  Local models without a backend are marked
   * ONLINE immediately without network validation.
   *
   * @returns {Promise<{ok:boolean, modelId?:string, validated?:boolean, error?:string}>}
   */
  async function connect(modelId) {
    const model = _models.get(modelId);
    if (!model) return { ok: false, error: `Model not found: ${modelId}` };

    model.state = MODEL_STATES.CONNECTING;
    _emit('model:connecting', { modelId });

    _openChannel(modelId);

    // Validate only when there is a real backend to probe
    const needsValidation = model.type === MODEL_TYPES.REMOTE || model._backend != null;

    if (needsValidation) {
      try {
        const validationResult = await query(modelId, VALIDATION_PROMPT);
        if (!validationResult.ok) {
          model.state = MODEL_STATES.ERROR;
          model.lastError = validationResult.error;
          _emit('model:error', { modelId, error: validationResult.error });
          return { ok: false, error: validationResult.error };
        }
      } catch (e) {
        model.state = MODEL_STATES.ERROR;
        model.lastError = e.message;
        return { ok: false, error: e.message };
      }
    }

    model.state = MODEL_STATES.ONLINE;
    _recordActivity(modelId);
    _scheduleIdleTimer(modelId);
    _emit('model:connected', { modelId, name: model.name, validated: needsValidation });
    return { ok: true, modelId, validated: needsValidation };
  }

  /** Connect all registered models in registration order. */
  async function connectAll() {
    const results = [];
    for (const id of _models.keys()) {
      results.push(await connect(id));
    }
    return results;
  }

  // ── Disconnect ────────────────────────────────────────────────────────────

  /** Close the virtual channel for a model and mark it OFFLINE. */
  function disconnect(modelId) {
    const model = _models.get(modelId);
    if (!model) return { ok: false, error: `Model not found: ${modelId}` };

    _cancelIdleTimer(modelId);
    _closeChannel(modelId);
    model.state = MODEL_STATES.OFFLINE;
    _emit('model:disconnected', { modelId });
    return { ok: true };
  }

  // ── Backend injection (for local models / testing) ────────────────────────

  /**
   * Attach a pluggable backend to a local model.
   * @param {string} modelId
   * @param {{ query: (prompt: string) => Promise<string> }} backend
   */
  function setModelBackend(modelId, backend) {
    const model = _models.get(modelId);
    if (!model) throw new Error(`setModelBackend: model not found: ${modelId}`);
    if (!backend || typeof backend.query !== 'function') {
      throw new TypeError('setModelBackend: backend must have a query(prompt) async function');
    }
    model._backend = backend;
  }

  // ── Read stored output from AIOS memory ──────────────────────────────────

  /**
   * Read the last response stored in IPC shared memory for a model.
   * @returns {{ ok: boolean, data?: string, error?: string }}
   */
  function readOutput(modelId) {
    if (!ipc) return { ok: false, error: 'IPC not available' };
    return ipc.shmRead(`model:output:${modelId}`);
  }

  // ── Status / introspection ────────────────────────────────────────────────

  /** Return a snapshot of all registered model states. */
  function status() {
    return Array.from(_models.values()).map(m => ({
      id:           m.id,
      name:         m.name,
      type:         m.type,
      state:        m.state,
      modes:        m.modes,
      queryCount:   m.queryCount,
      lastActivity: _lastActivity.get(m.id) || null,
      lastError:    m.lastError,
      channel:      _channels.get(m.id) || null,
    }));
  }

  /** Return a copy of the mode-to-model-type routing table. */
  function modeMap() {
    return Object.assign({}, MODE_ASSIGNMENTS);
  }

  // ── Router command interface ──────────────────────────────────────────────

  const commands = {
    model: async (args) => {
      const sub = (args[0] || '').toLowerCase();

      if (!sub || sub === 'status') {
        const models = status();
        if (!models.length) return { status: 'ok', result: 'No models registered.' };
        const lines = models.map(m =>
          `  [${m.state.padEnd(10)}] ${m.id.padEnd(16)} ${m.type.padEnd(7)}` +
          `  modes:${m.modes.join(',')}  queries:${m.queryCount}`
        );
        return { status: 'ok', result: 'Models:\n' + lines.join('\n') };
      }

      if (sub === 'modes') {
        const lines = Object.entries(MODE_ASSIGNMENTS).map(([mode, type]) =>
          `  ${mode.padEnd(10)} → ${type}`
        );
        return { status: 'ok', result: 'Mode assignments:\n' + lines.join('\n') };
      }

      if (sub === 'connect') {
        const id = args[1];
        if (!id) return { status: 'error', result: 'Usage: model connect <id>' };
        const r = await connect(id);
        return { status: r.ok ? 'ok' : 'error', result: r.ok ? `Model "${id}" connected.` : r.error };
      }

      if (sub === 'disconnect') {
        const id = args[1];
        if (!id) return { status: 'error', result: 'Usage: model disconnect <id>' };
        const r = disconnect(id);
        return { status: r.ok ? 'ok' : 'error', result: r.ok ? `Model "${id}" disconnected.` : r.error };
      }

      if (sub === 'query') {
        const id     = args[1];
        const prompt = args.slice(2).join(' ');
        if (!id || !prompt) return { status: 'error', result: 'Usage: model query <id> <prompt>' };
        const r = await query(id, prompt);
        return { status: r.ok ? 'ok' : 'error', result: r.ok ? r.response : r.error };
      }

      if (sub === 'ask') {
        const mode   = args[1];
        const prompt = args.slice(2).join(' ');
        if (!mode || !prompt) return { status: 'error', result: 'Usage: model ask <mode> <prompt>' };
        const r = await queryByMode(mode, prompt);
        return { status: r.ok ? 'ok' : 'error', result: r.ok ? r.response : r.error };
      }

      return { status: 'error', result: 'Usage: model <status|modes|connect|disconnect|query|ask>' };
    },
  };

  return {
    name:            'model-manager',
    version:         '4.0.0',
    AIOS_PORT,
    MODE_ASSIGNMENTS,
    MODEL_TYPES,
    MODEL_STATES,
    registerModel,
    connect,
    connectAll,
    disconnect,
    query,
    queryByMode,
    setModelBackend,
    readOutput,
    status,
    modeMap,
    commands,
  };
}

module.exports = { createModelManager, MODE_ASSIGNMENTS, MODEL_TYPES, MODEL_STATES };
