'use strict';
/**
 * memory-engine.js — AIOS Memory Engine v1.0.0
 *
 * Persistent in-session store for all interactions, queries, and learning data.
 *
 * Responsibilities:
 *   - Record every user interaction (input + response + timestamp)
 *   - Record raw queries for replay and inspection
 *   - Accumulate learning observations for mode-specific knowledge
 *   - Provide lookup, export, and capacity-reporting APIs
 *
 * Zero external npm dependencies.
 */

const MEMORY_ENGINE_VERSION = '1.0.0';
const DEFAULT_MAX_INTERACTIONS = 10000;
const DEFAULT_MAX_QUERIES      = 5000;
const DEFAULT_MAX_LEARNINGS    = 2000;

// ---------------------------------------------------------------------------
// createMemoryEngine
// ---------------------------------------------------------------------------
/**
 * @param {object} kernel  - AIOS kernel instance
 * @param {object} [opts]
 * @param {number} [opts.maxInteractions] - max interaction records (default 10000)
 * @param {number} [opts.maxQueries]      - max query records      (default 5000)
 * @param {number} [opts.maxLearnings]    - max learning records   (default 2000)
 */
function createMemoryEngine(kernel, opts = {}) {
  const maxInteractions = opts.maxInteractions || DEFAULT_MAX_INTERACTIONS;
  const maxQueries      = opts.maxQueries      || DEFAULT_MAX_QUERIES;
  const maxLearnings    = opts.maxLearnings    || DEFAULT_MAX_LEARNINGS;

  // ── Internal stores ───────────────────────────────────────────────────────
  const _interactions = [];   // { id, ts, mode, input, response, meta }
  const _queries      = [];   // { id, ts, raw, parsed, source }
  const _learnings    = [];   // { id, ts, topic, data, confidence }

  let _idSeq = 0;
  function _nextId() { return ++_idSeq; }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function _now() { return new Date().toISOString(); }

  function _trim(store, max) {
    if (store.length > max) store.splice(0, store.length - max);
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Record a completed interaction.
   * @param {string} mode      - current mode (chat, code, fix, help, learn)
   * @param {string} input     - user input text
   * @param {string} response  - system response text
   * @param {object} [meta]    - optional extra metadata
   * @returns {{ id: number }}
   */
  function recordInteraction(mode, input, response, meta = {}) {
    const record = {
      id:       _nextId(),
      ts:       _now(),
      mode:     String(mode || 'unknown'),
      input:    String(input  || ''),
      response: String(response || ''),
      meta,
    };
    _interactions.push(record);
    _trim(_interactions, maxInteractions);
    if (kernel && kernel.bus) {
      kernel.bus.emit('memory:interaction', { id: record.id, mode: record.mode });
    }
    return { id: record.id };
  }

  /**
   * Record a raw query.
   * @param {string} raw     - raw query string
   * @param {object} parsed  - parsed representation
   * @param {string} source  - origin (e.g. 'terminal', 'port', 'ai')
   * @returns {{ id: number }}
   */
  function recordQuery(raw, parsed, source) {
    const record = {
      id:     _nextId(),
      ts:     _now(),
      raw:    String(raw || ''),
      parsed: parsed || null,
      source: String(source || 'unknown'),
    };
    _queries.push(record);
    _trim(_queries, maxQueries);
    return { id: record.id };
  }

  /**
   * Add a learning observation.
   * @param {string} topic       - subject area
   * @param {*}      data        - learning payload
   * @param {number} [confidence=1.0] - 0–1 confidence score
   * @returns {{ id: number }}
   */
  function learn(topic, data, confidence = 1.0) {
    const record = {
      id:         _nextId(),
      ts:         _now(),
      topic:      String(topic || 'general'),
      data,
      confidence: Math.min(1, Math.max(0, Number(confidence) || 1.0)),
    };
    _learnings.push(record);
    _trim(_learnings, maxLearnings);
    if (kernel && kernel.bus) {
      kernel.bus.emit('memory:learn', { id: record.id, topic: record.topic });
    }
    return { id: record.id };
  }

  /**
   * Retrieve interaction history (most recent first).
   * @param {number} [limit=50]
   * @param {string} [mode]    - optional mode filter
   */
  function getInteractions(limit = 50, mode) {
    let list = _interactions.slice();
    if (mode) list = list.filter(r => r.mode === mode);
    return list.slice(-limit).reverse();
  }

  /**
   * Retrieve query history (most recent first).
   * @param {number} [limit=50]
   */
  function getQueries(limit = 50) {
    return _queries.slice(-limit).reverse();
  }

  /**
   * Retrieve learning observations.
   * @param {number} [limit=50]
   * @param {string} [topic] - optional topic filter
   */
  function getLearnings(limit = 50, topic) {
    let list = _learnings.slice();
    if (topic) list = list.filter(r => r.topic === topic);
    return list.slice(-limit).reverse();
  }

  /** Capacity and usage statistics */
  function stats() {
    return {
      interactions: { count: _interactions.length, max: maxInteractions },
      queries:      { count: _queries.length,      max: maxQueries      },
      learnings:    { count: _learnings.length,    max: maxLearnings    },
      totalRecords: _interactions.length + _queries.length + _learnings.length,
    };
  }

  /** Clear all stored data */
  function clear() {
    _interactions.splice(0);
    _queries.splice(0);
    _learnings.splice(0);
    _idSeq = 0;
  }

  // ── Router command interface ───────────────────────────────────────────────
  const commands = {
    'memory stats':   () => {
      const s = stats();
      return {
        status: 'ok',
        result: [
          `Memory Engine v${MEMORY_ENGINE_VERSION}`,
          `  Interactions : ${s.interactions.count} / ${s.interactions.max}`,
          `  Queries      : ${s.queries.count} / ${s.queries.max}`,
          `  Learnings    : ${s.learnings.count} / ${s.learnings.max}`,
          `  Total records: ${s.totalRecords}`,
        ].join('\n'),
      };
    },
    'memory history': (args) => {
      const limit = parseInt(args[0], 10) || 10;
      const list  = getInteractions(limit);
      if (!list.length) return { status: 'ok', result: 'No interactions recorded yet.' };
      const lines = list.map(r =>
        `[${r.ts.slice(11, 19)}] [${r.mode}] ${r.input.slice(0, 60)}`
      );
      return { status: 'ok', result: lines.join('\n') };
    },
    'memory queries': (args) => {
      const limit = parseInt(args[0], 10) || 10;
      const list  = getQueries(limit);
      if (!list.length) return { status: 'ok', result: 'No queries recorded yet.' };
      const lines = list.map(r =>
        `[${r.ts.slice(11, 19)}] [${r.source}] ${r.raw.slice(0, 80)}`
      );
      return { status: 'ok', result: lines.join('\n') };
    },
    'memory learn': (args) => {
      const limit = parseInt(args[0], 10) || 10;
      const list  = getLearnings(limit);
      if (!list.length) return { status: 'ok', result: 'No learning data yet.' };
      const lines = list.map(r =>
        `[${r.ts.slice(11, 19)}] [${r.topic}] conf=${r.confidence.toFixed(2)}`
      );
      return { status: 'ok', result: lines.join('\n') };
    },
    'memory clear': () => {
      clear();
      return { status: 'ok', result: 'Memory cleared.' };
    },
  };

  function dispatch(args) {
    const sub = (args[0] || 'stats').toLowerCase();
    const key = `memory ${sub}`;
    const fn  = commands[key];
    if (fn) return fn(args.slice(1));
    return {
      status: 'ok',
      result: 'Usage: memory <stats|history [n]|queries [n]|learn [n]|clear>',
    };
  }

  return {
    name:    'memory-engine',
    version: MEMORY_ENGINE_VERSION,
    // Core API
    recordInteraction,
    recordQuery,
    learn,
    getInteractions,
    getQueries,
    getLearnings,
    stats,
    clear,
    // Router integration
    commands: { memory: dispatch },
  };
}

module.exports = { createMemoryEngine };
