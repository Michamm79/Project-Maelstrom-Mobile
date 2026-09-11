#!/usr/bin/env node
/**
 * Character sprite sheet generator — GBA-era top-down pixel art.
 *
 * Style reference is the handheld Zelda look (chunky 1px tinted outline, 3-tone
 * shading, saturated palette, 4-direction facing, bouncy 4-frame walk). The
 * CHARACTER is original: a hooded alchemist, not anybody else's design.
 *
 * The body is authored as character maps and the legs are drawn per frame, so
 * a walk cycle costs four leg poses rather than sixteen hand-placed frames —
 * and proportions or colours can be retuned without redrawing anything.
 *
 * Run: npm run build:sprites
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { encodePng, scale } from './lib/png.mjs';

const OUT = resolve(import.meta.dirname, '../web/public/sprites');
mkdirSync(OUT, { recursive: true });

const W = 16;
const H = 24;

// ---------------------------------------------------------------- palette
// Outlines are a very dark violet rather than pure black: GBA sprite work tints
// its darks toward the subject, which is a large part of why the look reads as
// "warm" rather than "harsh".
const PALETTE = {
  '.': null,
  o: '#241a33', // outline
  h: '#6cbf8e', // hood light
  H: '#46906c', // hood mid
  d: '#2c6349', // hood shadow
  s: '#f0c49c', // skin
  S: '#c48f68', // skin shadow
  c: '#f2e6c8', // tunic light
  C: '#d4c096', // tunic shadow
  k: '#8a5a35', // leather
  K: '#5c3a20', // leather dark
  t: '#8d9bb5', // trouser
  T: '#6a7692', // trouser shadow
  b: '#7a4e2e', // boot
  B: '#4e2f1a', // boot dark
  y: '#e8d089', // pale hair
};

// ---------------------------------------------------------------- body maps
// Rows 0..17 only; legs are animated separately below.

const BODY = {
  down: [
    '......oooo......',
    '....oohhhhoo....',
    '...ohhhhhhhho...',
    '..ohhhhhhhhhho..',
    '..oHhhhhhhhhHo..',
    '..oHHddddddHHo..',
    '..oHdssssssdHo..',
    '..oHdsossosdHo..',
    '..oHdssssssdHo..',
    '...oHdSSSSdHo...',
    '...ooHHddHHoo...',
    '..oHHccccccHHo..',
    '..oHccccccccHo..',
    '..oHcckkkkccHo..',
    '..oHccKKKKccHo..',
    '..osccccccccso..',
    '...occcccccco...',
  ],
  up: [
    '......oooo......',
    '....oohhhhoo....',
    '...ohhhhhhhho...',
    '..ohhhhhhhhhho..',
    '..oHhhhhhhhhHo..',
    '..oHHhhhhhhHHo..',
    '..oHHhyyyyhHHo..',
    '..oHHhyyyyhHHo..',
    '..oHHdyyyydHHo..',
    '...oHHdyydHHo...',
    '...ooHHddHHoo...',
    '..oHHccccccHHo..',
    '..oHccccccccHo..',
    '..oHccccccccHo..',
    '..oHccKKKKccHo..',
    '..osccccccccso..',
    '...occcccccco...',
  ],
  side: [
    '.....oooo.......',
    '...oohhhhoo.....',
    '..ohhhhhhhho....',
    '..ohhhhhhhhho...',
    '..oHhhhhhhhho...',
    '..oHHdddddhho...',
    '..oHdssssssho...',
    '..oHdsossssho...',
    '..oHdssssssho...',
    '...oHdSSSSho....',
    '...ooHHddHHo....',
    '..oHHccccccHo...',
    '..oHcccccccHo...',
    '..oHcckkkkcHo...',
    '..oHccKKKKcHo...',
    '..oHcccccccso...',
    '...occcccco.....',
  ],
};

// ---------------------------------------------------------------- leg poses
// Four-frame cycle: contact, passing, contact (opposite), passing.
// `lift` raises a leg, `reach` pushes it forward, and the torso bobs up 1px on
// the passing frames, which is what gives the handheld Zelda walk its bounce.
const LEG_TOP = 17;
const LEG_BASE = 4;

const WALK = [
  { back: 0, front: 3, bob: 0 },
  { back: 2, front: 2, bob: -1 },
  { back: 3, front: 0, bob: 0 },
  { back: 2, front: 2, bob: -1 },
];

/** @param shade true for the far leg in profile, which reads as depth. */
function drawLeg(grid, x, top, length, shade = false) {
  // Trousers, not tunic: sharing the tunic colour made the legs disappear into
  // the robe and the whole figure read as a sack with feet.
  const leg = shade ? 'T' : 't';
  const legEdge = 'T';
  const boot = shade ? 'B' : 'b';

  for (let i = 0; i < length; i++) {
    const y = top + i;
    if (y >= H - 1) break;
    const isBoot = i >= length - 2;
    for (let dx = 0; dx < 3; dx++) {
      if (x + dx < 0 || x + dx >= W) continue;
      grid[y][x + dx] = isBoot ? (dx === 0 ? 'B' : boot) : dx === 0 ? legEdge : leg;
    }
    // Outline the outer edges so the leg keeps a silhouette against the ground.
    if (x - 1 >= 0 && grid[y][x - 1] === '.') grid[y][x - 1] = 'o';
    if (x + 3 < W && grid[y][x + 3] === '.') grid[y][x + 3] = 'o';
  }

  const footY = Math.min(H - 1, top + length);
  for (let dx = -1; dx <= 3; dx++) {
    if (x + dx >= 0 && x + dx < W) grid[footY][x + dx] = 'o';
  }
}

function buildFrame(facing, frame) {
  const grid = Array.from({ length: H }, () => Array(W).fill('.'));
  const body = BODY[facing === 'side' ? 'side' : facing];
  const { back, front, bob } = WALK[frame];

  for (let y = 0; y < body.length; y++) {
    const row = body[y];
    for (let x = 0; x < W; x++) {
      const ch = row[x];
      if (ch === '.') continue;
      const ty = y + bob;
      if (ty >= 0 && ty < H) grid[ty][x] = ch;
    }
  }

  const top = LEG_TOP + bob;
  if (facing === 'side') {
    // Profile: the far leg is drawn first, shaded, and slightly behind.
    drawLeg(grid, 5, top, LEG_BASE + back, true);
    drawLeg(grid, 8, top, LEG_BASE + front);
  } else {
    drawLeg(grid, 4, top, LEG_BASE + back);
    drawLeg(grid, 9, top, LEG_BASE + front);
  }

  return grid;
}

// ---------------------------------------------------------------- raster
function hexToRgb(hex) {
  const v = Number.parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function blit(rgba, sheetW, grid, ox, oy, mirror = false) {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ch = grid[y][mirror ? W - 1 - x : x];
      const hex = PALETTE[ch];
      if (!hex) continue;
      const [r, g, b] = hexToRgb(hex);
      const i = ((oy + y) * sheetW + ox + x) * 4;
      rgba[i] = r;
      rgba[i + 1] = g;
      rgba[i + 2] = b;
      rgba[i + 3] = 255;
    }
  }
}

// ---------------------------------------------------------------- validate
const problems = [];
for (const [name, rows] of Object.entries(BODY)) {
  rows.forEach((row, i) => {
    if (row.length !== W) problems.push(`${name} row ${i}: ${row.length} chars (want ${W}) "${row}"`);
    for (const ch of row) if (!(ch in PALETTE)) problems.push(`${name} row ${i}: unknown colour "${ch}"`);
  });
}
if (problems.length) {
  console.error('\n  sprite data invalid:\n' + problems.map((p) => `   x ${p}`).join('\n') + '\n');
  process.exit(1);
}

// ---------------------------------------------------------------- emit
const ROWS = ['down', 'side', 'up', 'sideMirror'];
const sheetW = W * WALK.length;
const sheetH = H * ROWS.length;
const sheet = Buffer.alloc(sheetW * sheetH * 4);

ROWS.forEach((row, r) => {
  const facing = row === 'sideMirror' ? 'side' : row;
  for (let f = 0; f < WALK.length; f++) {
    blit(sheet, sheetW, buildFrame(facing, f), f * W, r * H, row === 'sideMirror');
  }
});

writeFileSync(join(OUT, 'alchemist.png'), encodePng(sheetW, sheetH, sheet));

// Preview at 6x on a contrasting ground, so the sheet is readable at a glance.
const Z = 6;
const preview = scale(sheet, sheetW, sheetH, Z);
for (let i = 0; i < preview.length; i += 4) {
  if (preview[i + 3] === 0) {
    preview[i] = 32;
    preview[i + 1] = 42;
    preview[i + 2] = 38;
    preview[i + 3] = 255;
  }
}
writeFileSync(join(OUT, 'alchemist-preview.png'), encodePng(sheetW * Z, sheetH * Z, preview));

console.log(`\n  sprites -> web/public/sprites/alchemist.png  (${sheetW}x${sheetH}, ${W}x${H} frames)`);
console.log(`  rows: ${ROWS.join(', ')}   frames per row: ${WALK.length}`);
console.log(`  preview -> web/public/sprites/alchemist-preview.png (${Z}x)\n`);
