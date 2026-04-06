# AIOSCPU Troubleshooting Guide  v1.0.0

> **Quick diagnostic reference for operators and developers.**

---

## Table of Contents

1. [Startup Issues](#1-startup-issues)
2. [AI / Ollama Issues](#2-ai--ollama-issues)
3. [Kernel Issues](#3-kernel-issues)
4. [CPU Issues](#4-cpu-issues)
5. [Filesystem Issues](#5-filesystem-issues)
6. [Service Issues](#6-service-issues)
7. [Networking Issues](#7-networking-issues)
8. [Test Failures](#8-test-failures)
9. [Performance](#9-performance)
10. [Self-Repair Procedure](#10-self-repair-procedure)

---

## 1. Startup Issues

### `Cannot find module 'xxx'`

**Cause:** `node_modules` missing or corrupted.

**Fix:**
```bash
cd /path/to/aioscpu
npm install
```

### `Error: Node.js version too old`

**Cause:** Node.js < 14.

**Fix:**
```bash
# Termux
pkg install nodejs
# Desktop — install from https://nodejs.org/
```

### `EADDRINUSE: address already in use`

**Cause:** Port server port is in use.

**Fix:** Edit `etc/aios/services/*.json` and change the port number, or kill the conflicting process:
```bash
lsof -ti:<port> | xargs kill -9
```

### Splash screen shows but hangs

**Cause:** A service is timing out during initialization.

**Fix:**
1. Check service definitions: `etc/aios/services/*.json`
2. Try running with a short timeout: `AIOS_SVC_TIMEOUT=5000 node aos`

---

## 2. AI / Ollama Issues

### AI returns "offline" or empty responses

**Cause:** Ollama is not running or has no models.

**Fix:**
```bash
ollama serve                     # Start Ollama daemon
ollama pull qwen2:0.5b           # Pull smallest model
ollama list                      # Verify model is listed
```

### `AURA` not available

**Cause:** AURA is on-demand and must be started explicitly.

**Fix:**
```bash
# In AIOS terminal:
svc start aura
aura status
```

### Context lost between sessions

**Cause:** `/var/lib/aios/ai-context.json` not persisted to disk.

**Fix:**
```bash
# Enable persistent FS:
fs persistTo /data/aios-snapshot.json
fs loadFrom  /data/aios-snapshot.json   # on next boot
```

### Model switching not working

**Cause:** Requested model not available in Ollama.

**Fix:**
```bash
ollama list                     # List available models
ollama pull <model-name>        # Pull missing model
```

---

## 3. Kernel Issues

### Kernel panic: `Circular dependency detected`

**Cause:** Two modules each depend on each other via `depGraph`.

**Fix:** Review module dependency registrations in `boot/bootstrap.js`. Remove circular references.

### `kernel.assert()` throws unexpectedly

**Cause:** A condition that should be true is false — indicates a logic error.

**Fix:** Check the assertion message in the stack trace. The `code` field on the error maps to `ERROR_CODES`.

### Event bus handlers throwing silently

**Cause:** Errors in `bus.on()` handlers are caught and written to `stderr`, not thrown.

**Fix:** Monitor `process.stderr` or add explicit error handling in event handlers.

---

## 4. CPU Issues

### `RangeError: AIOSCPU: Memory read out of bounds`

**Cause:** A program attempted to read/write outside the 64 KB memory space.

**Fix:** Check LOAD/STORE addresses in your program. Valid range: `0x0000–0xFFFF`.

### CPU halts immediately

**Cause:** Program array is empty, or first instruction is `HALT`.

**Fix:** Verify `loadProgram()` receives a non-empty array with valid instruction objects.

### `Stack overflow` / `Stack underflow`

**Cause:** Too many CALL/PUSH operations (overflow) or too many RET/POP (underflow).

**Fix:** Balance CALL/RET and PUSH/POP. Stack is limited to 256 bytes (0x0100–0x01FF).

### CPU self-test failures

**Cause:** CPU module corruption or code change broke an instruction.

**Fix:**
```javascript
const { createCPU } = require('./core/cpu');
const cpu = createCPU();
const result = cpu.selfTest();
console.log(result);
```

All 10 assertions should pass. Failed assertion names will be in `result.results`.

---

## 5. Filesystem Issues

### `read: no such file: /path/to/file`

**Cause:** Path does not exist in the in-memory VFS.

**Fix:** Use `fs.stat('/path')` to check existence. Use `fs.mkdir` to create directories.

### `fsck` reports errors

**Cause:** Internal VFS consistency error (very rare).

**Fix:**
```javascript
const result = fs.fsck('/');
console.log(result.errors);  // List specific paths with issues
```

If you have a valid snapshot, restore it:
```javascript
fs.restore(savedSnapshot);
```

### Writes not persisted across restarts

**Cause:** The VFS is in-memory. Persistence requires explicit snapshots.

**Fix:**
```javascript
// Save before exit:
fs.persistTo('/data/aios-fs.json');

// Load on boot:
fs.loadFrom('/data/aios-fs.json');
```

### `mount: cannot create mount point`

**Cause:** Parent directory of mount point doesn't exist.

**Fix:** Create the mount point directory first:
```javascript
fs.mkdir('/mnt', { parents: true });
fs.mount('/mnt/data', 'vda1');
```

---

## 6. Service Issues

### Service won't start

**Checklist:**
1. Is the service registered? `svcMgr.list()`
2. Does it have a valid `start()` function?
3. Is a required dependency (port, network, AI) unavailable?

**Fix:**
```bash
svc status <name>
svc restart <name>
```

### Service crashes repeatedly

**Cause:** The service function throws and the service manager auto-restarts it.

**Fix:**
1. Check kernel bus events: listen to `service:crash` events
2. Check error logs for the service
3. Inspect the service definition in `etc/aios/services/`

### `service-manager: service not found`

**Cause:** Service name typo, or service not registered at boot.

**Fix:** Check registration in `boot/bootstrap.js` or `boot/init.js`.

---

## 7. Networking Issues

### Port server not accepting connections

**Cause:** Port server hasn't started, or port is in use.

**Fix:**
```bash
svc start port-server
svc status port-server
```

### Remote mesh connection failing

**Cause:** Remote peer not reachable or mesh not started.

**Fix:**
```javascript
const mesh = remoteMesh.getStatus();
console.log(mesh);
```

### `ECONNREFUSED` on health monitor endpoints

**Cause:** The HTTP endpoint being monitored is offline.

**Expected:** The health monitor emits `health:endpoint:down` and retries — this is normal behavior.

---

## 8. Test Failures

### Running tests

```bash
npm test                  # Run all tests
npx jest tests/kernel.test.js --verbose   # Single test file
npx jest --detectOpenHandles              # Find timer leaks
```

### `A worker process has failed to exit gracefully`

**Cause:** A timer or interval is not being cleared in a test's `afterEach`/`afterAll`.

**Fix:** Ensure all `setInterval`/`setTimeout` handles are cleared. Call `stop()` methods on status-bar, health-monitor, etc.

### Tests import errors

**Cause:** A required module path changed.

**Fix:** Check the `require()` paths at the top of the failing test file.

---

## 9. Performance

### High memory usage

**Cause:** AI context or memory engine storing too many entries.

**Fix:**
```javascript
// Clear AI context
aiosAura.clearHistory();

// Check memory engine size
const stats = memEngine.getStats();
```

### Slow startup

**Cause:** Many services initializing synchronously.

**Fix:** Services are initialized sequentially by default. For faster boot, consider reducing the number of enabled services in `etc/aios/services/`.

### CPU cycle limit hit

**Cause:** A CPU program ran for more than 10,000,000 cycles.

**Fix:** Check for infinite loops. Increase `MAX_CYCLES` in `core/cpu.js` if needed for intentionally long programs.

---

## 10. Self-Repair Procedure

Run the self-repair script for automated diagnostics:

```bash
bash install/self-repair.sh
```

This checks:
1. `package.json` present
2. `node_modules` present (reinstalls if missing)
3. All core modules present
4. `aos` entry point present
5. JS syntax check on all core files
6. Kernel smoke test

For a full reinstall:

```bash
bash install/self-repair.sh --reinstall
```

For a clean reinstall from scratch:

```bash
rm -rf node_modules package-lock.json
npm install
node aos
```
