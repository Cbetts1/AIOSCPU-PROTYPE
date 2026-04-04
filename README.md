# AIOSCPU Prototype One — AIOS Lite

> **A fully self-contained, Termux-bootable, offline AI-native operating system.**  
> Zero external dependencies · Pure Node.js · Runs on Android via Termux

---

## Overview

**AIOSCPU Prototype One** is a complete software-layer operating system that runs
entirely inside Node.js — no native compilation, no root, no internet connection
required. It boots from a single script (`./aos`) and includes its own:

| Component | Description |
|-----------|-------------|
| 🧠 **AIOSCPU v1.0** | Software-emulated 32-bit CPU with 30+ ISA opcodes |
| ⚙️  **Kernel** | Event bus, process table, module registry, syscall dispatch |
| 🗂  **Filesystem** | In-memory POSIX-like VFS (mkdir/ls/cat/write/mv/rm/tree) |
| 🔀 **Router** | Command dispatcher with hot-swap plug-in modules |
| 🛠  **Service Manager** | Start/stop/restart named background services |
| 💻 **Terminal** | Interactive readline REPL with ANSI colours |
| 🔁 **Self-hosting loop** | CPU `SYSCALL` instruction dispatches into the OS kernel |

---

## Quick Start

### On Android (Termux) — Recommended

```bash
# Step 1: Install Node.js in Termux
pkg update && pkg install nodejs git

# Step 2: Clone the repo
git clone https://github.com/Cbetts1/AIOSCPU-PROTYPE.git
cd AIOSCPU-PROTYPE

# Step 3: Boot AIOS Lite
chmod +x aos
./aos
```

### On Desktop (Linux / macOS / Windows)

```bash
git clone https://github.com/Cbetts1/AIOSCPU-PROTYPE.git
cd AIOSCPU-PROTYPE
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
AIOSCPU-PROTYPE/
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

## Documentation

| Document | Description |
|----------|-------------|
| [`docs/AIOSCPU-SPEC.md`](docs/AIOSCPU-SPEC.md) | Full CPU / ISA specification |
| [`docs/DEVELOPER.md`](docs/DEVELOPER.md) | Developer guide — adding commands, services, CPU programs |
| [`docs/LEGAL.md`](docs/LEGAL.md) | Copyright, IP ownership, and license details |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | How to contribute |
| [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) | Community standards |

---

## Legal

```
Copyright (c) 2026 Cbetts1. All rights reserved.
```

Licensed under the **MIT License** — see [`LICENSE`](LICENSE) for full terms.

AIOSCPU, AIOS Lite, and AIOS Prototype One are original creations of Cbetts1.  
See [`docs/LEGAL.md`](docs/LEGAL.md) and [`NOTICE`](NOTICE) for full IP and
copyright information.

---

*AIOSCPU Prototype One — AIOS Lite v1.0.0*  
*Built and owned by Cbetts1 · https://github.com/Cbetts1*
