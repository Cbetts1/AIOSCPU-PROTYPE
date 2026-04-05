'use strict';
/**
 * self-kernel/process-model.js — AIOS Self Kernel Process Model Wrapper v1.0.0
 *
 * Wraps usr/lib/aios/process-model.js (the existing virtual process model).
 * Exposes a stable API that the self kernel can rely on.
 *
 * Exposed API:
 *   init(kernel, vfs)  — initialise (called once after boot)
 *   spawn(name, opts)  — create a new virtual process
 *   kill(vPid, sig)    — terminate a virtual process
 *   list()             — list all virtual processes
 *   get(vPid)          — get a single process entry
 *   getByName(name)    — find a process by name
 */

// Lazy reference — populated after the existing boot has initialised the VPS.
let _model = null;

function init(model) {
  _model = model;
}

function _assertReady() {
  if (!_model) throw new Error('process-model not initialised — call init(model) first');
}

function spawn(name, opts) {
  _assertReady();
  return _model.spawn(name, opts);
}

function kill(vPid, sig) {
  _assertReady();
  return _model.kill(vPid, sig);
}

function list() {
  if (!_model) return [];
  return _model.list();
}

function get(vPid) {
  _assertReady();
  return _model.get(vPid);
}

function getByName(name) {
  _assertReady();
  return _model.getByName(name);
}

module.exports = { init, spawn, kill, list, get, getByName };
