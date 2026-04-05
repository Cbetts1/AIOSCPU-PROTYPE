'use strict';
/**
 * loop/nodes/me.js — Loop Node: Me (operator)
 *
 * Attaches operator identity information to the loop context.
 * Does NOT modify any existing system state.
 */

function process(context) {
  return Object.assign({}, context, {
    last_node:   'me',
    me: {
      operator_id: context.operator_id || 'aios',
      node_pid:    global.process ? global.process.pid : null,
      timestamp:   Date.now(),
    },
  });
}

module.exports = { name: 'me', process };
