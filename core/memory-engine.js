'use strict';
/**
 * memory-engine.js — AIOS Memory Engine v1.0.0
 *
 * Centralised, persistent memory for AIOS consciousness.
 *
 * Features:
 *   - Key/value context store (Map-backed)
 *   - Interaction history (bounded ring-buffer)
 *   - Learned-fact store with source and confidence
 *   - VFS persistence: reads/writes /var/lib/aios/memory.json
 *   - Per-session and cross-session context
 *   - `memory` terminal command
 *
 * Zero external npm dependencies.
 */

const MAX_HISTORY = 1000;
const MAX_FACTS   = 500;

// ---------------------------------------------------------------------------
// Memory Engine factory
// ---------------------------------------------------------------------------
function createMemoryEngine(kernel, vfs) {
  const _store   = new Map();       // key → value (arbitrary context)
  const _history = [];              // interaction log
  const _facts   = [];              // learned facts

  // ── Helpers ──────────────────────────────────────────────────────────────

  function _ts() { return new Date().toISOString(); }

  // ── store / retrieve ─────────────────────────────────────────────────────

  /**
   * Store a key/value pair in the context store.
   * @param {string} key
   * @param {*} value
   */
  function store(key, value) {
    if (typeof key !== 'string' || !key) throw new TypeError('key must be a non-empty string');
    _store.set(key, { value, ts: _ts() });
    if (kernel) kernel.bus.emit('memory:stored', { key });
  }

  /**
   * Retrieve a value from the context store.
   * @param {string} key
   * @returns {*} value or undefined
   */
  function retrieve(key) {
    const entry = _store.get(key);
    return entry ? entry.value : undefined;
  }

  /**
   * Remove a key from the context store.
   * @param {string} key
   */
  function forget(key) {
    _store.delete(key);
    if (kernel) kernel.bus.emit('memory:forgotten', { key });
  }

  /** List all stored context keys. */
  function listKeys() { return Array.from(_store.keys()); }

  // ── Interaction history ───────────────────────────────────────────────────

  /**
   * Append an interaction to the history.
   * @param {{ role: string, content: string, mode?: string, model?: string }} entry
   */
  function append(entry) {
    if (!entry || typeof entry.content !== 'string') return;
    const record = {
      ts:      _ts(),
      role:    entry.role    || 'user',
      content: entry.content,
      mode:    entry.mode    || 'chat',
      model:   entry.model   || 'built-in',
    };
    _history.push(record);
    if (_history.length > MAX_HISTORY) _history.shift();
    if (kernel) kernel.bus.emit('memory:appended', { role: record.role });
  }

  /**
   * Return the N most recent history entries (default 20).
   * @param {number} [n]
   * @returns {object[]}
   */
  function getHistory(n) {
    const count = (typeof n === 'number' && n > 0) ? n : 20;
    return _history.slice(-count);
  }

  /** Clear all history. */
  function clearHistory() { _history.length = 0; }

  // ── Learning ──────────────────────────────────────────────────────────────

  /**
   * Learn a new fact.
   * @param {{ content: string, source?: string, confidence?: number }} fact
   */
  function learn(fact) {
    if (!fact || typeof fact.content !== 'string' || !fact.content) return;
    const record = {
      ts:         _ts(),
      content:    fact.content,
      source:     fact.source     || 'interaction',
      confidence: (typeof fact.confidence === 'number') ? fact.confidence : 1.0,
    };
    _facts.push(record);
    if (_facts.length > MAX_FACTS) _facts.shift();
    if (kernel) kernel.bus.emit('memory:learned', { content: record.content.slice(0, 80) });
  }

  /** Return all learned facts. */
  function getFacts() { return _facts.slice(); }

  // ── Persistence (VFS) ────────────────────────────────────────────────────

  /**
   * Persist current memory state to VFS at /var/lib/aios/memory.json.
   */
  function persist() {
    if (!vfs) return;
    const snapshot = {
      ts:      _ts(),
      store:   Object.fromEntries(
        Array.from(_store.entries()).map(([k, v]) => [k, v])
      ),
      history: _history.slice(-200),
      facts:   _facts.slice(-200),
    };
    try {
      vfs.mkdir('/var/lib/aios', { parents: true });
      vfs.write('/var/lib/aios/memory.json', JSON.stringify(snapshot, null, 2) + '\n');
    } catch (_) {}
  }

  /**
   * Load persisted memory state from VFS.
   */
  function load() {
    if (!vfs) return;
    try {
      const r = vfs.read('/var/lib/aios/memory.json');
      if (!r || !r.ok) return;
      const snapshot = JSON.parse(r.content);
      if (snapshot.store) {
        for (const [k, v] of Object.entries(snapshot.store)) {
          _store.set(k, v);
        }
      }
      if (Array.isArray(snapshot.history)) {
        snapshot.history.forEach(e => _history.push(e));
        while (_history.length > MAX_HISTORY) _history.shift();
      }
      if (Array.isArray(snapshot.facts)) {
        snapshot.facts.forEach(f => _facts.push(f));
        while (_facts.length > MAX_FACTS) _facts.shift();
      }
    } catch (_) {}
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  function summary() {
    return {
      contextKeys:      _store.size,
      historyEntries:   _history.length,
      learnedFacts:     _facts.length,
      oldestInteraction: _history.length ? _history[0].ts : null,
      newestInteraction: _history.length ? _history[_history.length - 1].ts : null,
    };
  }

  // ── Router command interface ───────────────────────────────────────────────

  const commands = {
    memory(args) {
      const sub = (args[0] || 'summary').toLowerCase();

      if (sub === 'summary') {
        const s = summary();
        return {
          status: 'ok',
          result: [
            'Memory Engine v1.0.0',
            `Context keys    : ${s.contextKeys}`,
            `History entries : ${s.historyEntries}`,
            `Learned facts   : ${s.learnedFacts}`,
            `Oldest entry    : ${s.oldestInteraction || 'none'}`,
            `Newest entry    : ${s.newestInteraction || 'none'}`,
          ].join('\n'),
        };
      }

      if (sub === 'history') {
        const n = parseInt(args[1], 10) || 20;
        const entries = getHistory(n);
        if (!entries.length) return { status: 'ok', result: 'No history yet.' };
        const lines = entries.map(e =>
          `[${e.ts.slice(11, 19)}] ${e.role.padEnd(8)} (${e.mode}/${e.model}): ${e.content.slice(0, 80)}`
        );
        return { status: 'ok', result: lines.join('\n') };
      }

      if (sub === 'facts') {
        if (!_facts.length) return { status: 'ok', result: 'No facts learned yet.' };
        const lines = _facts.slice(-20).map(f =>
          `[${f.ts.slice(0, 10)}] [${String(f.confidence.toFixed(1))}] ${f.content.slice(0, 100)}`
        );
        return { status: 'ok', result: lines.join('\n') };
      }

      if (sub === 'store' && args[1] && args[2]) {
        store(args[1], args.slice(2).join(' '));
        return { status: 'ok', result: `Stored "${args[1]}".` };
      }

      if (sub === 'get' && args[1]) {
        const v = retrieve(args[1]);
        return v !== undefined
          ? { status: 'ok',    result: `${args[1]} = ${JSON.stringify(v)}` }
          : { status: 'error', result: `Key "${args[1]}" not found.` };
      }

      if (sub === 'forget' && args[1]) {
        forget(args[1]);
        return { status: 'ok', result: `Forgotten "${args[1]}".` };
      }

      if (sub === 'keys') {
        const keys = listKeys();
        return { status: 'ok', result: keys.length ? keys.join(', ') : '(empty)' };
      }

      if (sub === 'persist') {
        persist();
        return { status: 'ok', result: 'Memory persisted to VFS.' };
      }

      if (sub === 'clear') {
        clearHistory();
        return { status: 'ok', result: 'History cleared.' };
      }

      return {
        status: 'ok',
        result: 'Usage: memory <summary|history [n]|facts|store <key> <val>|get <key>|forget <key>|keys|persist|clear>',
      };
    },
  };

  return {
    name:         'memory-engine',
    version:      '1.0.0',
    store,
    retrieve,
    forget,
    listKeys,
    append,
    getHistory,
    clearHistory,
    learn,
    getFacts,
    persist,
    load,
    summary,
    commands,
  };
}

module.exports = { createMemoryEngine };
