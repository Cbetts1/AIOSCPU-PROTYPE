'use strict';
/**
 * self-kernel/services.js — AIOS Self Kernel Services Wrapper v1.0.0
 *
 * Wraps the existing core/service-manager.js without changing its behaviour.
 * Provides a stable, documented API for use by the self kernel and loop engine.
 *
 * Exposed API:
 *   init(svcMgr)                     — bind to the live service manager
 *   registerService(name, descriptor) — define a service
 *   startService(name)                — bring a service up
 *   stopService(name)                 — shut a service down
 *   restartService(name)              — stop then start
 *   getServiceStatus(name)            — get current state
 *   listServices()                    — list all registered services
 */

let _svcMgr = null;

function init(svcMgr) {
  _svcMgr = svcMgr;
}

function _assert() {
  if (!_svcMgr) throw new Error('services not initialised — call init(svcMgr) first');
}

function registerService(name, descriptor) {
  _assert();
  return _svcMgr.register(name, descriptor);
}

async function startService(name) {
  _assert();
  return _svcMgr.start(name);
}

async function stopService(name) {
  _assert();
  return _svcMgr.stop(name);
}

async function restartService(name) {
  _assert();
  return _svcMgr.restart(name);
}

function getServiceStatus(name) {
  if (!_svcMgr) return { ok: false, error: 'not initialised' };
  return _svcMgr.status(name);
}

function listServices() {
  if (!_svcMgr) return [];
  return _svcMgr.list();
}

module.exports = {
  init,
  registerService,
  startService,
  stopService,
  restartService,
  getServiceStatus,
  listServices,
};
