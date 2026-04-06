#!/usr/bin/env bash
# ============================================================
# AIOSCPU — Termux Installer  v1.0.0
# ============================================================
# Installs AIOSCPU on Android/Termux with all required deps.
# Usage:  bash termux-install.sh
# ============================================================
set -euo pipefail

REPO_URL="https://github.com/Cbetts1/AIOSCPU-PROTYPE"
INSTALL_DIR="${HOME}/aioscpu"
NODE_MIN_MAJOR=14

# ── Colours ─────────────────────────────────────────────────
R='\033[0;31m'; G='\033[0;32m'; Y='\033[0;33m'
B='\033[0;34m'; C='\033[0;36m'; W='\033[0m'

info()  { echo -e "${C}[INFO]${W}  $*"; }
ok()    { echo -e "${G}[ OK ]${W}  $*"; }
warn()  { echo -e "${Y}[WARN]${W}  $*"; }
fail()  { echo -e "${R}[FAIL]${W}  $*"; exit 1; }

# ── Banner ───────────────────────────────────────────────────
clear
echo -e "${B}╔══════════════════════════════════════════════════╗"
echo -e "║   AIOSCPU  ·  Termux Installer  ·  v1.0.0       ║"
echo -e "╚══════════════════════════════════════════════════╝${W}"
echo ""

# ── Check Termux ─────────────────────────────────────────────
if [[ ! -d "/data/data/com.termux" ]] && [[ "${AIOSCPU_FORCE:-0}" != "1" ]]; then
  warn "This script is designed for Termux on Android."
  warn "Set AIOSCPU_FORCE=1 to override and install anyway."
  fail "Not a Termux environment."
fi

# ── Update package list ──────────────────────────────────────
info "Updating package list..."
pkg update -y 2>/dev/null || apt-get update -y

# ── Install required packages ────────────────────────────────
info "Installing dependencies: nodejs, git, curl..."
pkg install -y nodejs git curl 2>/dev/null || \
  apt-get install -y nodejs git curl

# ── Verify Node.js version ───────────────────────────────────
NODE_MAJOR=$(node -p "parseInt(process.version.slice(1))" 2>/dev/null || echo "0")
if [[ "${NODE_MAJOR}" -lt "${NODE_MIN_MAJOR}" ]]; then
  fail "Node.js >= ${NODE_MIN_MAJOR} required. Found: $(node --version 2>/dev/null || echo 'none')"
fi
ok "Node.js $(node --version) detected"

# ── Clone or update repo ─────────────────────────────────────
if [[ -d "${INSTALL_DIR}/.git" ]]; then
  info "Existing installation found. Pulling latest..."
  cd "${INSTALL_DIR}" && git pull --ff-only
else
  info "Cloning AIOSCPU to ${INSTALL_DIR}..."
  git clone "${REPO_URL}" "${INSTALL_DIR}"
fi

cd "${INSTALL_DIR}"

# ── Install npm dependencies ─────────────────────────────────
info "Installing npm dependencies..."
npm install --production

# ── Create launcher alias ────────────────────────────────────
PROFILE="${HOME}/.bashrc"
if ! grep -q "alias aios=" "${PROFILE}" 2>/dev/null; then
  echo "" >> "${PROFILE}"
  echo "# AIOSCPU launcher" >> "${PROFILE}"
  echo "alias aios='node ${INSTALL_DIR}/aos'" >> "${PROFILE}"
  ok "Added 'aios' alias to ${PROFILE}"
fi

# ── Final message ─────────────────────────────────────────────
echo ""
echo -e "${G}╔══════════════════════════════════════════════════╗"
echo -e "║   AIOSCPU installed successfully!                ║"
echo -e "║                                                  ║"
echo -e "║   Run:  aios        (after restarting shell)     ║"
echo -e "║   Run:  node ~/aioscpu/aos                       ║"
echo -e "╚══════════════════════════════════════════════════╝${W}"
echo ""
info "Restart Termux or run: source ${PROFILE}"
