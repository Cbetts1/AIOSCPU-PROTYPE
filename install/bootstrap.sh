#!/usr/bin/env bash
# ============================================================
# AIOSCPU — One-Shot Bootstrap  v1.0.0
# ============================================================
# Single command to fetch and run the correct installer.
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/Cbetts1/AI-OS-vitural-CPU-OS/main/install/bootstrap.sh | bash
#   wget -qO- ...same URL... | bash
# ============================================================
set -euo pipefail

REPO_RAW="https://raw.githubusercontent.com/Cbetts1/AI-OS-vitural-CPU-OS/main/install"
TERMUX_SCRIPT="${REPO_RAW}/termux-install.sh"
DESKTOP_SCRIPT="${REPO_RAW}/desktop-install.sh"

R='\033[0;31m'; G='\033[0;32m'; Y='\033[0;33m'
B='\033[0;34m'; C='\033[0;36m'; W='\033[0m'

info() { echo -e "${C}[BOOTSTRAP]${W}  $*"; }
ok()   { echo -e "${G}[BOOTSTRAP]${W}  $*"; }
fail() { echo -e "${R}[BOOTSTRAP]${W}  $*"; exit 1; }

echo ""
echo -e "${B}╔══════════════════════════════════════════════════╗"
echo -e "║   AIOSCPU  ·  Bootstrap  ·  v1.0.0               ║"
echo -e "╚══════════════════════════════════════════════════╝${W}"
echo ""

# ── Pick downloader ──────────────────────────────────────────
if command -v curl &>/dev/null; then
  FETCH="curl -fsSL"
elif command -v wget &>/dev/null; then
  FETCH="wget -qO-"
else
  fail "Neither curl nor wget found. Install one and re-run."
fi

# ── Detect environment ───────────────────────────────────────
if [[ -d "/data/data/com.termux" ]]; then
  info "Termux environment detected. Running Termux installer..."
  bash <(${FETCH} "${TERMUX_SCRIPT}")
else
  info "Desktop environment detected. Running desktop installer..."
  bash <(${FETCH} "${DESKTOP_SCRIPT}")
fi
