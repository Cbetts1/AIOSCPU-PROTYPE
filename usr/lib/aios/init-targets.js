'use strict';
/**
 * init-targets.js — AIOS Init Target Definitions v1.0.0
 *
 * Defines the service dependency graph and boot targets for the
 * AIOS OS Integration Layer init system.
 *
 * Targets (activated in order):
 *   sysinit    — Kernel, VFS, identity, process model, procfs
 *   basic      — Environment, permissions, scheduler, AI core
 *   multi-user — Router, services from /etc/aios/services/, terminal
 *   shutdown   — Graceful shutdown sequence
 *   reboot     — Reboot sequence (shutdown + restart init)
 *   rescue     — Single-user mode (minimal services only)
 *
 * Each unit declaration:
 *   name:          string — unit identifier
 *   target:        string — which target this unit belongs to
 *   description:   string — human-readable description
 *   requires:      string[] — other units that must be active first
 *   after:         string[] — ordering hint (start after, but not required)
 *   restartPolicy: 'no' | 'on-failure' | 'always'
 *   crashRecovery: boolean — attempt restart on crash
 *   maxRestarts:   number  — max restart attempts (0 = unlimited)
 *   restartDelay:  number  — ms to wait before restart
 *
 * Zero external npm dependencies.
 */

const TARGETS = Object.freeze({
  SYSINIT:    'sysinit',
  BASIC:      'basic',
  MULTI_USER: 'multi-user',
  SHUTDOWN:   'shutdown',
  REBOOT:     'reboot',
  RESCUE:     'rescue',
});

// Boot activation order
const TARGET_ORDER = [TARGETS.SYSINIT, TARGETS.BASIC, TARGETS.MULTI_USER];

// ---------------------------------------------------------------------------
// Built-in unit definitions
// These are the units managed by the new init system.
// Service units loaded from /etc/aios/services/*.json are added at runtime.
// ---------------------------------------------------------------------------
const BUILTIN_UNITS = [
  // ── sysinit ─────────────────────────────────────────────────────────────
  {
    name:          'kernel.init',
    target:        TARGETS.SYSINIT,
    description:   'AIOS Software Kernel',
    requires:      [],
    after:         [],
    restartPolicy: 'no',
    crashRecovery: false,
    maxRestarts:   0,
    restartDelay:  0,
  },
  {
    name:          'filesystem.mount',
    target:        TARGETS.SYSINIT,
    description:   'AIOS Virtual Filesystem',
    requires:      ['kernel.init'],
    after:         ['kernel.init'],
    restartPolicy: 'no',
    crashRecovery: false,
    maxRestarts:   0,
    restartDelay:  0,
  },
  {
    name:          'rootfs.build',
    target:        TARGETS.SYSINIT,
    description:   'AIOS RootFS Builder',
    requires:      ['filesystem.mount'],
    after:         ['filesystem.mount'],
    restartPolicy: 'no',
    crashRecovery: false,
    maxRestarts:   0,
    restartDelay:  0,
  },
  {
    name:          'identity.init',
    target:        TARGETS.SYSINIT,
    description:   'AIOS OS Identity Engine',
    requires:      ['rootfs.build'],
    after:         ['rootfs.build'],
    restartPolicy: 'no',
    crashRecovery: false,
    maxRestarts:   0,
    restartDelay:  0,
  },
  {
    name:          'process-model.init',
    target:        TARGETS.SYSINIT,
    description:   'AIOS Virtual Process Model',
    requires:      ['kernel.init'],
    after:         ['kernel.init'],
    restartPolicy: 'no',
    crashRecovery: false,
    maxRestarts:   0,
    restartDelay:  0,
  },
  {
    name:          'procfs.init',
    target:        TARGETS.SYSINIT,
    description:   'AIOS /proc Filesystem',
    requires:      ['filesystem.mount', 'process-model.init'],
    after:         ['filesystem.mount', 'process-model.init'],
    restartPolicy: 'on-failure',
    crashRecovery: true,
    maxRestarts:   3,
    restartDelay:  1000,
  },

  // ── basic ────────────────────────────────────────────────────────────────
  {
    name:          'env.load',
    target:        TARGETS.BASIC,
    description:   'AIOS Environment Loader',
    requires:      ['rootfs.build'],
    after:         ['rootfs.build', 'identity.init'],
    restartPolicy: 'no',
    crashRecovery: false,
    maxRestarts:   0,
    restartDelay:  0,
  },
  {
    name:          'cpu.init',
    target:        TARGETS.BASIC,
    description:   'AIOSCPU Virtual CPU',
    requires:      ['kernel.init'],
    after:         ['kernel.init'],
    restartPolicy: 'no',
    crashRecovery: false,
    maxRestarts:   0,
    restartDelay:  0,
  },
  {
    name:          'host-bridge.init',
    target:        TARGETS.BASIC,
    description:   'Host OS Bridge',
    requires:      ['kernel.init'],
    after:         ['kernel.init'],
    restartPolicy: 'on-failure',
    crashRecovery: true,
    maxRestarts:   2,
    restartDelay:  2000,
  },
  {
    name:          'permissions.init',
    target:        TARGETS.BASIC,
    description:   'AIOS Permission / Capability System',
    requires:      ['host-bridge.init'],
    after:         ['host-bridge.init'],
    restartPolicy: 'no',
    crashRecovery: false,
    maxRestarts:   0,
    restartDelay:  0,
  },
  {
    name:          'scheduler.init',
    target:        TARGETS.BASIC,
    description:   'AIOS Virtual Process Scheduler',
    requires:      ['process-model.init'],
    after:         ['process-model.init'],
    restartPolicy: 'on-failure',
    crashRecovery: true,
    maxRestarts:   3,
    restartDelay:  500,
  },
  {
    name:          'ai-core.init',
    target:        TARGETS.BASIC,
    description:   'AIOS AI Personality Core',
    requires:      ['kernel.init', 'permissions.init'],
    after:         ['env.load', 'host-bridge.init'],
    restartPolicy: 'on-failure',
    crashRecovery: true,
    maxRestarts:   5,
    restartDelay:  3000,
  },

  // ── multi-user ───────────────────────────────────────────────────────────
  {
    name:          'router.init',
    target:        TARGETS.MULTI_USER,
    description:   'AIOS Command Router',
    requires:      ['kernel.init', 'ai-core.init'],
    after:         ['ai-core.init'],
    restartPolicy: 'on-failure',
    crashRecovery: true,
    maxRestarts:   3,
    restartDelay:  1000,
  },
  {
    name:          'service-manager.init',
    target:        TARGETS.MULTI_USER,
    description:   'AIOS Service Manager',
    requires:      ['kernel.init', 'router.init'],
    after:         ['router.init'],
    restartPolicy: 'no',
    crashRecovery: false,
    maxRestarts:   0,
    restartDelay:  0,
  },
  {
    name:          'services.start',
    target:        TARGETS.MULTI_USER,
    description:   'AIOS Built-in Services',
    requires:      ['service-manager.init'],
    after:         ['service-manager.init'],
    restartPolicy: 'on-failure',
    crashRecovery: true,
    maxRestarts:   2,
    restartDelay:  5000,
  },
  {
    name:          'mirror.init',
    target:        TARGETS.MULTI_USER,
    description:   'AIOS Mirror Session Manager',
    requires:      ['filesystem.mount', 'host-bridge.init'],
    after:         ['services.start'],
    restartPolicy: 'on-failure',
    crashRecovery: true,
    maxRestarts:   2,
    restartDelay:  2000,
  },
  {
    name:          'terminal.start',
    target:        TARGETS.MULTI_USER,
    description:   'AIOS Terminal / Shell',
    requires:      ['router.init', 'env.load'],
    after:         ['services.start', 'mirror.init'],
    restartPolicy: 'on-failure',
    crashRecovery: true,
    maxRestarts:   0,
    restartDelay:  1000,
  },
];

// ---------------------------------------------------------------------------
// getTargetUnits — return all units for a given target
// ---------------------------------------------------------------------------
function getTargetUnits(target) {
  return BUILTIN_UNITS.filter(u => u.target === target);
}

// ---------------------------------------------------------------------------
// getDependencyOrder — topological sort of units within a target
// ---------------------------------------------------------------------------
function getDependencyOrder(units) {
  const nameSet = new Set(units.map(u => u.name));
  const visited = new Set();
  const result  = [];

  function visit(unit) {
    if (visited.has(unit.name)) return;
    visited.add(unit.name);
    for (const dep of [...unit.requires, ...unit.after]) {
      const depUnit = units.find(u => u.name === dep);
      if (depUnit && nameSet.has(dep)) visit(depUnit);
    }
    result.push(unit);
  }

  for (const unit of units) visit(unit);
  return result;
}

// ---------------------------------------------------------------------------
// buildDependencyGraph — return a plain adjacency map for inspection
// ---------------------------------------------------------------------------
function buildDependencyGraph() {
  const graph = {};
  for (const unit of BUILTIN_UNITS) {
    graph[unit.name] = {
      target:        unit.target,
      description:   unit.description,
      requires:      unit.requires,
      after:         unit.after,
      restartPolicy: unit.restartPolicy,
    };
  }
  return graph;
}

module.exports = {
  TARGETS,
  TARGET_ORDER,
  BUILTIN_UNITS,
  getTargetUnits,
  getDependencyOrder,
  buildDependencyGraph,
};
