'use strict';
/**
 * self-kernel/loop-core.js — AIOS Self Kernel Loop Core Contract v1.0.0
 *
 * Defines the core loop contract used by the loop engine (loop/engine.js).
 * This module contains NO environment-specific logic; it is the inner, fixed
 * definition of what a "loop step" and "loop lifecycle" mean.
 *
 * Exposed API:
 *   initLoop(context)       — prepare internal state; returns updated context
 *   runLoopStep(context)    — execute one unit of work; returns updated context
 *   shutdownLoop()          — clean up internal loop state
 *   getLoopState()          — return current loop state descriptor
 */

const LOOP_STATES = Object.freeze({
  IDLE:     'idle',
  RUNNING:  'running',
  STEPPING: 'stepping',
  STOPPED:  'stopped',
});

let _state       = LOOP_STATES.STOPPED;
let _cycleCount  = 0;
let _lastStepAt  = null;
let _initContext = null;

// ---------------------------------------------------------------------------
// initLoop — called once before the loop starts running
// ---------------------------------------------------------------------------
function initLoop(context) {
  _state       = LOOP_STATES.IDLE;
  _cycleCount  = 0;
  _lastStepAt  = null;
  _initContext = context || {};
  return Object.assign({}, _initContext, { _loop_state: _state });
}

// ---------------------------------------------------------------------------
// runLoopStep — execute one atomic step; context flows in and out
// ---------------------------------------------------------------------------
function runLoopStep(context) {
  if (_state === LOOP_STATES.STOPPED) {
    return Object.assign({}, context, { _loop_error: 'loop is stopped' });
  }

  const prev = _state;
  _state = LOOP_STATES.STEPPING;
  _cycleCount++;
  _lastStepAt = Date.now();

  // The actual node-walking is performed by loop/engine.js.
  // loop-core only manages the lifecycle state machine here.

  _state = prev === LOOP_STATES.IDLE ? LOOP_STATES.RUNNING : prev;

  return Object.assign({}, context, {
    _loop_state:       _state,
    _loop_cycle_count: _cycleCount,
    _loop_last_step:   _lastStepAt,
  });
}

// ---------------------------------------------------------------------------
// shutdownLoop — transition to STOPPED state
// ---------------------------------------------------------------------------
function shutdownLoop() {
  _state = LOOP_STATES.STOPPED;
  _initContext = null;
}

// ---------------------------------------------------------------------------
// getLoopState — read-only snapshot
// ---------------------------------------------------------------------------
function getLoopState() {
  return {
    state:      _state,
    cycleCount: _cycleCount,
    lastStepAt: _lastStepAt,
    LOOP_STATES,
  };
}

module.exports = { initLoop, runLoopStep, shutdownLoop, getLoopState, LOOP_STATES };
