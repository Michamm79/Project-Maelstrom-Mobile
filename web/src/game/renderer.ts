/**
 * Canvas renderer: ground, scenery, nodes, the player and their two orbs, plus
 * the floating-text and joystick overlays.
 *
 * The camera follows the player and is clamped to the zone, so walking to an
 * edge never reveals blank space outside the map.
 */
import alchemistSheet from '../assets/alchemist.png';
import { drawIcon, shade, withAlpha } from './icons';
import { clamp, type World } from './world';
import type { Content } from '../core/content';
import type { InputController } from './input';
import type { MaterialId } from '../core/types';

/** Sprite sheet geometry. Rows match the order make-sprites.mjs emits. */
const SPRITE_W = 16;
const SPRITE_H = 24;
const SPRITE_ROWS = { down: 0, side: 1, up: 2, sideMirror: 3 } as const;
/** Drawn at 2x so the 16x24 character sits right next to 44px item icons. */
const SPRITE_SCALE = 2;

interface Floater {
  x: number;
  y: number;
  text: string;
  color: string;
  age: number;
  life: number;
}

export interface RenderState {
  leftOrb: MaterialId | null;
  rightOrb: MaterialId | null;
  /** The node the player could gather right now, highlighted in the world. */
  highlightNodeId: number | null;
  /** The enemy the action button would strike. */
  highlightEnemyId: number | null;
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly floaters: Floater[] = [];
  private width = 0;
  private height = 0;
  private dpr = 1;

  /** Character sheet. Bundled as a data URI, so this resolves immediately. */
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
    // Cap DPR at 2: a 3x phone display triples the fill cost for no visible gain.
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
  }

  addFloater(worldX: number, worldY: number, text: string, color: string, life = 1.25): void {
    this.floaters.push({ x: worldX, y: worldY, text, color, age: 0, life });
    // Bound the list so a burst of pickups can't grow it without limit.
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

  draw(world: World, state: RenderState, input: InputController): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    const camera = this.cameraFor(world);
    const palette = world.zone.palette;

    ctx.fillStyle = palette.ground;
    ctx.fillRect(0, 0, this.width, this.height);

    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    this.drawGround(world, camera);
    this.drawProps(world, camera);
    this.drawNodes(world, state, camera);
    this.drawEnemies(world, state, camera);
    this.drawPlayer(world, state);
    this.drawFloaters();

    ctx.restore();

    this.drawVignette(palette.fog);
    this.drawJoystick(input);

    ctx.restore();
  }

  // ---------------------------------------------------------------- camera

  /** Screen-space position (in CSS pixels, page-relative) of a world point. */
  worldToScreen(world: World, x: number, y: number): { x: number; y: number } {
    const camera = this.cameraFor(world);
    const rect = this.canvas.getBoundingClientRect();
    return { x: x - camera.x + rect.left, y: y - camera.y + rect.top };
  }

  private cameraFor(world: World): { x: number; y: number } {
    const { w, h } = world.zone.size;
    // When the zone is smaller than the viewport, centre it instead of clamping
    // to zero, which would pin it to the top-left corner.
    const x = w <= this.width
      ? (w - this.width) / 2
      : clamp(world.player.x - this.width / 2, 0, w - this.width);
    const y = h <= this.height
      ? (h - this.height) / 2
      : clamp(world.player.y - this.height / 2, 0, h - this.height);
    return { x, y };
  }

  private visibleBounds(camera: { x: number; y: number }, pad: number) {
    return {
      left: camera.x - pad,
      right: camera.x + this.width + pad,
      top: camera.y - pad,
      bottom: camera.y + this.height + pad,
    };
  }

  // ---------------------------------------------------------------- layers

  private drawGround(world: World, camera: { x: number; y: number }): void {
    const ctx = this.ctx;
    const cell = 56;
    const bounds = this.visibleBounds(camera, cell);
    const palette = world.zone.palette;

    const startX = Math.floor(bounds.left / cell) * cell;
    const startY = Math.floor(bounds.top / cell) * cell;

    // A faint, fine checker reads as ground texture. At full opacity and a
    // larger cell it reads as an unfinished placeholder instead.
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = palette.groundAlt;
    for (let y = startY; y < bounds.bottom; y += cell) {
      for (let x = startX; x < bounds.right; x += cell) {
        if (((x / cell) + (y / cell)) % 2 === 0) continue;
        ctx.fillRect(x, y, cell, cell);
      }
    }
    ctx.globalAlpha = 1;

    // Zone border: a visible edge reads as "the map ends here", not "it failed to draw".
    ctx.strokeStyle = withAlpha(palette.accent, 0.5);
    ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, world.zone.size.w, world.zone.size.h);
  }

  private drawProps(world: World, camera: { x: number; y: number }): void {
    const ctx = this.ctx;
    const bounds = this.visibleBounds(camera, 60);
    const accent = world.zone.palette.accent;

    for (const prop of world.props) {
      if (prop.x < bounds.left || prop.x > bounds.right || prop.y < bounds.top || prop.y > bounds.bottom) continue;

      const color = shade(accent, prop.tone);
      ctx.save();
      ctx.translate(prop.x, prop.y);

      if (prop.kind === 'tuft') {
        ctx.strokeStyle = withAlpha(color, 0.55);
        ctx.lineWidth = 2.2;
        ctx.lineCap = 'round';
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.moveTo(i * prop.size * 0.28, prop.size * 0.4);
          ctx.quadraticCurveTo(i * prop.size * 0.5, 0, i * prop.size * 0.7, -prop.size * 0.5);
          ctx.stroke();
        }
      } else if (prop.kind === 'stone') {
        // Flat and faint: a rounder, brighter blob reads as something to pick up.
        ctx.fillStyle = withAlpha(color, 0.3);
        ctx.beginPath();
        ctx.ellipse(0, 0, prop.size * 0.62, prop.size * 0.22, prop.tone, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = withAlpha(color, 0.35);
        ctx.beginPath();
        ctx.moveTo(0, -prop.size * 1.5);
        ctx.lineTo(prop.size * 0.42, prop.size * 0.5);
        ctx.lineTo(-prop.size * 0.42, prop.size * 0.5);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    }
  }

  private drawNodes(world: World, state: RenderState, camera: { x: number; y: number }): void {
    const ctx = this.ctx;
    const bounds = this.visibleBounds(camera, 80);

    for (const node of world.nodes) {
      if (node.x < bounds.left || node.x > bounds.right || node.y < bounds.top || node.y > bounds.bottom) continue;

      const material = this.content.material(node.material);
      ctx.save();
      ctx.translate(node.x, node.y);

      if (!node.available) {
        // Depleted: a filling ring shows how long until it returns.
        const progress = world.respawnProgress(node);
        ctx.strokeStyle = withAlpha('#ffffff', 0.16);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, 17, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = withAlpha(material.color, 0.6);
        ctx.beginPath();
        ctx.arc(0, 0, 17, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        continue;
      }

      const bob = Math.sin(world.time * 1.9 + node.phase) * 3;
      const highlighted = state.highlightNodeId === node.id;

      ctx.fillStyle = 'rgba(0,0,0,0.28)';
      ctx.beginPath();
      ctx.ellipse(0, 15, 15 * node.scale, 5.5 * node.scale, 0, 0, Math.PI * 2);
      ctx.fill();

      if (highlighted) {
        const pulse = 0.5 + Math.sin(world.time * 6) * 0.16;
        ctx.strokeStyle = withAlpha('#ffffff', pulse);
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(0, 0, 28, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.translate(0, bob - 4);
      drawIcon(ctx, material.shape, material.color, 44 * node.scale * (highlighted ? 1.12 : 1));
      ctx.restore();
    }
  }

  private drawEnemies(world: World, state: RenderState, camera: { x: number; y: number }): void {
    const ctx = this.ctx;
    const bounds = this.visibleBounds(camera, 90);

    for (const enemy of world.enemies) {
      if (enemy.dead) continue;
      if (enemy.x < bounds.left || enemy.x > bounds.right || enemy.y < bounds.top || enemy.y > bounds.bottom) continue;

      const { def } = enemy;
      ctx.save();
      ctx.translate(enemy.x, enemy.y);

      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.beginPath();
      ctx.ellipse(0, 14, 13, 5, 0, 0, Math.PI * 2);
      ctx.fill();

      // Target ring: which one the action button would hit.
      if (state.highlightEnemyId === enemy.id) {
        ctx.strokeStyle = withAlpha('#f87171', 0.55 + Math.sin(world.time * 7) * 0.2);
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(0, 0, 26, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Aggro tell, so being chased is legible before it reaches you.
      if (enemy.aggro) {
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
      drawIcon(ctx, def.shape, enemy.hitFlash > 0 ? '#ffffff' : def.color, 38);

      // Health bar only once damaged, so an untouched field stays uncluttered.
      if (enemy.hp < def.hp) {
        const w = 28;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(-w / 2, -28, w, 4);
        ctx.fillStyle = '#f87171';
        ctx.fillRect(-w / 2, -28, w * (enemy.hp / def.hp), 4);
      }

      ctx.restore();
    }
  }

  private drawPlayer(world: World, state: RenderState): void {
    const ctx = this.ctx;
    const { player } = world;
    const bob = Math.sin(player.bob) * 2.5;

    ctx.save();
    ctx.translate(player.x, player.y);

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(0, 18, 16, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    // The swing: an arc sweeping the direction the player faces.
    if (player.attackAnim > 0) {
      const config = this.content.progression.combat;
      const t = 1 - player.attackAnim / 0.22;
      ctx.save();
      ctx.rotate(player.facing);
      ctx.strokeStyle = withAlpha('#ffffff', 0.75 * (1 - t));
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(0, -6, config.attackRange * 0.8, -config.attackArc + t * 0.6, config.attackArc + t * 0.6);
      ctx.stroke();
      ctx.restore();
    }

    // Flash while briefly invulnerable after a hit.
    if (player.invulnerable > 0 && Math.floor(player.invulnerable * 12) % 2 === 0) {
      ctx.globalAlpha = 0.45;
    }
    if (player.dead) ctx.globalAlpha = 0.3;

    // Orbs genuinely circle the character, so the half of the orbit behind them
    // is drawn first. Without this the orbs sit flatly over the sprite's face.
    this.drawOrbs(ctx, world, state, bob, 'behind');

    if (this.sheetReady) {
      this.drawPlayerSprite(ctx, player);
    } else {
      this.drawPlayerFallback(ctx, player, bob);
    }

    this.drawOrbs(ctx, world, state, bob, 'front');
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  /** The pixel-art character, drawn from the sheet at the current facing and frame. */
  private drawPlayerSprite(ctx: CanvasRenderingContext2D, player: World['player']): void {
    const row =
      player.facing4 === 'side'
        ? player.mirrored
          ? SPRITE_ROWS.sideMirror
          : SPRITE_ROWS.side
        : SPRITE_ROWS[player.facing4];

    const w = SPRITE_W * SPRITE_SCALE;
    const h = SPRITE_H * SPRITE_SCALE;

    // Round to whole pixels: a sprite drawn on a half-pixel shimmers as it moves.
    const x = Math.round(-w / 2);
    const y = Math.round(-h + 16);

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.sheet, player.frame * SPRITE_W, row * SPRITE_H, SPRITE_W, SPRITE_H, x, y, w, h);
    ctx.imageSmoothingEnabled = true;
  }

  /** Kept for the frames before the sheet decodes, so the player is never invisible. */
  private drawPlayerFallback(ctx: CanvasRenderingContext2D, player: World['player'], bob: number): void {
    ctx.save();
    ctx.translate(0, bob);
    ctx.fillStyle = '#2f3448';
    ctx.beginPath();
    ctx.moveTo(-13, 17);
    ctx.quadraticCurveTo(-11, -7, 0, -14);
    ctx.quadraticCurveTo(11, -7, 13, 17);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.stroke();

    ctx.fillStyle = '#3d4460';
    ctx.beginPath();
    ctx.arc(0, -14, 9.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#11131c';
    ctx.beginPath();
    ctx.ellipse(Math.cos(player.facing) * 3, -14 + Math.sin(player.facing) * 2, 6, 5.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * The two orbs, orbiting. Filled orbs take their material's colour, which
   * makes the current pair readable without looking at the HUD.
   */
  private drawOrbs(
    ctx: CanvasRenderingContext2D,
    world: World,
    state: RenderState,
    bob: number,
    half: 'behind' | 'front',
  ): void {
    const orbs: [MaterialId | null, number][] = [
      [state.leftOrb, world.time * 1.1],
      [state.rightOrb, world.time * 1.1 + Math.PI],
    ];

    for (const [material, angle] of orbs) {
      const depth = Math.sin(angle);
      // sin < 0 is the far side of the orbit, drawn before the character.
      if ((half === 'behind') !== (depth < 0)) continue;

      const ox = Math.cos(angle) * 27;
      // Orbit the chest of a 48px-tall sprite, not the old figure's centre.
      const oy = depth * 7 - 15 + bob;
      // A touch smaller on the far side sells the depth without needing scaling maths.
      const radius = depth < 0 ? 4.6 : 5.6;
      const color = material ? this.content.material(material).color : '#5c6480';

      ctx.beginPath();
      ctx.arc(ox, oy, radius + 3, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(color, material ? 0.3 : 0.1);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(ox, oy, radius, 0, Math.PI * 2);
      ctx.fillStyle = material ? color : 'rgba(255,255,255,0.1)';
      ctx.fill();
      ctx.lineWidth = 1.3;
      ctx.strokeStyle = withAlpha('#ffffff', material ? 0.7 : 0.2);
      ctx.stroke();
    }
  }

  private drawFloaters(): void {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.font = '600 15px ui-sans-serif, system-ui, sans-serif';

    for (const floater of this.floaters) {
      const t = floater.age / floater.life;
      const alpha = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.fillStyle = floater.color;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.lineWidth = 3;
      const y = floater.y - 26 - t * 34;
      ctx.strokeText(floater.text, floater.x, y);
      ctx.fillText(floater.text, floater.x, y);
    }
    ctx.globalAlpha = 1;
  }

  private drawVignette(fog: string): void {
    const ctx = this.ctx;
    const gradient = ctx.createRadialGradient(
      this.width / 2,
      this.height / 2,
      Math.min(this.width, this.height) * 0.34,
      this.width / 2,
      this.height / 2,
      Math.max(this.width, this.height) * 0.78,
    );
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(1, withAlpha(fog, 0.72));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);
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
    ctx.stroke();
  }
}
