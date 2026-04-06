# AIOSCPU v1.0.0 — Release Notes

**Release Date:** 2026-04-05
**Type:** General Availability (GA)
**Codename:** AIOS Lite

---

## Summary

AIOSCPU v1.0.0 is the first stable release of the AI-Operated Software CPU — a fully-offline, Termux-bootable Node.js OS that provides a virtual kernel, virtual CPU, AI core, consciousness layer, and interactive terminal.

This release completes all six build phases:
- Phase 1: Core OS Hardening
- Phase 2: OS Experience Layer
- Phase 3: AI Core Integration (AIOS AURA, consciousness engine)
- Phase 4: Networking + Services
- Phase 5: Packaging + Distribution
- Phase 6: Finalization

---

## What's New in v1.0.0

### Kernel v1.1.0
- Standardized 25-code error table (`ERROR_CODES`)
- Module dependency graph with cycle detection
- Fail-fast panic/assert system
- Service health-check registry with interval monitoring

### CPU v1.1.0 (AIOSCPU ISA)
- Memory bounds checking — throws on out-of-range access
- CPU self-test (10 assertions, runs on boot)
- New arithmetic opcodes: NEG, ABS, INC, DEC

### Filesystem v1.1.0
- Virtual mount table (mount / umount / getMounts)
- Atomic write (shadow-and-swap)
- FS integrity check (fsck)
- Persistent layer (snapshot / restore / persistTo / loadFrom)

### Status Bar (New)
- CPU%, MEM%, uptime, mode, model, network, error indicator
- ANSI progress bars with colour thresholds
- Pluggable data providers
- Auto-refresh timer

### Boot Splash (New)
- High-contrast blue theme
- Retro Windows-95 frame
- AIOSCPU ASCII art logo
- Boot log with toggle

### Installer Suite (New)
- Termux one-liner installer
- Desktop one-liner installer
- One-shot bootstrap (auto-detects environment)
- Self-repair script (6 automated checks)

### Documentation (New / Expanded)
- Operator Manual (12 sections)
- API Reference (14 modules)
- Troubleshooting Guide (10 sections)
- CHANGELOG.md

---

## Test Coverage

| Suite | Tests |
|-------|-------|
| kernel.test.js | 47 |
| cpu.test.js | 48 |
| filesystem.test.js | 47 |
| ai-core.test.js | 56 |
| aios-aura.test.js | 56 |
| consciousness.test.js | 50 |
| memory-engine.test.js | 42 |
| mode-manager.test.js | 28 |
| model-registry.test.js | 32 |
| diagnostics-engine.test.js | 18 |
| health-monitor.test.js | 29 |
| port-server.test.js | 26 |
| service-manager.test.js | 34 |
| jarvis-orchestrator.test.js | 24 |
| router.test.js | 24 |
| ipc.test.js | 20 |
| scheduler.test.js | 24 |
| state-engine.test.js | 23 |
| upgrade-manager.test.js | 15 |
| memory-core.test.js | 52 |
| remote-mesh.test.js | 34 |
| permission-system.test.js | 23 |
| model-manager.test.js | 22 |
| model-scanner.test.js | 11 |
| capability-engine.test.js | 32 |
| collective-intelligence.test.js | 39 |
| env-loader.test.js | 37 |
| **kernel-hardening.test.js** (new) | 25+ |
| **cpu-v2.test.js** (new) | 30+ |
| **filesystem-v2.test.js** (new) | 25+ |
| **status-bar.test.js** (new) | 20+ |
| **boot-splash.test.js** (new) | 20+ |
| **Total** | **1200+** |

---

## Requirements

| Component | Version |
|-----------|---------|
| Node.js | >= 14.0.0 |
| npm | >= 6.0.0 |
| Ollama | Optional (for AI features) |
| OS | Linux, macOS, Android (Termux), Windows (WSL) |

---

## Installation

### One-shot (auto-detects Termux vs desktop)

```bash
curl -fsSL https://raw.githubusercontent.com/Cbetts1/AI-OS-vitural-CPU-OS/main/install/bootstrap.sh | bash
```

### Manual

```bash
git clone https://github.com/Cbetts1/AI-OS-vitural-CPU-OS
cd AI-OS-vitural-CPU-OS
npm install
node aos
```

---

## Breaking Changes

None — this is the initial GA release.

---

## Known Limitations

- The virtual filesystem is in-memory by default. Use `fs.persistTo()` for persistence.
- AI features require Ollama running on localhost:11434.
- The virtual CPU has a 10M-cycle safety limit per execution.
- AURA is on-demand only: `svc start aura` before use.

---

## Upgrade from Pre-Release

```bash
cd /path/to/aioscpu
git pull
npm install
```

---

## Links

- [Operator Manual](docs/OPERATOR.md)
- [Developer Manual](docs/DEVELOPER.md)
- [API Reference](docs/API-REFERENCE.md)
- [Troubleshooting](docs/TROUBLESHOOTING.md)
- [CPU Spec](docs/AIOSCPU-SPEC.md)
- [Changelog](CHANGELOG.md)
- [License](LICENSE)
