/**
 * The explorable zone: node spawning, respawn timers, player movement, and
 * gather-range queries. Pure simulation - it never touches the canvas.
 */
import { Rng, hashString } from '../core/rng';
import type { Content } from '../core/content';
import type { MaterialId, ZoneDef } from '../core/types';

export interface WorldNode {
  id: number;
  material: MaterialId;
  x: number;
  y: number;
  /** Layout is fixed per zone; only availability changes. */
  available: boolean;
  respawnAt: number;
  /** Per-node phase so the bobbing animation isn't synchronised. */
  phase: number;
  scale: number;
}

/** Non-interactive scenery, so a zone doesn't read as an empty field. */
export interface Prop {
  x: number;
  y: number;
  size: number;
  kind: 'tuft' | 'stone' | 'spire';
  tone: number;
}

export interface Player {
  x: number;
  y: number;
  /** Facing angle in radians, kept through idle frames so the sprite doesn't snap. */
  facing: number;
  moving: boolean;
  bob: number;
}

export class World {
  readonly nodes: WorldNode[] = [];
  readonly props: Prop[] = [];
  readonly player: Player;

  private elapsed = 0;

  constructor(
    private readonly content: Content,
    readonly zone: ZoneDef,
  ) {
    const rng = new Rng(hashString(zone.id));

    this.player = {
      x: zone.size.w / 2,
      y: zone.size.h / 2,
      facing: -Math.PI / 2,
      moving: false,
      bob: 0,
    };

    this.generateProps(rng);
    this.generateNodes(rng);
  }

  private generateProps(rng: Rng): void {
    const count = Math.round((this.zone.size.w * this.zone.size.h) / 11000);
    const kinds: Prop['kind'][] = ['tuft', 'stone', 'spire'];

    for (let i = 0; i < count; i++) {
      this.props.push({
        x: rng.range(24, this.zone.size.w - 24),
        y: rng.range(24, this.zone.size.h - 24),
        size: rng.range(9, 26),
        kind: rng.weighted(kinds, (k) => (k === 'tuft' ? 6 : k === 'stone' ? 3 : 1)),
        tone: rng.range(-0.25, 0.2),
      });
    }
  }

  private generateNodes(rng: Rng): void {
    const margin = 70;
    const minSpacing = 96;

    for (let i = 0; i < this.zone.nodeCount; i++) {
      const material = rng.weighted(this.zone.spawns, (s) => s.weight).material;

      // Rejection-sample so nodes don't stack on top of each other; give up after
      // a bounded number of tries rather than looping forever on a crowded zone.
      let x = 0;
      let y = 0;
      for (let attempt = 0; attempt < 24; attempt++) {
        x = rng.range(margin, this.zone.size.w - margin);
        y = rng.range(margin, this.zone.size.h - margin);
        const clash = this.nodes.some((n) => Math.hypot(n.x - x, n.y - y) < minSpacing);
        if (!clash) break;
      }

      this.nodes.push({
        id: i,
        material,
        x,
        y,
        available: true,
        respawnAt: 0,
        phase: rng.range(0, Math.PI * 2),
        scale: rng.range(0.92, 1.12),
      });
    }
  }

  /** Advance respawn timers and the player's walk-bob. dt is in seconds. */
  update(dt: number): void {
    this.elapsed += dt;

    for (const node of this.nodes) {
      if (!node.available && this.elapsed >= node.respawnAt) node.available = true;
    }

    this.player.bob = this.player.moving ? this.player.bob + dt * 9 : 0;
  }

  /** Move the player by a normalised direction vector, clamped to the zone. */
  movePlayer(dx: number, dy: number, dt: number): void {
    const magnitude = Math.hypot(dx, dy);
    if (magnitude < 0.01) {
      this.player.moving = false;
      return;
    }

    const speed = this.content.progression.player.moveSpeed;
    // Clamp rather than normalise: a half-pushed stick should walk, not sprint.
    const scale = Math.min(1, magnitude);
    const nx = (dx / magnitude) * scale;
    const ny = (dy / magnitude) * scale;

    const radius = this.content.progression.player.radius;
    this.player.x = clamp(this.player.x + nx * speed * dt, radius, this.zone.size.w - radius);
    this.player.y = clamp(this.player.y + ny * speed * dt, radius, this.zone.size.h - radius);
    this.player.facing = Math.atan2(ny, nx);
    this.player.moving = true;
  }

  /** The closest available node inside gather range, if any. */
  nodeInRange(): WorldNode | null {
    const range = this.content.progression.player.gatherRadius + this.content.progression.player.radius;
    let best: WorldNode | null = null;
    let bestDistance = Infinity;

    for (const node of this.nodes) {
      if (!node.available) continue;
      const distance = Math.hypot(node.x - this.player.x, node.y - this.player.y);
      if (distance <= range && distance < bestDistance) {
        best = node;
        bestDistance = distance;
      }
    }
    return best;
  }

  /** Mark a node harvested and start its respawn timer. */
  harvest(node: WorldNode): void {
    node.available = false;
    node.respawnAt = this.elapsed + this.zone.respawnSeconds;
  }

  /** Seconds until a harvested node returns, for the depleted-node countdown ring. */
  respawnProgress(node: WorldNode): number {
    if (node.available) return 1;
    const remaining = node.respawnAt - this.elapsed;
    return clamp(1 - remaining / this.zone.respawnSeconds, 0, 1);
  }

  get time(): number {
    return this.elapsed;
  }
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
