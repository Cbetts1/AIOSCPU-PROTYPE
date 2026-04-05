'use strict';
/**
 * loop/logger.js — AIOS Loop Logger v1.0.0
 *
 * Logs each node hop in the loop engine.
 * Supports log levels: silent (0), normal (1), verbose (2).
 *
 * Exposed API:
 *   setLevel(level)                        — "silent" | "normal" | "verbose"
 *   logHop(from_node, to_node, context)    — log a single node transition
 *   getLog()                               — return copy of in-memory log
 *   clearLog()                             — clear in-memory log
 */

const LEVELS = Object.freeze({ silent: 0, normal: 1, verbose: 2 });

let _level   = LEVELS.normal;
let _log     = [];
const MAX_LOG = 500;

// ---------------------------------------------------------------------------
// setLevel
// ---------------------------------------------------------------------------
function setLevel(level) {
  const l = String(level || '').toLowerCase();
  if (l in LEVELS) {
    _level = LEVELS[l];
  }
}

// ---------------------------------------------------------------------------
// logHop
// ---------------------------------------------------------------------------
function logHop(from_node, to_node, context) {
  if (_level === LEVELS.silent) return;

  const entry = {
    from_node:  from_node  || '(start)',
    to_node:    to_node    || '(end)',
    timestamp:  Date.now(),
    cycle_id:   context ? context.cycle_id   : null,
    host_mode:  context ? context.host_mode  : null,
    kernel_id:  context ? context.kernel_id  : null,
    last_node:  context ? context.last_node  : null,
  };

  _log.push(entry);
  if (_log.length > MAX_LOG) _log.shift();

  if (_level === LEVELS.verbose) {
    const ts = new Date(entry.timestamp).toISOString().slice(11, 23);
    process.stdout.write(
      `[Loop] ${ts}  ${String(entry.from_node).padEnd(8)} → ${String(entry.to_node).padEnd(8)}` +
      `  cycle=${entry.cycle_id}  mode=${entry.host_mode}\n`
    );
  } else {
    // normal: one line per cycle start only (when from_node is null/'(start)')
    if (!from_node) {
      const ts = new Date(entry.timestamp).toISOString().slice(11, 23);
      process.stdout.write(`[Loop] ${ts}  cycle=${entry.cycle_id}  mode=${entry.host_mode}\n`);
    }
  }
}

function getLog()   { return _log.slice(); }
function clearLog() { _log = []; }

module.exports = { setLevel, logHop, getLog, clearLog, LEVELS };
