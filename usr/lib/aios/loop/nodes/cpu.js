'use strict';
/**
 * loop/nodes/cpu.js — Loop Node: CPU
 *
 * Attaches execution state (virtual process list) to the loop context.
 * Reads from self-kernel/process-model.js (read-only).
 */

const procModel = require('../../self-kernel/process-model.js');

function process(context) {
  const procs = procModel.list();
  return Object.assign({}, context, {
    last_node: 'cpu',
    cpu: {
      process_count: procs.length,
      processes:     procs.slice(0, 16),  // cap at 16 for context size
      timestamp:     Date.now(),
    },
  });
}

module.exports = { name: 'cpu', process };
