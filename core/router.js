'use strict';
/**
 * router.js — AIOS Command Router v4.0.0
 *
 * Adapted from: Cbetts1/Router (router.js) — UMD → CJS, no external deps.
 *
 * Central traffic controller for the AIOS OS.
 * Dispatches CLI commands to registered handlers.
 * Supports hot-swap module mounting via router.use().
 */

const ROUTER_VERSION = '4.0.0';
const KNOWN_MODULES  = ['cpu', 'terminal', 'kernel', 'filesystem', 'services', 'ai'];

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function isFunction(v)  { return typeof v === 'function'; }
function isString(v)    { return typeof v === 'string'; }
function isObject(v)    { return v !== null && typeof v === 'object'; }

/** Parse a raw string or structured object into { command, args, raw } */
function parseInput(input) {
  if (isObject(input) && isString(input.command)) {
    return {
      command: input.command.trim().toLowerCase(),
      args:    Array.isArray(input.args) ? input.args : [],
      raw:     input,
    };
  }
  if (isString(input)) {
    const parts = input.trim().split(/\s+/);
    return {
      command: (parts[0] || '').toLowerCase(),
      args:    parts.slice(1),
      raw:     input,
    };
  }
  return { command: '', args: [], raw: input };
}

// ---------------------------------------------------------------------------
// Event bus (independent of kernel — router has its own internal bus)
// ---------------------------------------------------------------------------
function createEventBus() {
  const listeners = {};

  function on(event, listener) {
    if (!isString(event)) throw new TypeError('event must be a string');
    if (!isFunction(listener)) throw new TypeError('listener must be a function');
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(listener);
  }

  function off(event, listener) {
    if (!listeners[event]) return;
    listeners[event] = listeners[event].filter(l => l !== listener);
  }

  function emit(event, ...args) {
    if (!listeners[event]) return;
    listeners[event].forEach(l => {
      try { l(...args); } catch (_) {}
    });
  }

  function once(event, listener) {
    const w = (...args) => { off(event, w); listener(...args); };
    on(event, w);
  }

  return { on, off, emit, once };
}

// ---------------------------------------------------------------------------
// Router factory
// ---------------------------------------------------------------------------
function createRouter(options = {}) {
  const registry = {};   // command name → handler
  const modules  = {};   // module name  → module object
  const bus      = createEventBus();

  const logger = (function resolveLogger() {
    if (options.logger === null) return null;
    if (isObject(options.logger)) return options.logger;
    return console;
  }());

  function log(...args)  { if (logger && isFunction(logger.log))  logger.log(...args);  }
  function warn(...args) { if (logger && isFunction(logger.warn)) logger.warn(...args); }

  const defaultFallback = (parsed) => Promise.resolve({
    status:  'error',
    command: parsed.command,
    result:  `Unknown command: "${parsed.command}". Type "help" for a list.`,
  });

  const fallbackHandler = isFunction(options.fallback) ? options.fallback : defaultFallback;

  // Forward-declare router so built-in handlers can reference it
  const router = {};

  // Built-in commands
  const builtins = {
    help: (_args) => ({
      status:  'ok',
      command: 'help',
      result:  'Commands: ' + router.getCommands().join(', '),
    }),
    echo: (args) => ({
      status:  'ok',
      command: 'echo',
      result:  args.join(' '),
    }),
    version: () => ({
      status:  'ok',
      command: 'version',
      result:  `AIOS Router v${ROUTER_VERSION}`,
    }),
  };

  Object.keys(builtins).forEach(name => { registry[name] = builtins[name]; });

  // ---------------------------------------------------------------------------
  function registerCommand(name, handler) {
    if (!isString(name) || name.trim() === '') throw new TypeError('Command name must be a non-empty string');
    if (!isFunction(handler)) throw new TypeError('Command handler must be a function');
    registry[name.trim().toLowerCase()] = handler;
    bus.emit('command:registered', name);
  }

  function unregisterCommand(name) {
    if (!isString(name)) throw new TypeError('Command name must be a string');
    const key = name.trim().toLowerCase();
    if (!registry[key]) { warn(`[Router] unregisterCommand: "${key}" not found`); return false; }
    delete registry[key];
    bus.emit('command:unregistered', key);
    return true;
  }

  function use(moduleName, moduleObject) {
    if (!isString(moduleName) || moduleName.trim() === '') throw new TypeError('Module name must be a non-empty string');
    if (!isObject(moduleObject)) throw new TypeError('Module must be an object');
    const key = moduleName.trim().toLowerCase();
    if (modules[key]) unuse(key);
    modules[key] = moduleObject;
    if (isObject(moduleObject.commands)) {
      Object.keys(moduleObject.commands).forEach(cmd => {
        if (isFunction(moduleObject.commands[cmd])) registerCommand(cmd, moduleObject.commands[cmd]);
      });
    }
    if (isFunction(moduleObject.onMount)) {
      try { moduleObject.onMount(router); } catch (e) { warn(`[Router] onMount error in "${key}":`, e.message); }
    }
    bus.emit('module:mounted', key, moduleObject);
  }

  function unuse(moduleName) {
    if (!isString(moduleName)) throw new TypeError('Module name must be a string');
    const key = moduleName.trim().toLowerCase();
    const mod = modules[key];
    if (!mod) { warn(`[Router] unuse: module "${key}" not found`); return false; }
    if (isObject(mod.commands)) {
      Object.keys(mod.commands).forEach(cmd => unregisterCommand(cmd));
    }
    if (isFunction(mod.onUnmount)) try { mod.onUnmount(router); } catch (_) {}
    delete modules[key];
    bus.emit('module:unmounted', key);
    return true;
  }

  function handle(input, context = {}) {
    const parsed = parseInput(input);
    bus.emit('command:before', parsed, context);

    const handler = registry[parsed.command];
    let p;

    if (!handler) {
      p = parsed.command === ''
        ? Promise.resolve({ status: 'error', command: '', result: 'No command provided.' })
        : Promise.resolve(fallbackHandler(parsed, context));
    } else {
      try {
        const raw = handler(parsed.args, context);
        p = (raw && isFunction(raw.then)) ? raw : Promise.resolve(raw);
      } catch (e) {
        p = Promise.resolve({ status: 'error', command: parsed.command, result: `Handler error: ${e.message}` });
      }
    }

    return p
      .then(result => { bus.emit('command:after', parsed, result, context); return result; })
      .catch(e => {
        const r = { status: 'error', command: parsed.command, result: `Async error: ${e.message}` };
        bus.emit('command:after', parsed, r, context);
        return r;
      });
  }

  function getCommands() { return Object.keys(registry).sort(); }
  function getModules()  { return Object.keys(modules).sort(); }

  Object.assign(router, {
    handle,
    registerCommand,
    unregisterCommand,
    use,
    unuse,
    on:           bus.on,
    off:          bus.off,
    emit:         bus.emit,
    once:         bus.once,
    getCommands,
    getModules,
    version:      ROUTER_VERSION,
    knownModules: KNOWN_MODULES.slice(),
  });

  return router;
}

module.exports = { createRouter };
