'use strict';
/**
 * core/collective-intelligence.js — AIOS Collective Intelligence v1.0.0
 *
 * The shared brain. Every response from every one of the 7 mesh models
 * is stored here. AIOS, AURA, and all 7 models draw from this store before
 * answering — so each query benefits from everything the system has ever learned.
 *
 * How it works:
 *   1. A query arrives at AIOS or any mesh agent.
 *   2. Before querying the model, `context(prompt)` injects relevant past
 *      perspectives from other models into the system prompt.
 *   3. The model answers with that combined knowledge in mind.
 *   4. `contribute(model, query, response)` stores the new perspective.
 *   5. Future queries on related topics inherit all prior answers.
 *
 * Over time this store grows into a persistent collective memory — the system
 * gets measurably smarter with every interaction.
 *
 * Storage layers:
 *   - In-memory rolling store (fast, for current session)
 *   - VFS persistence at /var/lib/aios/collective.json (survives reboots)
 *   - Integrated with memory-core (all events also flow to the unified log)
 *
 * Router commands:
 *   collective            — show stats
 *   collective status     — same
 *   collective log        — show recent perspectives
 *   collective recall <q> — surface stored perspectives on a topic
 *
 * Zero external npm dependencies.
 */

const VERSION = '1.0.0';

// Max perspectives stored per model (oldest evicted when full)
const MAX_PER_MODEL    = 200;
// Max total cross-model topic index entries
const MAX_TOPIC_INDEX  = 500;
// Number of relevant past perspectives to inject into each new prompt
const MAX_CONTEXT_INJECT = 4;
// Max chars to include from each perspective in the context injection
const MAX_PERSPECTIVE_CHARS = 300;

// ---------------------------------------------------------------------------
// createCollectiveIntelligence factory
// ---------------------------------------------------------------------------
function createCollectiveIntelligence(kernel, memoryCore, filesystem) {

  const PERSIST_PATH = '/var/lib/aios/collective.json';

  // ── Per-model perspective stores ────────────────────────────────────────────
  // Map<modelName, Array<{ query, response, ts, topic }>>
  const _modelStore = new Map();

  // ── Cross-model topic index ─────────────────────────────────────────────────
  // Map<normalizedTopic, Array<{ model, response, ts }>>
  const _topicIndex = new Map();

  // ── Stats ───────────────────────────────────────────────────────────────────
  const _stats = { contributions: 0, contextBuilds: 0, recalls: 0, syntheses: 0 };

  // ── Helpers ─────────────────────────────────────────────────────────────────

  // Normalise text to a stable lookup key (lowercase, alphanum + spaces, truncated)
  function _normalize(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80);
  }

  // Extract the key nouns/phrases from a prompt for topic matching
  function _extractTopics(text) {
    const normalized = _normalize(text);
    // Split into 3-6 word windows to create multiple overlapping topic keys
    const words  = normalized.split(' ').filter(Boolean);
    const topics = new Set();
    topics.add(normalized.slice(0, 40)); // full prefix
    for (let i = 0; i < words.length; i++) {
      const phrase = words.slice(i, i + 4).join(' ');
      if (phrase.length > 6) topics.add(phrase);
    }
    return [...topics];
  }

  // Score relevance of a stored topic key against the current prompt (0–1)
  function _relevanceScore(storedKey, promptNormalized) {
    const storedWords  = new Set(storedKey.split(' '));
    const promptWords  = new Set(promptNormalized.split(' '));
    const intersection = [...storedWords].filter(w => promptWords.has(w) && w.length > 3);
    if (!storedWords.size) return 0;
    return intersection.length / Math.max(storedWords.size, promptWords.size);
  }

  // ── contribute ─────────────────────────────────────────────────────────────
  // Store a model's perspective. Called by remote-mesh after every successful query.
  function contribute(modelName, query, response) {
    if (!modelName || !query || !response) return;

    const entry = {
      query:    String(query).slice(0, 400),
      response: String(response).slice(0, MAX_PERSPECTIVE_CHARS * 2),
      ts:       new Date().toISOString(),
      topic:    _normalize(query).slice(0, 60),
    };

    // ── Per-model store ──────────────────────────────────────────────────────
    if (!_modelStore.has(modelName)) _modelStore.set(modelName, []);
    const store = _modelStore.get(modelName);
    store.push(entry);
    if (store.length > MAX_PER_MODEL) store.shift();

    // ── Cross-model topic index ──────────────────────────────────────────────
    const topics = _extractTopics(query);
    for (const topic of topics) {
      if (!_topicIndex.has(topic)) _topicIndex.set(topic, []);
      const bucket = _topicIndex.get(topic);
      bucket.push({ model: modelName, response: entry.response, ts: entry.ts });
      if (bucket.length > 10) bucket.shift(); // keep last 10 per topic key

      // Global topic index cap: evict oldest entries
      if (_topicIndex.size > MAX_TOPIC_INDEX) {
        _topicIndex.delete(_topicIndex.keys().next().value);
      }
    }

    _stats.contributions++;

    // Also record in unified memory-core
    if (memoryCore) {
      memoryCore.record(`collective:${modelName}`, query, response, null);
    }

    if (kernel) {
      kernel.bus.emit('collective:contributed', { model: modelName, topicLen: entry.topic.length });
    }
  }

  // ── context ─────────────────────────────────────────────────────────────────
  // Build a context string from past perspectives relevant to `prompt`.
  // Injected into model system prompts so every query benefits from prior answers.
  function context(prompt) {
    if (!prompt || _topicIndex.size === 0) return '';
    _stats.contextBuilds++;

    const normalized = _normalize(prompt);

    // Score every topic key against the current prompt
    const scored = [];
    for (const [key, perspectives] of _topicIndex) {
      const score = _relevanceScore(key, normalized);
      if (score > 0.15) {
        // Pick the most recent perspective for this topic
        const latest = perspectives[perspectives.length - 1];
        scored.push({ score, model: latest.model, response: latest.response, ts: latest.ts });
      }
    }

    if (!scored.length) return '';

    // Sort by relevance desc, take top N, deduplicate by model
    const seen    = new Set();
    const top     = scored
      .sort((a, b) => b.score - a.score)
      .filter(p => { if (seen.has(p.model)) return false; seen.add(p.model); return true; })
      .slice(0, MAX_CONTEXT_INJECT);

    if (!top.length) return '';

    const lines = ['[Collective Intelligence — relevant prior knowledge:]'];
    for (const p of top) {
      const snippet = p.response.slice(0, MAX_PERSPECTIVE_CHARS).replace(/\n/g, ' ');
      lines.push(`  [${p.model}] ${snippet}`);
    }
    lines.push('[End of collective context]');
    return lines.join('\n');
  }

  // ── synthesize ─────────────────────────────────────────────────────────────
  // Merge multiple model responses into a single combined insight.
  // Used when AIOS/AURA fan out to several models and want one unified answer.
  function synthesize(perspectives) {
    // perspectives: Array<{ model, response }>
    if (!perspectives || !perspectives.length) return '';
    _stats.syntheses++;

    // Filter empty responses
    const valid = perspectives.filter(p => p && p.response && p.response.trim());
    if (!valid.length) return '';
    if (valid.length === 1) return valid[0].response;

    // Find the longest (most detailed) response as the base
    const base = valid.reduce((a, b) =>
      b.response.length > a.response.length ? b : a
    );

    // Collect unique insights from the other models
    const baseWords = new Set(_normalize(base.response).split(' '));
    const addIns    = [];
    for (const p of valid) {
      if (p.model === base.model) continue;
      const otherWords  = _normalize(p.response).split(' ').filter(Boolean);
      const uniqueWords = otherWords.filter(w => w.length > 4 && !baseWords.has(w));
      if (uniqueWords.length >= 3) {
        // This model added something meaningfully different — include a snippet
        addIns.push(`[${p.model}] ${p.response.slice(0, 200).replace(/\n/g, ' ')}`);
      }
    }

    if (!addIns.length) return base.response;

    return (
      base.response +
      '\n\n— Additional perspectives from mesh agents:\n' +
      addIns.join('\n')
    );
  }

  // ── recall ──────────────────────────────────────────────────────────────────
  // Return all stored perspectives on a topic (for the `collective recall` command).
  function recall(query) {
    _stats.recalls++;
    const normalized = _normalize(query);
    const found      = [];
    const seen       = new Set();

    for (const [key, perspectives] of _topicIndex) {
      const score = _relevanceScore(key, normalized);
      if (score > 0.2) {
        for (const p of perspectives) {
          const dedup = `${p.model}:${p.response.slice(0, 40)}`;
          if (!seen.has(dedup)) {
            seen.add(dedup);
            found.push({ score, model: p.model, response: p.response, ts: p.ts });
          }
        }
      }
    }

    return found
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
  }

  // ── getState ─────────────────────────────────────────────────────────────────
  function getState() {
    const modelSummary = {};
    for (const [name, entries] of _modelStore) {
      modelSummary[name] = entries.length;
    }
    return {
      version:      VERSION,
      contributions: _stats.contributions,
      contextBuilds: _stats.contextBuilds,
      syntheses:     _stats.syntheses,
      recalls:       _stats.recalls,
      topicKeys:     _topicIndex.size,
      models:        modelSummary,
    };
  }

  // ── Persistence ─────────────────────────────────────────────────────────────
  function persist() {
    if (!filesystem) return;
    try {
      filesystem.mkdir('/var/lib/aios', { parents: true });
      const snapshot = {
        savedAt:    new Date().toISOString(),
        stats:      _stats,
        topicIndex: [..._topicIndex.entries()].slice(-200), // last 200 topics
      };
      filesystem.write(PERSIST_PATH, JSON.stringify(snapshot));
    } catch (_) {}
  }

  function restore() {
    if (!filesystem) return;
    try {
      const r = filesystem.read(PERSIST_PATH);
      if (!r || !r.ok || !r.content) return;
      const snap = JSON.parse(r.content);
      if (Array.isArray(snap.topicIndex)) {
        for (const [key, perspectives] of snap.topicIndex) {
          _topicIndex.set(key, perspectives);
        }
      }
      if (snap.stats) {
        Object.assign(_stats, snap.stats);
      }
    } catch (_) {}
  }

  // ── Router commands ──────────────────────────────────────────────────────────
  const commands = {
    collective: (args) => {
      const sub = (args && args[0] ? args[0] : 'status').toLowerCase();
      const rest = args ? args.slice(1).join(' ') : '';

      // ── collective / collective status ──────────────────────────────────
      if (sub === 'status') {
        const s = getState();
        const modelLines = Object.entries(s.models)
          .map(([name, count]) => `    ${name.padEnd(18)} ${count} perspectives`)
          .join('\n') || '    (none yet)';
        return {
          status: 'ok',
          result: [
            `Collective Intelligence v${VERSION}`,
            `Contributions : ${s.contributions}`,
            `Topic keys    : ${s.topicKeys}`,
            `Context builds: ${s.contextBuilds}`,
            `Syntheses     : ${s.syntheses}`,
            `Recalls       : ${s.recalls}`,
            '',
            'Model contributions:',
            modelLines,
          ].join('\n'),
        };
      }

      // ── collective log ───────────────────────────────────────────────────
      if (sub === 'log') {
        const lines = [];
        for (const [model, entries] of _modelStore) {
          const last = entries.slice(-3);
          for (const e of last) {
            lines.push(
              `[${e.ts.slice(11, 19)}] ${model.padEnd(20)} ` +
              `${e.query.slice(0, 30).padEnd(30)} → ${e.response.slice(0, 50)}`
            );
          }
        }
        if (!lines.length) return { status: 'ok', result: 'Collective memory is empty.' };
        return { status: 'ok', result: lines.join('\n') };
      }

      // ── collective recall <query> ────────────────────────────────────────
      if (sub === 'recall') {
        if (!rest) return { status: 'error', result: 'Usage: collective recall <topic>' };
        const found = recall(rest);
        if (!found.length) return { status: 'ok', result: `No collective memory found for: "${rest}"` };
        const lines = found.map(p =>
          `[${p.model}] ${p.response.slice(0, 200)}`
        );
        return { status: 'ok', result: lines.join('\n\n') };
      }

      return { status: 'error', result: `Unknown command: collective ${sub}. Try: collective status` };
    },
  };

  return {
    name:       'collective-intelligence',
    version:    VERSION,
    contribute,
    context,
    synthesize,
    recall,
    getState,
    persist,
    restore,
    commands,
  };
}

module.exports = { createCollectiveIntelligence };
