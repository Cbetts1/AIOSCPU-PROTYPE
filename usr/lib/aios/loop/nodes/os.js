'use strict';
/**
 * loop/nodes/os.js — Loop Node: OS
 *
 * Attaches the world interface state (VFS summary) to the loop context.
 * The live VFS is injected via setFS(); falls back to a stub when not available.
 */

let _fs = null;

function setFS(fs) {
  _fs = fs;
}

function process(context) {
  let vfs_info = { available: false };

  if (_fs) {
    try {
      const pwd = typeof _fs.pwd === 'function' ? _fs.pwd() : '/';
      vfs_info = { available: true, cwd: pwd };
    } catch (_) {
      vfs_info = { available: true, cwd: '/' };
    }
  }

  return Object.assign({}, context, {
    last_node: 'os',
    os: {
      vfs: vfs_info,
      node_platform: process.platform,
      timestamp:     Date.now(),
    },
  });
}

module.exports = { name: 'os', process, setFS };
