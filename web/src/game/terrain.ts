/**
 * The regions, as places rather than palettes.
 *
 * A biome used to be one radial gradient of its ground colour with props
 * scattered on top, which made every region the spawn in a different colour.
 * This gives two of them - the two the spawn withholds, and so the two anyone
 * actually travels for - the four things that separate a place from a tint:
 *
 * - **A tiled floor.** Baked once per biome into a small canvas and repeated,
 *   so the ground has grain that belongs to it: wind-packed snow, or a raised
 *   server floor with panel seams.
 * - **A dithered edge.** The old fade was an alpha ramp, and a gradient is the
 *   one thing the whole pixel pass exists to remove. A two-step dither band
 *   reads as a snowline or the edge of the concrete.
 * - **Elevation.** A lit top face and a dark front face is the oldest trick in
 *   top-down games and the only cheap way to get height when the camera looks
 *   straight down. Shelves on the mountain, plinths and trenches in the ruin.
 * - **Motion.** Drifting snow, and a scan that crawls across the floor. A place
 *   that moves is identified faster than a place that is a different colour.
 *
 * Everything here is deterministic from the biome id and the world position, so
 * the mountain has the same shelves every run and they do not swim when the
 * camera moves.
 */
import type { BiomeDisc } from './world';
import { withAlpha } from './icons';

export interface Bounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** World units per tile pixel. Two, so a tile pixel is about one art pixel. */
const TILE_UNIT = 2;
/** Tile size in tile pixels. 32 keeps the repeat from reading as a repeat. */
const TILE = 32;

/** Ordered dither, the same 4x4 the cover's sky uses. */
const BAYER = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

function threshold(x: number, y: number, level: number): boolean {
  return (BAYER[((y % 4) + 4) % 4]![((x % 4) + 4) % 4]! + 0.5) / 16 < level;
}

/**
 * Deterministic noise keyed by position.
 *
 * A seeded sequence would give the same tile every time but a different answer
 * for the same spot depending on how many cells were drawn before it, which is
 * exactly what makes scenery swim when the camera moves. Hashing the coordinate
 * means a square of ground always answers the same way.
 */
function hash(x: number, y: number, salt: number): number {
  let h = (x * 374761393 + y * 668265263 + salt * 1442695040888963407) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const to = (v: number) =>
    Math.max(0, Math.min(255, Math.round(k >= 0 ? v + (255 - v) * k : v * (1 + k))));
  return `rgb(${to((n >> 16) & 255)}, ${to((n >> 8) & 255)}, ${to(n & 255)})`;
}

/* ----------------------------------------------------------------- tiles -- */

const tiles = new Map<string, CanvasPattern | null>();

/**
 * Bake a biome's floor once.
 *
 * The pattern is built at tile-pixel resolution and scaled up by the pattern
 * transform rather than drawn large, which is what keeps its grain on the art
 * grid instead of a size of its own.
 */
function bakeTile(disc: BiomeDisc, ctx: CanvasRenderingContext2D): CanvasPattern | null {
  const key = disc.id;
  const cached = tiles.get(key);
  if (cached !== undefined) return cached;

  const c = document.createElement('canvas');
  c.width = TILE;
  c.height = TILE;
  const g = c.getContext('2d');
  if (!g) {
    tiles.set(key, null);
    return null;
  }

  const p = disc.palette;
  g.fillStyle = p.ground;
  g.fillRect(0, 0, TILE, TILE);

  if (disc.id === 'snowy_mountain') {
    /*
     * Snow, which means the PALE colour is the ground and the dark one is what
     * shows through it.
     *
     * The first version had this the other way round - the region's dark slate
     * as the base with white streaks combed across it - and it came out as a
     * barcode: high contrast, edge to edge, with the diagonal repeat plainly
     * visible at arm's length. A snowfield is mostly one value. The drift is
     * the small departure from it, not the subject.
     */
    g.fillStyle = shade(p.accent, -0.3);
    g.fillRect(0, 0, TILE, TILE);

    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        // A long, shallow comb - the angle is what says wind rather than noise.
        const drift = Math.sin((x * 0.22 + y * 0.9) * 0.55) * 0.5 + 0.5;
        const n = hash(x, y, 11);
        if (drift > 0.88 && n > 0.5) g.fillStyle = shade(p.accent, -0.12);
        else if (drift < 0.1 && n > 0.72) g.fillStyle = shade(p.accent, -0.45);
        // Rock, where the wind has scoured down to it. Rare on purpose: this
        // is the one high-contrast mark in the tile and three per tile is
        // texture where ten is gravel.
        else if (n > 0.985) g.fillStyle = shade(p.ground, -0.15);
        else continue;
        g.fillRect(x, y, 1, 1);
      }
    }
  } else if (disc.id === 'data_center') {
    /*
     * A raised server floor: square panels on a grid, with the seams between
     * them and a lifting hole in the corner of each.
     *
     * The grid is the identity. Everything else in the Coliseum is organic and
     * this is the one place laid out by somebody with a plan, so the floor is
     * the first thing that should say so.
     */
    const PANEL = 8;
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const seam = x % PANEL === 0 || y % PANEL === 0;
        const n = hash(x, y, 23);
        if (seam) g.fillStyle = shade(p.ground, -0.42);
        else if (n > 0.96) g.fillStyle = shade(p.groundAlt, 0.08);
        else if (n > 0.86) g.fillStyle = shade(p.groundAlt, -0.1);
        else continue;
        g.fillRect(x, y, 1, 1);
      }
    }
    // The lift hole, one per panel, always in the same corner.
    g.fillStyle = shade(p.ground, -0.55);
    for (let py = 0; py < TILE; py += PANEL) {
      for (let px = 0; px < TILE; px += PANEL) g.fillRect(px + 2, py + 2, 2, 2);
    }
  } else if (disc.id === 'wetland') {
    /*
     * Standing water with matted growth through it.
     *
     * Canon's line is "low visibility, slow going, cover in every direction",
     * so the floor is busy on purpose - it is the one region where the ground
     * itself is the concealment. Water is drawn DARKER than the mud rather
     * than lighter: under an overcast sky a shallow pool is a hole, not a
     * mirror, and painting it bright turns a swamp into a paddling pool.
     */
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const pool = Math.sin(x * 0.38) * Math.cos(y * 0.31) + Math.sin((x + y) * 0.19);
        const n = hash(x, y, 41);
        if (pool > 0.75) g.fillStyle = shade(p.ground, -0.42);
        else if (pool > 0.55) g.fillStyle = shade(p.ground, -0.25);
        else if (n > 0.9) g.fillStyle = shade(p.accent, -0.25);
        else if (n > 0.76) g.fillStyle = shade(p.groundAlt, 0.06);
        else continue;
        g.fillRect(x, y, 1, 1);
      }
    }
  } else if (disc.id === 'desert') {
    /*
     * Ripples, and almost nothing else.
     *
     * "Exposed. Nowhere to hide, and visible from far off" is a statement
     * about emptiness, and the floor has to agree with it: long parallel
     * ripples at one low contrast, a scatter of grit, and no third value. A
     * busy desert floor would be the region arguing with its own rule.
     */
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const ripple = Math.sin((y * 1.6 + Math.sin(x * 0.22) * 3) * 0.55) * 0.5 + 0.5;
        const n = hash(x, y, 53);
        if (ripple > 0.86) g.fillStyle = shade(p.groundAlt, 0.16);
        else if (ripple < 0.12) g.fillStyle = shade(p.ground, -0.16);
        else if (n > 0.982) g.fillStyle = shade(p.accent, -0.35);
        else continue;
        g.fillRect(x, y, 1, 1);
      }
    }
  } else if (disc.id === 'plains_forest') {
    /*
     * Grass, in clumps rather than in noise.
     *
     * This tile does double duty: it is the spawn's floor AND the connective
     * ground between every other region, which canon says is forest rather
     * than a void. It replaced a 96-unit checker that was fine as a movement
     * cue when the game was smooth and read as enormous flat squares once the
     * world went to a four-pixel grid.
     */
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const n = hash(x, y, 67);
        const clump = hash(Math.floor(x / 3), Math.floor(y / 3), 68);
        if (clump > 0.72 && n > 0.45) g.fillStyle = shade(p.accent, -0.3);
        else if (clump < 0.2 && n > 0.72) g.fillStyle = shade(p.ground, -0.22);
        else if (n > 0.975) g.fillStyle = shade(p.accent, 0.05);
        else continue;
        g.fillRect(x, y, 1, 1);
      }
    }
  }

  const pattern = ctx.createPattern(c, 'repeat');
  if (pattern && typeof pattern.setTransform === 'function') {
    pattern.setTransform(new DOMMatrix([TILE_UNIT, 0, 0, TILE_UNIT, 0, 0]));
  }
  tiles.set(key, pattern ?? null);
  return pattern ?? null;
}

/**
 * Whether this region has a floor of its own.
 *
 * All five do now. It stays a function rather than becoming an assumption
 * because the switch is what made it possible to convert two regions and ship
 * them without ever having a build where half a region was done.
 */
export function hasTerrain(id: string): boolean {
  return (
    id === 'snowy_mountain' ||
    id === 'data_center' ||
    id === 'wetland' ||
    id === 'desert' ||
    id === 'plains_forest'
  );
}

/**
 * The ground between the regions, which is forest.
 *
 * Canon treats the walk between regions as the thing the world shape depends
 * on, and 900 of the Coliseum's 1,940 material nodes are scattered out here -
 * so this is not filler, it is half the map. It borrows the spawn's tile and
 * sits a shade darker, which is the difference between arriving somewhere and
 * still being on the way.
 */
export function drawBetween(
  ctx: CanvasRenderingContext2D,
  spawn: BiomeDisc,
  bounds: Bounds,
): void {
  const pattern = bakeTile(spawn, ctx);
  if (!pattern) return;
  ctx.fillStyle = pattern;
  ctx.fillRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
  ctx.fillStyle = withAlpha('#05090a', 0.34);
  ctx.fillRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
}

/** The tiled floor, clipped to the disc. */
export function drawFloor(ctx: CanvasRenderingContext2D, disc: BiomeDisc): void {
  const pattern = bakeTile(disc, ctx);
  if (!pattern) return;
  ctx.save();
  ctx.beginPath();
  ctx.arc(disc.x, disc.y, disc.radius, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = pattern;
  ctx.fillRect(disc.x - disc.radius, disc.y - disc.radius, disc.radius * 2, disc.radius * 2);
  ctx.restore();
}

/**
 * Detail that does not repeat.
 *
 * A 32-pixel tile repeats every 64 world units, and at the default view that is
 * fourteen repeats across the screen - close enough together that the eye finds
 * the lattice even when no single tile is busy. This lays hashed cells over the
 * top in WORLD space, so they line up with nothing and never come round again.
 *
 * It is the cheapest fix for the oldest problem in tiled art, and it costs one
 * pass of about five hundred filled cells: the scan is over the visible
 * rectangle only, and nine cells in ten are skipped before anything is drawn.
 */
export function drawScatter(ctx: CanvasRenderingContext2D, disc: BiomeDisc, bounds: Bounds): void {
  const p = disc.palette;
  const SCATTER = 8;
  const x0 = Math.floor(bounds.left / SCATTER) * SCATTER;
  const y0 = Math.floor(bounds.top / SCATTER) * SCATTER;
  const r2 = disc.radius * disc.radius;

  for (let x = x0; x < bounds.right; x += SCATTER) {
    for (let y = y0; y < bounds.bottom; y += SCATTER) {
      const n = hash(x, y, 151);
      if (n > 0.07) continue;
      const dx = x - disc.x;
      const dy = y - disc.y;
      if (dx * dx + dy * dy > r2) continue;
      // Three shades and no more: a scatter with a palette of its own stops
      // being grain on the floor and becomes litter on it.
      /*
       * Low contrast on purpose.
       *
       * At a tenth of the cells and a fifth of the value range this is grain;
       * push either number and it stops reading as ground and starts reading
       * as dirt somebody spilled on it. The first pass was at 0.11 density
       * with a -0.2 shade and the snow came out looking soiled.
       */
      ctx.fillStyle =
        n > 0.05 ? shade(p.groundAlt, 0.08) : n > 0.025 ? shade(p.ground, -0.1) : shade(p.accent, -0.3);
      ctx.fillRect(x, y, SCATTER / 2, SCATTER / 2);
    }
  }
}

/* ------------------------------------------------------------------ edge -- */

/** How wide the transition band is, in world units. */
const EDGE = 150;
/** One dithered cell. Four world units is about two art pixels. */
const CELL = 4;

/**
 * The border, dithered rather than faded.
 *
 * Scanned row by row rather than over the whole visible rectangle: the band is
 * a thin curve, and for each row the circle crosses it in at most two places,
 * so solving for those two spans turns eleven thousand candidate cells into a
 * few hundred. At the Coliseum's scale the naive version is the difference
 * between a frame and a slideshow.
 */
export function drawEdge(ctx: CanvasRenderingContext2D, disc: BiomeDisc, bounds: Bounds): void {
  const outer = disc.radius;
  const inner = disc.radius - EDGE;
  const colour = disc.palette.ground;

  const top = Math.floor(Math.max(bounds.top, disc.y - outer) / CELL) * CELL;
  const bottom = Math.min(bounds.bottom, disc.y + outer);

  ctx.fillStyle = colour;
  for (let y = top; y < bottom; y += CELL) {
    const dy = y + CELL / 2 - disc.y;
    const outerHalf = Math.sqrt(Math.max(0, outer * outer - dy * dy));
    if (outerHalf <= 0) continue;
    const innerHalf = Math.sqrt(Math.max(0, inner * inner - dy * dy));

    // Left span, then right span. When the row misses the inner circle
    // entirely the two merge into one, which is the cap of the disc.
    const spans: [number, number][] = innerHalf
      ? [
          [disc.x - outerHalf, disc.x - innerHalf],
          [disc.x + innerHalf, disc.x + outerHalf],
        ]
      : [[disc.x - outerHalf, disc.x + outerHalf]];

    for (const [from, to] of spans) {
      const a = Math.max(from, bounds.left);
      const b = Math.min(to, bounds.right);
      for (let x = Math.floor(a / CELL) * CELL; x < b; x += CELL) {
        const d = Math.hypot(x + CELL / 2 - disc.x, dy);
        // 1 at the inner edge of the band, 0 at the outer: the region thins
        // out into the forest rather than stopping.
        const level = 1 - (d - inner) / EDGE;
        if (level <= 0 || level >= 1) continue;
        if (threshold(Math.round(x / CELL), Math.round(y / CELL), level)) {
          ctx.fillRect(x, y, CELL, CELL);
        }
      }
    }
  }
}

/* -------------------------------------------------------------- elevation -- */

export interface Shelf {
  x: number;
  y: number;
  w: number;
  h: number;
  /** How tall the front face is, in world units. */
  lift: number;
}

/**
 * Raised ground, placed on a coarse grid and hashed rather than stored.
 *
 * There is no list of shelves anywhere: a cell of the world either has one or
 * it does not, and the answer comes from the coordinate. That is what makes a
 * 22,000-unit region full of terrain cost nothing to hold and nothing to
 * regenerate, and it is why walking away and back finds the same rock.
 */
const SHELF_GRID = 280;

export function shelvesIn(disc: BiomeDisc, bounds: Bounds): Shelf[] {
  const out: Shelf[] = [];
  const x0 = Math.floor(bounds.left / SHELF_GRID) * SHELF_GRID;
  const y0 = Math.floor(bounds.top / SHELF_GRID) * SHELF_GRID;
  /*
   * Each region's ground does something different, so each gets its own salt
   * and its own density. Sharing one would put a dune and an outcrop in
   * exactly the same places in two regions, which nobody would ever name but
   * everybody would feel as sameness.
   */
  const SALT: Record<string, number> = {
    snowy_mountain: 7,
    data_center: 19,
    wetland: 29,
    desert: 37,
    plains_forest: 47,
  };
  const DENSITY: Record<string, number> = {
    snowy_mountain: 0.6,
    data_center: 0.42,
    // Water everywhere. It is the region's whole identity and its whole cost.
    wetland: 0.78,
    // Dunes are large and far apart; exposure is the point.
    desert: 0.3,
    /*
     * The spawn has no elevation at all.
     *
     * It is "open, bright, unthreatening" and it is where the tutorial
     * happens, and a low rock shelf out here came out as a pale box sitting on
     * the grass - the one region whose identity is that nothing is in your way
     * had things in the way. Its scenery is props, which stand up on their own
     * and never interrupt a sight line.
     */
    plains_forest: 0,
  };
  const salt = SALT[disc.id] ?? 19;

  for (let gx = x0; gx < bounds.right; gx += SHELF_GRID) {
    for (let gy = y0; gy < bounds.bottom; gy += SHELF_GRID) {
      const roll = hash(gx, gy, salt);
      if (roll > (DENSITY[disc.id] ?? 0.42)) continue;

      const jx = hash(gx, gy, salt + 1);
      const jy = hash(gx, gy, salt + 2);
      const jw = hash(gx, gy, salt + 3);
      const jh = hash(gx, gy, salt + 4);
      const x = gx + jx * SHELF_GRID * 0.5;
      const y = gy + jy * SHELF_GRID * 0.5;

      // Inside the region, and not so close to the edge that a shelf hangs off
      // it - a cliff with nothing under it is the giveaway that this is a
      // texture and not a place.
      if (Math.hypot(x - disc.x, y - disc.y) > disc.radius - EDGE) continue;

      /*
       * Small. An earlier pass made these up to 300 units across, which at the
       * default view is a third of the screen - and a flat pale slab a third of
       * the screen wide reads as a white box dropped on the snow, not as rock
       * standing out of it. An outcrop you can walk around in two seconds is
       * terrain; one you cannot see the end of is a wall.
       */
      const big = disc.id === 'wetland' || disc.id === 'desert';
      const w = SHELF_GRID * (big ? 0.3 + jw * 0.55 : disc.id === 'snowy_mountain' ? 0.18 + jw * 0.3 : 0.16 + jw * 0.22);
      const h = SHELF_GRID * (big ? 0.22 + jh * 0.4 : disc.id === 'snowy_mountain' ? 0.14 + jh * 0.22 : 0.12 + jh * 0.16);
      out.push({
        x: Math.round(x / CELL) * CELL,
        y: Math.round(y / CELL) * CELL,
        w: Math.round(w / CELL) * CELL,
        h: Math.round(h / CELL) * CELL,
        /*
         * Taller than it looks like it should be.
         *
         * In a top-down view a snow-topped shelf is inherently low contrast -
         * pale on pale, lit from above. What actually reads as height is the
         * FRONT face and the shadow under it, and at sixteen units those were
         * eight art pixels and invisible. The top can stay subtle; the face
         * cannot.
         */
        /*
         * A pool has negative lift.
         *
         * Everything else here stands up; the Wetland's water goes DOWN, and
         * the sign is the whole of the difference - a depression is the same
         * drawing with the lit edge on the near side and the dark face on the
         * far one. Getting that backwards gives you a puddle standing on a
         * plinth, which is a mistake you can only see, never reason out.
         */
        lift:
          disc.id === 'snowy_mountain'
            ? 28 + Math.round(jw * 3) * 4
            : disc.id === 'wetland'
              ? -12
              : disc.id === 'desert'
                ? 16
                : disc.id === 'plains_forest'
                  ? 12
                  : 20,
      });
    }
  }
  return out;
}

/**
 * One raised block: the face you can see, the top you cannot stand on, and the
 * shadow it throws.
 *
 * Drawn in that order because the front face has to sit over the shadow of
 * whatever is behind it. The top gets a lit edge along its back, which is the
 * one line that stops a shelf reading as a hole.
 */
export function drawShelf(ctx: CanvasRenderingContext2D, disc: BiomeDisc, shelf: Shelf): void {
  const p = disc.palette;
  const { x, y, w, h, lift } = shelf;

  // Water goes down, so it is drawn by its own routine rather than by this one
  // with every sign flipped.
  if (lift < 0) {
    drawPool(ctx, disc, shelf);
    return;
  }

  const snow = disc.id === 'snowy_mountain';
  const sand = disc.id === 'desert';

  ctx.fillStyle = withAlpha('#000000', sand ? 0.28 : 0.42);
  ctx.fillRect(x + CELL * 2, y + h + lift, w, CELL * 2);

  /*
   * The face.
   *
   * On the mountain and in the ruin it is in shadow, because the thing above
   * it is catching the light. A dune is the exception: the sun is low and the
   * windward face is the brightest thing in the region, so shading it like
   * rock would make the desert read as a quarry.
   */
  ctx.fillStyle = sand ? shade(p.groundAlt, 0.1) : shade(p.ground, snow ? -0.25 : -0.45);
  ctx.fillRect(x, y + h, w, lift);
  for (let i = CELL * 2; i < lift - CELL; i += CELL * 2) {
    if (hash(x + i, y, 3) > 0.55) continue;
    ctx.fillStyle = sand ? shade(p.groundAlt, 0.02) : shade(p.ground, snow ? -0.45 : -0.6);
    ctx.fillRect(x + CELL, y + h + i, w - CELL * 2, CELL);
  }
  ctx.fillStyle = sand ? shade(p.ground, -0.2) : shade(p.ground, snow ? -0.62 : -0.72);
  ctx.fillRect(x, y + h + lift - CELL, w, CELL);

  // The top wears the same floor it is standing in, so a raised patch is made
  // of the ground rather than dropped on it.
  const pattern = bakeTile(disc, ctx);
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = pattern ?? shade(p.groundAlt, 0);
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = withAlpha('#ffffff', snow ? 0.24 : sand ? 0.16 : 0.1);
  ctx.fillRect(x, y, w, h);
  ctx.restore();

  // The lit back edge, the sides, and the lip where the top turns into the
  // face. The sides give the top a silhouette against ground that is otherwise
  // exactly the same material.
  ctx.fillStyle = snow ? shade(p.accent, 0.42) : sand ? shade(p.accent, 0.2) : shade(p.accent, -0.15);
  ctx.fillRect(x, y, w, CELL);
  ctx.fillStyle = sand ? shade(p.ground, -0.1) : shade(p.ground, snow ? -0.3 : -0.4);
  ctx.fillRect(x, y, CELL, h);
  ctx.fillRect(x + w - CELL, y, CELL, h);
  ctx.fillStyle = snow ? shade(p.accent, -0.38) : sand ? shade(p.ground, -0.05) : shade(p.ground, -0.25);
  ctx.fillRect(x, y + h - CELL, w, CELL);

  // Corners bitten out, so the silhouette is not a rectangle. Two cells off
  // two corners, chosen by the shelf's own position, so a given outcrop always
  // loses the same ones.
  const bite = CELL * 2;
  const roll = hash(x, y, 5);
  ctx.fillStyle = snow ? shade(p.accent, -0.3) : p.ground;
  if (roll > 0.35) ctx.fillRect(x, y, bite, bite);
  if (roll < 0.7) ctx.fillRect(x + w - bite, y + h - bite, bite, bite + lift);
}

/**
 * Standing water, which is a hole rather than a block.
 *
 * The lit edge is on the NEAR side and the dark face on the far one, which is
 * the whole inversion: light coming from behind the camera reaches the near
 * bank of a depression and not the far one, and reaches the far top of a
 * raised block and not the near one. The surface is darker than the mud around
 * it - under an overcast sky a shallow pool is a hole, not a mirror - with one
 * pale glint that moves, which is the only thing that says it is liquid.
 */
function drawPool(ctx: CanvasRenderingContext2D, disc: BiomeDisc, shelf: Shelf): void {
  const p = disc.palette;
  const { x, y, w, h } = shelf;
  const depth = -shelf.lift;

  // The bank: a lip of wet, darker ground all the way round.
  ctx.fillStyle = shade(p.ground, -0.3);
  ctx.fillRect(x - CELL, y - CELL, w + CELL * 2, h + CELL * 2 + depth);

  // The water.
  ctx.fillStyle = shade(p.ground, -0.55);
  ctx.fillRect(x, y, w, h);

  // The far wall, in shadow, and the near rim catching the light.
  ctx.fillStyle = shade(p.ground, -0.72);
  ctx.fillRect(x, y, w, CELL * 2);
  ctx.fillStyle = shade(p.accent, -0.25);
  ctx.fillRect(x - CELL, y + h + CELL, w + CELL * 2, CELL);

  /*
   * Corners bitten back out to the bank.
   *
   * Water pools in a hollow and a hollow is not rectangular. Reeds alone were
   * not enough - they broke the bottom edge and left the other three straight,
   * which read as a tank rather than a pond. Each corner is bitten by its own
   * hashed amount, so no two pools lose the same shape and none of them is
   * symmetrical.
   */
  ctx.fillStyle = shade(p.ground, -0.3);
  const corners: [number, number, number][] = [
    [x, y, 73],
    [x + w, y, 79],
    [x, y + h, 97],
    [x + w, y + h, 103],
  ];
  for (const [cx, cy, salt] of corners) {
    const n = hash(cx, cy, salt);
    const bw = CELL * (1 + Math.round(n * 3));
    const bh = CELL * (1 + Math.round(hash(cx, cy, salt + 1) * 2));
    ctx.fillRect(cx === x ? x : x + w - bw, cy === y ? y : y + h - bh, bw, bh);
  }

  // Reeds at the near edge, where they stand between you and the water.
  for (let i = 0; i < w; i += CELL * 2) {
    if (hash(x + i, y, 71) > 0.55) continue;
    ctx.fillStyle = shade(p.accent, -0.4);
    ctx.fillRect(x + i, y + h - CELL, CELL, CELL * 3);
  }
}

/* --------------------------------------------------------------- weather -- */

/**
 * What moves.
 *
 * Snow drifts across the mountain on a constant wind; the ruin is scanned by
 * something that has not been told to stop. Both are drawn from hashed
 * positions advanced by the clock rather than from a particle list, so nothing
 * accumulates, nothing needs culling, and the same square of world always has
 * the same weather in it.
 */
export function drawWeather(
  ctx: CanvasRenderingContext2D,
  disc: BiomeDisc,
  bounds: Bounds,
  time: number,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(disc.x, disc.y, disc.radius, 0, Math.PI * 2);
  ctx.clip();

  if (disc.id === 'snowy_mountain') {
    const DRIFT = 160;
    const x0 = Math.floor(bounds.left / DRIFT) * DRIFT;
    const y0 = Math.floor(bounds.top / DRIFT) * DRIFT;
    for (let gx = x0; gx < bounds.right; gx += DRIFT) {
      for (let gy = y0; gy < bounds.bottom; gy += DRIFT) {
        for (let i = 0; i < 3; i++) {
          const n = hash(gx, gy, 31 + i);
          const m = hash(gx, gy, 61 + i);
          // Wrapped inside the cell, so a flake leaving one enters the next.
          const x = gx + ((n * DRIFT + time * (90 + m * 70)) % DRIFT);
          const y = gy + ((m * DRIFT + time * (34 + n * 26)) % DRIFT);
          ctx.fillStyle = withAlpha('#ffffff', 0.25 + m * 0.4);
          ctx.fillRect(Math.round(x / 2) * 2, Math.round(y / 2) * 2, m > 0.7 ? 4 : 2, 2);
        }
      }
    }
  } else if (disc.id === 'data_center') {
    /*
     * A scan line crawling across the floor, plus the odd cell that flickers.
     *
     * The scan is deliberately slow - about a screen every eight seconds -
     * because a fast one reads as a screen artifact rather than as something
     * the building is doing.
     */
    const SPAN = 1800;
    const head = ((time * 220) % SPAN) + Math.floor(bounds.left / SPAN) * SPAN;
    for (let pass = -1; pass <= 1; pass++) {
      const x = head + pass * SPAN;
      if (x < bounds.left - 60 || x > bounds.right + 60) continue;
      const g = ctx.createLinearGradient(x - 60, 0, x + 12, 0);
      g.addColorStop(0, withAlpha(disc.palette.accent, 0));
      g.addColorStop(1, withAlpha(disc.palette.accent, 0.14));
      ctx.fillStyle = g;
      ctx.fillRect(x - 60, bounds.top, 72, bounds.bottom - bounds.top);
      ctx.fillStyle = withAlpha(disc.palette.accent, 0.3);
      ctx.fillRect(Math.round(x / 2) * 2, bounds.top, 2, bounds.bottom - bounds.top);
    }

    const CELLS = 220;
    const x0 = Math.floor(bounds.left / CELLS) * CELLS;
    const y0 = Math.floor(bounds.top / CELLS) * CELLS;
    for (let gx = x0; gx < bounds.right; gx += CELLS) {
      for (let gy = y0; gy < bounds.bottom; gy += CELLS) {
        const n = hash(gx, gy, 97);
        if (n > 0.3) continue;
        // Each panel blinks on its own period, so the floor never pulses.
        const on = (time * (0.6 + n * 2) + n * 10) % 1 > 0.55;
        if (!on) continue;
        ctx.fillStyle = withAlpha(disc.palette.accent, 0.5);
        ctx.fillRect(gx + Math.round(n * 40) * 2, gy + Math.round(n * 30) * 2, 2, 2);
      }
    }
  } else if (disc.id === 'wetland') {
    /*
     * Mist lying in sheets, and the odd insect.
     *
     * The Wetland's whole mechanical identity is low visibility, so its
     * weather is the only one here that actually obscures - pale horizontal
     * bands drifting slowly sideways at an alpha low enough to read as air
     * rather than as a wipe over the screen.
     */
    const BANK = 320;
    const x0 = Math.floor(bounds.left / BANK) * BANK;
    const y0 = Math.floor(bounds.top / BANK) * BANK;
    for (let gx = x0; gx < bounds.right; gx += BANK) {
      for (let gy = y0; gy < bounds.bottom; gy += BANK) {
        const n = hash(gx, gy, 83);
        if (n > 0.55) continue;
        const m = hash(gx, gy, 89);
        const x = gx + ((n * BANK + time * (12 + m * 10)) % BANK);
        const y = gy + m * BANK;
        ctx.fillStyle = withAlpha('#b9c9c2', 0.05 + m * 0.05);
        ctx.fillRect(Math.round(x / 2) * 2, Math.round(y / 2) * 2, 90 + m * 140, 6);
      }
    }
    // Midges: two pixels, and the only fast thing in a region about slowness.
    const SWARM = 260;
    for (let gx = Math.floor(bounds.left / SWARM) * SWARM; gx < bounds.right; gx += SWARM) {
      for (let gy = Math.floor(bounds.top / SWARM) * SWARM; gy < bounds.bottom; gy += SWARM) {
        const n = hash(gx, gy, 91);
        if (n > 0.3) continue;
        const x = gx + n * SWARM + Math.sin(time * 2.2 + n * 30) * 14;
        const y = gy + n * SWARM * 0.7 + Math.cos(time * 3.1 + n * 20) * 10;
        ctx.fillStyle = withAlpha(disc.palette.accent, 0.5);
        ctx.fillRect(Math.round(x / 2) * 2, Math.round(y / 2) * 2, 2, 2);
      }
    }
  } else if (disc.id === 'desert') {
    /*
     * Sand running across the ground, and nothing in the air.
     *
     * "Nowhere to hide" means the Desert's weather must never obscure
     * anything - so it is all at ground level: long low streaks moving fast
     * enough to read as wind and thin enough to see straight through.
     */
    const RUN = 220;
    for (let gx = Math.floor(bounds.left / RUN) * RUN; gx < bounds.right; gx += RUN) {
      for (let gy = Math.floor(bounds.top / RUN) * RUN; gy < bounds.bottom; gy += RUN) {
        for (let i = 0; i < 2; i++) {
          const n = hash(gx, gy, 101 + i);
          const m = hash(gx, gy, 107 + i);
          const x = gx + ((n * RUN + time * (170 + m * 120)) % RUN);
          const y = gy + m * RUN;
          ctx.fillStyle = withAlpha(shade(disc.palette.accent, 0.25), 0.1 + m * 0.18);
          ctx.fillRect(Math.round(x / 2) * 2, Math.round(y / 2) * 2, 10 + m * 18, 2);
        }
      }
    }
  } else if (disc.id === 'plains_forest') {
    /*
     * Pollen, going nowhere in particular.
     *
     * The spawn is "open, bright, unthreatening" and it is where the player
     * spends the tutorial, so its weather has to be the least insistent thing
     * in the game: a few motes drifting upward, slowly, and no wind direction
     * at all. Anything with purpose here would read as a threat.
     */
    const AIR = 300;
    for (let gx = Math.floor(bounds.left / AIR) * AIR; gx < bounds.right; gx += AIR) {
      for (let gy = Math.floor(bounds.top / AIR) * AIR; gy < bounds.bottom; gy += AIR) {
        for (let i = 0; i < 2; i++) {
          const n = hash(gx, gy, 113 + i);
          const m = hash(gx, gy, 127 + i);
          if (n > 0.6) continue;
          const x = gx + n * AIR + Math.sin(time * 0.5 + m * 20) * 18;
          const y = gy + ((m * AIR - time * (10 + n * 12)) % AIR + AIR) % AIR;
          ctx.fillStyle = withAlpha(shade(disc.palette.accent, 0.4), 0.2 + m * 0.3);
          ctx.fillRect(Math.round(x / 2) * 2, Math.round(y / 2) * 2, 2, 2);
        }
      }
    }
  }

  ctx.restore();
}
