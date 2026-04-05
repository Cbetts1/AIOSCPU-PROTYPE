'use strict';
/**
 * loop/engine.js — AIOS Loop Engine v1.0.0
 *
 * Drives the ordered node pipeline:
 *   ["me", "host", "aios", "cpu", "ai", "os", "world"]
 *
 * Each node receives the current context and returns a new context.
 * Nodes are loaded dynamically so they can be reloaded at runtime.
 *
 * Uses self-kernel/loop-core.js for lifecycle state management.
 *
 * Exposed API:
 *   runOneCycle(context)      — pass context through all nodes; returns final context
 *   startLoop()               — begin ticking (calls runOneCycle repeatedly)
 *   stopLoop()                — stop ticking
 *   getStatus()               — returns loop status object
 *   reloadNode(name)          — reload a single node module
 *   reloadAllNodes()          — reload all node modules
 *   setTickInterval(ms)       — configure tick interval (default 30 000 ms)
 */

const nodepath  = require('path');
const loopCore  = require('../self-kernel/loop-core.js');
const { createInitialContext, cloneWithUpdate } = require('./context.js');
const logger    = require('./logger.js');

const NODE_ORDER = ['me', 'host', 'aios', 'cpu', 'ai', 'os', 'world'];
const NODES_DIR  = nodepath.join(__dirname, 'nodes');

// Node registry — name → loaded module
const _nodeRegistry = {};

// ---------------------------------------------------------------------------
// Node loading
// ---------------------------------------------------------------------------
function _loadNode(name) {
  try {
    const modPath = nodepath.join(NODES_DIR, `${name}.js`);
    // Clear require cache to allow hot-reload
    delete require.cache[require.resolve(modPath)];
    const mod = require(modPath);
    _nodeRegistry[name] = mod;
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function _ensureNodes() {
  for (const name of NODE_ORDER) {
    if (!_nodeRegistry[name]) _loadNode(name);
  }
}

function reloadNode(name) {
  return _loadNode(name);
}

function reloadAllNodes() {
  const results = {};
  for (const name of NODE_ORDER) {
    results[name] = _loadNode(name);
  }
  return results;
}

// ---------------------------------------------------------------------------
// runOneCycle — pass context through the ordered node pipeline
// ---------------------------------------------------------------------------
async function runOneCycle(context) {
  _ensureNodes();
  let ctx = context || createInitialContext();

  // Notify loop-core that a step is starting
  ctx = loopCore.runLoopStep(ctx);

  logger.logHop(null, NODE_ORDER[0], ctx);

  for (let i = 0; i < NODE_ORDER.length; i++) {
    const name = NODE_ORDER[i];
    const mod  = _nodeRegistry[name];
    const next = NODE_ORDER[i + 1] || '(done)';

    if (!mod || typeof mod.process !== 'function') {
      ctx = cloneWithUpdate(ctx, { last_node: name, [`${name}_error`]: 'node not loaded' });
      logger.logHop(name, next, ctx);
      continue;
    }

    try {
      const result = await Promise.resolve(mod.process(ctx));
      ctx = result || ctx;
    } catch (e) {
      ctx = cloneWithUpdate(ctx, { last_node: name, [`${name}_error`]: e.message });
    }

    logger.logHop(name, next, ctx);
  }

  _lastCycleContext = ctx;
  _lastCycleAt      = Date.now();
  return ctx;
}

// ---------------------------------------------------------------------------
// Loop tick management
// ---------------------------------------------------------------------------
let _running        = false;
let _tickInterval   = 30000;
let _tickTimer      = null;
let _lastCycleContext = null;
let _lastCycleAt    = null;

function startLoop() {
  if (_running) return { ok: true, note: 'already running' };
  _running = true;

  const initCtx = createInitialContext();
  loopCore.initLoop(initCtx);

  function _tick() {
    runOneCycle(createInitialContext()).catch(() => {});
    if (_running) {
      _tickTimer = setTimeout(_tick, _tickInterval);
    }
  }

  _tickTimer = setTimeout(_tick, 0);
  return { ok: true };
}

function stopLoop() {
  if (!_running) return { ok: true, note: 'not running' };
  _running = false;
  if (_tickTimer) { clearTimeout(_tickTimer); _tickTimer = null; }
  loopCore.shutdownLoop();
  return { ok: true };
}

function setTickInterval(ms) {
  _tickInterval = Math.max(100, Number(ms) || 30000);
}

function getStatus() {
  const core = loopCore.getLoopState();
  return {
    running:         _running,
    tickIntervalMs:  _tickInterval,
    lastCycleAt:     _lastCycleAt,
    lastNode:        _lastCycleContext ? _lastCycleContext.last_node : null,
    cycleCount:      core.cycleCount,
    loopState:       core.state,
    nodeOrder:       NODE_ORDER.slice(),
    nodesLoaded:     Object.keys(_nodeRegistry),
  };
}

module.exports = {
  runOneCycle,
  startLoop,
  stopLoop,
  getStatus,
  reloadNode,
  reloadAllNodes,
  setTickInterval,
  NODE_ORDER,
};
