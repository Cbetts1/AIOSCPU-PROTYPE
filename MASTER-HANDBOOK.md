# 📖 AIOS MASTER HANDBOOK
### The Complete Guide for Chris Betts — Owner, Builder, and Operator
**Contact:** chris.l.betts.1988@gmail.com  
**GitHub:** https://github.com/Cbetts1  
**Last Updated:** April 2026

---

## 🗂️ TABLE OF CONTENTS

1. [What Is AIOS?](#1-what-is-aios)
2. [Your Complete Repository Overview](#2-your-complete-repository-overview)
3. [Install Guide — Every Platform](#3-install-guide--every-platform)
4. [Usage Guide — All Commands](#4-usage-guide--all-commands)
5. [Architecture — How It All Works](#5-architecture--how-it-all-works)
6. [Your Supporting Repos — Purpose & Use](#6-your-supporting-repos--purpose--use)
7. [Marketing & Promotion Guide](#7-marketing--promotion-guide)
8. [Maintenance Checklist](#8-maintenance-checklist)
9. [Quick Reference Card](#9-quick-reference-card)

---

## 1. What Is AIOS?

**AIOS (AI Operating System)** is a complete, self-contained operating system that runs entirely inside Node.js — no native compilation, no root access, no internet connection required. You built it from scratch.

### What Makes It Unique

AIOS is the **only** project in the world that combines all five of:

| # | Unique Property | Why It Matters |
|---|-----------------|----------------|
| 1 | **Custom virtual 32-bit CPU (AIOSCPU ISA)** with AI syscall integration | AI is built into the instruction layer, not bolted on |
| 2 | **Full OS kernel written from scratch** (no Linux/POSIX base) | Pure Node.js — runs everywhere Node does |
| 3 | **First-class Android/Termux deployment** — boots on a $50 phone | Your phone is a pocket AI computer |
| 4 | **Zero external runtime dependencies** — one command to run | `node aos` is the entire install |
| 5 | **Local LLM personality built into the boot sequence** | Offline AI, no cloud, no subscription |

### Version History at a Glance

| Version | What Changed |
|---------|-------------|
| v1.0.0 | Initial kernel, CPU, filesystem, terminal |
| v1.1.0 | ERROR_CODES, DependencyGraph, fsck, selfTest() |
| v2.0.0 | VHAL bus, AIOS personality, AURA intelligence, consciousness layer, 1400+ tests |

---

## 2. Your Complete Repository Overview

You have **12 repositories** on GitHub. Here is exactly what each one is:

---

### 🥇 [AI-OS-vitural-CPU-OS](https://github.com/Cbetts1/AI-OS-vitural-CPU-OS) ← **YOU ARE HERE — THE OFFICIAL REPO**
**Language:** JavaScript (Node.js) | **License:** MIT  
This is the canonical, most up-to-date version of AIOS. Everything else feeds into this.

---

### 🥈 [AIOSCPU-PROTYPE](https://github.com/Cbetts1/AIOSCPU-PROTYPE)
**Language:** JavaScript | **License:** MIT  
The previous main repo. Still fully functional. Has 1 GitHub star. The name has a typo ("PROTYPE" instead of "PROTOTYPE"). New work should go in `AI-OS-vitural-CPU-OS`.

---

### 🥉 [AIOS](https://github.com/Cbetts1/AIOS)
**Language:** Python | **License:** ⚠️ MISSING — needs MIT added  
A Python-based version of AIOS targeting AI/ML developers. Has `install.sh`, a full directory structure, and at least 1 star. Different audience from the JS version.

---

### 📦 [Kernal-](https://github.com/Cbetts1/Kernal-)
**Language:** JavaScript | **License:** ⚠️ MISSING — needs MIT added  
The kernel extracted as a standalone npm-ready library. Has TypeScript definitions (`kernel.d.ts`) — professional quality. Publish to npm as `aios-kernel`.

---

### 📦 [Router](https://github.com/Cbetts1/Router)
**Language:** JavaScript | **License:** MIT  
The command router as a standalone npm-ready library. Has thorough tests. Publish to npm as `aios-router`.

---

### 🖥️ [Terminal](https://github.com/Cbetts1/Terminal)
**Language:** JavaScript | **License:** MIT  
A web-based Linux terminal. Has a Dockerfile — ready to deploy on any server. Connect to AIOS for a live browser demo.

---

### 🔬 [NEW-ATTEMPT](https://github.com/Cbetts1/NEW-ATTEMPT)
**Language:** C | **License:** MIT  
A native C-language OS kernel prototype with a real bootloader. This is low-level systems programming — the "bare metal" version of your OS.

---

### ⚙️ [Digtail-Web-CPU](https://github.com/Cbetts1/Digtail-Web-CPU)
**Language:** C | **License:** MIT  
A C-language CPU emulator designed to interface with the web. Has a Makefile. Note: "Digtail" is a typo of "Digital".

---

### 🔗 [Os-handshake](https://github.com/Cbetts1/Os-handshake)
**Language:** JavaScript | **License:** MIT  
An inter-OS communication protocol. Lets different OS components talk to each other. Has thorough tests — well built.

---

### 🌐 [Os-layer](https://github.com/Cbetts1/Os-layer)
**Language:** JavaScript/HTML/CSS | **License:** MIT  
A browser-based OS UI — a webpage that looks like an operating system. Good for demos and marketing.

---

### ❌ [Backend-file-system-](https://github.com/Cbetts1/Backend-file-system-)
**Status:** Empty placeholder. No code. **Delete or fill.**

---

### ❌ [Files-system](https://github.com/Cbetts1/Files-system)
**Status:** Empty placeholder. No code. **Delete or fill.**

---

## 3. Install Guide — Every Platform

### 3.1 Android (Termux) — Recommended for Mobile

This is the coolest deployment: your AI OS on your phone.

```bash
# STEP 1: Set up Termux on Android
# Download Termux from F-Droid (https://f-droid.org) — NOT the Play Store version

# STEP 2: Update packages
pkg update && pkg upgrade -y

# STEP 3: Install Node.js and Git
pkg install nodejs git -y

# STEP 4: Clone AIOS
git clone https://github.com/Cbetts1/AI-OS-vitural-CPU-OS.git
cd AI-OS-vitural-CPU-OS

# STEP 5: Boot AIOS
chmod +x aos
./aos
```

**Optional: Install Termux widget for one-tap boot**
```bash
# Install Termux:Widget from F-Droid
# Then run this once:
node scripts/install-termux-widget.js
# Now you can boot AIOS by tapping a home screen widget
```

---

### 3.2 Linux (Ubuntu/Debian/Raspberry Pi)

```bash
# Install Node.js (if not already installed)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs git

# Clone and boot
git clone https://github.com/Cbetts1/AI-OS-vitural-CPU-OS.git
cd AI-OS-vitural-CPU-OS
node aos
```

---

### 3.3 macOS

```bash
# Install Node.js via Homebrew (if not already installed)
brew install node git

# Clone and boot
git clone https://github.com/Cbetts1/AI-OS-vitural-CPU-OS.git
cd AI-OS-vitural-CPU-OS
node aos
```

---

### 3.4 Windows

```bash
# Install Node.js from https://nodejs.org (LTS version)
# Install Git from https://git-scm.com

# Open Command Prompt or PowerShell:
git clone https://github.com/Cbetts1/AI-OS-vitural-CPU-OS.git
cd AI-OS-vitural-CPU-OS
node aos
```

---

### 3.5 Docker (Terminal Web App)

Deploy the web-based terminal so anyone can access AIOS from a browser:

```bash
git clone https://github.com/Cbetts1/Terminal.git
cd Terminal
docker build -t aios-terminal .
docker run -p 3000:3000 aios-terminal
# Open http://localhost:3000 in any browser
```

---

### 3.6 Run Tests

```bash
cd AI-OS-vitural-CPU-OS
npm install        # Install Jest (only dev dependency)
npx jest --verbose # Run all 1400+ tests
```

---

## 4. Usage Guide — All Commands

Once booted (`node aos`), you get an interactive terminal. Type `help` to see all commands.

### 4.1 Filesystem Commands

| Command | What It Does |
|---------|-------------|
| `pwd` | Print current working directory |
| `ls [path]` | List directory contents |
| `cd <path>` | Change directory |
| `mkdir [-p] <path>` | Create directory (-p creates parents) |
| `touch <path>` | Create empty file |
| `cat <path>` | Read and display a file |
| `write <path> <content>` | Write text to a file |
| `rm [-r] <path>` | Remove file or directory (-r recursive) |
| `cp <src> <dst>` | Copy file |
| `mv <src> <dst>` | Move or rename |
| `stat <path>` | Show file metadata (size, dates) |
| `tree [path]` | Recursive directory listing |

### 4.2 OS / System Commands

| Command | What It Does |
|---------|-------------|
| `uname` | OS version string |
| `uptime` | Seconds since boot |
| `ps` | List all running processes |
| `kill <pid>` | Kill a process by PID |
| `env` | Show environment variables |
| `date` | Current date/time (ISO 8601) |
| `whoami` | Current user |
| `hostname` | System hostname |

### 4.3 AIOSCPU Commands

| Command | What It Does |
|---------|-------------|
| `cpu demo` | Run a Hello World program on the virtual CPU |
| `cpu info` | Show CPU specs and current state |
| `cpu regs` | Dump all register values (R0–R7, PC, SP, FLAGS) |
| `cpu reset` | Reset the CPU to initial state |

### 4.4 Service Manager Commands

| Command | What It Does |
|---------|-------------|
| `svc list` | List all services and status |
| `svc status <name>` | Detailed status of a named service |
| `svc start <name>` | Start a named service |
| `svc stop <name>` | Stop a named service |
| `svc restart <name>` | Restart a named service |

### 4.5 AI / AIOS Commands

| Command | What It Does |
|---------|-------------|
| `aios <question>` | Ask the AIOS personality anything |
| `aura start` | Start the AURA hardware intelligence layer |
| `aura stop` | Stop AURA |
| `jarvis <question>` | Ask the Jarvis multi-agent AI orchestrator |

### 4.6 Termux-Specific Commands (Android only)

| Command | What It Does |
|---------|-------------|
| `termux help` | Show Termux bridge commands |
| `termux battery` | Read battery level |
| `termux notify <msg>` | Send Android notification |
| `termux toast <msg>` | Show Android toast message |
| `termux tts <text>` | Speak text aloud (text-to-speech) |
| `termux clipboard <text>` | Copy text to Android clipboard |

### 4.7 Shell / General Commands

| Command | What It Does |
|---------|-------------|
| `help` | List all commands |
| `version` | Show router/OS version |
| `echo <text>` | Echo text back |
| `history` | Command history |
| `clear` | Clear the screen |
| `exit` / `quit` / `shutdown` | Shut down AIOS cleanly |

---

## 5. Architecture — How It All Works

```
[USER]
  │
  ▼
./aos  (entry point)
  │
  ▼
boot/boot.js  (startup orchestrator)
  │
  ├── core/kernel.js         ← The heart: event bus, process table, syscalls
  │     └── ERROR_CODES      ← 25 error codes, panic/assert, DependencyGraph
  │
  ├── core/filesystem.js     ← In-memory VFS (POSIX-like)
  │     └── atomic writes, fsck, snapshots, mount table
  │
  ├── core/cpu.js            ← AIOSCPU v1.0 (32-bit virtual processor)
  │     └── 30+ opcodes, R0-R7, SYSCALL bridge to kernel
  │
  ├── core/router.js         ← Command dispatcher (hot-swappable modules)
  │
  ├── core/service-manager.js ← Start/stop/restart named services
  │
  ├── core/vhal.js           ← Virtual Hardware Abstraction Layer
  │     ├── core/vrom.js     ← Virtual ROM
  │     ├── core/vram.js     ← Virtual RAM
  │     ├── core/vmem.js     ← Virtual memory manager
  │     ├── core/vdisplay.js ← Virtual display
  │     ├── core/vnet.js     ← Virtual network
  │     └── core/npu-tinyllama.js ← NPU for TinyLlama AI model
  │
  ├── core/ai-core.js        ← AI backend manager (multi-backend, circuit breakers)
  │     └── core/aios-aura.js ← AIOS + AURA personality layers
  │
  ├── core/consciousness.js  ← OS self-awareness loop
  │     ├── core/memory-core.js    ← Unified cognitive memory layer
  │     ├── core/memory-engine.js  ← Memory storage engine
  │     ├── core/mode-manager.js   ← Mode switching
  │     ├── core/model-registry.js ← AI model registry
  │     └── core/self-model.js     ← OS self-model
  │
  ├── core/termux-bridge.js  ← Android/Termux API bridge
  │
  └── terminal/terminal.js   ← Interactive readline REPL
```

### The SYSCALL Bridge (How AI talks to the CPU)

```
User writes a CPU program with SYSCALL instruction
  └─► CPU executes SYSCALL opcode
        └─► kernel.syscall(num, args)
              └─► OS action (filesystem read/write, print, exit...)
                    └─► kernel.bus.emit('kernel:syscall', event)
                          └─► AI can listen and respond to any syscall
```

---

## 6. Your Supporting Repos — Purpose & Use

### Using Kernal- as a Library

```bash
# Install in another project:
npm install github:Cbetts1/Kernal-

# Use in code:
const { createKernel } = require('aios-kernel');
const kernel = createKernel({ version: '2.0.0' });
kernel.boot();
```

### Using Router as a Library

```bash
# Install in another project:
npm install github:Cbetts1/Router

# Use in code:
const Router = require('./router');
const router = new Router();
router.use('mycommand', (args) => console.log('Hello from mycommand!'));
```

### Using Os-handshake for Cross-OS Communication

```bash
npm install github:Cbetts1/Os-handshake

const interOS = require('inter-os');
const handshake = new interOS.HandshakeProtocol();
handshake.connect('aios', 'terminal');
```

### Building the C Kernel (NEW-ATTEMPT)

```bash
git clone https://github.com/Cbetts1/NEW-ATTEMPT.git
cd NEW-ATTEMPT
make              # Build the native kernel
make run          # Run in QEMU emulator (requires QEMU)
make clean        # Clean build output
```

### Building the C Web CPU (Digtail-Web-CPU)

```bash
git clone https://github.com/Cbetts1/Digtail-Web-CPU.git
cd Digtail-Web-CPU
make              # Compile the CPU emulator
./build/webcpu    # Run it
```

---

## 7. Marketing & Promotion Guide

### 7.1 Your Core Value Proposition

> *"I built a complete AI-native operating system that boots on a $50 Android phone with zero dependencies — no root, no internet, no cloud."*

That is your headline. Use it everywhere.

### 7.2 Headlines by Platform

**Hacker News (Show HN):**
> "Show HN: I built a full OS + custom virtual CPU + offline AI in pure Node.js — runs on Android"

**Reddit r/programming:**
> "I wrote an OS from scratch in Node.js. It has its own 32-bit CPU, kernel, filesystem, and AI personality — boots on a $50 phone."

**Reddit r/androiddev:**
> "Your Android phone is a pocket AI computer. No root, no internet, no Play Store. Just Termux + `node aos`."

**Reddit r/ollama:**
> "I integrated Ollama (TinyLlama/Phi3/Qwen) into a custom OS boot sequence. The AI is part of the kernel, not a plugin."

**Twitter/X (short):**
> "I built a full OS in Node.js that boots on your Android phone in 1 second. Zero dependencies. Offline AI built in. Just `node aos`."

**Dev.to (article title):**
> "Building an AI Operating System from Scratch in Node.js"

**ProductHunt:**
> Product: "AIOS Terminal" | Tagline: "A browser-based AI OS terminal — no install, runs anywhere"

### 7.3 What Screenshots/Videos to Create

To maximize sharing, create these media assets:

1. **Boot video** (30 sec): Screen recording on Android Termux — `./aos` → AI responding
2. **Demo GIF**: `cpu demo` running the Hello World program on the virtual CPU
3. **Architecture diagram**: Export the ASCII diagram above as a PNG
4. **Benchmark screenshot**: Show `npx jest --verbose` passing all 1400+ tests

### 7.4 GitHub Profile Optimization

1. Pin `AI-OS-vitural-CPU-OS` as your top repository
2. Add description: "AIOS — AI-native OS in Node.js | Custom virtual CPU | Boots on Android"
3. Add website URL to your profile
4. Add GitHub Topics to each repo (see section 8)

---

## 8. Maintenance Checklist

### Urgent To-Do (Do This Week)

- [ ] Go to https://github.com/Cbetts1/AIOS → Add file → Create `LICENSE` → Choose MIT
- [ ] Go to https://github.com/Cbetts1/Kernal- → Add file → Create `LICENSE` → Choose MIT
- [ ] Go to https://github.com/Cbetts1/Backend-file-system- → Settings → Danger Zone → Delete
- [ ] Go to https://github.com/Cbetts1/Files-system → Settings → Danger Zone → Delete

### Important (Do This Month)

- [ ] Add GitHub Topics to `AI-OS-vitural-CPU-OS`:  
  `operating-system`, `ai`, `nodejs`, `termux`, `android`, `virtual-cpu`, `ai-os`, `offline-ai`, `kernel`, `javascript`
- [ ] Add GitHub Topics to `AIOSCPU-PROTYPE` (same topics)
- [ ] Create a GitHub Release: `AI-OS-vitural-CPU-OS` → Releases → Draft new release → Tag: `v2.0.0`
- [ ] Write a proper README for `Os-layer` (currently only 21 bytes)
- [ ] Rename `NEW-ATTEMPT` to `AIOS-Kernel-C` (Settings → Repository name)
- [ ] Rename `Digtail-Web-CPU` to `Digital-Web-CPU` (fix the typo)
- [ ] Pin `AI-OS-vitural-CPU-OS` on your GitHub profile

### Growth (This Quarter)

- [ ] Publish `Kernal-` to npm: `npm publish --access public` (after adding license)
- [ ] Publish `Router` to npm: same process
- [ ] Deploy `Terminal` to Railway (free): https://railway.app → New → GitHub repo → Cbetts1/Terminal
- [ ] Create a `DEMO.gif` in this repo showing the OS booting
- [ ] Post "Show HN" to Hacker News: https://news.ycombinator.com/submit
- [ ] Post to Reddit r/programming and r/androiddev
- [ ] Create a YouTube video: "I Built a Full OS on My Android Phone"

---

## 9. Quick Reference Card

Save this. Everything you need in one box.

```
╔══════════════════════════════════════════════════════════════╗
║             AIOS QUICK REFERENCE — Chris Betts               ║
╠══════════════════════════════════════════════════════════════╣
║  BOOT:          node aos   (or: ./aos on Android/Linux)      ║
║  TESTS:         npx jest --verbose                           ║
║  TERMINAL:      node server/ (in Terminal repo)              ║
║  DOCKER:        docker run -p 3000:3000 aios-terminal        ║
╠══════════════════════════════════════════════════════════════╣
║  GITHUB:        https://github.com/Cbetts1                   ║
║  MAIN REPO:     AI-OS-vitural-CPU-OS                        ║
║  EMAIL:         chris.l.betts.1988@gmail.com                ║
╠══════════════════════════════════════════════════════════════╣
║  AIOS COMMANDS (once booted):                                ║
║    help          → all commands                              ║
║    cpu demo      → run virtual CPU demo                      ║
║    aios hello    → talk to AI personality                    ║
║    svc list      → list all services                         ║
║    ls /          → list root filesystem                      ║
╠══════════════════════════════════════════════════════════════╣
║  TERMUX (Android) EXTRAS:                                    ║
║    termux battery          → check phone battery             ║
║    termux notify "msg"     → send Android notification       ║
║    termux tts "say this"   → text-to-speech                  ║
╠══════════════════════════════════════════════════════════════╣
║  ARCHITECTURE IN ONE LINE:                                   ║
║  ./aos → kernel → [cpu + fs + router + svc + ai + terminal] ║
╚══════════════════════════════════════════════════════════════╝
```

---

*AIOS Master Handbook — Built by and for Chris Betts*  
*github.com/Cbetts1 | chris.l.betts.1988@gmail.com*
