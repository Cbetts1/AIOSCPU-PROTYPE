'use strict';
/**
 * loop/nodes/aios.js — Loop Node: AIOS
 *
 * Attaches kernel_id and services status snapshot to the loop context.
 * Reads from self-kernel/identity.js and self-kernel/services.js (read-only).
 */

const identity = require('../../self-kernel/identity.js');
const services = require('../../self-kernel/services.js');

function process(context) {
  return Object.assign({}, context, {
    last_node: 'aios',
    kernel_id: identity.getKernelId(),
    aios: {
      kernel_id: identity.getKernelId(),
      version:   identity.getVersion(),
      build_id:  identity.getBuildId(),
      services:  services.listServices(),
    },
  });
}

module.exports = { name: 'aios', process };
