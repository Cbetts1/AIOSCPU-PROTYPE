'use strict';
/**
 * branding/branding.config.js — AIOSCPU Central Branding Configuration
 *
 * Single source of truth for all product identity, version strings,
 * legal notices, and display text used across the boot splash, status bar,
 * banner, and documentation generation.
 *
 * To white-label or rebrand: edit only this file.
 *
 * Copyright (c) 2026 Cbetts1. All rights reserved.
 */

// ---------------------------------------------------------------------------
// Product Identity
// ---------------------------------------------------------------------------
const PRODUCT = Object.freeze({
  name:         'AIOSCPU',
  fullName:     'AIOSCPU — AI-Operated Software CPU',
  edition:      'AIOS Lite',
  codename:     'Prototype One',

  // Version components (bump here — propagates everywhere)
  version:      '2.0.0',
  kernelVer:    '2.0.0',
  cpuVer:       '2.0.0',
  fsVer:        '1.1.0',
  aiVer:        '3.0.0',
  vhalVer:      '1.0.0',

  // Taglines — use in marketing materials
  tagline:      'Termux-Bootable · Offline-First · AI-Native · Pure Node.js',
  shortTag:     'The AI OS that runs anywhere Node.js does.',

  // Platforms
  platforms:    ['Android / Termux', 'Linux', 'macOS', 'Windows (WSL)'],
  minNode:      '>=14.0.0',
});

// ---------------------------------------------------------------------------
// Ownership & Legal
// ---------------------------------------------------------------------------
const LEGAL = Object.freeze({
  owner:        'Cbetts1',
  ownerUrl:     'https://github.com/Cbetts1',
  repoUrl:      'https://github.com/Cbetts1/AIOSCPU-PROTYPE',
  year:         '2026',
  license:      'MIT',
  licenseUrl:   'https://github.com/Cbetts1/AIOSCPU-PROTYPE/blob/main/LICENSE',

  // Copyright line — use everywhere
  copyright:    'Copyright (c) 2026 Cbetts1. All rights reserved.',

  // Trademark notice — ™ until registered, ® after USPTO registration
  trademark:    '"AIOSCPU" and "AIOS Lite" are trademarks of Cbetts1.',

  // One-line disclaimer for footers
  disclaimer:   'Provided "AS IS" without warranty. Not for safety-critical use.',
});

// ---------------------------------------------------------------------------
// Display Strings (console / terminal UI)
// ---------------------------------------------------------------------------
const DISPLAY = Object.freeze({
  // Header shown at top of boot splash (overridable by user env AIOS_BANNER)
  bannerTitle:  `${PRODUCT.name}  ·  ${PRODUCT.edition}  ·  v${PRODUCT.version}`,
  bannerSub:    PRODUCT.tagline,

  // Status bar prefix label
  statusPrefix: `[${PRODUCT.name}]`,

  // Prompt string in interactive shell
  prompt:       `${PRODUCT.name}> `,
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = { PRODUCT, LEGAL, DISPLAY };
