# Legal Information — AIOSCPU v2.0.0

**Project:** AIOSCPU — AI-Operated Software CPU (AIOS Lite)  
**Version:** 2.0.0  
**Owner:** Cbetts1  
**Repository:** https://github.com/Cbetts1/AI-OS-vitural-CPU-OS  
**Date:** 2026

---

## 1. Copyright

```
Copyright (c) 2026 Cbetts1. All rights reserved.
```

All source code, documentation, architecture designs, specifications, and other
materials in this repository are protected by copyright law. Unauthorized
reproduction or distribution of this work, or any portion of it, may result in
civil and criminal penalties.

The full copyright notice must be preserved in all copies or substantial portions
of the Software, as required by the MIT License included in this repository.

---

## 2. License

This project is licensed under the **MIT License**.

> Permission is hereby granted, free of charge, to any person obtaining a copy
> of this software and associated documentation files (the "Software"), to deal
> in the Software without restriction, including without limitation the rights
> to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
> copies of the Software, and to permit persons to whom the Software is
> furnished to do so, subject to the following conditions:
>
> The above copyright notice and this permission notice shall be included in all
> copies or substantial portions of the Software.

See the [`LICENSE`](../LICENSE) file for the full license text.

### What you CAN do under MIT

- ✅ Use this software for personal or commercial projects
- ✅ Copy, modify, and distribute the source code
- ✅ Include this software in your own open-source or proprietary projects
- ✅ Sublicense this software
- ✅ Use privately without publishing changes

### What you MUST do under MIT

- 📋 Include the original `LICENSE` file and copyright notice in all copies or
  substantial portions of the software

### What you CANNOT do under MIT

- ❌ Hold the author (Cbetts1) liable for damages
- ❌ Use the author's name to endorse your product without permission
- ❌ Remove the copyright notice from source files

---

## 3. Intellectual Property

### 3.1 Original Inventions

The following are original works created by **Cbetts1** and are protected as
intellectual property:

| Item | Description |
|------|-------------|
| **AIOSCPU ISA v1.0** | Original instruction set architecture for a software-emulated 32-bit CPU, including opcode table, register layout, memory model, syscall convention, and flag system |
| **AIOS Kernel** | Original software kernel design with event bus, process table, hot-swap module registry, and syscall dispatch table |
| **AIOS Router** | Original command routing architecture with plug-and-play module mounting |
| **AIOS VFS** | Original in-memory virtual filesystem with POSIX-style API |
| **AIOS Service Manager** | Original service lifecycle management system |
| **AIOS Boot Protocol** | Original ordered boot sequence for software-layer OS initialization |
| **CPU–Kernel Handshake** | Original protocol connecting the AIOSCPU `SYSCALL` instruction to the OS kernel syscall table |
| **AIOS Lite Architecture** | Overall system architecture — the design of a self-hosted, portable, Termux-bootable operating system driven by a software CPU |

### 3.2 Names and Branding

The following names are original creations of Cbetts1:

- **AIOSCPU** — the virtual CPU and its ISA
- **AIOS Lite** — the lightweight variant of the AIOS operating system
- **AIOS Prototype One** — the first working prototype release
- **AIOS** — the broader AI-native operating system project

These names are not currently registered trademarks. All rights to these names
are reserved by Cbetts1.

### 3.3 Source Repository Ownership

All source repositories merged into this project
(see [`NOTICE`](../NOTICE) for the full list) are original work authored and
owned by Cbetts1. No external third-party code was incorporated.

---

## 4. Disclaimer of Warranty

> THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
> FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
> AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
> LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
> OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
> SOFTWARE.

This software is a prototype. It is provided for educational, experimental, and
development purposes. It is not intended for safety-critical, life-critical, or
production applications without additional testing and validation.

---

## 5. Third-Party Notices

This project has **no runtime npm dependencies**.

The only external runtime requirement is **Node.js**, which is licensed under
its own MIT-compatible license:

- Node.js License: https://github.com/nodejs/node/blob/main/LICENSE
- Node.js is not bundled in this repository

All Node.js built-in modules used (`readline`, `crypto`, `os`, `path`) are
part of the Node.js standard library and fall under the Node.js license.

---

## 6. Contributions

By submitting a pull request or contribution to this repository, you agree that:

1. Your contribution is your own original work or you have the right to submit it.
2. You grant Cbetts1 a perpetual, worldwide, non-exclusive, royalty-free license
   to use, reproduce, modify, and distribute your contribution as part of this
   project.
3. Your contribution will be licensed under the same MIT License as this project.

See [`CONTRIBUTING.md`](../CONTRIBUTING.md) for contribution guidelines.

---

## 8. Pre-Commercial & Prototype Status

AIOSCPU v2.0.0 is currently a **pre-commercial prototype**. It has not undergone:

- Formal third-party security auditing
- Regulatory compliance review (GDPR, CCPA, HIPAA, etc.)
- Certification for safety-critical or production environments

**Before commercializing** this software as part of a paid product or service,
the owner (Cbetts1) should consider:

1. **Trademark Registration** — File "AIOSCPU" and "AIOS Lite" with the USPTO
   (Class 9 — Computer Software) and internationally via the Madrid Protocol.
   Filing fee: approx. $250–$400 per class per jurisdiction.

2. **Commercial License Option** — The MIT license permits all users to
   redistribute the software freely (including competitors). For commercial
   exclusivity, consider a **dual-license model**: MIT for open-source/community
   use; a paid commercial license for embedded/enterprise/OEM use.

3. **Privacy Policy** — If any networked features are enabled (port-server,
   remote-mesh, Ollama integration), a Privacy Policy may be required by law in
   the US, EU, and other jurisdictions.

4. **Export Controls** — Software containing cryptographic functions (`crypto`
   module usage) may be subject to US Export Administration Regulations (EAR).
   AIOSCPU uses Node.js's built-in `crypto` for hashing only; this is generally
   exempt, but verify with an attorney before export.

5. **Name Conflict Check** — "AIOS" is used by third-party mobile AI assistants.
   "AIOSCPU" appears to be distinctive. A trademark attorney search is recommended
   before registration.

---

## 9. Contact

For licensing inquiries, permissions beyond the scope of the MIT License, or
IP-related questions, open an issue on the GitHub repository:

**https://github.com/Cbetts1/AI-OS-vitural-CPU-OS/issues**

---

*AIOSCPU — AI-Operated Software CPU · AIOS Lite v2.0.0*  
*Copyright (c) 2026 Cbetts1. All rights reserved.*

