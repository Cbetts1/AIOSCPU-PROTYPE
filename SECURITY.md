# Security Policy — AIOSCPU v2.0.0

**Project:** AIOSCPU — AI-Operated Software CPU  
**Maintainer:** Cbetts1  
**Repository:** https://github.com/Cbetts1/AI-OS-vitural-CPU-OS  

---

## Supported Versions

| Version | Security Support |
|---------|-----------------|
| 2.0.x   | ✅ Active        |
| 1.x.x   | ❌ End-of-life   |

---

## Reporting a Vulnerability

**Please do NOT report security vulnerabilities through public GitHub issues.**

If you discover a security vulnerability in AIOSCPU, report it privately:

1. **Open a GitHub Security Advisory** (preferred):  
   Go to https://github.com/Cbetts1/AI-OS-vitural-CPU-OS/security/advisories/new  
   and submit the details there. This keeps the report private until a fix is deployed.

2. **Alternatively**, open a regular issue and mark it **[SECURITY]** in the title
   if the GitHub advisory feature is unavailable. Cbetts1 will respond and request
   a private channel.

Please include:
- A description of the vulnerability
- Steps to reproduce
- Potential impact
- Any suggested fix (optional but appreciated)

---

## Response Timeline

| Stage | Target |
|-------|--------|
| Initial acknowledgment | Within 72 hours |
| Severity assessment | Within 7 days |
| Patch released (critical/high) | Within 30 days |
| Patch released (medium/low) | Best effort |
| Public disclosure | After patch is available |

---

## Security Design of AIOSCPU

### Offline-First Architecture
AIOSCPU runs fully offline by default. The kernel, CPU emulator, filesystem,
and service manager have **no network exposure** unless you explicitly start a
`port-server` or configure remote mesh networking.

### No External Runtime Dependencies
Zero npm production dependencies. The attack surface from the supply chain is
minimal — only `jest` (dev-only) is an external package.

### Sandboxed Virtual Hardware
All hardware is emulated in software. The virtual CPU (AIOSCPU), VHAL, VROM,
VRAM, VMEM, and VDISPLAY have no direct access to physical hardware or the host
OS filesystem (except through the deliberate `host-bridge.js` interface).

### Known Limitations (Prototype Status)
- AIOSCPU is a **prototype** — it has not undergone a formal third-party security audit.
- The Termux integration (`termux-bridge.js`) executes shell commands via `child_process`.
  Inputs passed to this bridge from untrusted sources could lead to command injection.
  **Do not expose the AIOS shell to untrusted network users without additional hardening.**
- The Ollama/LLM integration (`aios-aura.js`, `jarvis-orchestrator.js`) communicates
  with local HTTP endpoints. Ensure those endpoints are bound to `localhost` only.

---

## Scope

| Component | In Scope |
|-----------|----------|
| `core/kernel.js` | ✅ |
| `core/cpu.js` | ✅ |
| `core/filesystem.js` | ✅ |
| `core/termux-bridge.js` | ✅ |
| `core/permission-system.js` | ✅ |
| `core/port-server.js` | ✅ |
| `core/remote-mesh.js` | ✅ |
| `boot/` scripts | ✅ |
| `install/` scripts | ✅ |
| Test files only (`tests/`) | ❌ |
| Documentation files only | ❌ |

---

## Credit

Security researchers who responsibly disclose vulnerabilities will be credited
in the `CHANGELOG.md` and `NOTICE` file with their permission.

---

*Copyright (c) 2026 Cbetts1. All rights reserved.*
