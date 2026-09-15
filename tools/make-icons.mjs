#!/usr/bin/env node
/**
 * Generates the app icons from scratch - no binary art in the repo, and no
 * image library. Writes a minimal hand-encoded PNG (raw RGBA -> zlib -> IHDR/
 * IDAT/IEND) plus an SVG favicon.
 *
 * These are what "Add to Home Screen" uses, so the game gets a real icon on a
 * phone rather than a screenshot thumbnail.
 *
 * Run: npm run build:icons
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { encodePng } from './lib/png.mjs';

const OUT = resolve(import.meta.dirname, '../web/public');
mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------- the mark
// A large arcane orb with the two smaller orbs the player carries, on the
// app's background colour.

function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const c = size / 2;

  const put = (x, y, [r, g, b], a) => {
    if (a <= 0) return;
    const i = (y * size + x) * 4;
    const prev = rgba[i + 3] / 255;
    const out = a + prev * (1 - a);
    if (out <= 0) return;
    rgba[i] = Math.round((r * a + rgba[i] * prev * (1 - a)) / out);
    rgba[i + 1] = Math.round((g * a + rgba[i + 1] * prev * (1 - a)) / out);
    rgba[i + 2] = Math.round((b * a + rgba[i + 2] * prev * (1 - a)) / out);
    rgba[i + 3] = Math.round(out * 255);
  };

  /** Anti-aliased filled disc. */
  const disc = (cx, cy, radius, color, alpha = 1, feather = 1.2) => {
    const lo = Math.max(0, Math.floor(cy - radius - 2));
    const hi = Math.min(size - 1, Math.ceil(cy + radius + 2));
    for (let y = lo; y <= hi; y++) {
      for (let x = Math.max(0, Math.floor(cx - radius - 2)); x <= Math.min(size - 1, Math.ceil(cx + radius + 2)); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        const coverage = Math.min(1, Math.max(0, (radius - d) / feather + 0.5));
        put(x, y, color, coverage * alpha);
      }
    }
  };

  /** Smooth radial glow - a feathered disc bands visibly at this size. */
  const glow = (cx, cy, radius, color, alpha) => {
    const lo = Math.max(0, Math.floor(cy - radius));
    const hi = Math.min(size - 1, Math.ceil(cy + radius));
    for (let y = lo; y <= hi; y++) {
      for (let x = Math.max(0, Math.floor(cx - radius)); x <= Math.min(size - 1, Math.ceil(cx + radius)); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / radius;
        if (d >= 1) continue;
        const falloff = (1 - d) * (1 - d);
        put(x, y, color, falloff * alpha);
      }
    }
  };

  const bg = [13, 17, 23];
  for (let i = 0; i < size * size; i++) {
    rgba[i * 4] = bg[0];
    rgba[i * 4 + 1] = bg[1];
    rgba[i * 4 + 2] = bg[2];
    rgba[i * 4 + 3] = 255;
  }

  // Outer halo, then the orb body shaded from highlight to rim.
  glow(c, c, size * 0.46, [197, 143, 216], 0.42);
  glow(c, c, size * 0.32, [160, 190, 250], 0.3);

  const bodyR = size * 0.245;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      const d = Math.hypot(dx, dy);
      if (d > bodyR + 1.5) continue;
      const coverage = Math.min(1, Math.max(0, (bodyR - d) / 1.4 + 0.5));
      // Light from the upper left.
      const t = Math.min(1, Math.max(0, (dx * 0.5 + dy * 0.7) / bodyR * 0.5 + 0.5));
      const color = [
        Math.round(238 - t * 110),
        Math.round(196 - t * 110),
        Math.round(252 - t * 90),
      ];
      put(x, y, color, coverage);
    }
  }
  disc(c - bodyR * 0.34, c - bodyR * 0.38, bodyR * 0.24, [255, 255, 255], 0.55, 2);

  // The two carried orbs, on the horizontal axis.
  const satR = size * 0.072;
  const satX = size * 0.335;
  glow(c - satX, c, satR * 2.6, [125, 211, 252], 0.5);
  glow(c + satX, c, satR * 2.6, [255, 160, 90], 0.5);
  disc(c - satX, c, satR, [125, 211, 252], 1, 1.4);
  disc(c + satX, c, satR, [255, 160, 90], 1, 1.4);

  return rgba;
}

for (const size of [192, 512]) {
  writeFileSync(join(OUT, `icon-${size}.png`), encodePng(size, size, drawIcon(size)));
}

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#0d1117"/>
  <circle cx="32" cy="32" r="19" fill="#c58fd8" opacity="0.18"/>
  <circle cx="32" cy="32" r="12" fill="url(#g)"/>
  <circle cx="27" cy="27" r="3.4" fill="#fff" opacity="0.55"/>
  <circle cx="11" cy="32" r="4.6" fill="#7dd3fc"/>
  <circle cx="53" cy="32" r="4.6" fill="#ffa05a"/>
  <defs>
    <radialGradient id="g" cx="0.36" cy="0.32" r="0.78">
      <stop offset="0" stop-color="#eec4fc"/>
      <stop offset="1" stop-color="#80568e"/>
    </radialGradient>
  </defs>
</svg>
`;
writeFileSync(join(OUT, 'favicon.svg'), favicon);

const manifest = {
  name: 'Project Maelstrom',
  short_name: 'Maelstrom',
  description: 'Wake in a bounded arena. Gather with the gauntlets, craft, and learn what the program wants.',
  start_url: './',
  scope: './',
  display: 'standalone',
  // "any", not "portrait". The HUD relays and the camera rotates, so locking
  // this was quietly undoing all of that the moment anyone installed the game.
  orientation: 'any',
  categories: ['games'],
  background_color: '#0d1117',
  theme_color: '#0d1117',
  icons: [
    { src: './icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: './icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    // A maskable copy, or Android crops the art inside its own safe zone and
    // the icon arrives with its corners cut off.
    { src: './icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
};
writeFileSync(join(OUT, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2) + '\n');

console.log('  icons written to web/public/ (icon-192.png, icon-512.png, favicon.svg, manifest.webmanifest)');
