# AIOSCPU — Installation Guide

> **AIOS v4.0.0** · AI-Operated Software CPU  
> Runs on Android (Termux), Linux, macOS, Windows · Zero native dependencies

---

## One-Command Install (Termux / Android)

Open Termux and run:

```sh
curl -fsSL https://raw.githubusercontent.com/Cbetts1/AI-OS-vitural-CPU-OS/main/install/termux-install.sh | bash
```

Then start AIOS:

```sh
aios
```

---

## Step-by-Step Install

### Requirements

| Requirement | Version |
|-------------|---------|
| Node.js     | ≥ 14.0.0 |
| Git         | any recent |
| Termux      | ≥ 0.118 (Android) |
| Storage     | ≈ 50 MB |
| RAM         | ≈ 128 MB minimum |

No root, no sudo, no Docker, no virtualization required.

---

### On Android (Termux) — Recommended

```sh
# 1. Update package list and install dependencies
pkg update && pkg install -y nodejs git curl

# 2. Clone the repository
git clone https://github.com/Cbetts1/AI-OS-vitural-CPU-OS.git ~/aioscpu
cd ~/aioscpu

# 3. Install Node.js development dependencies (optional, for tests)
npm install

# 4. Boot AIOS
node aos
# — or —
chmod +x aos && ./aos
```

#### Add a permanent launch alias

```sh
echo "alias aios='node ~/aioscpu/aos'" >> ~/.bashrc
source ~/.bashrc
aios
```

#### Termux Widget (one-tap launch from your home screen)

```sh
# Install the Termux:Widget app from F-Droid or Play Store first, then:
node ~/aioscpu/scripts/install-termux-widget.js
```

---

### On Linux / macOS / WSL

```sh
git clone https://github.com/Cbetts1/AI-OS-vitural-CPU-OS.git
cd AI-OS-vitural-CPU-OS
node aos
```

---

### On Windows (PowerShell)

```powershell
git clone https://github.com/Cbetts1/AI-OS-vitural-CPU-OS.git
cd AI-OS-vitural-CPU-OS
node aos
```

---

## Optional: AI Model Support

AIOS runs fully offline without any AI models. To enable the AI layer, install
one of the supported backends:

### Option A — Ollama (easiest, desktop/server)

```sh
# Install Ollama from https://ollama.com
ollama serve &
ollama pull qwen2:0.5b   # smallest — 394 MB, works on most phones
```

### Option B — llama.cpp (best for mobile, remote offload)

```sh
# Build llama.cpp: https://github.com/ggerganov/llama.cpp
# Download a GGUF model, then:
llama-server -m qwen2-0.5b.gguf --port 8080

# To offload all AI work to a home server/PC:
export LLAMA_HOST=http://192.168.1.100:8080
```

> **Phone tip:** Start with `qwen2:0.5b` (394 MB) or `tinyllama` (637 MB) —
> both run on entry-level Android devices.

---

## Optional: Command Center (virtual-network orchestration)

AIOS can register with a remote Command Center to join a virtual network of repos.
Set environment variables before boot:

```sh
export AIOS_CC_URL=http://your-command-center:5000
export AIOS_CC_TOKEN=your-secret-token
node aos
```

Then from inside AIOS:

```
cc status      # show registration status
cc register    # force re-register
cc peers       # list sibling nodes
```

---

## Self-Repair

If AIOS fails to start, run the self-repair script:

```sh
bash ~/aioscpu/install/self-repair.sh
```

---

## Update

```sh
cd ~/aioscpu
git pull --ff-only
npm install
```

---

## Uninstall

```sh
rm -rf ~/aioscpu ~/.aios
# Remove alias from ~/.bashrc if added
```

---

## Verify Installation

```sh
cd ~/aioscpu
npm test       # runs all 1500+ unit tests
node aos       # boots AIOS interactive shell
```

---

## Troubleshooting

See [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) for a full list of
common issues and fixes.

| Symptom | Fix |
|---------|-----|
| `node: not found` | `pkg install nodejs` in Termux |
| `Cannot find module` | `npm install` in the repo dir |
| Terminal shows no color | Run from inside Termux, not SSH |
| AI queries return "offline" | Install Ollama or llama.cpp (optional) |
| CC registration fails | Set `AIOS_CC_URL` or leave blank for standalone mode |

---

*AIOSCPU is an open-source project licensed under the MIT License.*  
*See [LICENSE](LICENSE) and [DISCLAIMER.md](DISCLAIMER.md) for full details.*
