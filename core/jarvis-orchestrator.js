'use strict';
/**
 * core/jarvis-orchestrator.js
 *
 * This file forwards to core/aios-aura.js.
 * The AI system is officially AIOS (personality) and AURA (hardware intelligence).
 * This shim keeps any legacy require() paths from breaking.
 */
const { createAIOSAURA } = require('./aios-aura.js');

function createJarvisOrchestrator(kernel, svcMgr, hostBridge, memoryCore, consciousness, modeManager) {
  return createAIOSAURA(kernel, svcMgr, hostBridge, memoryCore, consciousness, modeManager);
}

module.exports = { createJarvisOrchestrator, createAIOSAURA };
