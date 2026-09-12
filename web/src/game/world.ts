/**
 * The explorable zone: node spawning, respawn timers, player movement, and
 * gather-range queries. Pure simulation - it never touches the canvas.
 */
import { Rng, hashString } from '../core/rng';
import type { Content } from '../core/content';
import { applyDamage, inSwing, rollDrops } from '../core/combat';
import type { EnemyDef, MaterialId, ZoneDef } from '../core/types';

/** World pixels travelled per walk-cycle frame. */
const STEP_DISTANCE = 13;
const WALK_FRAMES = 4;

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

export interface Enemy {
  id: number;
  def: EnemyDef;
  x: number;
  y: number;
  hp: number;
  /** Where it returns to when it loses interest. */
  homeX: number;
  homeY: number;
  aggro: boolean;
  /** Seconds until it can swing again. */
  cooldown: number;
  /** Counts down after being hit, for the flash and the knockback slide. */
  hitFlash: number;
  knockX: number;
  knockY: number;
  /** Set on death; the corpse fades, then the slot respawns. */
  dead: boolean;
  respawnAt: number;
  facing: number;
}

export interface CombatEvent {
  kind: 'player-hit' | 'enemy-hit' | 'enemy-killed' | 'player-died' | 'miss';
  enemy?: Enemy;
  amount?: number;
  drops?: MaterialId[];
  xp?: number;
}

/** Non-interactive scenery, so a zone doesn't read as an empty field. */
export interface Prop {
  x: number;
  y: number;
  size: number;
  kind: 'tuft' | 'stone' | 'spire';
  tone: number;
}

/** The four sprite facings. Movement commits to one rather than interpolating. */
export type Facing = 'down' | 'up' | 'side';

export interface Player {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  /** Counts down; while positive the player cannot be hit again. */
  invulnerable: number;
  /** Seconds since last taking damage, gating regeneration. */
  sinceHit: number;
  /** Counts down while the swing animation plays. */
  attackAnim: number;
  attackCooldown: number;
  dead: boolean;
  respawnAt: number;
  /** Facing angle in radians, kept through idle frames so the sprite doesn't snap. */
  facing: number;
  moving: boolean;
  bob: number;

  /** Which sprite row to draw. */
  facing4: Facing;
  /** Side facing is one mirrored row, as the era did to save cartridge space. */
  mirrored: boolean;
  /** Walk cycle index, 0..3. */
  frame: number;
  /** Distance since the last frame advance - the cycle ticks on travel, not time. */
  travelled: number;
}

export class World {
  readonly nodes: WorldNode[] = [];
  readonly props: Prop[] = [];
  readonly enemies: Enemy[] = [];
  readonly player: Player;

  /** Drained by the game layer each frame. */
  readonly events: CombatEvent[] = [];

  private elapsed = 0;

  /** Coyote time: the node last in range, and when its grace expires. */
  private graceNode: WorldNode | null = null;
  private graceUntil = 0;

  constructor(
    private readonly content: Content,
    readonly zone: ZoneDef,
  ) {
    const rng = new Rng(hashString(zone.id));

    const combat = content.progression.combat;
    this.player = {
      x: zone.size.w / 2,
      y: zone.size.h / 2,
      hp: combat.maxHp,
      maxHp: combat.maxHp,
      invulnerable: 0,
      sinceHit: combat.regenDelaySeconds,
      attackAnim: 0,
      attackCooldown: 0,
      dead: false,
      respawnAt: 0,
      facing: -Math.PI / 2,
      moving: false,
      bob: 0,
      facing4: 'down',
      mirrored: false,
      frame: 0,
      travelled: 0,
    };

    this.generateProps(rng);
    this.generateNodes(rng);
    this.generateEnemies(rng);
  }

  private generateEnemies(rng: Rng): void {
    if (!this.zone.enemies.length) return;

    for (let i = 0; i < this.zone.enemyCount; i++) {
      const def = this.content.enemy(rng.pick(this.zone.enemies));
      // Keep spawns off the player's start, so arriving in a zone is not an ambush.
      let x = 0;
      let y = 0;
      for (let attempt = 0; attempt < 24; attempt++) {
        x = rng.range(80, this.zone.size.w - 80);
        y = rng.range(80, this.zone.size.h - 80);
        if (Math.hypot(x - this.player.x, y - this.player.y) > 320) break;
      }

      this.enemies.push({
        id: i,
        def,
        x,
        y,
        hp: def.hp,
        homeX: x,
        homeY: y,
        aggro: false,
        cooldown: 0,
        hitFlash: 0,
        knockX: 0,
        knockY: 0,
        dead: false,
        respawnAt: 0,
        facing: rng.range(0, Math.PI * 2),
      });
    }
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

  /** Advance respawn timers, combat and the player's walk-bob. dt is in seconds. */
  update(dt: number): void {
    this.elapsed += dt;

    for (const node of this.nodes) {
      if (!node.available && this.elapsed >= node.respawnAt) node.available = true;
    }

    this.player.bob = this.player.moving ? this.player.bob + dt * 9 : 0;
    this.updatePlayerCombat(dt);
    this.updateEnemies(dt);
  }

  private updatePlayerCombat(dt: number): void {
    const combat = this.content.progression.combat;
    const p = this.player;

    p.invulnerable = Math.max(0, p.invulnerable - dt);
    p.attackAnim = Math.max(0, p.attackAnim - dt);
    p.attackCooldown = Math.max(0, p.attackCooldown - dt);

    if (p.dead) {
      if (this.elapsed >= p.respawnAt) this.respawnPlayer();
      return;
    }

    p.sinceHit += dt;
    if (p.hp < p.maxHp && p.sinceHit >= combat.regenDelaySeconds) {
      p.hp = Math.min(p.maxHp, p.hp + combat.regenPerSecond * dt);
    }
  }

  private updateEnemies(dt: number): void {
    const p = this.player;
    const combat = this.content.progression.combat;

    for (const enemy of this.enemies) {
      enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
      enemy.cooldown = Math.max(0, enemy.cooldown - dt);

      // Knockback decays rather than stopping dead, so a hit reads as a shove.
      if (enemy.knockX || enemy.knockY) {
        enemy.x += enemy.knockX * dt;
        enemy.y += enemy.knockY * dt;
        const decay = Math.exp(-dt * 9);
        enemy.knockX *= decay;
        enemy.knockY *= decay;
        if (Math.hypot(enemy.knockX, enemy.knockY) < 1) {
          enemy.knockX = 0;
          enemy.knockY = 0;
        }
      }

      if (enemy.dead) {
        if (this.elapsed >= enemy.respawnAt) {
          enemy.dead = false;
          enemy.hp = enemy.def.hp;
          enemy.x = enemy.homeX;
          enemy.y = enemy.homeY;
          enemy.aggro = false;
        }
        continue;
      }

      const dx = p.x - enemy.x;
      const dy = p.y - enemy.y;
      const distance = Math.hypot(dx, dy);

      // A dead player is not a target; enemies drift home instead.
      if (p.dead) {
        enemy.aggro = false;
      } else if (distance <= enemy.def.aggroRadius) {
        enemy.aggro = true;
      } else if (distance > enemy.def.aggroRadius * 1.8) {
        enemy.aggro = false;
      }

      if (enemy.aggro && distance > 0.01) {
        enemy.facing = Math.atan2(dy, dx);

        if (distance > enemy.def.attackRange * 0.8) {
          const step = enemy.def.speed * dt;
          enemy.x += (dx / distance) * step;
          enemy.y += (dy / distance) * step;
        } else if (enemy.cooldown <= 0) {
          enemy.cooldown = enemy.def.attackCooldown;
          this.damagePlayer(enemy.def.damage, combat);
        }
      } else if (!enemy.aggro) {
        const hx = enemy.homeX - enemy.x;
        const hy = enemy.homeY - enemy.y;
        const home = Math.hypot(hx, hy);
        if (home > 4) {
          const step = Math.min(home, enemy.def.speed * 0.6 * dt);
          enemy.x += (hx / home) * step;
          enemy.y += (hy / home) * step;
        }
      }

      enemy.x = clamp(enemy.x, 8, this.zone.size.w - 8);
      enemy.y = clamp(enemy.y, 8, this.zone.size.h - 8);
    }
  }

  private damagePlayer(amount: number, combat: { invulnerableSeconds: number; respawnSeconds: number }): void {
    const p = this.player;
    if (p.dead || p.invulnerable > 0) return;

    const died = applyDamage(p, amount);
    p.invulnerable = combat.invulnerableSeconds;
    p.sinceHit = 0;
    this.events.push({ kind: 'player-hit', amount });

    if (died) {
      p.dead = true;
      p.respawnAt = this.elapsed + combat.respawnSeconds;
      this.events.push({ kind: 'player-died' });
    }
  }

  private respawnPlayer(): void {
    const p = this.player;
    p.dead = false;
    p.hp = p.maxHp;
    p.invulnerable = this.content.progression.combat.invulnerableSeconds;
    p.sinceHit = 0;
    p.x = this.zone.size.w / 2;
    p.y = this.zone.size.h / 2;

    // Reset the field rather than respawning into whatever was chasing you.
    for (const enemy of this.enemies) {
      enemy.aggro = false;
      enemy.x = enemy.homeX;
      enemy.y = enemy.homeY;
    }
  }

  /** The nearest living enemy inside the swing, or null. */
  enemyInReach(): Enemy | null {
    const combat = this.content.progression.combat;
    let best: Enemy | null = null;
    let bestDistance = Infinity;

    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const distance = Math.hypot(enemy.x - this.player.x, enemy.y - this.player.y);
      if (distance > combat.attackRange || distance >= bestDistance) continue;
      best = enemy;
      bestDistance = distance;
    }
    return best;
  }

  /**
   * Swing. Hits every living enemy inside the arc, not just the nearest, so
   * being surrounded is survivable rather than a death sentence.
   */
  attack(damage: number, roll: () => number): boolean {
    const p = this.player;
    const combat = this.content.progression.combat;
    if (p.dead || p.attackCooldown > 0) return false;

    p.attackCooldown = combat.attackCooldown;
    p.attackAnim = Math.min(combat.attackCooldown, 0.22);

    let hitAny = false;
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      if (!inSwing(p, enemy, combat)) continue;

      hitAny = true;
      enemy.hitFlash = 0.18;
      enemy.aggro = true;

      const away = Math.atan2(enemy.y - p.y, enemy.x - p.x);
      enemy.knockX = Math.cos(away) * combat.knockback * 6;
      enemy.knockY = Math.sin(away) * combat.knockback * 6;

      if (applyDamage(enemy, damage)) {
        enemy.dead = true;
        enemy.respawnAt = this.elapsed + this.zone.respawnSeconds * 2;
        this.events.push({
          kind: 'enemy-killed',
          enemy,
          xp: enemy.def.xp,
          drops: rollDrops(enemy.def.drops, roll),
        });
      } else {
        this.events.push({ kind: 'enemy-hit', enemy, amount: damage });
      }
    }

    if (!hitAny) this.events.push({ kind: 'miss' });
    return true;
  }

  /** Take and clear queued combat events. */
  drainEvents(): CombatEvent[] {
    return this.events.splice(0, this.events.length);
  }

  /** Move the player by a normalised direction vector, clamped to the zone. */
  movePlayer(dx: number, dy: number, dt: number): void {
    if (this.player.dead) {
      this.player.moving = false;
      return;
    }
    const magnitude = Math.hypot(dx, dy);
    if (magnitude < 0.01) {
      this.player.moving = false;
      // Rest on the contact frame rather than wherever the cycle stopped.
      this.player.frame = 0;
      this.player.travelled = 0;
      return;
    }

    const speed = this.content.progression.player.moveSpeed;
    // Clamp rather than normalise: a half-pushed stick should walk, not sprint.
    const scale = Math.min(1, magnitude);
    const nx = (dx / magnitude) * scale;
    const ny = (dy / magnitude) * scale;

    const radius = this.content.progression.player.radius;
    const beforeX = this.player.x;
    const beforeY = this.player.y;

    this.player.x = clamp(this.player.x + nx * speed * dt, radius, this.zone.size.w - radius);
    this.player.y = clamp(this.player.y + ny * speed * dt, radius, this.zone.size.h - radius);
    this.player.facing = Math.atan2(ny, nx);
    this.player.moving = true;

    // Commit to one of four facings by dominant axis. Interpolating between them
    // would need a sprite per angle; committing is what makes the look readable.
    if (Math.abs(nx) > Math.abs(ny)) {
      this.player.facing4 = 'side';
      this.player.mirrored = nx > 0;
    } else {
      this.player.facing4 = ny < 0 ? 'up' : 'down';
    }

    // Advance on distance actually moved - measured after clamping, so walking
    // into a zone edge doesn't cycle the legs on the spot. Tying the cycle to
    // travel rather than to a timer is what stops the walk looking like skating.
    const moved = Math.hypot(this.player.x - beforeX, this.player.y - beforeY);
    this.player.travelled += moved;
    while (this.player.travelled >= STEP_DISTANCE) {
      this.player.travelled -= STEP_DISTANCE;
      this.player.frame = (this.player.frame + 1) % WALK_FRAMES;
    }
  }

  /**
   * The node the player can gather: the closest one in range, or the one they
   * just walked past if they are still within the grace window.
   *
   * The grace exists because range alone is unforgiving while moving. At the
   * default speed a node is in strict range for about half a second walking
   * straight over it, and a fraction of that clipping its edge - less than the
   * time it takes to notice the prompt and move a thumb to it. Letting a
   * slightly late tap still land is the difference between the loop feeling
   * responsive and feeling like it is ignoring you.
   */
  nodeInRange(): WorldNode | null {
    const { gatherRadius, radius, gatherGraceSeconds, gatherGraceRangeFactor } =
      this.content.progression.player;
    const range = gatherRadius + radius;

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

    if (best) {
      this.graceNode = best;
      this.graceUntil = this.elapsed + gatherGraceSeconds;
      return best;
    }

    // Nothing strictly in range - fall back to the one just left behind, as long
    // as it is still unharvested and has not been left far behind.
    if (this.graceNode && this.graceNode.available && this.elapsed < this.graceUntil) {
      const distance = Math.hypot(this.graceNode.x - this.player.x, this.graceNode.y - this.player.y);
      if (distance <= range * gatherGraceRangeFactor) return this.graceNode;
    }

    this.graceNode = null;
    return null;
  }

  /** Mark a node harvested and start its respawn timer. */
  harvest(node: WorldNode): void {
    node.available = false;
    node.respawnAt = this.elapsed + this.zone.respawnSeconds;
    // Clear the grace target too, or the prompt lingers on something just taken.
    if (this.graceNode === node) this.graceNode = null;
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
