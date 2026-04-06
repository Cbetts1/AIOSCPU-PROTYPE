#!/bin/bash
set -e

echo "[AIOS] Creating model directory..."
mkdir -p AI-OS-vitural-CPU-OS/usr/lib/aios/models

echo "[AIOS] Moving tinyllama.gguf into place..."
mv tinyllama.gguf AI-OS-vitural-CPU-OS/usr/lib/aios/models/ 2>/dev/null || true

echo "[AIOS] Writing model.json..."
cat > AI-OS-vitural-CPU-OS/usr/lib/aios/models/model.json << 'EOC'
{
  "id": "tinyllama",
  "type": "gguf",
  "path": "tinyllama.gguf",
  "autoload": true,
  "description": "TinyLlama 1.1B — AIOS Plug-and-Play Model"
}
EOC

echo "[AIOS] Patching AI Core for autoload..."
AI_CORE="AI-OS-vitural-CPU-OS/core/ai-core.js"

if ! grep -q "tinyllama.gguf" "$AI_CORE"; then
cat >> "$AI_CORE" << 'EOP'

// --- AUTO-INJECTED BY INSTALLER ---
try {
    const fs = require('fs');
    const path = require('path');
    const modelCfg = require('../usr/lib/aios/models/model.json');
    const modelFile = path.join(__dirname, '..', 'usr', 'lib', 'aios', 'models', modelCfg.path);

    if (fs.existsSync(modelFile)) {
        console.log("[AIOS] Loading model:", modelCfg.id);
        AIOS.AI.loadModel({
            id: modelCfg.id,
            file: modelFile,
            format: modelCfg.type
        });
    } else {
        console.log("[AIOS] Model file missing:", modelFile);
    }
} catch (err) {
    console.log("[AIOS] Model load error:", err);
}
// --- END AUTO-INJECT ---
EOP
fi

echo "[AIOS] TinyLlama is now plug-and-play."
