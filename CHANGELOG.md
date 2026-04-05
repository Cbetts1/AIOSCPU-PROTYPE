# Changelog

All notable changes to AIOSCPU are documented in this file.

Format: [Semantic Versioning](https://semver.org/)

---

## [1.0.0] — 2026-04-05

### Added — Phase 1: Core OS Hardening

**Kernel (`core/kernel.js` v1.1.0)**
- `ERROR_CODES` table — 25 standardized numeric error codes covering kernel, CPU, FS, services, and AI
- `DependencyGraph` class — tracks module registration, topological sort, circular-dep detection
- `kernel.panic(message, code)` — fail-fast kernel panic with `kernel:panic` bus event
- `kernel.assert(cond, message, code)` — inline assertion helper
- `kernel.registerHealthCheck(name, fn, intervalMs)` — register a service health check
- `kernel.runHealthCheck(name)` / `kernel.runAllHealthChecks()` — run checks on demand
- `kernel.startHealthMonitoring()` / `kernel.stopHealthMonitoring()` — interval-based checks
- `kernel.depGraph` exposed on kernel object

**CPU (`core/cpu.js` v1.1.0)**
- Memory bounds checking — `memRead`/`memWrite` throw `RangeError` with `err.cpuCode = 'E_CPU_BOUNDS'` on out-of-range access; `cpu:fault` event emitted on kernel bus
- `selfTest()` method — 10-assertion boot self-test covering LOADI, ADD, SUB, MUL, DIV, NEG, ABS, INC, DEC, CALL/RET, and JZ
- New arithmetic opcodes: `NEG` (0x16), `ABS` (0x17), `INC` (0x18), `DEC` (0x19)

**Filesystem (`core/filesystem.js` v1.1.0)**
- Virtual mount table — `mount()`, `umount()`, `getMounts()`
- `writeAtomic(path, content)` — write to shadow node, verify, then swap
- `fsck(path)` — recursive integrity check returning `{ok, checked, errors, clean}`
- Persistent layer — `snapshot()` / `restore(json)` / `persistTo(hostPath)` / `loadFrom(hostPath)`

### Added — Phase 2: OS Experience Layer

**Status Bar (`core/status-bar.js` v1.0.0)**
- Real-time status line: CPU%, MEM%, uptime, mode, model name, network indicator, error indicator
- ANSI progress bars with colour-coded thresholds (green/yellow/red)
- Pluggable data providers (setCpuProvider, setMemProvider, setModeProvider, setModelProvider, setNetProvider, setErrorProvider)
- Auto-refresh timer with configurable interval
- Graceful degradation on non-TTY terminals

**Boot Splash (`core/boot-splash.js` v1.0.0)**
- High-contrast blue theme (white-on-blue ANSI)
- Retro Windows-95 double-line box frame (╔ ═ ╗ ║ ╠ ╚)
- AIOSCPU ASCII art logo (6-line block font)
- `show()` / `complete(message)` / `log(message, level)` API
- Boot log with `toggleLog()` / `setLogVisible()` support
- Log levels: `info`, `ok`, `warn`, `err`

### Added — Phase 5: Packaging & Distribution

**Installers**
- `install/termux-install.sh` — full Termux/Android installer
- `install/desktop-install.sh` — Linux/macOS/WSL desktop installer with `--dir` / `--no-alias` options
- `install/bootstrap.sh` — one-shot bootstrap script (auto-detects environment)
- `install/self-repair.sh` — 6-step automated repair with `--reinstall` option

**Branding**
- `branding/logo.txt` — AIOSCPU block-font ASCII logo
- `branding/boot-banner.txt` — full framed boot banner with version info

**Documentation**
- `docs/OPERATOR.md` — complete operator manual (12 sections, all commands)
- `docs/API-REFERENCE.md` — full JavaScript API reference (14 modules)
- `docs/TROUBLESHOOTING.md` — 10-section diagnostic guide with fixes

### Added — Phase 6: Tests

**New test files**
- `tests/status-bar.test.js` — 20+ tests for status bar module
- `tests/boot-splash.test.js` — 20+ tests for boot splash module
- `tests/kernel-hardening.test.js` — 25+ tests for new kernel features
- `tests/cpu-v2.test.js` — 30+ tests for CPU v1.1 (bounds, self-test, NEG/ABS/INC/DEC)
- `tests/filesystem-v2.test.js` — 25+ tests for FS v1.1 (mount, atomic write, fsck, snapshot)

---

## Earlier Development (pre-1.0.0)

Prior iterations established:

- `core/kernel.js` v1.0.0 — kernel event bus, process table, module registry
- `core/cpu.js` v1.0.0 — full AIOSCPU ISA (30+ opcodes)
- `core/filesystem.js` v1.0.0 — POSIX VFS (mkdir, ls, cd, read, write, rm, mv, cp, tree)
- `core/router.js` — command routing and dispatch
- `core/service-manager.js` — service lifecycle management
- `core/ai-core.js` v3.0.0 — multi-backend AI with circuit breakers, persistent context
- `core/aios-aura.js` v2.0.0 — AIOS personality + AURA hardware intelligence
- `core/consciousness.js` — consciousness layer integration
- `core/memory-engine.js` — interaction and learning data storage
- `core/mode-manager.js` — chat/code/fix/help/learn modes
- `core/model-registry.js` — model discovery and registration
- `core/diagnostics-engine.js` v1.0.0 — system health diagnostics
- `core/port-server.js` — TCP port server
- `core/health-monitor.js` v1.0.0 — HTTP and TCP health monitoring
- `core/network.js` — virtual networking
- `core/remote-mesh.js` — distributed mesh
- `core/jarvis-orchestrator.js` v1.0.0 — multi-agent AI orchestrator
- `core/memory-core.js` — unified cognitive memory layer
- `terminal/terminal.js` v2.0.0 — interactive terminal
- `boot/bootstrap.js` — full OS boot sequence
- 1113 tests across 27 test suites
