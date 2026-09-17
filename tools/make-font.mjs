#!/usr/bin/env node
/**
 * The game's typeface, built from `tools/font/glyphs.mjs` into a real TrueType
 * file.
 *
 * ## Why a font file and not a canvas routine
 *
 * The HUD is DOM - bars, buttons, menus, the log, every note the player reads.
 * A bitmap text renderer on a canvas cannot touch any of it, so the only way
 * the interface stops being the last smooth surface in a pixel-art game is a
 * font the browser can actually set on an element. That means TTF.
 *
 * ## Why generated rather than downloaded
 *
 * The project's one claim about its art is that all of it comes out of code in
 * this repository. A pixel font pulled off the internet would be the single
 * asset that claim is not true of, and it would be a licence to track as well.
 * This is the same bargain `make-sprites.mjs` makes for the character: author
 * the pixels, emit the file, commit the result.
 *
 * ## How a square becomes a glyph
 *
 * Every lit cell in the 5x9 grid is emitted as its own four-point contour
 * wound clockwise. TrueType fills by non-zero winding, so squares that touch
 * merge into one shape with no seam and squares that do not stay separate -
 * which means the outline never has to be traced. It costs more points than a
 * traced outline and saves the entire problem.
 *
 * Run: npm run build:font
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { CHARS, CELL_W, ROWS_ABOVE, ROWS_TOTAL, pixelsOf } from './font/glyphs.mjs';

const OUT = resolve(import.meta.dirname, '../web/src/assets');

/*
 * 1000 units per em and 100 per pixel, so a capital is 700 units tall and the
 * advance is a clean 600. Round numbers matter more here than anywhere else in
 * the project: a font whose pixel is 83.33 units lands its edges between
 * device pixels at most sizes and the whole point of this typeface is that it
 * does not.
 */
const UPM = 1000;
const PIXEL = 100;
const ADVANCE = (CELL_W + 1) * PIXEL;
const ASCENDER = 800;
const DESCENDER = -200;

/* ------------------------------------------------------------- binary io -- */

class Writer {
  constructor() {
    this.bytes = [];
  }
  u8(v) {
    this.bytes.push(v & 0xff);
    return this;
  }
  u16(v) {
    return this.u8(v >> 8).u8(v);
  }
  i16(v) {
    return this.u16(v < 0 ? v + 0x10000 : v);
  }
  u32(v) {
    return this.u16((v >>> 16) & 0xffff).u16(v & 0xffff);
  }
  tag(s) {
    for (const c of s) this.u8(c.charCodeAt(0));
    return this;
  }
  raw(arr) {
    for (const b of arr) this.bytes.push(b & 0xff);
    return this;
  }
  pad4() {
    while (this.bytes.length % 4) this.u8(0);
    return this;
  }
  get length() {
    return this.bytes.length;
  }
  buffer() {
    return Buffer.from(this.bytes);
  }
}

/** A table's checksum is the sum of its uint32s, with the tail zero-padded. */
function checksum(buf) {
  let sum = 0;
  for (let i = 0; i < buf.length; i += 4) {
    const word =
      ((buf[i] ?? 0) << 24) | ((buf[i + 1] ?? 0) << 16) | ((buf[i + 2] ?? 0) << 8) | (buf[i + 3] ?? 0);
    sum = (sum + (word >>> 0)) >>> 0;
  }
  return sum >>> 0;
}

/* ---------------------------------------------------------------- glyphs -- */

/**
 * One glyph's outline.
 *
 * Runs of lit cells along a row are merged into a single rectangle first. It is
 * not an optimisation for its own sake: a capital E is 19 lit cells and 5
 * rectangles, and a font whose every glyph carries four times the points it
 * needs is one the browser's rasteriser has to hint four times as hard at the
 * small sizes this is for.
 */
function outline(ch) {
  const grid = pixelsOf(ch);
  const rects = [];
  for (let r = 0; r < ROWS_TOTAL; r++) {
    let run = -1;
    for (let c = 0; c <= CELL_W; c++) {
      const lit = c < CELL_W && grid[r][c];
      if (lit && run < 0) run = c;
      if (!lit && run >= 0) {
        // Row r sits above the baseline for r < ROWS_ABOVE and below it after.
        const top = (ROWS_ABOVE - r) * PIXEL;
        rects.push({ x0: run * PIXEL, y0: top - PIXEL, x1: c * PIXEL, y1: top });
        run = -1;
      }
    }
  }
  return rects;
}

function glyphTable(ch) {
  const rects = outline(ch);
  if (!rects.length) return Buffer.alloc(0);

  const w = new Writer();
  let xMin = Infinity;
  let yMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;
  for (const r of rects) {
    xMin = Math.min(xMin, r.x0);
    yMin = Math.min(yMin, r.y0);
    xMax = Math.max(xMax, r.x1);
    yMax = Math.max(yMax, r.y1);
  }

  w.i16(rects.length).i16(xMin).i16(yMin).i16(xMax).i16(yMax);
  for (let i = 0; i < rects.length; i++) w.u16((i + 1) * 4 - 1);
  w.u16(0); // no instructions

  // Every point is on-curve, and every delta is a plain int16. The short forms
  // would save bytes on a font this size and cost the one thing worth having
  // here, which is being able to read this function and believe it.
  const points = [];
  for (const r of rects) {
    points.push([r.x0, r.y0], [r.x0, r.y1], [r.x1, r.y1], [r.x1, r.y0]);
  }
  for (let i = 0; i < points.length; i++) w.u8(0x01);

  let prev = 0;
  for (const [x] of points) {
    w.i16(x - prev);
    prev = x;
  }
  prev = 0;
  for (const [, y] of points) {
    w.i16(y - prev);
    prev = y;
  }

  w.pad4();
  return w.buffer();
}

/* ---------------------------------------------------------------- tables -- */

function buildFont() {
  // Glyph 0 is .notdef and is deliberately empty: a font that draws a box for
  // every character it does not have turns one missing glyph into a wall of
  // boxes, and this one covers everything the game writes.
  const glyphs = [Buffer.alloc(0), ...CHARS.map(glyphTable)];
  const numGlyphs = glyphs.length;

  const loca = new Writer();
  let offset = 0;
  for (const g of glyphs) {
    loca.u32(offset);
    offset += g.length;
  }
  loca.u32(offset);

  const glyf = Buffer.concat(glyphs);

  const hmtx = new Writer();
  for (let i = 0; i < numGlyphs; i++) hmtx.u16(ADVANCE).i16(0);

  const head = new Writer();
  head
    .u32(0x00010000)
    .u32(0x00010000)
    .u32(0) // checkSumAdjustment, filled in at the end
    .u32(0x5f0f3cf5)
    .u16(0x000b) // flags: baseline at y=0, lsb at x=0, integer ppem
    .u16(UPM)
    .u32(0)
    .u32(0) // created
    .u32(0)
    .u32(0) // modified
    .i16(0)
    .i16(DESCENDER)
    .i16(CELL_W * PIXEL)
    .i16(ROWS_ABOVE * PIXEL)
    .u16(0)
    .u16(8)
    .i16(2)
    .i16(1) // long loca
    .i16(0);

  const hhea = new Writer();
  hhea
    .u32(0x00010000)
    .i16(ASCENDER)
    .i16(DESCENDER)
    .i16(0)
    .u16(ADVANCE)
    .i16(0)
    .i16(0)
    .i16(CELL_W * PIXEL)
    .i16(1)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .u16(numGlyphs);

  const maxp = new Writer();
  maxp
    .u32(0x00010000)
    .u16(numGlyphs)
    .u16(ROWS_TOTAL * CELL_W * 4)
    .u16(ROWS_TOTAL * CELL_W)
    .u16(0)
    .u16(0)
    .u16(2)
    .u16(0)
    .u16(0)
    .u16(0)
    .u16(0)
    .u16(0)
    .u16(0)
    .u16(0)
    .u16(0);

  /*
   * cmap format 4, one contiguous segment per run of characters.
   *
   * The set is ASCII plus five typographic marks, which is two runs with a gap
   * between them - so the segments are computed rather than assumed. The first
   * version hard-coded one segment from 32 to 126 and silently dropped the em
   * dash, the middot, the bullet, the degree and the times sign, which is to
   * say every character the prose actually needed.
   */
  const segments = [];
  for (let i = 0; i < CHARS.length; i++) {
    const code = CHARS[i].codePointAt(0);
    const last = segments[segments.length - 1];
    if (last && code === last.end + 1) {
      last.end = code;
    } else {
      segments.push({ start: code, end: code, glyph: i + 1 });
    }
  }
  segments.push({ start: 0xffff, end: 0xffff, glyph: 0 });

  const segCount = segments.length;
  const cmapSub = new Writer();
  const searchRange = 2 * 2 ** Math.floor(Math.log2(segCount));
  cmapSub
    .u16(4)
    .u16(16 + segCount * 8)
    .u16(0)
    .u16(segCount * 2)
    .u16(searchRange)
    .u16(Math.log2(searchRange / 2))
    .u16(segCount * 2 - searchRange);
  for (const s of segments) cmapSub.u16(s.end);
  cmapSub.u16(0);
  for (const s of segments) cmapSub.u16(s.start);
  for (const s of segments) cmapSub.i16(s.start === 0xffff ? 1 : (s.glyph - s.start) & 0xffff);
  for (const _ of segments) cmapSub.u16(0);

  const cmap = new Writer();
  cmap.u16(0).u16(1).u16(3).u16(1).u32(12).raw(cmapSub.bytes);

  const NAMES = [
    [1, 'Maelstrom Pixel'],
    [2, 'Regular'],
    [3, 'Maelstrom Pixel Regular'],
    [4, 'Maelstrom Pixel'],
    [6, 'MaelstromPixel-Regular'],
  ];
  const name = new Writer();
  name.u16(0).u16(NAMES.length).u16(6 + NAMES.length * 12);
  let strOffset = 0;
  const strings = [];
  for (const [id, text] of NAMES) {
    // Platform 3, encoding 1, language 0x409: UTF-16BE, which is the record
    // every browser reads.
    const utf16 = [];
    for (const c of text) {
      utf16.push((c.charCodeAt(0) >> 8) & 0xff, c.charCodeAt(0) & 0xff);
    }
    name.u16(3).u16(1).u16(0x409).u16(id).u16(utf16.length).u16(strOffset);
    strings.push(utf16);
    strOffset += utf16.length;
  }
  for (const s of strings) name.raw(s);
  name.pad4();

  const post = new Writer();
  post.u32(0x00030000).u32(0).i16(-100).i16(PIXEL).u32(1).u32(0).u32(0).u32(0).u32(0);

  const os2 = new Writer();
  os2
    .u16(4)
    .i16(ADVANCE)
    .u16(400)
    .u16(5)
    .u16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    .i16(0)
    // PANOSE: a monospaced, even-weight, square sans.
    .raw([2, 11, 5, 9, 2, 2, 2, 2, 2, 4])
    .u32(0x00000003)
    .u32(0)
    .u32(0)
    .u32(0)
    .tag('MLST')
    .u16(0x0040) // regular
    .u16(CHARS[0].codePointAt(0))
    .u16(CHARS[CHARS.length - 1].codePointAt(0))
    .i16(ASCENDER)
    .i16(DESCENDER)
    .i16(0)
    .u16(ASCENDER)
    .u16(-DESCENDER)
    .u32(0)
    .u32(0)
    .i16(5 * PIXEL) // x-height
    .i16(ROWS_ABOVE * PIXEL) // cap height
    .u16(0)
    .u16(0)
    .u16(1);

  const tables = [
    ['OS/2', os2.buffer()],
    ['cmap', cmap.buffer()],
    ['glyf', glyf],
    ['head', head.buffer()],
    ['hhea', hhea.buffer()],
    ['hmtx', hmtx.buffer()],
    ['loca', loca.buffer()],
    ['maxp', maxp.buffer()],
    ['name', name.buffer()],
    ['post', post.buffer()],
  ].sort((a, b) => (a[0] < b[0] ? -1 : 1));

  const count = tables.length;
  const entrySelector = Math.floor(Math.log2(count));
  const sr = 2 ** entrySelector * 16;

  const header = new Writer();
  header.u32(0x00010000).u16(count).u16(sr).u16(entrySelector).u16(count * 16 - sr);

  let pos = 12 + count * 16;
  const records = new Writer();
  const bodies = [];
  for (const [tag, buf] of tables) {
    const padded = Buffer.concat([buf, Buffer.alloc((4 - (buf.length % 4)) % 4)]);
    records.tag(tag).u32(checksum(padded)).u32(pos).u32(buf.length);
    bodies.push(padded);
    pos += padded.length;
  }

  const file = Buffer.concat([header.buffer(), records.buffer(), ...bodies]);

  /*
   * checkSumAdjustment: 0xB1B0AFBA minus the checksum of the whole file with
   * this field still zero. Browsers do not verify it, but every font tool
   * does, and a font that fails validation is one nobody can debug later.
   */
  const headIndex = tables.findIndex(([t]) => t === 'head');
  let headOffset = 12 + count * 16;
  for (let i = 0; i < headIndex; i++) headOffset += bodies[i].length;
  file.writeUInt32BE((0xb1b0afba - checksum(file)) >>> 0, headOffset + 8);

  return { file, numGlyphs };
}

mkdirSync(OUT, { recursive: true });
const { file, numGlyphs } = buildFont();
writeFileSync(join(OUT, 'maelstrom.ttf'), file);

console.log(
  `\n  font    -> web/src/assets/maelstrom.ttf  (${numGlyphs} glyphs, ${(file.length / 1024).toFixed(1)}KB, ${CELL_W}x${ROWS_ABOVE} cell)\n`,
);
