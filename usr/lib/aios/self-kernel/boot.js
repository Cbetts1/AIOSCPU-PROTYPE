'use strict';
/**
 * self-kernel/boot.js — AIOS Self Kernel Boot Wrapper v1.0.0
 *
 * Wraps the existing boot sequence (boot/boot.js) without rewriting it.
 * Provides three stable entry-points that the loop engine and shell can call:
 *
 *   bootSelfKernel()    — initialise identity + kernel (idempotent)
 *   startCoreServices() — hand off to the existing service manager
 *   attachLoopEngine()  — connect the loop engine to the running kernel
 *
 * The existing boot/boot.js `start()` function is the authoritative boot
 * sequence; this module only adds hooks AROUND it.
 */

const identity  = require('./identity.js');

// Reference to the live kernel/svcMgr/router injected after boot completes.
// Populated by attachLoopEngine() once the existing boot has run.
let _kernel   = null;
let _svcMgr   = null;
let _router   = null;
let _loopCtrl = null;
let _booted   = false;

// ---------------------------------------------------------------------------
// bootSelfKernel — lightweight identity init, safe to call before full boot
// ---------------------------------------------------------------------------
function bootSelfKernel() {
  if (_booted) return { ok: true, note: 'already booted' };
  const id = identity.getIdentity();
  _booted = true;
  return { ok: true, kernelId: id.kernel_id, version: id.os_version };
}

// ---------------------------------------------------------------------------
// startCoreServices — delegates to existing service manager
// ---------------------------------------------------------------------------
async function startCoreServices() {
  if (!_svcMgr) return { ok: false, error: 'Service manager not yet attached — call attachLoopEngine first.' };
  const list = _svcMgr.list();
  const results = [];
  for (const svc of list) {
    if (svc.state !== 'running') {
      const r = await _svcMgr.start(svc.name);
      results.push({ name: svc.name, ...r });
    }
  }
  return { ok: true, started: results };
}

// ---------------------------------------------------------------------------
// attachLoopEngine — inject live references after the existing boot has run
// ---------------------------------------------------------------------------
function attachLoopEngine(kernel, svcMgr, router, loopCtrl) {
  _kernel   = kernel;
  _svcMgr   = svcMgr;
  _router   = router;
  _loopCtrl = loopCtrl;

  if (!_booted) bootSelfKernel();

  if (kernel) {
    kernel.bus.emit('self-kernel:attached', {
      kernelId: identity.getKernelId(),
      version:  identity.getVersion(),
    });
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------
function getKernel()   { return _kernel; }
function getSvcMgr()   { return _svcMgr; }
function getRouter()   { return _router; }
function getLoopCtrl() { return _loopCtrl; }
function isBooted()    { return _booted; }

module.exports = {
  bootSelfKernel,
  startCoreServices,
  attachLoopEngine,
  getKernel,
  getSvcMgr,
  getRouter,
  getLoopCtrl,
  isBooted,
};
