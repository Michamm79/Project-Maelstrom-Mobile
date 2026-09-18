/**
 * What a thing made of code looks like when it stops running.
 *
 * Canon is unusually direct about this: the three tiers are "renderings of
 * hostile code", a goblin the way a file manifests as an icon. So a killed
 * enemy should not fall over and it should not fade out like a body. It should
 * stop being rendered - and the honest picture of that is the silhouette coming
 * apart into the ones and zeroes it was standing in for.
 *
 * The glyphs are sampled from the REAL creature art rather than scattered in a
 * box. `drawCreature` is rendered once per tier into an offscreen canvas, the
 * alpha channel is walked, and a glyph is placed wherever the creature actually
 * had a pixel. That is the whole reason the effect reads as the goblin being
 * deleted rather than as a puff of numbers near a goblin: the binary is the
 * shape of the thing that died, including its horns and its scythe.
 *
 * Drawn with cached glyph bitmaps rather than fillText. A tier-3 death is about
 * 120 glyphs, several deaths overlap, and text layout per glyph per frame is
 * the kind of cost that only shows up on the device you do not own.
 */
import { drawCreature, isCreature, type CreatureId } from './creatures';
import { withAlpha } from './icons';

/** Seconds from the kill to the last glyph going out. */
export const DELETION_SECONDS = 1.05;

/** How long the silhouette stays white before it starts converting. */
const FLASH_SECONDS = 0.1;

/** World units between sampled points. Smaller is denser and more expensive. */
const SAMPLE_STRIDE = 5;

/** Nothing bigger is worth drawing; a death is over before anyone counts them. */
const MAX_GLYPHS = 150;

/**
 * Glyph cell size in world units.
 *
 * Smaller than the sampling stride on purpose. At 7 the cells overlapped by two
 * units and the creature came apart as a solid block of digits - unmistakably
 * data, but no longer unmistakably a minotaur. Tiles with a hairline gap now,
 * which is what lets the silhouette survive being made of numbers.
 */
const GLYPH = 4.6;

/**
 * Fraction of a glyph's life spent holding position before it drifts.
 *
 * Without it the shape was gone inside two frames: the creature flashed and
 * became a cloud, and the one thing worth seeing - that the cloud IS the
 * creature - was over before anyone could see it. A beat of the silhouette
 * standing there flickering is the whole effect.
 */
const HOLD = 0.34;

export interface Glyph {
  /** Offset from the creature's origin, in world units. */
  ox: number;
  oy: number;
  /** Where it drifts to, as a velocity in world units per second. */
  vx: number;
  vy: number;
  /** 0 or 1 to start with; it flickers between them on the way out. */
  bit: number;
  /** Staggers the conversion so it sweeps rather than switching at once. */
  delay: number;
  flicker: number;
}

export interface Deletion {
  x: number;
  y: number;
  color: string;
  size: number;
  age: number;
  glyphs: Glyph[];
}

/**
 * Deterministic per creature and size, so the same tier always comes apart the
 * same way. Two goblins dying together looking identical is far less odd than
 * the same goblin looking different every run.
 */
function rng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const silhouettes = new Map<string, { ox: number; oy: number }[]>();

/**
 * Where the creature actually has pixels.
 *
 * Rendered at 1:1 into an offscreen canvas and read back once per tier. The
 * pose is deliberately neutral - no wind-up, no stagger, facing right - because
 * this is the shape of the species rather than of the moment it died in, and
 * caching a pose would mean one frame of the animation deciding the silhouette
 * for every death after it.
 */
function silhouette(id: CreatureId, size: number): { ox: number; oy: number }[] {
  const key = `${id}:${Math.round(size)}`;
  const cached = silhouettes.get(key);
  if (cached) return cached;

  const points: { ox: number; oy: number }[] = [];
  if (typeof document === 'undefined') return points;

  // The authored box is 100 units tall and creatures are drawn centred on the
  // origin, so a square of `size` with room either side covers every tier.
  const box = Math.ceil(size * 1.6);
  const canvas = document.createElement('canvas');
  canvas.width = box;
  canvas.height = box;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return points;

  ctx.translate(box / 2, box / 2);
  drawCreature(ctx, id, {
    color: '#ffffff',
    size,
    time: 0,
    phase: 0,
    facing: 1,
    windUp: 0,
    stagger: 0,
    aggro: false,
    flash: 0,
  });

  let pixels: Uint8ClampedArray;
  try {
    pixels = ctx.getImageData(0, 0, box, box).data;
  } catch {
    // A tainted or zero-sized canvas. The effect degrades to nothing rather
    // than taking a kill down with it.
    silhouettes.set(key, points);
    return points;
  }

  for (let y = 0; y < box; y += SAMPLE_STRIDE) {
    for (let x = 0; x < box; x += SAMPLE_STRIDE) {
      // Half-opaque or better: the outlines and soft edges would otherwise
      // double the glyph count for pixels nobody can see.
      if ((pixels[(y * box + x) * 4 + 3] ?? 0) < 128) continue;
      points.push({ ox: x - box / 2, oy: y - box / 2 });
    }
  }

  // Thin out evenly rather than truncating, which would delete one side of the
  // creature and leave the deletion lopsided.
  if (points.length > MAX_GLYPHS) {
    const step = points.length / MAX_GLYPHS;
    const kept: { ox: number; oy: number }[] = [];
    for (let i = 0; i < MAX_GLYPHS; i++) kept.push(points[Math.floor(i * step)]!);
    points.length = 0;
    points.push(...kept);
  }

  silhouettes.set(key, points);
  return points;
}

/** Build the effect for one death. Returns null for anything with no art. */
export function makeDeletion(
  id: string,
  x: number,
  y: number,
  color: string,
  size: number,
): Deletion | null {
  if (!isCreature(id)) return null;
  const points = silhouette(id, size);
  if (!points.length) return null;

  const random = rng(Math.round(x * 31 + y * 17));
  let lowest = -Infinity;
  for (const p of points) lowest = Math.max(lowest, p.oy);
  let highest = Infinity;
  for (const p of points) highest = Math.min(highest, p.oy);
  const span = Math.max(1, lowest - highest);

  const glyphs: Glyph[] = points.map((p) => {
    /*
     * The conversion sweeps upward from the feet.
     *
     * All at once reads as an explosion; a sweep reads as something being
     * taken apart in order, which is what a program being killed looks like
     * and what makes the effect legible at a glance rather than just busy.
     */
    const fromBottom = (lowest - p.oy) / span;
    return {
      ox: p.ox,
      oy: p.oy,
      // Outward from the centre line, and mostly up: data coming off the thing
      // rather than debris falling off it.
      vx: (p.ox / span) * 34 + (random() - 0.5) * 26,
      vy: -40 - random() * 46,
      bit: random() > 0.5 ? 1 : 0,
      delay: fromBottom * 0.3 + random() * 0.06,
      flicker: 7 + random() * 12,
    };
  });

  return { x, y, color, size, age: 0, glyphs };
}

/** Where one glyph is, and how it looks, at a given age. Null before it exists. */
export interface GlyphPhase {
  /** 0 at conversion, 1 when gone. */
  k: number;
  x: number;
  y: number;
  alpha: number;
  /** White, because it has only just stopped being part of a creature. */
  hot: boolean;
  bit: number;
}

/**
 * The timeline for one glyph, as pure arithmetic.
 *
 * Separated out because the sweep direction is genuinely easy to get backwards
 * - `oy` grows downward, so "sweeps up from the feet" is a delay that grows as
 * `oy` shrinks - and getting it backwards produces an effect that still looks
 * fine in a screenshot while running the wrong way.
 */
export function glyphPhase(age: number, g: Glyph): GlyphPhase | null {
  const life = age - FLASH_SECONDS - g.delay;
  if (life < 0) return null;

  const remaining = DELETION_SECONDS - FLASH_SECONDS - g.delay;
  const k = Math.min(1, life / Math.max(0.01, remaining));

  // Hold, then go. See HOLD: the shape has to be readable before it leaves.
  const drift = Math.max(0, (k - HOLD) / (1 - HOLD));
  const travel = 1 - Math.pow(1 - drift, 2.2);

  return {
    k,
    x: g.ox + g.vx * travel,
    y: g.oy + g.vy * travel,
    alpha: Math.min(1, (1 - k) * 1.6),
    hot: k < 0.18,
    bit: (g.bit + Math.floor(life * g.flicker)) % 2,
  };
}

const glyphCache = new Map<string, HTMLCanvasElement>();

/**
 * One digit, baked.
 *
 * fillText per glyph per frame is a text layout per glyph per frame. Six small
 * canvases - two digits across three tier colours - turn the whole effect into
 * drawImage calls, which is the difference between this being free and this
 * being the reason a phone drops frames when three things die at once.
 */
function glyphBitmap(bit: number, color: string): HTMLCanvasElement | null {
  const key = `${bit}:${color}`;
  const cached = glyphCache.get(key);
  if (cached) return cached;
  if (typeof document === 'undefined') return null;

  const scale = 3;
  const canvas = document.createElement('canvas');
  canvas.width = GLYPH * scale;
  canvas.height = GLYPH * scale;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.scale(scale, scale);
  ctx.font = `700 ${GLYPH}px ui-monospace, "DejaVu Sans Mono", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(String(bit), GLYPH / 2, GLYPH / 2);

  glyphCache.set(key, canvas);
  return canvas;
}

/**
 * Draw one deletion in world space, with the caller already translated to the
 * world origin. `age` is advanced by the owner.
 */
export function drawDeletion(ctx: CanvasRenderingContext2D, d: Deletion): void {
  const t = d.age / DELETION_SECONDS;
  if (t >= 1) return;

  ctx.save();
  ctx.translate(d.x, d.y);

  /*
   * The flash: the silhouette goes white before anything moves.
   *
   * Drawn from the same sampled points rather than by re-rendering the
   * creature, so the flash is already made of the cells that are about to
   * become digits - the shape does not change, only what it is made of.
   */
  if (d.age < FLASH_SECONDS) {
    const strength = 1 - d.age / FLASH_SECONDS;
    ctx.fillStyle = withAlpha('#ffffff', 0.55 + strength * 0.45);
    for (const g of d.glyphs) {
      ctx.fillRect(g.ox - SAMPLE_STRIDE / 2, g.oy - SAMPLE_STRIDE / 2, SAMPLE_STRIDE, SAMPLE_STRIDE);
    }
  }

  /*
   * The conversion line.
   *
   * A bright rule riding up the silhouette just ahead of the glyphs that have
   * turned. It is what makes the sweep read as a sweep rather than as the
   * bottom half happening to fade first, and it is one fillRect.
   */
  const sweep = (d.age - FLASH_SECONDS) / 0.34;
  if (sweep > 0 && sweep < 1) {
    let lowest = -Infinity;
    let highest = Infinity;
    for (const g of d.glyphs) {
      lowest = Math.max(lowest, g.oy);
      highest = Math.min(highest, g.oy);
    }
    const line = lowest - (lowest - highest) * sweep;
    const width = d.size * 0.55;
    ctx.fillStyle = withAlpha('#ffffff', 0.5 * (1 - sweep));
    ctx.fillRect(-width, line - 1, width * 2, 2);
  }

  const white = glyphBitmap(0, '#ffffff');
  for (const g of d.glyphs) {
    const phase = glyphPhase(d.age, g);
    if (!phase) continue;
    // White for the first moment it exists, then the creature's own colour:
    // hot at the point of conversion, cooling as it leaves.
    const sheet = phase.hot ? white : glyphBitmap(phase.bit, d.color);
    if (!sheet) continue;

    ctx.globalAlpha = phase.alpha;
    ctx.drawImage(sheet, phase.x - GLYPH / 2, phase.y - GLYPH / 2, GLYPH, GLYPH);
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}
