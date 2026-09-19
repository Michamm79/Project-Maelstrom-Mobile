#!/usr/bin/env node
/**
 * Character sprite sheet generator — GBA-era top-down pixel art.
 *
 * Style reference is the handheld look (chunky 1px tinted outline, 3-tone
 * shading, 4-direction facing, bouncy 4-frame walk). The CHARACTER is drawn
 * from a reference the author supplied of themselves: silver hair, a black
 * shirt that covers the arms and the upper back but leaves the torso bare, and
 * dark trousers. It replaced a hooded alchemist, which is why the palette's
 * `h/H/d` ramp is hair where it used to be a hood.
 *
 * That cut is what makes the figure legible rather than a problem to solve: the
 * bare torso is a light mass between two dark sleeves, so the shirt can be as
 * near-black as it should be without the whole silhouette going flat against
 * dark ground. Silver hair does the same job at the top.
 *
 * The belt has to stay dark for the same reason in reverse - a warm brown at
 * skin value merged into the torso and the two read as one tan block.
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

// The sheet goes into src/ so the bundler processes it: at 875 bytes it lands
// under Vite's inline limit and becomes a data URI, which is what keeps the
// single-file build self-contained. A public/ path would 404 there.
const OUT = resolve(import.meta.dirname, '../web/src/assets');
const PREVIEW_OUT = resolve(import.meta.dirname, '../docs/art');
mkdirSync(OUT, { recursive: true });
mkdirSync(PREVIEW_OUT, { recursive: true });

const W = 16;
const H = 24;

// ---------------------------------------------------------------- palette
// Outlines are a very dark violet rather than pure black: GBA sprite work tints
// its darks toward the subject, which is a large part of why the look reads as
// "warm" rather than "harsh".
const PALETTE = {
  '.': null,
  o: '#1d1526', // outline
  h: '#e2e6ec', // hair light - silver
  H: '#b3b9c4', // hair mid
  d: '#848b98', // hair shadow, and the line where it meets the face
  s: '#efc09a', // skin
  S: '#c8926a', // skin shadow
  c: '#312f3a', // shirt, lit
  C: '#1f1d26', // shirt, shadow
  k: '#4a3a2c', // belt - dark leather, or it reads as more skin
  K: '#2b211a', // belt dark
  t: '#1f1c26', // trouser
  T: '#15131a', // trouser shadow
  b: '#2c2630', // boot
  B: '#19161c', // boot dark
  y: '#b3b9c4', // kept for compatibility; the hood's pale hair is now hair
};

// ---------------------------------------------------------------- body maps
// Rows 0..17 only; legs are animated separately below.

const BODY = {
  down: [
    '......oooo......',
    '....oohhhhoo....',
    '...ohhHhhHhhho..',
    '..ohhhhhhhhhho..',
    '..oHhhhhhhhhHo..',
    '..oHHhhhhhhHHo..',
    '..oHdssssssdHo..',
    '..oHdsossosdHo..',
    '..oHdssssssdHo..',
    '...oHdSSSSdHo...',
    '...ooHHddHHoo...',
    '..occcccccccco..',
    '..oCcsssssscCo..',
    '..oCcsssssscCo..',
    '..oCckkkkkkcCo..',
    '..osttttttttso..',
    '...otttttttto...',
  ],
  up: [
    '......oooo......',
    '....oohhhhoo....',
    '...ohhHhhHhhho..',
    '..ohhhhhhhhhho..',
    '..oHhhhhhhhhHo..',
    '..oHHhhhhhhHHo..',
    '..oHhhhhhhhhHo..',
    '..oHHhhhhhhHHo..',
    '..oHHdhhhhdHHo..',
    '...oHHddddHHo...',
    '...ooHHddHHoo...',
    '..occcccccccco..',
    '..oCccccccccCo..',
    '..oCcsssssscCo..',
    '..oCckkkkkkcCo..',
    '..osttttttttso..',
    '...otttttttto...',
  ],
  side: [
    '.....oooo.......',
    '...oohhhhoo.....',
    '..ohhhhhhhho....',
    '..ohhhhhhhhho...',
    '..oHhhhhhhhho...',
    '..oHHhhhhhhho...',
    '..oHdssssssho...',
    '..oHdsossssho...',
    '..oHdssssssho...',
    '...oHdSSSSho....',
    '...ooHHddHHo....',
    '..occccccccco...',
    '..oCsssssscCo...',
    '..oCsssssscCo...',
    '..oCkkkkkkcCo...',
    '..ostttttttso...',
    '...ottttttto....',
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
writeFileSync(join(PREVIEW_OUT, 'alchemist-preview.png'), encodePng(sheetW * Z, sheetH * Z, preview));

console.log(`\n  sheet   -> web/src/assets/alchemist.png  (${sheetW}x${sheetH}, ${W}x${H} frames)`);
console.log(`  rows: ${ROWS.join(', ')}   frames per row: ${WALK.length}`);
console.log(`  preview -> docs/art/alchemist-preview.png (${Z}x, documentation only)\n`);
