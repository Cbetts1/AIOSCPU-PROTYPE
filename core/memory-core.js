'use strict';
/**
 * memory-core.js — AIOS Unified Memory Core v1.0.0
 *
 * The cognitive memory layer for AIOS. All model outputs, queries,
 * responses, errors, and autonomous decisions flow through this module,
 * making AIOS "think" as one unified entity. Enables continuous learning
 * and proactive assistance.
 *
 * Features:
 *   - Unified event store (all model outputs, queries, errors)
 *   - Pattern learning from successful query→response pairs
 *   - Context retrieval (recent N events)
 *   - Proactive suggestions based on error patterns and frequent operations
 *   - recall(input) — surface a previously learned response
 *   - Router commands: memcore <status|log|suggest|recall <input>>
 *
 * Zero external npm dependencies.
 */

const MAX_ENTRIES  = 1000;  // rolling event log size
const MAX_PATTERNS = 200;   // learned pattern capacity

// ---------------------------------------------------------------------------
// createMemoryCore — factory
// ---------------------------------------------------------------------------
function createMemoryCore(kernel) {
  // ── Storage ──────────────────────────────────────────────────────────────
  const _entries  = [];                  // all recorded events
  const _patterns = new Map();           // input → { count, lastOutput, lastTs }
  const _errors   = [];                  // recent errors for proactive suggestions

  const _stats = { recorded: 0, learned: 0, suggestions: 0, errors: 0 };

  // ── record ────────────────────────────────────────────────────────────────
  // Store any event into unified memory.
  // type    : string tag  e.g. 'query', 'nlp→cmd', 'autonomous', 'error', 'brain'
  // input   : what triggered the event (user text, service name, etc.)
  // output  : resulting string output / response
  // error   : error message if the event was a failure (null otherwise)
  function record(type, input, output, error) {
    const entry = {
      id:     _stats.recorded + 1,
      ts:     new Date().toISOString(),
      type:   String(type  || 'unknown'),
      input:  String(input  || '').slice(0, 500),
      output: String(output || '').slice(0, 500),
      error:  error ? String(error).slice(0, 200) : null,
    };

    _entries.push(entry);
    if (_entries.length > MAX_ENTRIES) _entries.shift();
    _stats.recorded++;

    if (error) {
      _stats.errors++;
      _errors.push({ ts: entry.ts, type: entry.type, input: entry.input, error: entry.error });
      if (_errors.length > 100) _errors.shift();
    }

    _learn(entry);

    if (kernel) kernel.bus.emit('memory:recorded', { id: entry.id, type: entry.type });

    return entry;
  }

  // ── _learn ────────────────────────────────────────────────────────────────
  // Update the pattern map from successful interactions.
  function _learn(entry) {
    if (entry.error || !entry.input || !entry.output) return;

    const key = entry.input.toLowerCase().trim();
    if (!key) return;

    const existing = _patterns.get(key);
    if (existing) {
      existing.count++;
      existing.lastOutput = entry.output;
      existing.lastTs     = entry.ts;
    } else {
      // Evict oldest entry when at capacity
      if (_patterns.size >= MAX_PATTERNS) {
        const oldestKey = _patterns.keys().next().value;
        _patterns.delete(oldestKey);
      }
      _patterns.set(key, { count: 1, lastOutput: entry.output, lastTs: entry.ts });
    }
    _stats.learned++;
  }

  // ── getContext ────────────────────────────────────────────────────────────
  // Return the most recent `n` memory entries.
  function getContext(n) {
    return _entries.slice(-(n || 20));
  }

  // ── recall ────────────────────────────────────────────────────────────────
  // Look up a previously learned response for a given input string.
  // Returns { count, lastOutput, lastTs } or null.
  function recall(input) {
    const key = String(input || '').toLowerCase().trim();
    return _patterns.get(key) || null;
  }

  // ── suggestions ──────────────────────────────────────────────────────────
  // Generate proactive suggestions based on recent errors and usage patterns.
  function suggestions() {
    _stats.suggestions++;
    const suggs = [];

    // Suggest recovery actions for recent errors
    const recentErrors = _errors.slice(-5);
    for (const e of recentErrors) {
      suggs.push(
        `[Error recovery] "${e.input.slice(0, 40)}" failed (${e.error.slice(0, 50)})` +
        ` — consider retrying or checking logs`
      );
    }

    // Surface frequently used inputs that might benefit from a shortcut
    const topPatterns = [..._patterns.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 3);
    for (const [key, val] of topPatterns) {
      if (val.count >= 3) {
        suggs.push(
          `[Frequent] "${key.slice(0, 40)}" used ${val.count} times` +
          ` — consider adding an alias or shortcut`
        );
      }
    }

    if (suggs.length === 0) {
      suggs.push('No proactive suggestions at this time. System is operating normally.');
    }

    return suggs;
  }

  // ── getStats ──────────────────────────────────────────────────────────────
  function getStats() {
    return Object.assign({}, _stats, {
      entries:  _entries.length,
      patterns: _patterns.size,
    });
  }

  // ── Router command module ─────────────────────────────────────────────────
  const commands = {
    memcore: (args) => {
      const sub = (args[0] || 'status').toLowerCase();

      if (sub === 'status') {
        const s = getStats();
        return {
          status: 'ok',
          result: [
            'AIOS Memory Core v1.0.0',
            `Entries    : ${s.entries} / ${MAX_ENTRIES}`,
            `Patterns   : ${s.patterns} / ${MAX_PATTERNS}`,
            `Recorded   : ${s.recorded}`,
            `Learned    : ${s.learned}`,
            `Errors     : ${s.errors}`,
            `Suggestions: ${s.suggestions}`,
          ].join('\n'),
        };
      }

      if (sub === 'log') {
        const ctx = getContext(20);
        if (!ctx.length) return { status: 'ok', result: 'Memory is empty.' };
        const lines = ctx.map(e =>
          `[${e.ts.slice(11, 19)}] #${String(e.id).padStart(4)} ` +
          `${e.type.padEnd(12)} ` +
          `${e.input.slice(0, 28).padEnd(28)} → ` +
          (e.error ? `✗ ${e.error.slice(0, 35)}` : e.output.slice(0, 40))
        );
        return { status: 'ok', result: lines.join('\n') };
      }

      if (sub === 'suggest') {
        return { status: 'ok', result: suggestions().join('\n') };
      }

      if (sub === 'recall' && args.length > 1) {
        const r = recall(args.slice(1).join(' '));
        if (!r) return { status: 'ok', result: 'No memory found for that input.' };
        return {
          status: 'ok',
          result: `Recalled (×${r.count}, last: ${r.lastTs.slice(0, 19)}): ${r.lastOutput}`,
        };
      }

      return {
        status: 'ok',
        result: 'Usage: memcore <status | log | suggest | recall <input>>',
      };
    },
  };

  return {
    name:        'memory-core',
    version:     '1.0.0',
    record,
    recall,
    getContext,
    suggestions,
    getStats,
    commands,
  };
}

module.exports = { createMemoryCore };
