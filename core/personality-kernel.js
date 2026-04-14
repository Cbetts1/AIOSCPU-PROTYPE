'use strict';
/**
 * personality-kernel.js — AIOS AI Personality Kernel v1.0.0
 *
 * @deprecated  NOT WIRED INTO BOOT — reserved for future use.
 *   This module is not imported or instantiated by boot/bootstrap.js.
 *   It is preserved as the planned top-layer of the UniKernel stack:
 *     Personality Kernel → Hardware Kernel → Software Kernel (kernel.js)
 *   To activate, instantiate via createPersonalityKernel(kernel, aiCore,
 *   router, svcMgr, hwKernel, stateEngine, memoryCore).
 *
 * The AI "brain" layer of the AIOS UniKernel stack.
 * Sits above the Hardware Kernel and provides autonomous intelligence,
 * natural language understanding, and self-healing service management.
 *
 * Architecture:
 *   ┌───────────────────────────────────────────────┐
 *   │            Personality Kernel                 │
 *   │  ┌─────────────────┐  ┌────────────────────┐ │
 *   │  │  Primary Brain  │  │   Backup Brain     │ │
 *   │  │  (AI Core NLP   │  │   (Rule-based,     │ │
 *   │  │  + LLM backend) │  │   always online)   │ │
 *   │  └────────┬────────┘  └─────────┬──────────┘ │
 *   │           └──────────┬──────────┘            │
 *   │                Brain Router                   │
 *   │        (failover + health watchdog)           │
 *   └───────────────────────────────────────────────┘
 *
 * Primary Brain  = full NLP + optional LLM backend (ai-core.js)
 * Backup Brain   = deterministic pattern matcher — no LLM, always fast
 * Brain Router   = automatic failover if primary errors >= threshold
 *
 * Eternal loop: once activated, the personality kernel runs forever.
 * It cannot be stopped except by an explicit OS shutdown command.
 *
 * Zero external npm dependencies.
 */

// ---------------------------------------------------------------------------
// Backup Brain — deterministic rule-based brain, always available
// ---------------------------------------------------------------------------

const BACKUP_RULES = [
  // Filesystem
  { re: /^(ls|list)\s*(.*)$/i,           fn: (m) => `ls ${(m[2] || '.').trim()}` },
  { re: /^cat\s+(.+)$/i,                 fn: (m) => `cat ${m[1].trim()}` },
  { re: /^cd\s+(.+)$/i,                  fn: (m) => `cd ${m[1].trim()}` },
  { re: /^pwd$/i,                         fn: ()  => 'pwd' },
  { re: /^mkdir\s+(.+)$/i,               fn: (m) => `mkdir ${m[1].trim()}` },
  { re: /^touch\s+(.+)$/i,               fn: (m) => `touch ${m[1].trim()}` },
  { re: /^rm\s+(.+)$/i,                  fn: (m) => `rm ${m[1].trim()}` },
  { re: /^tree\s*(.*)$/i,                fn: (m) => `tree ${(m[1] || '.').trim()}` },
  // System info
  { re: /^(ps|processes?)$/i,            fn: ()  => 'ps' },
  { re: /^df\s*(.*)$/i,                  fn: ()  => 'df' },
  { re: /^free\s*(.*)$/i,                fn: ()  => 'free' },
  { re: /^uname\s*(.*)$/i,              fn: ()  => 'uname' },
  { re: /^uptime$/i,                     fn: ()  => 'uptime' },
  { re: /^sysinfo$/i,                    fn: ()  => 'sysinfo' },
  { re: /^hostname$/i,                   fn: ()  => 'hostname' },
  // Services
  { re: /^svc\s+(start|stop|restart|list|status)\s*(.*)$/i,
    fn: (m) => `svc ${m[1]} ${(m[2] || '').trim()}`.trim() },
  // Hardware
  { re: /^hwinfo\s*(.*)$/i,              fn: ()  => 'hwinfo' },
  { re: /^hwcpu\s*(.*)$/i,              fn: ()  => 'hwcpu' },
  { re: /^hwmem\s*(.*)$/i,              fn: ()  => 'hwmem' },
  // Init / state / caps / env
  { re: /^(init|state|caps|env)\s*(.*)$/i,
    fn: (m) => `${m[1]} ${(m[2] || '').trim()}`.trim() },
  // Debug
  { re: /^debug\s*(.*)$/i,              fn: (m) => `debug ${(m[1] || '').trim()}`.trim() },
  // Kernel
  { re: /^kernel\s+info$/i,             fn: ()  => 'kernel info' },
  { re: /^kernel\s+mode$/i,             fn: ()  => 'kernel mode' },
  { re: /^kernel\s+switch\s+(self|mirror)$/i,
    fn: (m) => `kernel switch ${m[1]}` },
  // Loop engine
  { re: /^loop\s+(start|stop|status|step)$/i,
    fn: (m) => `loop ${m[1]}` },
  // CPU demo
  { re: /^cpu\s*(demo|info|regs|reset)$/i,
    fn: (m) => `cpu ${m[1]}` },
  // Help
  { re: /^help$/i,                       fn: ()  => 'help' },
];

function createBackupBrain() {
  let _queries  = 0;
  let _resolved = 0;

  async function process(input, router) {
    _queries++;
    const text = String(input || '').trim();

    for (const rule of BACKUP_RULES) {
      const m = text.match(rule.re);
      if (m) {
        const cmd = rule.fn(m);
        _resolved++;
        if (router) {
          const result = await router.handle(cmd, { fromBackupBrain: true });
          return { matched: true, result };
        }
        return { matched: true, result: { status: 'ok', result: `[backup] would run: ${cmd}` } };
      }
    }

    return {
      matched: false,
      result: {
        status: 'ok',
        result: [
          'Backup brain is active (primary brain is recovering).',
          `Unrecognized input: "${text}"`,
          '',
          'Available commands: ls, cat, cd, pwd, mkdir, ps, df, free,',
          '  uname, uptime, sysinfo, svc, hwinfo, debug, kernel info, cpu, help',
        ].join('\n'),
      },
    };
  }

  return {
    name:    'backup-brain',
    version: '4.0.0',
    process,
    stats:   () => ({ queries: _queries, resolved: _resolved }),
  };
}

// ---------------------------------------------------------------------------
// Personality Kernel factory
// ---------------------------------------------------------------------------
function createPersonalityKernel(kernel, primaryAICore, router, svcMgr, hwKernel, stateEngine, memoryCore) {
  const FAILOVER_THRESHOLD = 3;    // primary failures before auto-switch
  const FAILOVER_WINDOW_MS = 60000; // rolling 60-second window

  const _backupBrain  = createBackupBrain();
  let   _primaryBrain = primaryAICore;
  let   _usePrimary   = true;
  let   _primaryFails = [];          // timestamps of recent primary failures
  let   _monitoring   = false;
  let   _monitorInterval = null;
  let   _stats = { queries: 0, resolved: 0, failovers: 0, primaryErrors: 0 };

  // ── Brain health ────────────────────────────────────────────────────────────

  function _recordPrimaryFailure() {
    const now = Date.now();
    _primaryFails.push(now);
    _primaryFails = _primaryFails.filter(t => now - t < FAILOVER_WINDOW_MS);
    _stats.primaryErrors++;
    if (_usePrimary && _primaryFails.length >= FAILOVER_THRESHOLD) {
      _switchToBackup('auto: primary failure threshold reached');
    }
  }

  function _switchToBackup(reason) {
    if (!_usePrimary) return;
    _usePrimary = false;
    _stats.failovers++;
    if (kernel) {
      kernel.bus.emit('brain:failover', { to: 'backup', reason });
      kernel.syscall(1, [`[PersonalityKernel] Switched to backup brain — ${reason}`]);
    }
    if (memoryCore) {
      memoryCore.record('brain', `failover:${reason}`, 'switched to backup', reason);
    }
  }

  function _switchToPrimary() {
    if (_usePrimary) return;
    _primaryFails = [];
    _usePrimary   = true;
    if (kernel) {
      kernel.bus.emit('brain:recovered', { to: 'primary' });
      kernel.syscall(1, ['[PersonalityKernel] Primary brain restored.']);
    }
    if (memoryCore) {
      memoryCore.record('brain', 'recovered:primary', 'switched to primary', null);
    }
  }

  // ── Main process ────────────────────────────────────────────────────────────

  async function process(input) {
    _stats.queries++;
    const text = String(input || '').trim();
    if (!text) return { status: 'error', result: 'No input.' };

    // Personality kernel meta commands
    const lower = text.toLowerCase();
    if (lower === 'brain status' || lower === 'brain') return _brainStatus();
    if (lower === 'brain switch primary') {
      _switchToPrimary();
      return { status: 'ok', result: 'Switched to primary brain.' };
    }
    if (lower === 'brain switch backup') {
      _switchToBackup('manual switch');
      return { status: 'ok', result: 'Switched to backup brain.' };
    }
    if (lower === 'brain switch auto') {
      _usePrimary = true;
      _primaryFails = [];
      return { status: 'ok', result: 'Auto brain routing enabled.' };
    }

    // Try primary brain
    if (_usePrimary && _primaryBrain) {
      try {
        const result = await _primaryBrain.process(text);
        if (result && result.status !== 'error') {
          _stats.resolved++;
          return result;
        }
        _recordPrimaryFailure();
      } catch (e) {
        _recordPrimaryFailure();
        if (kernel) kernel.bus.emit('brain:primary:error', { error: e.message });
      }
    }

    // Fallback to backup brain
    const backupResult = await _backupBrain.process(text, router);
    if (backupResult.matched) _stats.resolved++;
    return backupResult.result;
  }

  // ── Brain status ────────────────────────────────────────────────────────────

  function _brainStatus() {
    return {
      status: 'ok',
      result: [
        'AI Personality Kernel — Brain Status',
        '──────────────────────────────────────────',
        `Active Brain   : ${_usePrimary ? 'PRIMARY ●' : 'BACKUP ●'}`,
        `Primary Brain  : ${_primaryBrain ? (_usePrimary ? 'ACTIVE' : 'STANDBY') : 'NOT LOADED'}`,
        `Backup Brain   : ${!_usePrimary ? 'ACTIVE' : 'STANDBY'}`,
        `Primary Errors : ${_stats.primaryErrors}  (last 60s: ${_primaryFails.length}/${FAILOVER_THRESHOLD})`,
        `Failovers      : ${_stats.failovers}`,
        `Total Queries  : ${_stats.queries}`,
        `Resolved       : ${_stats.resolved}`,
        `Eternal Loop   : ${_monitoring ? 'RUNNING' : 'STOPPED'}`,
        '',
        'Commands:',
        '  brain status',
        '  brain switch primary | backup | auto',
      ].join('\n'),
    };
  }

  function status() {
    return {
      primaryActive: _usePrimary && !!_primaryBrain,
      backupActive:  !_usePrimary,
      currentBrain:  _usePrimary ? 'primary' : 'backup',
      monitoring:    _monitoring,
      stats:         Object.assign({}, _stats),
    };
  }

  // ── Eternal loop ─────────────────────────────────────────────────────────────
  // The eternal loop is the OS heartbeat. Once started it runs forever.
  // It performs periodic health checks and keeps the process alive.

  function startEternalLoop() {
    if (_monitoring) return;
    _monitoring = true;

    _monitorInterval = setInterval(async () => {
      try {
        // Attempt primary brain recovery if on backup
        if (!_usePrimary && _primaryBrain) {
          try {
            const test = await _primaryBrain.process('status');
            if (test && test.status !== 'error') _switchToPrimary();
          } catch (_) {}
        }

        // Check failed services and auto-restart
        if (svcMgr) {
          const svcs = svcMgr.list();
          for (const svc of svcs) {
            if (svc.state === 'failed') {
              svcMgr.restart(svc.name).catch(() => {});
              if (kernel) kernel.syscall(1, [`[PersonalityKernel] Auto-restarting service: ${svc.name}`]);
            }
          }
        }

        // Memory warning
        if (hwKernel) {
          const m = hwKernel.memInfo();
          if (m.ok && m.freeMB < 50 && kernel) {
            kernel.bus.emit('ai:alert', { type: 'memory:low', freeMB: m.freeMB });
          }
        }

        // Heartbeat event
        if (kernel) {
          kernel.bus.emit('brain:heartbeat', {
            brain:   _usePrimary ? 'primary' : 'backup',
            uptime:  kernel.uptime(),
            queries: _stats.queries,
          });
        }

        // State maintenance
        if (stateEngine) {
          const s = stateEngine.get();
          // Transition RUNNING → IDLE when queries are low and no active services changed
          // (simple heuristic: no recent queries in 5+ minutes)
          if (s === 'RUNNING' && _stats.queries === 0) {
            stateEngine.transition('IDLE');
          } else if (s === 'IDLE' && _stats.queries > 0) {
            stateEngine.transition('RUNNING');
          }
        }
      } catch (e) {
        // Never let the eternal loop die — catch everything
        if (kernel) kernel.bus.emit('brain:monitor:error', { error: e.message });
      }
    }, 30000);

    // DO NOT unref() — this interval keeps the Node.js process alive (eternal loop)

    if (kernel) {
      kernel.bus.emit('brain:eternal-loop:started', { interval: 30000 });
      kernel.syscall(1, ['[PersonalityKernel] Eternal loop activated — OS is permanently live.']);
    }
  }

  function stopEternalLoop() {
    if (_monitorInterval) {
      clearInterval(_monitorInterval);
      _monitorInterval = null;
    }
    _monitoring = false;
    if (kernel) kernel.bus.emit('brain:eternal-loop:stopped', {});
  }

  // ── Update primary brain reference ────────────────────────────────────────

  function setPrimaryBrain(aiCore) {
    _primaryBrain = aiCore;
    if (kernel) kernel.bus.emit('brain:primary:set', { version: aiCore ? aiCore.version : null });
  }

  // ── Router command module ────────────────────────────────────────────────

  const commands = {
    brain: async (args) => {
      const sub = (args[0] || 'status').toLowerCase();
      if (sub === 'status')                  return _brainStatus();
      if (sub === 'switch' && args[1]) {
        const target = args[1].toLowerCase();
        if (target === 'primary') { _switchToPrimary();              return { status: 'ok', result: 'Switched to primary brain.' }; }
        if (target === 'backup')  { _switchToBackup('manual');       return { status: 'ok', result: 'Switched to backup brain.' }; }
        if (target === 'auto')    { _usePrimary = true; _primaryFails = []; return { status: 'ok', result: 'Auto routing enabled.' }; }
        return { status: 'error', result: 'Usage: brain switch <primary|backup|auto>' };
      }
      return _brainStatus();
    },
  };

  return {
    name:            'personality-kernel',
    version:         '4.0.0',
    process,
    status,
    setPrimaryBrain,
    startEternalLoop,
    stopEternalLoop,
    isMonitoring:    () => _monitoring,
    usePrimary:      () => _usePrimary,
    commands,
  };
}

module.exports = { createPersonalityKernel };
