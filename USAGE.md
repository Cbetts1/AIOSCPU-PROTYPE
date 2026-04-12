# AIOSCPU — Usage Guide

> **AIOS v4.0.0** · AI-Operated Software CPU  
> Interactive OS shell running inside Node.js · Boots in < 1 second

---

## Booting AIOS

```sh
node aos          # from the repo directory
# — or —
aios              # if you added the alias during install
```

You will see the AIOS boot banner, a status bar, and an interactive prompt:

```
╔══════════════════════════════════════════╗
║  AIOS UniKernel v3.0.0  — READY         ║
╚══════════════════════════════════════════╝
aios>
```

Type `help` for a full command reference.

---

## Command Reference

### Filesystem

```
pwd                        Print working directory
cd <path>                  Change directory
mkdir [-p] <path>          Create directory (with -p for parents)
ls [path]                  List directory contents
touch <path>               Create an empty file
cat <path>                 Read a file
write <path> <content>     Write content to a file
rm [-r] <path>             Remove file or directory
cp <src> <dst>             Copy file
mv <src> <dst>             Move / rename
stat <path>                Show file metadata
tree [path]                Recursive directory listing
```

---

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
sysreport                  Full system diagnostic report
```

---

### AIOSCPU (Virtual CPU)

```
cpu demo                   Run a Hello World program on the virtual CPU
cpu run <file>             Execute a binary image on the CPU
cpu info                   Show CPU register state
cpu bench                  Run a CPU benchmark
```

---

### AI (AIOS / AURA Personality Kernel)

```
aios                       Show AIOS personality status
aios <question>            Ask AIOS a question (uses local LLM)
aios clear                 Clear AIOS conversation history

aura                       Show AURA hardware intelligence status
aura start                 Start the AURA on-demand AI service
aura stop                  Stop AURA
aura <question>            Ask AURA a hardware/system question
```

---

### AI Mesh (7-agent distributed brain)

```
mesh                       Show all 7 AI agent statuses
mesh status                Same as above
mesh refresh               Re-discover loaded models
mesh help                  Show mesh help
mesh <question>            Route question to the best agent
```

---

### Builder Engine (module/script generator)

```
build                      Show builder status
build status               Same as above
build module <name>        Scaffold a new core module
build test <name>          Generate a Jest test stub
build script <name>        Generate a POSIX shell script
build config <name>        Generate a service config JSON
build list                 List all generated artefacts
build help                 Show builder help
```

---

### Command Center (virtual-network node agent)

```
cc                         Show Command Center agent status
cc status                  Same as above
cc register                Register this node with the Command Center
cc heartbeat               Send a heartbeat now
cc sync                    Push a state snapshot to the Command Center
cc peers                   List known sibling nodes
cc disconnect              Stop heartbeat and unregister
```

---

### Services

```
svc list                   List all registered services
svc start <name>           Start a service
svc stop <name>            Stop a service
svc restart <name>         Restart a service
svc status <name>          Show service status
```

---

### Upgrade Manager

```
upgrade                    Show full upgrade plan and status
upgrade status             Current component versions
upgrade plan               Recommended upgrades
upgrade history            Log of applied upgrades
upgrade check              Run self-check against upgrade plan
upgrade model <name>       Pull an Ollama AI model
upgrade config <k> <v>     Set a runtime config value
```

---

### Diagnostics & Health

```
diag                       Show diagnostics dashboard
diag report                Full system health report
diag ports                 Show registered port monitors
diag models                Show registered model monitors

health                     Show health monitor status
```

---

### Models

```
models                     List all AI models
models scan                Scan for available Ollama models
models refresh             Refresh the model registry
```

---

### Mode Manager

```
mode                       Show current operating mode
mode set <name>            Switch operating mode
```

Available modes: `chat`, `code`, `fix`, `help`, `learn`

---

### Memory & Learning

```
memory                     Show memory engine stats
memory log [n]             Show last N memory entries (default 10)
memory recall <query>      Search memory for relevant entries
memory clear               Clear all stored interactions

collective                 Show collective-intelligence stats
collective log             Show recent cross-model perspectives
collective recall <q>      Surface perspectives on a topic
```

---

### Port Server (HTTP API)

AIOS exposes an HTTP API on port 4000 (or `$AIOS_PORT`).

```sh
# Start the port server from inside AIOS:
port start

# From another terminal / device:
curl http://localhost:4000/status
curl http://localhost:4000/models
curl -X POST http://localhost:4000/ai -H 'Content-Type: application/json' \
     -d '{"input":"what is 2+2?"}'
curl -X POST http://localhost:4000/command -H 'Content-Type: application/json' \
     -d '{"command":"uptime"}'
```

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/` | GET | Welcome + version |
| `/status` | GET | Full JSON system status |
| `/report` | GET | Diagnostics report |
| `/models` | GET | Model registry |
| `/ai` | POST | Route to AI (`{input, mode}`) |
| `/command` | POST | Execute command (`{command}`) |

---

### Miscellaneous

```
clear                      Clear the terminal screen
echo <text>                Print text
history                    Show command history
help                       Show the full interactive help window
exit                       Shut down AIOS gracefully
```

---

## Virtual Network Quickstart

AIOS is designed to work as a **node in a virtual network of repos**.
Each AIOS instance has a unique identity and can communicate with a central
Command Center.

```sh
# 1. Configure (before boot, or at runtime)
export AIOS_CC_URL=http://your-cc-server:5000
export AIOS_CC_TOKEN=my-shared-secret

# 2. Boot
node aos

# 3. Inside AIOS shell
cc register     # register this node
cc status       # confirm registration
cc peers        # see other nodes in the network
```

The Command Center receives:
- Node registration (identity, capabilities, arch)
- Periodic heartbeats with memory/uptime/service status
- State snapshots on demand
- Command results when remote commands are dispatched

---

## Module Self-Expansion

AIOS can generate and load new modules at runtime using the Builder Engine:

```sh
# Inside AIOS
build module my-sensor     # generates core/my-sensor.js in VFS
build test my-sensor       # generates a Jest test stub
build script daily-backup  # generates a Termux-safe shell script
build config my-sensor     # generates a service config JSON
```

Generated artefacts are written to:
- **VFS**: `/var/lib/aios/builder/`
- **Host FS**: `~/.aios/builder/`

---

## Configuration

AIOS reads configuration from environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `AIOS_PORT` | `4000` | HTTP API port |
| `AIOS_CC_URL` | `http://localhost:5000` | Command Center URL |
| `AIOS_CC_TOKEN` | _(empty)_ | Bearer token for CC auth |
| `AIOS_CC_INTERVAL` | `30000` | Heartbeat interval (ms) |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama server URL |
| `LLAMA_HOST` | `http://localhost:8080` | llama.cpp server URL |

---

## Further Reading

| Document | Description |
|----------|-------------|
| [README.md](README.md) | Project overview and quick start |
| [INSTALL.md](INSTALL.md) | Full installation guide |
| [docs/API-REFERENCE.md](docs/API-REFERENCE.md) | HTTP API reference |
| [docs/DEVELOPER.md](docs/DEVELOPER.md) | Developer guide |
| [docs/OPERATOR.md](docs/OPERATOR.md) | Operator / production guide |
| [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Common issues and fixes |
| [MASTER-HANDBOOK.md](MASTER-HANDBOOK.md) | Complete system handbook |

---

*AIOSCPU is open-source software released under the MIT License.*
