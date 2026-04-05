#!/usr/bin/env bash
# ============================================================
# AIOSCPU — Desktop Installer  v1.0.0
# ============================================================
# Installs AIOSCPU on Linux / macOS / Windows (WSL) desktops.
# Usage:  bash desktop-install.sh [--dir <path>] [--no-alias]
# ============================================================
set -euo pipefail

REPO_URL="https://github.com/Cbetts1/AIOSCPU-PROTYPE"
INSTALL_DIR="${HOME}/.local/share/aioscpu"
NODE_MIN_MAJOR=14
CREATE_ALIAS=1

# ── Parse args ───────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case $1 in
    --dir)     INSTALL_DIR="$2"; shift 2 ;;
    --no-alias) CREATE_ALIAS=0; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ── Colours ─────────────────────────────────────────────────
R='\033[0;31m'; G='\033[0;32m'; Y='\033[0;33m'
B='\033[0;34m'; C='\033[0;36m'; W='\033[0m'

info()  { echo -e "${C}[INFO]${W}  $*"; }
ok()    { echo -e "${G}[ OK ]${W}  $*"; }
warn()  { echo -e "${Y}[WARN]${W}  $*"; }
fail()  { echo -e "${R}[FAIL]${W}  $*"; exit 1; }

# ── Banner ───────────────────────────────────────────────────
echo ""
echo -e "${B}╔══════════════════════════════════════════════════╗"
echo -e "║   AIOSCPU  ·  Desktop Installer  ·  v1.0.0       ║"
echo -e "╚══════════════════════════════════════════════════╝${W}"
echo ""

# ── Detect OS ────────────────────────────────────────────────
OS="$(uname -s)"
info "Detected OS: ${OS}"

# ── Check Node.js ────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  fail "Node.js not found. Install it from https://nodejs.org/ (>= v${NODE_MIN_MAJOR})"
fi
NODE_MAJOR=$(node -p "parseInt(process.version.slice(1))" 2>/dev/null || echo "0")
if [[ "${NODE_MAJOR}" -lt "${NODE_MIN_MAJOR}" ]]; then
  fail "Node.js >= ${NODE_MIN_MAJOR} required. Found: $(node --version)"
fi
ok "Node.js $(node --version) detected"

# ── Check git ────────────────────────────────────────────────
if ! command -v git &>/dev/null; then
  fail "git not found. Install git and re-run this script."
fi

# ── Clone or update ──────────────────────────────────────────
if [[ -d "${INSTALL_DIR}/.git" ]]; then
  info "Existing installation found at ${INSTALL_DIR}. Updating..."
  cd "${INSTALL_DIR}" && git pull --ff-only
else
  info "Installing AIOSCPU to ${INSTALL_DIR}..."
  mkdir -p "$(dirname "${INSTALL_DIR}")"
  git clone "${REPO_URL}" "${INSTALL_DIR}"
fi

cd "${INSTALL_DIR}"

# ── Install npm dependencies ─────────────────────────────────
info "Installing npm dependencies..."
npm install --production

# ── Create launcher ──────────────────────────────────────────
LAUNCHER="${HOME}/.local/bin/aios"
mkdir -p "$(dirname "${LAUNCHER}")"
cat > "${LAUNCHER}" <<EOF
#!/usr/bin/env bash
exec node "${INSTALL_DIR}/aos" "\$@"
EOF
chmod +x "${LAUNCHER}"
ok "Launcher created: ${LAUNCHER}"

# ── Shell alias ──────────────────────────────────────────────
if [[ "${CREATE_ALIAS}" == "1" ]]; then
  for PROFILE in "${HOME}/.bashrc" "${HOME}/.zshrc" "${HOME}/.profile"; do
    if [[ -f "${PROFILE}" ]] && ! grep -q "alias aios=" "${PROFILE}" 2>/dev/null; then
      echo "" >> "${PROFILE}"
      echo "# AIOSCPU — add launcher to PATH" >> "${PROFILE}"
      echo 'export PATH="${HOME}/.local/bin:${PATH}"' >> "${PROFILE}"
      ok "Updated PATH in ${PROFILE}"
      break
    fi
  done
fi

# ── Desktop shortcut (Linux only) ───────────────────────────
if [[ "${OS}" == "Linux" ]] && [[ -d "${HOME}/.local/share/applications" ]]; then
  cat > "${HOME}/.local/share/applications/aioscpu.desktop" <<EOF
[Desktop Entry]
Name=AIOSCPU
Comment=AI-Operated Software CPU — AIOS Lite
Exec=bash -c "node ${INSTALL_DIR}/aos"
Icon=${INSTALL_DIR}/branding/logo.txt
Type=Application
Categories=Development;System;
Terminal=true
EOF
  ok "Desktop shortcut created"
fi

# ── Final message ─────────────────────────────────────────────
echo ""
echo -e "${G}╔══════════════════════════════════════════════════╗"
echo -e "║   AIOSCPU installed successfully!                ║"
echo -e "║                                                  ║"
echo -e "║   Run:  aios        (new terminal)               ║"
echo -e "║   Run:  node ${INSTALL_DIR}/aos${W}${G}"
echo -e "╚══════════════════════════════════════════════════╝${W}"
echo ""
