# AIOSCPU Operator Manual  v1.0.0

> **AI-Operated Software CPU — AIOS Lite**
> For operators, administrators, and power users.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Installation](#2-installation)
3. [Starting AIOSCPU](#3-starting-aioscpu)
4. [Terminal Commands](#4-terminal-commands)
5. [Filesystem Operations](#5-filesystem-operations)
6. [Service Management](#6-service-management)
7. [AI Commands](#7-ai-commands)
8. [CPU Commands](#8-cpu-commands)
9. [Permission System](#9-permission-system)
10. [Status Bar & Boot Splash](#10-status-bar--boot-splash)
11. [Shutdown & Restart](#11-shutdown--restart)
12. [Troubleshooting Quick Reference](#12-troubleshooting-quick-reference)

---

## 1. Introduction

AIOSCPU is a fully-offline, AI-operated software CPU that runs inside Node.js.
It provides:

- A virtual kernel with process table, event bus, and module registry
- A virtual CPU (AIOSCPU v1.1 ISA) with full arithmetic, bitwise, and flow-control operations
- A POSIX-like in-memory virtual filesystem
- An AI core (AIOS + AURA) powered by Ollama / llama.cpp
- A consciousness layer (memory engine, mode manager, identity)
- Virtual networking, port server, service manager
- Interactive terminal with tab completion and command history

---

## 2. Installation

### Termux (Android)

```bash
curl -fsSL https://raw.githubusercontent.com/Cbetts1/AIOSCPU-PROTYPE/main/install/bootstrap.sh | bash
```

Or manually:

```bash
pkg install nodejs git
git clone https://github.com/Cbetts1/AIOSCPU-PROTYPE ~/aioscpu
cd ~/aioscpu && npm install
node aos
```

### Desktop (Linux / macOS / WSL)

```bash
curl -fsSL https://raw.githubusercontent.com/Cbetts1/AIOSCPU-PROTYPE/main/install/bootstrap.sh | bash
```

Or:

```bash
git clone https://github.com/Cbetts1/AIOSCPU-PROTYPE ~/.local/share/aioscpu
cd ~/.local/share/aioscpu && npm install
node aos
```

### Requirements

| Requirement | Version |
|-------------|---------|
| Node.js     | >= 14.0.0 |
| npm         | >= 6.0.0  |
| OS          | Linux, macOS, Android (Termux), Windows (WSL) |
| Ollama      | Optional — for AI features |

---

## 3. Starting AIOSCPU

```bash
node aos           # Start with full boot sequence
node aos --help    # Show launch options
aios               # If installed via installer (alias)
```

The system will:
1. Display the boot splash
2. Initialize all kernel modules
3. Mount the virtual filesystem
4. Start services
5. Drop into the interactive terminal

---

## 4. Terminal Commands

### Help & Navigation

| Command         | Description                                |
|-----------------|--------------------------------------------|
| `help`          | Show all available commands                |
| `help <cmd>`    | Show help for a specific command           |
| `exit`          | Graceful shutdown                          |
| `clear`         | Clear the terminal screen                  |
| `history`       | Show command history                       |

### System Information

| Command         | Description                                |
|-----------------|--------------------------------------------|
| `status`        | Full system status                         |
| `ps`            | List running processes                     |
| `uptime`        | Show system uptime                         |
| `version`       | Show AIOSCPU version info                  |

### Host OS Passthrough

| Command         | Description                                |
|-----------------|--------------------------------------------|
| `!<cmd>`        | Run any host OS command (e.g. `!ls /`)     |
| `ai <text>`     | Natural language OS control               |
| `sudo <cmd>`    | Privilege escalation relay                |

### Number-Driven Menus

Many commands present numbered menus. Enter the number to select:

```
[1] Chat mode
[2] Code mode
[3] Fix mode
[4] Help mode
[5] Learn mode
```

---

## 5. Filesystem Operations

The virtual filesystem is a POSIX-compatible in-memory VFS.

| Command              | Description                                     |
|----------------------|-------------------------------------------------|
| `pwd`                | Print working directory                         |
| `cd <path>`          | Change directory                               |
| `ls [path]`          | List directory contents                        |
| `mkdir <path>`       | Create directory                               |
| `mkdir -p <path>`    | Create directory (with parents)                |
| `touch <path>`       | Create empty file                              |
| `cat <path>`         | Read file                                      |
| `write <path> <text>`| Write text to file                             |
| `rm <path>`          | Remove file                                    |
| `rm -r <path>`       | Remove directory recursively                   |
| `cp <src> <dst>`     | Copy file                                      |
| `mv <src> <dst>`     | Move / rename                                  |
| `stat <path>`        | File/directory info                            |
| `tree [path]`        | Recursive directory tree                       |

### Mount Table

```bash
mount /dev/vda1 /mnt/data ext4
umount /mnt/data
```

### FS Integrity Check

```bash
fsck /        # Check entire VFS for consistency errors
```

---

## 6. Service Management

| Command                | Description                                  |
|------------------------|----------------------------------------------|
| `svc list`             | List all services                            |
| `svc start <name>`     | Start a service                              |
| `svc stop <name>`      | Stop a service                               |
| `svc restart <name>`   | Restart a service                            |
| `svc status <name>`    | Service status                               |

### Built-in Services

| Service              | Description                          |
|----------------------|--------------------------------------|
| `kernel-watchdog`    | Monitors kernel health               |
| `ai-monitor`         | Monitors AI core health              |
| `procfs-updater`     | Updates /proc filesystem             |
| `host-info-logger`   | Logs host system information         |
| `cpu-idle`           | CPU idle loop / cycle tracking       |

---

## 7. AI Commands

| Command              | Description                                        |
|----------------------|----------------------------------------------------|
| `aios <text>`        | Query AIOS (always-on personality AI)              |
| `aios status`        | AIOS status and configuration                      |
| `aios clear`         | Clear AIOS conversation history                    |
| `aura <text>`        | Query AURA (hardware intelligence AI, on-demand)   |
| `aura status`        | AURA service status                                |
| `svc start aura`     | Start AURA service                                 |
| `svc stop aura`      | Stop AURA service                                  |
| `mode chat`          | Switch to Chat mode                               |
| `mode code`          | Switch to Code mode                               |
| `mode fix`           | Switch to Fix mode                                |
| `mode help`          | Switch to Help mode                               |
| `mode learn`         | Switch to Learn mode                              |

### AI Models (default priority)

1. `qwen2:0.5b` — ultra-light, phone-friendly
2. `tinyllama` — compact, offline
3. `phi3` — quality tier

---

## 8. CPU Commands

| Command              | Description                                        |
|----------------------|----------------------------------------------------|
| `cpu status`         | CPU registers, flags, cycle count                  |
| `cpu reset`          | Reset CPU state                                    |
| `cpu selftest`       | Run CPU self-test (10 assertions)                  |
| `cpu run <prog>`     | Run a program (JSON array of instructions)         |

### Example CPU Program

```json
[
  { "op": "LOADI", "dst": 0, "imm": 10 },
  { "op": "LOADI", "dst": 1, "imm": 32 },
  { "op": "ADD",   "dst": 2, "src1": 0, "src2": 1 },
  { "op": "HALT" }
]
```

---

## 9. Permission System

AIOSCPU has four privilege levels:

| Level      | Numeric | Description                          |
|------------|---------|--------------------------------------|
| `user`     | 0       | Default, read-only system access     |
| `operator` | 1       | Can start/stop services              |
| `admin`    | 2       | Full system access                   |
| `root`     | 3       | Unrestricted, kernel-level access    |

```bash
sudo <cmd>    # Request elevated privilege for one command
```

---

## 10. Status Bar & Boot Splash

### Status Bar

The status bar shows live system metrics:

```
CPU ██████░░ 72%  │  MEM ████████ 88%  │  UP 2m15s  │  MODE CHAT  │  MODEL phi3  │  NET
```

Enable auto-refresh:

```javascript
const { createStatusBar } = require('./core/status-bar');
const sb = createStatusBar(kernel, { refreshMs: 5000 });
sb.start();
```

### Boot Splash

The boot splash displays on startup and supports a toggleable boot log.

```javascript
const { createBootSplash } = require('./core/boot-splash');
const splash = createBootSplash({ version: '1.0.0', showBootLog: true });
splash.show();
splash.log('Kernel initialized', 'ok');
splash.complete('System ready.');
```

---

## 11. Shutdown & Restart

```bash
exit           # Graceful shutdown (saves state, stops services)
shutdown       # Alias for exit
reboot         # Restart the AIOS session
```

---

## 12. Troubleshooting Quick Reference

| Symptom                       | Fix                                              |
|-------------------------------|--------------------------------------------------|
| `node_modules` missing        | Run `npm install`                                |
| AI not responding             | Check Ollama: `ollama serve` / `ollama list`     |
| Service won't start           | Check logs: `svc status <name>`                  |
| Port in use                   | Change port in `etc/aios/services/*.json`        |
| FS integrity error            | Run `fsck /`                                     |
| Kernel panic                  | Restart: `node aos`                              |
| Corrupted install             | Run `bash install/self-repair.sh --reinstall`    |

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for detailed diagnostics.
