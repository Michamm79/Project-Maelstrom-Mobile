/**
 * Canvas renderer for the Coliseum.
 *
 * The world is one continuous disc rather than five rectangles, so the ground is
 * painted as the connective forest with each biome laid over it and its edges
 * feathered - crossing into the mountain should read as arriving somewhere, not
 * as a level load.
 *
 * The camera follows the player and is clamped to the boundary, so walking to
 * the edge never reveals blank space outside the world.
 */
import alchemistSheet from '../assets/alchemist.png';
import { drawIcon, shade, withAlpha } from './icons';
import { drawCreature, isCreature } from './creatures';
import { SWING_SECONDS, WIND_UP_SECONDS, type BiomeDisc, type World } from './world';
import type { Content } from '../core/content';
import type { InputController } from './input';
import type { Screen } from './screen';
import { DELETION_SECONDS, drawDeletion, makeDeletion, type Deletion } from './deletion';

/** Sprite sheet geometry. Rows match the order make-sprites.mjs emits. */
const SPRITE_W = 16;
const SPRITE_H = 24;
const SPRITE_ROWS = { down: 0, side: 1, up: 2, sideMirror: 3 } as const;
const SPRITE_SCALE = 2;

/** The connective terrain between the regions. Canon: forest, not a void. */
const BETWEEN = { ground: '#232f22', groundAlt: '#293626', fog: '#0f150e' };

/*
 * How much world the *longer* screen axis shows lives in `screen.ts`, because
 * the player can change it.
 *
 * The camera used to draw one world unit per CSS pixel, which meant the amount
 * of world on screen was whatever the device happened to be. Turning a phone
 * sideways then kept 412 units across the short side while the HUD's height
 * stayed fixed in pixels, so the same bar that cost a fifth of a portrait
 * screen cost half a landscape one and the playfield became a letterbox.
 *
 * Anchoring the zoom to the longer axis makes the rotation symmetric: the same
 * view, turned. It is purely presentational - the simulation is all in world
 * units, so nothing about reach, speed or spawn density changes with it.
 */

/**
 * Legibility floor and ceiling on that zoom.
 *
 * The floor was 0.9, which quietly capped the widest view setting on a phone:
 * 1080 units across a 915px screen needs 0.847, so asking for Wide gave back
 * the same 1017 as the step below it. 0.8 draws the character at 38px, which
 * is still a clear silhouette, and lets the setting mean what it says.
 */
const ZOOM_MIN = 0.8;
const ZOOM_MAX = 2.2;

/**
 * Screen pixels per world unit, for a box of this size showing this span.
 *
 * Exported so the relationship can be asserted without a canvas: the clamp is
 * the part that bites, and it used to silently swallow a whole view setting.
 */
export function zoomFor(width: number, height: number, span: number): number {
  return clamp(Math.max(width, height) / span, ZOOM_MIN, ZOOM_MAX);
}

interface Floater {
  x: number;
  y: number;
  text: string;
  color: string;
  age: number;
  life: number;
}

export interface RenderState {
  /** Current gauntlet reach, in screen units. */
  pullRadius: number;
  pulling: boolean;
  /**
   * True only during the first bundle, where it lifts the awareness limit so
   * every enemy is marked however far away. Afterwards the player still senses
   * what is nearby - that is permanent now - just not the whole Coliseum.
   */
  showEnemies: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Above this average frame time the haze starts giving way to the frame rate. */
const SLOW_FRAME_MS = 22;
/** And below this it comes back. The gap is the hysteresis. */
const GOOD_FRAME_MS = 18;

/** Side of the baked haze texture. Detail-free, so it can be small. */
const FOG_TEXTURE = 192;

function bakeFog(tint: string, strength: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = FOG_TEXTURE;
  canvas.height = FOG_TEXTURE;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const half = FOG_TEXTURE / 2;
  const haze = ctx.createRadialGradient(half, half, half * 0.12, half, half, half * 0.72);
  haze.addColorStop(0, withAlpha(tint, 0));
  haze.addColorStop(0.55, withAlpha(tint, strength * 0.55));
  haze.addColorStop(1, withAlpha(tint, strength));
  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, FOG_TEXTURE, FOG_TEXTURE);
  return canvas;
}

/**
 * Concurrent deletions worth drawing.
 *
 * A wave clear can kill a dozen things inside a second, and each one is up to
 * 150 glyphs. Past a handful the screen is unreadable anyway, so the oldest
 * give way rather than the frame rate doing it for them.
 */
const MAX_DELETIONS = 8;

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly floaters: Floater[] = [];
  private readonly deletions: Deletion[] = [];
  private width = 0;
  private height = 0;
  private dpr = 1;
  private zoom = 1;
  /** The haze, baked at low resolution and stretched. See drawFog. */
  private fog: HTMLCanvasElement | null = null;
  private fogKey = '';
  /**
   * Rolling frame time, and how much of the haze the device can afford.
   *
   * The fog is one full-screen alpha blend, which is nearly free on a GPU and
   * measurably not on a software rasteriser - 10fps on SwiftShader here. A
   * phone that cannot afford it should lose the atmosphere rather than the
   * frame rate, so this backs it off and restores it when there is headroom.
   */
  private frameMs = 16.7;
  private fogQuality = 1;

  private readonly sheet = new Image();
  private sheetReady = false;
  private readonly boxWatcher: ResizeObserver;

  private readonly unwatchScreen: () => void;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly content: Content,
    private readonly screen: Screen,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;

    this.sheet.onload = () => {
      this.sheetReady = true;
    };
    this.sheet.src = alchemistSheet;

    this.resize();

    /*
     * Watch the canvas box, because nothing else did.
     *
     * The only resize path was a guard in draw() comparing `canvas.width` to
     * `this.width * this.dpr` - two values resize() always writes together, so
     * it could never be false and resize() never ran again after construction.
     * Turning a phone therefore left the backing store portrait-shaped while
     * CSS stretched it across the landscape box: the art really was set for
     * vertical and then squashed sideways.
     *
     * A ResizeObserver catches the rotation, a window resize, a soft keyboard
     * and a move to a display with a different pixel ratio, without reading
     * layout on every frame.
     */
    this.boxWatcher = new ResizeObserver(() => this.resize());
    this.boxWatcher.observe(canvas);
    window.addEventListener('orientationchange', this.onViewportChange);
    // Turning the box sideways changes its size, so the observer above would
    // catch that on its own; changing the view setting does not, and a zoom
    // that only took effect on the next rotation would look broken.
    this.unwatchScreen = this.screen.onChange(() => this.resize());
  }

  private readonly onViewportChange = (): void => {
    this.resize();
  };

  dispose(): void {
    this.boxWatcher.disconnect();
    this.unwatchScreen();
    window.removeEventListener('orientationchange', this.onViewportChange);
  }

  resize(): void {
    // Cap DPR at 2: a 3x display triples the fill cost for no visible gain.
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    /*
     * clientWidth/Height, not getBoundingClientRect.
     *
     * The rect is the element's axis-aligned cover AFTER transforms, so once
     * the app box is rotated into a portrait viewport it reports the box with
     * its sides swapped - and the backing store would come out portrait again,
     * which is the exact bug the ResizeObserver was added to fix. These two
     * read the layout box, which is the shape the game is actually drawn in.
     */
    this.width = Math.max(1, this.canvas.clientWidth || Math.round(this.canvas.getBoundingClientRect().width));
    this.height = Math.max(1, this.canvas.clientHeight || Math.round(this.canvas.getBoundingClientRect().height));
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.zoom = zoomFor(this.width, this.height, this.screen.span);
  }

  /**
   * A creature has stopped running. Canon says they are renderings of hostile
   * code, so this is the rendering coming apart rather than a body falling.
   */
  addDeletion(id: string, x: number, y: number, color: string, size: number): void {
    const effect = makeDeletion(id, x, y, color, size);
    if (!effect) return;
    this.deletions.push(effect);
    if (this.deletions.length > MAX_DELETIONS) {
      this.deletions.splice(0, this.deletions.length - MAX_DELETIONS);
    }
  }

  addFloater(x: number, y: number, text: string, color: string, life = 1.25): void {
    this.floaters.push({ x, y, text, color, age: 0, life });
    if (this.floaters.length > 40) this.floaters.splice(0, this.floaters.length - 40);
  }

  /** Seconds the renderer has been running, for effects that pulse. */
  private time = 0;

  update(dt: number): void {
    // A wall clock for anything that pulses on its own - the shield ring, the
    // heal motes - rather than each of them counting its own frames.
    this.time += dt;
    // Smoothed hard, so one slow frame during a load never dims the world.
    this.frameMs += (Math.min(100, dt * 1000) - this.frameMs) * 0.05;
    if (this.frameMs > SLOW_FRAME_MS) this.fogQuality = Math.max(0, this.fogQuality - dt * 0.6);
    else if (this.frameMs < GOOD_FRAME_MS) this.fogQuality = Math.min(1, this.fogQuality + dt * 0.2);

    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const floater = this.floaters[i];
      if (!floater) continue;
      floater.age += dt;
      if (floater.age >= floater.life) this.floaters.splice(i, 1);
    }

    for (let i = this.deletions.length - 1; i >= 0; i--) {
      const effect = this.deletions[i];
      if (!effect) continue;
      effect.age += dt;
      if (effect.age >= DELETION_SECONDS) this.deletions.splice(i, 1);
    }
  }

  draw(world: World, state: RenderState, input?: InputController): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    const camera = {
      x: clamp(world.player.x, -world.boundaryRadius, world.boundaryRadius),
      y: clamp(world.player.y, -world.boundaryRadius, world.boundaryRadius),
    };

    ctx.fillStyle = BETWEEN.fog;
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.save();
    // Rounded in CSS pixels rather than world units: at any zoom but 1 a world
    // space round lands the camera between device pixels and the ground
    // checker shimmers as you walk.
    ctx.scale(this.zoom, this.zoom);
    ctx.translate(
      Math.round(this.width / 2 - camera.x * this.zoom) / this.zoom,
      Math.round(this.height / 2 - camera.y * this.zoom) / this.zoom,
    );

    this.drawGround(world, camera);
    this.drawProps(world, camera);
    this.drawNodes(world, state, camera);
    this.drawEnemies(world, state, camera);
    this.drawDeletions();
    this.drawPullRing(world, state);
    this.drawSwing(world);
    this.drawPlayer(world);
    this.drawFog(world, camera);
    this.drawFloaters();

    ctx.restore();

    if (input) this.drawJoystick(input);
    ctx.restore();
  }

  // ---------------------------------------------------------------- ground

  /** The world rectangle on screen. In world units, so it tracks the zoom. */
  private visible(camera: { x: number; y: number }, margin: number) {
    const halfW = this.width / (2 * this.zoom);
    const halfH = this.height / (2 * this.zoom);
    return {
      left: camera.x - halfW - margin,
      right: camera.x + halfW + margin,
      top: camera.y - halfH - margin,
      bottom: camera.y + halfH + margin,
    };
  }

  /** World units currently on screen, for tests and the orientation probe. */
  get view(): { width: number; height: number; zoom: number } {
    return { width: this.width / this.zoom, height: this.height / this.zoom, zoom: this.zoom };
  }

  private drawGround(world: World, camera: { x: number; y: number }): void {
    const ctx = this.ctx;
    const bounds = this.visible(camera, 80);

    ctx.fillStyle = BETWEEN.ground;
    ctx.fillRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);

    // A soft checker so movement reads even on open ground.
    const cell = 96;
    ctx.fillStyle = BETWEEN.groundAlt;
    const x0 = Math.floor(bounds.left / cell) * cell;
    const y0 = Math.floor(bounds.top / cell) * cell;
    for (let x = x0; x < bounds.right; x += cell) {
      for (let y = y0; y < bounds.bottom; y += cell) {
        if (((x / cell) + (y / cell)) % 2 === 0) ctx.fillRect(x, y, cell, cell);
      }
    }

    for (const disc of world.discs) {
      if (
        disc.x + disc.radius < bounds.left ||
        disc.x - disc.radius > bounds.right ||
        disc.y + disc.radius < bounds.top ||
        disc.y - disc.radius > bounds.bottom
      ) {
        continue;
      }
      this.drawBiome(disc);
    }

    // The boundary itself, so the edge of the world is legible before you hit it.
    ctx.strokeStyle = withAlpha('#000000', 0.55);
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(0, 0, world.boundaryRadius, 0, Math.PI * 2);
    ctx.stroke();
  }

  /** Feathered so a region blends into the forest rather than snapping on. */
  private drawBiome(disc: BiomeDisc): void {
    const ctx = this.ctx;
    const gradient = ctx.createRadialGradient(disc.x, disc.y, disc.radius * 0.55, disc.x, disc.y, disc.radius);
    gradient.addColorStop(0, disc.palette.ground);
    gradient.addColorStop(0.82, disc.palette.ground);
    gradient.addColorStop(1, withAlpha(disc.palette.ground, 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(disc.x, disc.y, disc.radius, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = withAlpha(disc.palette.accent, 0.14);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(disc.x, disc.y, disc.radius * 0.985, 0, Math.PI * 2);
    ctx.stroke();
  }

  /**
   * Scenery, drawn per kind.
   *
   * Three shapes tinted by the local accent used to serve the whole Coliseum,
   * which is why every region looked like the spawn in a different colour. The
   * kinds are what actually distinguish a snowfield from a server floor.
   */
  private drawProps(world: World, camera: { x: number; y: number }): void {
    const ctx = this.ctx;
    const bounds = this.visible(camera, 40);

    for (const prop of world.propsIn(bounds.left, bounds.top, bounds.right, bounds.bottom)) {
      const disc = world.biomeAt(prop.x, prop.y);
      const base = disc ? disc.palette.accent : '#4c7a4a';
      const tint = shade(base, prop.tone);
      const s = prop.size;

      ctx.save();
      ctx.translate(prop.x, prop.y);
      ctx.fillStyle = withAlpha(tint, 0.45);

      switch (prop.kind) {
        case 'stone':
          ctx.beginPath();
          ctx.arc(0, 0, s * 0.36, 0, Math.PI * 2);
          ctx.fill();
          break;

        case 'tree':
          ctx.beginPath();
          ctx.moveTo(0, -s);
          ctx.lineTo(s * 0.34, 0);
          ctx.lineTo(-s * 0.34, 0);
          ctx.closePath();
          ctx.fill();
          break;

        // Wind-scalloped snow: a low mound with a bright lip facing the light.
        case 'drift':
          ctx.fillStyle = withAlpha('#e8f2fb', 0.3);
          ctx.beginPath();
          ctx.ellipse(0, 0, s * 0.72, s * 0.3, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = withAlpha('#ffffff', 0.34);
          ctx.beginPath();
          ctx.ellipse(-s * 0.1, -s * 0.1, s * 0.46, s * 0.14, 0, 0, Math.PI * 2);
          ctx.fill();
          break;

        // Bare rock breaking the snow: angular, never rounded.
        case 'crag':
          ctx.fillStyle = withAlpha(shade(base, -0.5), 0.55);
          ctx.beginPath();
          ctx.moveTo(-s * 0.5, s * 0.28);
          ctx.lineTo(-s * 0.18, -s * 0.62);
          ctx.lineTo(s * 0.16, -s * 0.2);
          ctx.lineTo(s * 0.52, s * 0.3);
          ctx.closePath();
          ctx.fill();
          break;

        // Glacite showing through. It is the region's whole reason to exist,
        // so it is the one prop that emits rather than reflects.
        case 'shard':
          ctx.fillStyle = withAlpha('#bfe9ff', 0.5);
          ctx.beginPath();
          ctx.moveTo(0, -s * 0.8);
          ctx.lineTo(s * 0.22, 0);
          ctx.lineTo(0, s * 0.34);
          ctx.lineTo(-s * 0.22, 0);
          ctx.closePath();
          ctx.fill();
          break;

        // Sand ridge: long, shallow, and lying across the wind.
        case 'dune':
          ctx.fillStyle = withAlpha(shade(base, 0.12), 0.24);
          ctx.beginPath();
          ctx.ellipse(0, 0, s * 1.15, s * 0.22, 0.3, 0, Math.PI * 2);
          ctx.fill();
          break;

        case 'bone':
          ctx.fillStyle = withAlpha('#e6dcc4', 0.42);
          ctx.beginPath();
          ctx.ellipse(0, 0, s * 0.42, s * 0.1, -0.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.beginPath();
          ctx.arc(-s * 0.3, -s * 0.2, s * 0.1, 0, Math.PI * 2);
          ctx.arc(s * 0.3, s * 0.2, s * 0.1, 0, Math.PI * 2);
          ctx.fill();
          break;

        // Standing water. Darker than the ground rather than lighter, which is
        // what stops the Wetland reading as a field with puddles painted on.
        case 'pool':
          ctx.fillStyle = withAlpha('#16333a', 0.5);
          ctx.beginPath();
          ctx.ellipse(0, 0, s * 0.9, s * 0.45, prop.tone, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = withAlpha('#9fd8e8', 0.14);
          ctx.lineWidth = 1.4;
          ctx.stroke();
          break;

        case 'reed':
          ctx.strokeStyle = withAlpha(tint, 0.5);
          ctx.lineWidth = Math.max(1, s * 0.09);
          for (const lean of [-0.22, 0, 0.26]) {
            ctx.beginPath();
            ctx.moveTo(lean * s * 0.4, 0);
            ctx.quadraticCurveTo(lean * s, -s * 0.6, lean * s * 1.5 + s * 0.06, -s * 1.05);
            ctx.stroke();
          }
          break;

        // A rack, seen from above: a dark block with a column of live lights.
        case 'rack':
          ctx.fillStyle = withAlpha('#0f1020', 0.62);
          ctx.fillRect(-s * 0.46, -s * 0.6, s * 0.92, s * 1.2);
          ctx.fillStyle = withAlpha('#7fd8d8', 0.55);
          for (let i = 0; i < 4; i++) {
            const lit = ((prop.tone * 40 + i) | 0) % 3 !== 0;
            if (!lit) continue;
            ctx.fillRect(-s * 0.3, -s * 0.44 + i * s * 0.28, s * 0.6, s * 0.08);
          }
          break;

        case 'conduit':
          ctx.strokeStyle = withAlpha('#7fd8d8', 0.2);
          ctx.lineWidth = Math.max(1.5, s * 0.16);
          ctx.beginPath();
          ctx.moveTo(-s * 0.8, -s * 0.2);
          ctx.lineTo(s * 0.1, -s * 0.2);
          ctx.lineTo(s * 0.1, s * 0.7);
          ctx.stroke();
          break;

        case 'tuft':
        default:
          ctx.beginPath();
          ctx.ellipse(0, 0, s * 0.5, s * 0.28, 0, 0, Math.PI * 2);
          ctx.fill();
          break;
      }

      ctx.restore();
    }
  }

  // ---------------------------------------------------------------- nodes

  private drawNodes(world: World, state: RenderState, camera: { x: number; y: number }): void {
    const ctx = this.ctx;
    const bounds = this.visible(camera, 70);

    for (const node of world.nodes) {
      if (!node.available) continue;
      const position = world.pullPosition(node);
      if (
        position.x < bounds.left ||
        position.x > bounds.right ||
        position.y < bounds.top ||
        position.y > bounds.bottom
      ) {
        continue;
      }

      const material = this.content.material(node.material);
      const bob = Math.sin(world.time * 2 + node.phase) * 3;

      ctx.save();
      ctx.translate(position.x, position.y);

      // Shrinks as it comes in, so the absorb reads as being taken rather than
      // simply vanishing.
      const scale = node.scale * (1 - node.pull * 0.55);

      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.ellipse(0, 15, 15 * scale, 5.5 * scale, 0, 0, Math.PI * 2);
      ctx.fill();

      if (node.pull > 0) {
        ctx.rotate(node.pull * Math.PI * 2.4);
        ctx.globalAlpha = 1 - node.pull * 0.25;
      } else if (state.pulling) {
        const reach = Math.hypot(node.x - world.player.x, node.y - world.player.y);
        if (reach <= state.pullRadius * 1.25) ctx.globalAlpha = 0.95;
      }

      ctx.translate(0, bob - 4);
      drawIcon(ctx, material.shape, material.color, 44 * scale);
      ctx.restore();
    }
  }

  /**
   * The gauntlet's reach, drawn only while pulling. Canon's pull is a radius
   * overlap rather than a trace from a crosshair, so the readout is a ring
   * around the player and never a cone or a cursor.
   */
  private drawPullRing(world: World, state: RenderState): void {
    if (!state.pulling) return;
    const ctx = this.ctx;
    const { player } = world;
    const pulse = 0.5 + Math.sin(world.time * 9) * 0.18;

    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.strokeStyle = withAlpha('#9fd8e8', pulse * 0.7);
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(0, 0, state.pullRadius, 0, Math.PI * 2);
    ctx.stroke();

    // A second, tighter arc turning the other way: the spiral, implied.
    ctx.strokeStyle = withAlpha('#ffffff', pulse * 0.35);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, state.pullRadius * 0.62, world.time * 3, world.time * 3 + Math.PI * 1.2);
    ctx.stroke();
    ctx.restore();
  }

  // ---------------------------------------------------------------- enemies

  private drawEnemies(world: World, state: RenderState, camera: { x: number; y: number }): void {
    const ctx = this.ctx;
    const bounds = this.visible(camera, 90);

    for (const enemy of world.enemies) {
      const offscreen =
        enemy.x < bounds.left || enemy.x > bounds.right || enemy.y < bounds.top || enemy.y > bounds.bottom;

      /*
       * Canon's asymmetry, the player's half of it: they sense what is around
       * them, the program does not sense them. Enemies now notice only at an
       * encounter distance, so this marker is not a crutch - it is the thing
       * that lets a player go looking for a fight rather than only being found
       * by one. Local, not a map of everything: only inside awarenessRadius.
       */
      if (offscreen) {
        if (!enemy.dead) {
          const reach = Math.hypot(enemy.x - world.player.x, enemy.y - world.player.y);
          // The tutorial bundle drops the limit entirely, so the first fight is
          // never a search. After it, awareness is local again.
          // Scaled by where the player is standing: the Wetland is "low
          // visibility" and the Desert is "visible from far off", and both of
          // those cut in the player's direction as well as the enemies'.
          const sight = world.terrainAt(world.player.x, world.player.y).sight;
          // Solvane's whole domain is revealing, so a live Clarion is the same
          // affordance the first bundle gets for free: everything, marked.
          const revealed = state.showEnemies || world.player.status.revealed > 0;
          const sense = revealed ? Infinity : this.content.waves.awarenessRadius * sight;
          const limit = Number.isFinite(sense) ? sense : this.content.waves.awarenessRadius * sight;
          if (reach <= sense) this.drawOffscreenMarker(enemy, world, Math.min(1, reach / limit));
        }
        continue;
      }

      const { def } = enemy;
      ctx.save();
      ctx.translate(enemy.x, enemy.y);

      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(0, 14, 13, 5, 0, 0, Math.PI * 2);
      ctx.fill();

      // Nothing to draw: a dead creature has already been replaced by its
      // deletion, and a translucent corpse under the glyphs reads as the effect
      // failing to remove it.
      if (enemy.dead) {
        ctx.restore();
        continue;
      }

      // Noticed-you tell. It matters more now that noticing is an encounter
      // rather than a sweep: this is the moment the wandering stopped.
      if (enemy.aggro && !enemy.dead) {
        const top = -30 - def.tier * 7;
        ctx.fillStyle = withAlpha('#f87171', 0.85 + Math.sin(world.time * 10) * 0.15);
        ctx.beginPath();
        ctx.moveTo(0, top);
        ctx.lineTo(5, top - 7);
        ctx.lineTo(-5, top - 7);
        ctx.closePath();
        ctx.fill();
      }

      const bob = Math.sin(world.time * 3 + enemy.id) * 2;
      ctx.translate(0, bob);
      // Tier is read by silhouette first and size second: a Goblin, a Minotaur
      // and a Scythe-bearer are different shapes, not one shape at three scales.
      const size = 34 + def.tier * 8;
      if (isCreature(def.id)) {
        drawCreature(ctx, def.id, {
          color: def.color,
          size: size * 1.35,
          time: world.time,
          phase: enemy.id * 1.7,
          facing: Math.cos(enemy.facing) < 0 ? -1 : 1,
          windUp: enemy.windUp > 0 ? 1 - enemy.windUp / WIND_UP_SECONDS : 0,
          stagger: Math.min(1, enemy.stagger * 4),
          aggro: enemy.aggro,
          flash: enemy.hitFlash,
        });
      } else {
        drawIcon(ctx, def.shape, enemy.hitFlash > 0 ? '#ffffff' : def.color, size);
      }

      if (enemy.hp < def.hp && !enemy.dead) {
        const w = 28;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(-w / 2, -30, w, 4);
        ctx.fillStyle = '#f87171';
        ctx.fillRect(-w / 2, -30, w * (enemy.hp / def.hp), 4);
      }

      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  /**
   * An arrow at the edge of the view for something out of sight.
   *
   * @param nearness 0 at the player, 1 at the limit of what they can sense, so
   *   the marker fades with distance and reads as "roughly over there" rather
   *   than as a precise fix on something the player cannot actually see.
   */
  private drawOffscreenMarker(enemy: World['enemies'][number], world: World, nearness: number): void {
    const ctx = this.ctx;
    const dx = enemy.x - world.player.x;
    const dy = enemy.y - world.player.y;
    const angle = Math.atan2(dy, dx);
    const radius = (Math.min(this.width, this.height) / this.zoom) * 0.42;
    const fade = 0.22 + (1 - nearness) * 0.55;
    // Tier by size, the same way the bodies read it: a Scythe-bearer somewhere
    // off screen is worth knowing about before it arrives.
    const size = 5 + enemy.def.tier * 1.6;

    ctx.save();
    ctx.translate(world.player.x + Math.cos(angle) * radius, world.player.y + Math.sin(angle) * radius);
    ctx.rotate(angle);
    ctx.globalAlpha = fade;
    ctx.fillStyle = enemy.aggro ? '#f87171' : shade(enemy.def.color, 0.25);
    ctx.beginPath();
    ctx.moveTo(size * 1.5, 0);
    ctx.lineTo(-size, size * 0.85);
    ctx.lineTo(-size, -size * 0.85);
    ctx.closePath();
    ctx.fill();
    // A dark edge so it stays readable over pale ground.
    ctx.globalAlpha = fade * 0.8;
    ctx.strokeStyle = '#181024';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.restore();
  }

  /**
   * The haze some regions sit under.
   *
   * Drawn over the world and under the floaters, as a radial wash that is
   * thinnest around the player: coolant fog and marsh mist are supposed to
   * close the distance down, not blind you where you stand. Strength comes
   * from the blended terrain, so it fades in across the border rather than
   * switching on.
   */
  private drawFog(world: World, camera: { x: number; y: number }): void {
    const terrain = world.terrainAt(world.player.x, world.player.y);
    const strength = terrain.fog * this.fogQuality;
    if (strength <= 0.01) return;

    const disc = world.biomeAt(world.player.x, world.player.y);
    const ctx = this.ctx;
    const reach = Math.max(this.width, this.height) / this.zoom;

    /*
     * Baked small and stretched, rather than filled at full resolution.
     *
     * Measured: a screen-sized radial gradient fill cost 10fps on its own at
     * DPR 2 - about 1.5 million gradient-evaluated pixels every frame, while
     * the props and the nodes together cost nothing. Haze has no detail in it,
     * so a 192px texture scaled up is indistinguishable and turns the per-frame
     * cost into one blit.
     */
    const tint = disc?.palette.fog ?? '#101018';
    // Quantised, or easing the quality would rebake the texture every frame.
    const key = `${tint}|${strength.toFixed(2)}`;
    if (key !== this.fogKey) {
      this.fog = bakeFog(tint, strength);
      this.fogKey = key;
    }
    if (!this.fog) return;

    ctx.drawImage(this.fog, camera.x - reach, camera.y - reach, reach * 2, reach * 2);
  }

  // ---------------------------------------------------------------- swing

  /**
   * The basic attack, drawn.
   *
   * `attackAnim` has been counting down on every swing since combat went in and
   * nothing ever read it, so the attack landed damage with no picture attached -
   * which is a large part of why it felt weightless whatever the numbers said.
   *
   * It is an arc rather than a weapon, because the gauntlets are the weapon: a
   * crescent sweeping through the same cone the hit test uses, so what you see
   * is what was actually checked.
   */
  private drawSwing(world: World): void {
    const { player } = world;
    if (player.attackAnim <= 0) return;

    const ctx = this.ctx;
    const attack = this.content.progression.combat.basicAttack;
    // 0 at the start of the swing, 1 at the end.
    const t = 1 - player.attackAnim / SWING_SECONDS;
    const halfArc = (attack.arcDegrees * Math.PI) / 360;
    // The leading edge travels through the cone; the trail follows it.
    const lead = player.facing - halfArc + t * halfArc * 2;
    const trail = lead - Math.min(halfArc * 1.4, t * halfArc * 2.6);
    const reach = attack.range * (0.72 + t * 0.28);
    const fade = Math.sin(Math.min(1, t) * Math.PI);

    ctx.save();
    ctx.translate(player.x, player.y);

    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = withAlpha('#bfe9ff', fade * 0.55);
    ctx.lineWidth = 9 * (1 - t * 0.45);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, 0, reach * 0.82, trail, lead);
    ctx.stroke();

    ctx.strokeStyle = withAlpha('#ffffff', fade * 0.8);
    ctx.lineWidth = 3 * (1 - t * 0.5);
    ctx.beginPath();
    ctx.arc(0, 0, reach * 0.86, trail, lead);
    ctx.stroke();

    // A spark at the leading edge, so the eye follows the direction of the cut.
    ctx.globalAlpha = fade;
    ctx.fillStyle = '#eaf8ff';
    ctx.beginPath();
    ctx.arc(Math.cos(lead) * reach * 0.86, Math.sin(lead) * reach * 0.86, 3.2 * fade, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  // ---------------------------------------------------------------- player

  private drawPlayer(world: World): void {
    const ctx = this.ctx;
    const { player } = world;
    const bob = Math.sin(player.bob) * 2.5;

    ctx.save();
    ctx.translate(player.x, player.y);

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(0, 18, 16, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    if (player.invulnerable > 0 && Math.floor(player.invulnerable * 12) % 2 === 0) ctx.globalAlpha = 0.45;
    if (player.dead) ctx.globalAlpha = 0.3;
    /*
     * Under a veil, you can still see yourself - dimmed.
     *
     * Canon's Umbrel is dampening rather than invisibility, and the player has
     * to keep track of where they are, so this is a state you can read at a
     * glance rather than a sprite that disappears.
     */
    if (player.status.hidden > 0) ctx.globalAlpha = Math.min(ctx.globalAlpha, 0.55);

    if (this.sheetReady) this.drawPlayerSprite(ctx, player);
    else this.drawPlayerFallback(ctx, bob);

    ctx.globalAlpha = 1;
    this.drawStatus(ctx, player);
    ctx.restore();
  }

  /**
   * The timers, drawn on the player rather than in a corner of the HUD.
   *
   * A shield is something you check in the half-second before deciding to take
   * a hit, and a number in the top-left is not where anyone is looking then.
   */
  private drawStatus(ctx: CanvasRenderingContext2D, player: World['player']): void {
    const { status } = player;

    if (status.shield > 0) {
      // Pulses faster as it runs out of time, so "about to lapse" is legible
      // without the player having to read a countdown.
      const urgency = status.shieldFor < 3 ? 9 : 2.5;
      const pulse = 0.55 + Math.sin(this.time * urgency) * 0.2;
      ctx.strokeStyle = withAlpha('#98a4b0', pulse);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(0, -2, 20, 26, 0, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (status.healLeft > 0) {
      // Motes rising, rather than a ring: growth going up is the one shape
      // that cannot be confused with the shield around it.
      ctx.fillStyle = withAlpha('#7fbf5a', 0.75);
      for (let i = 0; i < 3; i++) {
        const t = (this.time * 0.9 + i / 3) % 1;
        ctx.globalAlpha = 0.75 * (1 - t);
        ctx.beginPath();
        ctx.arc(Math.sin((t + i) * 6) * 11, 14 - t * 34, 2.2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }

    if (status.hidden > 0) {
      ctx.strokeStyle = withAlpha('#5b4a72', 0.5 + Math.sin(this.time * 3) * 0.15);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(0, 6, 24, 12, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawPlayerSprite(ctx: CanvasRenderingContext2D, player: World['player']): void {
    const row =
      player.facing4 === 'side'
        ? player.mirrored
          ? SPRITE_ROWS.sideMirror
          : SPRITE_ROWS.side
        : SPRITE_ROWS[player.facing4];

    const w = SPRITE_W * SPRITE_SCALE;
    const h = SPRITE_H * SPRITE_SCALE;
    // Round to whole pixels: a sprite on a half-pixel shimmers as it moves.
    const x = Math.round(-w / 2);
    const y = Math.round(-h + 16);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.sheet, player.frame * SPRITE_W, row * SPRITE_H, SPRITE_W, SPRITE_H, x, y, w, h);
    ctx.imageSmoothingEnabled = true;
  }

  /** Kept for the frames before the sheet decodes, so the player is never invisible. */
  private drawPlayerFallback(ctx: CanvasRenderingContext2D, bob: number): void {
    ctx.save();
    ctx.translate(0, bob);
    ctx.fillStyle = '#2f3448';
    ctx.beginPath();
    ctx.ellipse(0, 0, 10, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ---------------------------------------------------------------- overlays

  private drawFloaters(): void {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.font = '600 13px system-ui, sans-serif';
    for (const floater of this.floaters) {
      const t = floater.age / floater.life;
      ctx.globalAlpha = 1 - t;
      ctx.fillStyle = floater.color;
      ctx.fillText(floater.text, floater.x, floater.y - 20 - t * 22);
    }
    ctx.globalAlpha = 1;
  }

  private drawDeletions(): void {
    for (const effect of this.deletions) drawDeletion(this.ctx, effect);
  }

  private drawJoystick(input: InputController): void {
    if (!input.origin || !input.knob) return;
    const ctx = this.ctx;
    // Already in the box's own coordinates: the input controller maps every
    // touch through the screen on the way in, so there is nothing to subtract
    // here and nothing that goes wrong when the box is rotated.
    const { x: ox, y: oy } = input.origin;
    const { x: kx, y: ky } = input.knob;

    ctx.beginPath();
    ctx.arc(ox, oy, 52, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.07)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.22)';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(kx, ky, 24, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.24)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}
