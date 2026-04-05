'use strict';
/**
 * loop/nodes/host.js — Loop Node: Host
 *
 * Attaches host_mode and host platform information to the loop context.
 * Calls env-kernel/mode.js and env-kernel/host-info.js (read-only).
 */

const mode     = require('../../env-kernel/mode.js');
const hostInfo = require('../../env-kernel/host-info.js');

function process(context) {
  return Object.assign({}, context, {
    last_node: 'host',
    host_mode: mode.getMode(),
    host: {
      mode:     mode.getMode(),
      platform: hostInfo.getPlatform(),
      summary:  hostInfo.getHostSummary(),
    },
  });
}

module.exports = { name: 'host', process };
