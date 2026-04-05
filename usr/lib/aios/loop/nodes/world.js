'use strict';
/**
 * loop/nodes/world.js — Loop Node: World
 *
 * Attaches safe world diagnostics to the loop context.
 * MUST NOT perform any destructive actions.
 * Collects environment snapshot (uptime, memory, load).
 */

const nodeos = require('os');

function process(context) {
  return Object.assign({}, context, {
    last_node: 'world',
    world: {
      uptime_s:    Math.floor(nodeos.uptime()),
      free_mem_mb: Math.floor(nodeos.freemem() / 1024 / 1024),
      load_avg:    nodeos.loadavg(),
      timestamp:   Date.now(),
    },
  });
}

module.exports = { name: 'world', process };
