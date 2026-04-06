#!/data/data/com.termux/files/usr/bin/bash
# ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
# AIOS Termux Widget Shortcut
#
# How to use
# ──────────
#   1. Install Termux:Widget from F-Droid  (NOT the Play Store version)
#   2. Run:  node scripts/install-termux-widget.js
#      OR manually copy this file to ~/.shortcuts/AIOS.sh
#   3. Long-press your home screen → Widgets → Termux:Widget → AIOS
#   4. Tap the widget to boot AIOS in a Termux terminal
#
# What this does
# ──────────────
#   Opens a Termux session, changes to the AIOS project directory,
#   and boots the OS.  Termux IS the host bridge — AIOS runs entirely
#   inside Termux using it as the display and communication channel.
#
# ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

# Resolve the AIOS project root (set by the installer, or auto-detect)
AIOS_DIR="${AIOS_HOME:-__AIOS_DIR__}"

if [ ! -f "$AIOS_DIR/aos" ]; then
  echo "[AIOS] ERROR: Cannot find AIOS at: $AIOS_DIR"
  echo "       Re-run: node scripts/install-termux-widget.js"
  exit 1
fi

cd "$AIOS_DIR" || exit 1
exec node aos
