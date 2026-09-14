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
import type { BiomeDisc, World } from './world';
import type { Content } from '../core/content';
import type { InputController } from './input';

/** Sprite sheet geometry. Rows match the order make-sprites.mjs emits. */
const SPRITE_W = 16;
const SPRITE_H = 24;
const SPRITE_ROWS = { down: 0, side: 1, up: 2, sideMirror: 3 } as const;
const SPRITE_SCALE = 2;

/** The connective terrain between the regions. Canon: forest, not a void. */
const BETWEEN = { ground: '#232f22', groundAlt: '#293626', fog: '#0f150e' };

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
  /** True only during the first bundle - canon's fading tutorial affordance. */
  showEnemies: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly floaters: Floater[] = [];
  private width = 0;
  private height = 0;
  private dpr = 1;

  private readonly sheet = new Image();
  private sheetReady = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly content: Content,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;

    this.sheet.onload = () => {
      this.sheetReady = true;
    };
    this.sheet.src = alchemistSheet;

    this.resize();
  }

  resize(): void {
    // Cap DPR at 2: a 3x display triples the fill cost for no visible gain.
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
  }

  addFloater(x: number, y: number, text: string, color: string, life = 1.25): void {
    this.floaters.push({ x, y, text, color, age: 0, life });
    if (this.floaters.length > 40) this.floaters.splice(0, this.floaters.length - 40);
  }

  update(dt: number): void {
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const floater = this.floaters[i];
      if (!floater) continue;
      floater.age += dt;
      if (floater.age >= floater.life) this.floaters.splice(i, 1);
    }
  }

  draw(world: World, state: RenderState, input?: InputController): void {
    if (this.canvas.width !== Math.round(this.width * this.dpr)) this.resize();

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
    ctx.translate(Math.round(this.width / 2 - camera.x), Math.round(this.height / 2 - camera.y));

    this.drawGround(world, camera);
    this.drawProps(world, camera);
    this.drawNodes(world, state, camera);
    this.drawEnemies(world, state, camera);
    this.drawPullRing(world, state);
    this.drawPlayer(world);
    this.drawFloaters();

    ctx.restore();

    if (input) this.drawJoystick(input);
    ctx.restore();
  }

  // ---------------------------------------------------------------- ground

  private visible(camera: { x: number; y: number }, margin: number) {
    return {
      left: camera.x - this.width / 2 - margin,
      right: camera.x + this.width / 2 + margin,
      top: camera.y - this.height / 2 - margin,
      bottom: camera.y + this.height / 2 + margin,
    };
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

  private drawProps(world: World, camera: { x: number; y: number }): void {
    const ctx = this.ctx;
    const bounds = this.visible(camera, 40);

    for (const prop of world.props) {
      if (prop.x < bounds.left || prop.x > bounds.right || prop.y < bounds.top || prop.y > bounds.bottom) {
        continue;
      }
      const disc = world.biomeAt(prop.x, prop.y);
      const base = disc ? disc.palette.accent : '#4c7a4a';
      ctx.fillStyle = withAlpha(shade(base, prop.tone), 0.45);

      if (prop.kind === 'tuft') {
        ctx.beginPath();
        ctx.ellipse(prop.x, prop.y, prop.size * 0.5, prop.size * 0.28, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (prop.kind === 'stone') {
        ctx.beginPath();
        ctx.arc(prop.x, prop.y, prop.size * 0.36, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(prop.x, prop.y - prop.size);
        ctx.lineTo(prop.x + prop.size * 0.34, prop.y);
        ctx.lineTo(prop.x - prop.size * 0.34, prop.y);
        ctx.closePath();
        ctx.fill();
      }
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

      // The first-bundle affordance: an arrow at the screen edge for anything
      // out of view. It disappears for good once that bundle is done.
      if (offscreen) {
        if (state.showEnemies && !enemy.dead) this.drawOffscreenMarker(enemy.x, enemy.y, world);
        continue;
      }

      const { def } = enemy;
      ctx.save();
      ctx.translate(enemy.x, enemy.y);

      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(0, 14, 13, 5, 0, 0, Math.PI * 2);
      ctx.fill();

      if (enemy.dead) ctx.globalAlpha = 0.35;

      // Aggro tell, so being noticed is legible before it reaches you.
      if (enemy.aggro && !enemy.dead) {
        ctx.fillStyle = withAlpha('#f87171', 0.85);
        ctx.beginPath();
        ctx.moveTo(0, -30);
        ctx.lineTo(4, -24);
        ctx.lineTo(-4, -24);
        ctx.closePath();
        ctx.fill();
      }

      const bob = Math.sin(world.time * 3 + enemy.id) * 2;
      ctx.translate(0, bob);
      // Tier is read by silhouette: the size difference is doing the work a
      // number on a health bar would otherwise have to.
      const size = 34 + def.tier * 8;
      drawIcon(ctx, def.shape, enemy.hitFlash > 0 ? '#ffffff' : def.color, size);

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

  private drawOffscreenMarker(x: number, y: number, world: World): void {
    const ctx = this.ctx;
    const dx = x - world.player.x;
    const dy = y - world.player.y;
    const angle = Math.atan2(dy, dx);
    const radius = Math.min(this.width, this.height) * 0.42;

    ctx.save();
    ctx.translate(world.player.x + Math.cos(angle) * radius, world.player.y + Math.sin(angle) * radius);
    ctx.rotate(angle);
    ctx.fillStyle = withAlpha('#f87171', 0.5);
    ctx.beginPath();
    ctx.moveTo(8, 0);
    ctx.lineTo(-5, 5);
    ctx.lineTo(-5, -5);
    ctx.closePath();
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

    if (this.sheetReady) this.drawPlayerSprite(ctx, player);
    else this.drawPlayerFallback(ctx, bob);

    ctx.globalAlpha = 1;
    ctx.restore();
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

  private drawJoystick(input: InputController): void {
    if (!input.origin || !input.knob) return;
    const ctx = this.ctx;
    const rect = this.canvas.getBoundingClientRect();
    const ox = input.origin.x - rect.left;
    const oy = input.origin.y - rect.top;
    const kx = input.knob.x - rect.left;
    const ky = input.knob.y - rect.top;

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
