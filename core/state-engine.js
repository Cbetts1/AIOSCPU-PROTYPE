'use strict';
/**
 * state-engine.js — AIOS State Engine v1.0.0
 *
 * Manages OS runtime states and enforces valid transitions.
 * States mirror Linux kernel run states at the conceptual level:
 *
 *   INITIALIZING → BOOTING → RUNNING ⇄ IDLE
 *                                 ↓
 *                            DEGRADED ↗↘
 *                            SHUTDOWN → HALTED
 *                            (or RESTART → INITIALIZING)
 *
 * State is persisted in /var/run/state in the VFS.
 * Events are emitted on the kernel bus for every transition.
 *
 * Zero external npm dependencies.
 */

// ---------------------------------------------------------------------------
// State constants
// ---------------------------------------------------------------------------
const STATES = Object.freeze({
  INITIALIZING: 'INITIALIZING',   // Kernel modules loading
  BOOTING:      'BOOTING',        // Init system running
  RUNNING:      'RUNNING',        // Fully operational
  IDLE:         'IDLE',           // Low activity
  DEGRADED:     'DEGRADED',       // Running with one or more failures
  SHUTDOWN:     'SHUTDOWN',       // Orderly shutdown in progress
  HALTED:       'HALTED',         // Fully stopped
  RESTARTING:   'RESTARTING',     // Restart requested
});

// Valid transitions map
const TRANSITIONS = {
  [STATES.INITIALIZING]: [STATES.BOOTING,   STATES.HALTED],
  [STATES.BOOTING]:      [STATES.RUNNING,   STATES.DEGRADED, STATES.HALTED],
  [STATES.RUNNING]:      [STATES.IDLE,      STATES.DEGRADED, STATES.SHUTDOWN, STATES.RESTARTING],
  [STATES.IDLE]:         [STATES.RUNNING,   STATES.DEGRADED, STATES.SHUTDOWN],
  [STATES.DEGRADED]:     [STATES.RUNNING,   STATES.SHUTDOWN, STATES.RESTARTING],
  [STATES.SHUTDOWN]:     [STATES.HALTED,    STATES.RESTARTING],
  [STATES.RESTARTING]:   [STATES.INITIALIZING],
  [STATES.HALTED]:       [STATES.INITIALIZING],
};

// ---------------------------------------------------------------------------
// State engine factory
// ---------------------------------------------------------------------------
function createStateEngine(kernel, fs) {
  let _state   = STATES.INITIALIZING;
  let _history = [];

  function _persist(state) {
    if (!fs) return;
    try {
      fs.write('/var/run/state', JSON.stringify({
        state,
        since:  new Date().toISOString(),
        uptime: kernel ? kernel.uptime() : 0,
      }) + '\n');
    } catch (_) {}
  }

  function _record(from, to) {
    const entry = { from, to, at: new Date().toISOString() };
    _history.push(entry);
    if (_history.length > 100) _history.shift();
    _persist(to);
    if (kernel) kernel.bus.emit('state:changed', { from, to, at: Date.now() });
  }

  // ---------------------------------------------------------------------------
  // transition — move to a new state (validates the transition)
  // ---------------------------------------------------------------------------
  function transition(newState) {
    if (!STATES[newState]) {
      return { ok: false, error: `Unknown state: ${newState}` };
    }
    const allowed = TRANSITIONS[_state];
    if (!allowed || !allowed.includes(newState)) {
      return { ok: false, error: `Invalid transition: ${_state} → ${newState}` };
    }
    const prev = _state;
    _state = newState;
    _record(prev, _state);
    return { ok: true, from: prev, to: _state };
  }

  function get()       { return _state; }
  function history()   { return _history.slice(); }
  function isRunning() { return _state === STATES.RUNNING || _state === STATES.IDLE; }
  function isBooted()  { return _state !== STATES.INITIALIZING && _state !== STATES.BOOTING && _state !== STATES.HALTED; }

  // ---------------------------------------------------------------------------
  // Router command module
  // ---------------------------------------------------------------------------
  const commands = {
    state: (args) => {
      const sub = (args[0] || '').toLowerCase();

      if (sub === 'history') {
        const lines = _history.slice(-20).map(h =>
          `  ${h.from.padEnd(14)} → ${h.to.padEnd(14)} at ${h.at.slice(11, 19)}`
        );
        return { status: 'ok', result: lines.join('\n') || '  (no transitions yet)' };
      }

      return {
        status: 'ok',
        result: [
          `Current State : ${_state}`,
          `Uptime        : ${kernel ? kernel.uptime() : 0}s`,
          `Transitions   : ${_history.length}`,
          '',
          'Usage: state | state history',
        ].join('\n'),
      };
    },
  };

  return {
    name:      'state-engine',
    STATES,
    transition,
    get,
    history,
    isRunning,
    isBooted,
    commands,
  };
}

module.exports = { createStateEngine, STATES };
