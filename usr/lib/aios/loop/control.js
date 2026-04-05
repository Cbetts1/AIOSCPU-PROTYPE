'use strict';
/**
 * loop/control.js — AIOS Loop Control Interface v1.0.0
 *
 * Provides the shell-facing control surface for the loop engine.
 * These functions are wired to shell commands:
 *   loop start  → start()
 *   loop stop   → stop()
 *   loop status → status()
 *   loop step   → step()
 *
 * Exposed API:
 *   start()   — start the loop
 *   stop()    — stop the loop
 *   step()    — run exactly one cycle and return the context summary
 *   status()  — return current loop status as a formatted string
 */

const engine  = require('./engine.js');
const context = require('./context.js');

// ---------------------------------------------------------------------------
// start
// ---------------------------------------------------------------------------
function start() {
  const r = engine.startLoop();
  if (r.ok) {
    return { status: 'ok', result: r.note ? `Loop already running.` : 'Loop started.' };
  }
  return { status: 'error', result: r.error || 'Failed to start loop.' };
}

// ---------------------------------------------------------------------------
// stop
// ---------------------------------------------------------------------------
function stop() {
  const r = engine.stopLoop();
  if (r.ok) {
    return { status: 'ok', result: r.note ? 'Loop was not running.' : 'Loop stopped.' };
  }
  return { status: 'error', result: r.error || 'Failed to stop loop.' };
}

// ---------------------------------------------------------------------------
// step — run one cycle synchronously and return summary
// ---------------------------------------------------------------------------
async function step() {
  const ctx    = context.createInitialContext();
  const result = await engine.runOneCycle(ctx);

  const summary = [
    `Cycle     : ${result.cycle_id}`,
    `Host mode : ${result.host_mode}`,
    `Kernel ID : ${result.kernel_id}`,
    `Last node : ${result.last_node}`,
    `Timestamp : ${new Date(result.timestamp).toISOString()}`,
  ];

  if (result.world) {
    summary.push(`Uptime    : ${result.world.uptime_s}s`);
    summary.push(`Free mem  : ${result.world.free_mem_mb} MB`);
  }

  return { status: 'ok', result: summary.join('\n') };
}

// ---------------------------------------------------------------------------
// status — formatted status string
// ---------------------------------------------------------------------------
function status() {
  const s = engine.getStatus();

  const lastAt = s.lastCycleAt
    ? new Date(s.lastCycleAt).toISOString()
    : 'never';

  const lines = [
    'Loop Engine Status',
    '──────────────────────────────────────',
    `Running         : ${s.running ? 'YES ●' : 'NO  ○'}`,
    `Loop state      : ${s.loopState}`,
    `Cycle count     : ${s.cycleCount}`,
    `Last cycle at   : ${lastAt}`,
    `Last node       : ${s.lastNode || '—'}`,
    `Tick interval   : ${s.tickIntervalMs}ms`,
    `Node order      : ${s.nodeOrder.join(' → ')}`,
    `Nodes loaded    : ${s.nodesLoaded.join(', ') || '(none)'}`,
  ];

  return { status: 'ok', result: lines.join('\n') };
}

module.exports = { start, stop, step, status };
