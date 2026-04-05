'use strict';
/**
 * loop/context.js — AIOS Loop Context v1.0.0
 *
 * Defines the context object that flows through every cycle of the loop engine.
 * Context is immutable per-step — each node receives a context and returns
 * a new one via cloneWithUpdate().
 *
 * Context fields:
 *   operator_id    — string, who initiated this cycle
 *   host_mode      — "self" | "mirror"
 *   kernel_id      — AIOS kernel UUID
 *   env_signature  — platform + mode fingerprint
 *   last_node      — name of the last node that processed this context
 *   cycle_id       — incrementing cycle number
 *   timestamp      — epoch ms when the context was created/last updated
 *   payload        — generic free-form data object
 *
 * Exposed API:
 *   createInitialContext()              — build a fresh context
 *   cloneWithUpdate(context, updates)   — return a new context with merged updates
 */

const crypto   = require('crypto');
const identity = require('../self-kernel/identity.js');
const mode     = require('../env-kernel/mode.js');
const hostInfo = require('../env-kernel/host-info.js');

let _cycleCounter = 0;

function _envSig() {
  const m = mode.getMode();
  const p = hostInfo.getPlatform();
  return `${p}:${m}`;
}

// ---------------------------------------------------------------------------
// createInitialContext
// ---------------------------------------------------------------------------
function createInitialContext(overrides) {
  _cycleCounter++;
  return Object.freeze(Object.assign({
    operator_id:   'aios',
    host_mode:     mode.getMode(),
    kernel_id:     identity.getKernelId(),
    env_signature: _envSig(),
    last_node:     null,
    cycle_id:      _cycleCounter,
    timestamp:     Date.now(),
    payload:       {},
  }, overrides || {}));
}

// ---------------------------------------------------------------------------
// cloneWithUpdate — return new frozen context with applied updates
// ---------------------------------------------------------------------------
function cloneWithUpdate(context, updates) {
  return Object.freeze(Object.assign({}, context, updates || {}, {
    timestamp: Date.now(),
  }));
}

module.exports = { createInitialContext, cloneWithUpdate };
