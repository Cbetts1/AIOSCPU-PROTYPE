'use strict';
/**
 * loop/nodes/ai.js — Loop Node: AI
 *
 * Attaches an AI reasoning summary to the loop context.
 * The live AI core is injected via setAICore(); falls back to a stub summary
 * when the AI core has not been attached yet.
 */

let _aiCore = null;

function setAICore(core) {
  _aiCore = core;
}

async function process(context) {
  let summary = 'ai-core not attached';

  if (_aiCore && typeof _aiCore.status === 'function') {
    try {
      const s = _aiCore.status();
      summary = JSON.stringify(s);
    } catch (_) {}
  } else if (_aiCore && typeof _aiCore.process === 'function') {
    try {
      const r = await _aiCore.process('status');
      if (r && r.result) summary = String(r.result).slice(0, 200);
    } catch (_) {}
  }

  return Object.assign({}, context, {
    last_node: 'ai',
    ai: {
      summary,
      timestamp: Date.now(),
    },
  });
}

module.exports = { name: 'ai', process, setAICore };
