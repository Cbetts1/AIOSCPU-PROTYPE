# Contributing to AIOSCPU Prototype One

Thank you for your interest in contributing to **AIOS Lite**!  
By contributing you agree to the terms in [`docs/LEGAL.md`](docs/LEGAL.md).

---

## Getting Started

```bash
# Clone the repo
git clone https://github.com/Cbetts1/AI-OS-vitural-CPU-OS.git
cd AI-OS-vitural-CPU-OS

# No npm install needed — zero external dependencies

# Run the OS
node aos
```

---

## How to Contribute

### Reporting Bugs

Open an issue at https://github.com/Cbetts1/AI-OS-vitural-CPU-OS/issues and include:

- A clear description of the bug
- Steps to reproduce it
- Expected vs actual behaviour
- Your Node.js version (`node --version`) and platform (Termux / Linux / macOS)

### Suggesting Features

Open an issue with the `[Feature Request]` prefix in the title.
Describe the feature, why it's useful, and how it fits the AIOS Lite design
philosophy (self-contained, offline, Termux-bootable).

### Submitting Pull Requests

1. Fork the repository
2. Create a branch: `git checkout -b feat/my-feature`
3. Make your changes following the conventions below
4. Test your changes: `node -e "require('./boot/boot.js')"` should load cleanly
5. Open a pull request against `main`

---

## Code Conventions

- **CommonJS only** — no ESM (`import`/`export`). All files use `require`/`module.exports`.
- **Zero external dependencies** — do not add npm packages. Use Node.js built-ins only.
- **`'use strict'`** at the top of every JS file.
- **Module interface** — every pluggable module must expose `{ name, start?, stop?, commands? }`.
- **Command handlers** always return `{ status: 'ok'|'error', result: string }`.
- **No `console.log`** in library code — use `kernel.syscall(1, [msg])` or `process.stdout.write`.

---

## Project Structure

```
core/       — OS modules (kernel, cpu, router, fs, services)
terminal/   — Interactive shell
boot/       — Boot orchestrator
docs/       — Specifications and guides
```

See [`docs/DEVELOPER.md`](docs/DEVELOPER.md) for a full developer guide.

---

## License

By submitting a contribution you agree that it will be licensed under the
[MIT License](LICENSE) and that you have read and agreed to [`docs/LEGAL.md`](docs/LEGAL.md).

---

*Copyright (c) 2026 Cbetts1*
