# AIOSCPU — AI-Operated Software CPU

> **AIOS Lite v4.0.0 — The AI-native OS that runs anywhere Node.js does.**  
> Zero external dependencies · Pure Node.js · Boots on Android via Termux · Fully offline

[![GitHub](https://img.shields.io/badge/GitHub-AI--OS--vitural--CPU--OS-black?logo=github)](https://github.com/Cbetts1/AI-OS-vitural-CPU-OS)

[![Version](https://img.shields.io/badge/version-4.0.0-blue.svg)](CHANGELOG.md)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D14.0.0-brightgreen.svg)](package.json)
[![Tests](https://img.shields.io/badge/tests-1611%20passing-brightgreen.svg)](tests/)
[![Platform](https://img.shields.io/badge/platform-Android%20%7C%20Linux%20%7C%20macOS%20%7C%20Windows-lightgrey.svg)](README.md)

---

## Overview

**AIOSCPU** is a complete software-layer operating system that runs entirely
inside Node.js — no native compilation, no root, no internet connection required.
It boots from a single script (`./aos`) and includes its own:

| Component | Version | Description |
|-----------|---------|-------------|
| 🧠 **AIOSCPU ISA** | v2.0 | Software-emulated 32-bit CPU with 30+ opcodes, registers, stack, SYSCALL |
| ⚙️  **Kernel** | v4.0.0 | Event bus, process table, module registry, syscall dispatch, panic/assert |
| 🗂  **Filesystem** | v1.1.0 | In-memory POSIX-like VFS + atomic writes, snapshots, fsck |
| 🔀 **Router** | v1.0 | Command dispatcher with hot-swap plug-in modules |
| 🛠  **Service Manager** | v1.0 | Start/stop/restart named background services |
| 💻 **Terminal** | v1.0 | Interactive readline REPL with ANSI colours |
| 🤖 **AIOS Personality** | v2.0 | Always-on AI kernel with phone-first offline LLM support |
| 🔬 **AURA** | v2.0 | On-demand hardware intelligence layer |
| 📡 **VHAL** | v1.0 | Virtual hardware bus (VROM, VRAM, VMEM, VDISPLAY, VNET, NPU) |
| 🪞 **Self-Model** | v1.0 | OS consciousness loop, memory engine, self-awareness |

---

## Quick Start

### On Android (Termux) — Recommended

```bash
# Step 1: Install Node.js in Termux
pkg update && pkg install nodejs git

# Step 2: Clone the repo
git clone https://github.com/Cbetts1/AI-OS-vitural-CPU-OS.git
cd AI-OS-vitural-CPU-OS

# Step 3: Boot AIOS Lite
chmod +x aos
./aos
```

### On Desktop (Linux / macOS / Windows)

```bash
git clone https://github.com/Cbetts1/AI-OS-vitural-CPU-OS.git
cd AI-OS-vitural-CPU-OS
node aos
```

> **No `npm install` needed.** There are zero external packages.

---

## Terminal Commands

Once booted, you get an interactive shell. Here are all built-in commands:

### Filesystem
```
pwd                        Print working directory
cd <path>                  Change directory
mkdir [-p] <path>          Create directory
ls [path]                  List directory contents
touch <path>               Create empty file
cat <path>                 Read a file
write <path> <content>     Write content to file
rm [-r] <path>             Remove file or directory
cp <src> <dst>             Copy file
mv <src> <dst>             Move / rename
stat <path>                Show file metadata
tree [path]                Recursive directory listing
```

### OS / System
```
uname                      OS version string
uptime                     Seconds since boot
ps                         List running processes
kill <pid>                 Kill a process by PID
env                        Show OS environment variables
date                       Current date/time (ISO 8601)
whoami                     Current user
hostname                   System hostname
```

### AIOSCPU
```
cpu demo                   Run a Hello World program on the AIOSCPU
cpu info                   Show CPU spec and current state
cpu regs                   Dump all register values
cpu reset                  Reset the CPU
```

### Service Manager
```
svc list                   List all services and their states
svc status <name>          Detailed status of a service
svc start  <name>          Start a service
svc stop   <name>          Stop a service
svc restart <name>         Restart a service
```

### Router / General
```
help                       List all available commands
version                    Router version
echo <text>                Echo text back
history                    Command history
clear                      Clear screen
exit / quit / shutdown     Shut down AIOS Lite
```

---

## Architecture

```
./aos
 └─ boot/boot.js
      ├─ core/kernel.js          Event bus · process table · syscall table
      ├─ core/filesystem.js      In-memory VFS  (POSIX-like)
      ├─ core/cpu.js             AIOSCPU v1.0   (32-bit virtual processor)
      ├─ core/router.js          Command router (hot-swap modules)
      ├─ core/service-manager.js Service lifecycle
      └─ terminal/terminal.js    readline REPL  (user shell)
```

### CPU–Kernel Self-Hosting Loop

```
AIOSCPU program
  └─ SYSCALL instruction
       └─ kernel.syscall(num, args)
            └─ OS action  (write / fs / exit / …)
                 └─ kernel.bus.emit('kernel:syscall', …)
```

The CPU is a first-class OS module. Programs running on the AIOSCPU can read
and write the filesystem, print output, query uptime, and trigger shutdown — all
via the `SYSCALL` opcode.

---

## AIOSCPU ISA Summary

| Category  | Instructions |
|-----------|-------------|
| Control   | `NOP` `HALT` `JMP` `JMPR` `JZ` `JNZ` `JLT` `JGT` `JLE` `JGE` `CALL` `RET` |
| Data      | `MOV` `LOADI` `LOAD` `STORE` `LOADR` `STORER` `PUSH` `POP` |
| Arithmetic| `ADD` `ADDI` `SUB` `MUL` `DIV` `MOD` |
| Bitwise   | `AND` `OR` `XOR` `NOT` `SHL` `SHR` |
| Compare   | `CMP` `CMPI` |
| OS Bridge | `SYSCALL` `IN` `OUT` |

- **Registers:** R0–R7 (32-bit signed), PC, SP, FLAGS
- **Memory:** 64 KB flat address space
- **Stack:** `0x0100–0x01FF` (grows downward)
- **Safety cap:** 10,000,000 cycles per run

Full specification: [`docs/AIOSCPU-SPEC.md`](docs/AIOSCPU-SPEC.md)

---

## Project Structure

```
AI-OS-vitural-CPU-OS/
├── aos                        ← Boot entry point (chmod +x, then ./aos)
├── boot/boot.js               ← Full startup orchestrator
├── core/
│   ├── kernel.js              ← Kernel
│   ├── cpu.js                 ← AIOSCPU v1.0 virtual processor
│   ├── router.js              ← Command router
│   ├── filesystem.js          ← In-memory VFS
│   └── service-manager.js     ← Service lifecycle
├── terminal/terminal.js       ← Interactive REPL
├── docs/
│   ├── AIOSCPU-SPEC.md        ← CPU & ISA specification
│   ├── DEVELOPER.md           ← Developer guide
│   └── LEGAL.md               ← IP, copyright & license details
├── LICENSE                    ← MIT License
├── NOTICE                     ← Copyright & attribution notice
├── CONTRIBUTING.md            ← Contribution guidelines
└── CODE_OF_CONDUCT.md         ← Community standards
```

---

## Requirements

| Requirement | Version |
|-------------|---------|
| Node.js     | ≥ 14.0.0 |
| npm packages| **None** |
| Internet    | **Not required** |
| Root / sudo | **Not required** |

---

## Why AIOSCPU?

AIOSCPU is the only project that combines **all five** of:

1. 🤖 **Custom virtual CPU with AI syscall integration** — AI is not bolted on; it's in the instruction layer
2. 🏗 **Full OS kernel written from scratch** — no Linux, no POSIX base required
3. 📱 **First-class Android/Termux deployment** — boots on your phone right now
4. 📦 **Zero external dependencies** — `node aos` is the entire install
5. 🧠 **Local LLM personality built into the boot sequence** — offline AI, no cloud

---

## Documentation

| Document | Description |
|----------|-------------|
| [`MASTER-HANDBOOK.md`](MASTER-HANDBOOK.md) | Complete operator & marketing handbook — start here |
| [`docs/AIOSCPU-SPEC.md`](docs/AIOSCPU-SPEC.md) | Full CPU / ISA specification |
| [`docs/API-REFERENCE.md`](docs/API-REFERENCE.md) | Full API reference for all modules |
| [`docs/DEVELOPER.md`](docs/DEVELOPER.md) | Developer guide — adding commands, services, CPU programs |
| [`docs/OPERATOR.md`](docs/OPERATOR.md) | Operator guide — deployment, config, monitoring |
| [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) | Troubleshooting guide |
| [`docs/PRODUCT-BRIEF.md`](docs/PRODUCT-BRIEF.md) | Sales & marketing product brief |
| [`docs/COMPETITIVE-ANALYSIS.md`](docs/COMPETITIVE-ANALYSIS.md) | Market positioning & competitive analysis |
| [`docs/USER-RIGHTS.md`](docs/USER-RIGHTS.md) | User rights, EULA, data privacy |
| [`docs/LEGAL.md`](docs/LEGAL.md) | Copyright, IP, trademark, and commercial notes |
| [`SECURITY.md`](SECURITY.md) | Security policy and vulnerability reporting |
| [`DISCLAIMER.md`](DISCLAIMER.md) | Warranty disclaimer and liability limitation |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | How to contribute |
| [`CHANGELOG.md`](CHANGELOG.md) | Version history |

---

## Legal

```
Copyright (c) 2026 Cbetts1. All rights reserved.
```

Licensed under the **MIT License** — see [`LICENSE`](LICENSE) for full terms.

"AIOSCPU" and "AIOS Lite" are trademarks of Cbetts1. See [`docs/LEGAL.md`](docs/LEGAL.md)
and [`NOTICE`](NOTICE) for full IP and copyright information.

---

*AIOSCPU — AI-Operated Software CPU · AIOS Lite v4.0.0*  
*Built and owned by Cbetts1 · https://github.com/Cbetts1*

