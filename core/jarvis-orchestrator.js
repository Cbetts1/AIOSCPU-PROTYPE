'use strict';
/**
 * core/jarvis-orchestrator.js — AIOSCPU v2.0.0
 *
 * Copyright (c) 2026 Cbetts1. All rights reserved.
 * SPDX-License-Identifier: MIT
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
