/**
 * Canvas renderer: ground, scenery, nodes, the player and their two orbs, plus
 * the floating-text and joystick overlays.
 *
 * The camera follows the player and is clamped to the zone, so walking to an
 * edge never reveals blank space outside the map.
 */
import { drawIcon, shade, withAlpha } from './icons';
import { clamp, type World } from './world';
import type { Content } from '../core/content';
import type { InputController } from './input';
import type { MaterialId } from '../core/types';

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
}

export class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly floaters: Floater[] = [];
  private width = 0;
  private height = 0;
  private dpr = 1;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly content: Content,
  ) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
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

    // Robed figure: a hood over a tapered body, facing the walk direction.
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

    // The two orbs, orbiting. Filled orbs take their material's colour, which
    // makes the current pair readable without looking at the HUD.
    const orbs: [MaterialId | null, number][] = [
      [state.leftOrb, world.time * 1.1],
      [state.rightOrb, world.time * 1.1 + Math.PI],
    ];

    for (const [material, angle] of orbs) {
      const ox = Math.cos(angle) * 25;
      const oy = Math.sin(angle) * 10 - 5 + bob;
      const color = material ? this.content.material(material).color : '#5c6480';

      ctx.beginPath();
      ctx.arc(ox, oy, 8.5, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(color, material ? 0.32 : 0.14);
      ctx.fill();

      ctx.beginPath();
      ctx.arc(ox, oy, 5.4, 0, Math.PI * 2);
      ctx.fillStyle = material ? color : 'rgba(255,255,255,0.14)';
      ctx.fill();
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = withAlpha('#ffffff', material ? 0.7 : 0.28);
      ctx.stroke();
    }

    ctx.restore();
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
