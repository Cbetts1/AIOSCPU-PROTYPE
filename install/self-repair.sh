#!/usr/bin/env bash
# ============================================================
# AIOSCPU — Self-Repair Script  v1.0.0
# ============================================================
# Detects and repairs common AIOSCPU installation issues.
# Run from the AIOSCPU installation directory.
# Usage:  bash install/self-repair.sh [--reinstall]
# ============================================================
set -euo pipefail

REINSTALL=0
INSTALL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

while [[ $# -gt 0 ]]; do
  case $1 in
    --reinstall) REINSTALL=1; shift ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

R='\033[0;31m'; G='\033[0;32m'; Y='\033[0;33m'
B='\033[0;34m'; C='\033[0;36m'; W='\033[0m'

info()  { echo -e "${C}[REPAIR]${W}  $*"; }
ok()    { echo -e "${G}[ FIX ]${W}  $*"; }
warn()  { echo -e "${Y}[WARN ]${W}  $*"; }
fail()  { echo -e "${R}[FAIL ]${W}  $*"; }
header(){ echo -e "${B}$*${W}"; }

header "╔══════════════════════════════════════════════════╗"
header "║   AIOSCPU  ·  Self-Repair  ·  v1.0.0             ║"
header "╚══════════════════════════════════════════════════╝"
echo ""
info "Installation directory: ${INSTALL_DIR}"
echo ""

ERRORS=0

# ── Check 1: package.json ─────────────────────────────────────
info "[1/6] Checking package.json..."
if [[ ! -f "${INSTALL_DIR}/package.json" ]]; then
  fail "package.json missing — installation may be corrupt"
  ERRORS=$((ERRORS + 1))
else
  ok "package.json found"
fi

# ── Check 2: node_modules ─────────────────────────────────────
info "[2/6] Checking node_modules..."
if [[ ! -d "${INSTALL_DIR}/node_modules" ]]; then
  warn "node_modules missing — running npm install..."
  cd "${INSTALL_DIR}" && npm install --production
  ok "npm install complete"
else
  ok "node_modules present"
fi

# ── Check 3: Core modules ─────────────────────────────────────
info "[3/6] Checking core modules..."
CORE_MODULES=("kernel.js" "cpu.js" "filesystem.js" "router.js" "service-manager.js" "ai-core.js")
for mod in "${CORE_MODULES[@]}"; do
  if [[ ! -f "${INSTALL_DIR}/core/${mod}" ]]; then
    fail "Missing core module: ${mod}"
    ERRORS=$((ERRORS + 1))
  fi
done
if [[ "${ERRORS}" -eq 0 ]]; then
  ok "All core modules present"
fi

# ── Check 4: Boot entry point ─────────────────────────────────
info "[4/6] Checking boot entry point (aos)..."
if [[ ! -f "${INSTALL_DIR}/aos" ]]; then
  fail "Entry point 'aos' missing"
  ERRORS=$((ERRORS + 1))
else
  ok "Entry point 'aos' found"
fi

# ── Check 5: Node.js syntax check ─────────────────────────────
info "[5/6] Running Node.js syntax checks..."
SYNTAX_ERRORS=0
for f in "${INSTALL_DIR}/core/"*.js "${INSTALL_DIR}/boot/"*.js "${INSTALL_DIR}/terminal/"*.js; do
  if [[ -f "${f}" ]]; then
    node --check "${f}" 2>/dev/null || {
      fail "Syntax error in: ${f}"
      SYNTAX_ERRORS=$((SYNTAX_ERRORS + 1))
      ERRORS=$((ERRORS + 1))
    }
  fi
done
if [[ "${SYNTAX_ERRORS}" -eq 0 ]]; then
  ok "All JS files pass syntax check"
fi

# ── Check 6: Quick smoke test ─────────────────────────────────
info "[6/6] Running quick smoke test..."
SMOKE_OUT=$(node -e "
  const { createKernel } = require('${INSTALL_DIR}/core/kernel.js');
  const k = createKernel(); k.boot();
  process.stdout.write(k.isBooted() ? 'OK' : 'FAIL');
" 2>/dev/null || echo "ERROR")
if [[ "${SMOKE_OUT}" == "OK" ]]; then
  ok "Kernel smoke test passed"
else
  fail "Kernel smoke test failed (output: ${SMOKE_OUT})"
  ERRORS=$((ERRORS + 1))
fi

# ── Reinstall if requested ────────────────────────────────────
if [[ "${REINSTALL}" == "1" ]]; then
  warn "Full reinstall requested. Re-running npm install..."
  cd "${INSTALL_DIR}"
  rm -rf node_modules package-lock.json
  npm install --production
  ok "Reinstall complete"
fi

# ── Summary ───────────────────────────────────────────────────
echo ""
if [[ "${ERRORS}" -eq 0 ]]; then
  echo -e "${G}╔══════════════════════════════════════════════════╗"
  echo -e "║   All checks passed. AIOSCPU is healthy.          ║"
  echo -e "╚══════════════════════════════════════════════════╝${W}"
  exit 0
else
  echo -e "${R}╔══════════════════════════════════════════════════╗"
  echo -e "║   ${ERRORS} issue(s) found. Try: bash install/self-repair.sh --reinstall"
  echo -e "╚══════════════════════════════════════════════════╝${W}"
  exit 1
fi
