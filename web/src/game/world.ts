/**
 * The Coliseum: one continuous, bounded world.
 *
 * Not five levels behind a travel menu. Plains/Forest is the permanent spawn at
 * the origin, four biomes ring it on the diagonals at equal distance, and forest
 * fills the space between them out to the boundary. Distance from spawn is the
 * difficulty axis, and it costs nothing to build because it is already in the
 * shape (GDD section 3).
 *
 * Canon distances are Unreal units; everything here is screen units, converted
 * once on construction through content.unitsPerPixel.
 *
 * Pure simulation - it never touches the canvas.
 */
import { Rng, hashString } from '../core/rng';
import type { Content } from '../core/content';
import { abilityTargets, applyDamage } from '../core/combat';
import type { AlchemyCombination, BiomeId, EnemyDef, MaterialId } from '../core/types';

/** Screen units travelled per walk-cycle frame. */
const STEP_DISTANCE = 13;
const WALK_FRAMES = 4;

/** How many turns the spiral makes on its way in. The pull is never a straight snap. */
const SPIRAL_TURNS = 1.35;

export interface WorldNode {
  id: number;
  material: MaterialId;
  /** Which region it belongs to. A node can never sit outside its own biome. */
  biome: BiomeId;
  x: number;
  y: number;
  available: boolean;
  respawnAt: number;
  /** Per-node phase so the bobbing animation is not synchronised. */
  phase: number;
  scale: number;

  /** 0 when at rest, climbing to 1 as the gauntlet draws it in. */
  pull: number;
  /** Where the spiral started, so it reads as one continuous motion. */
  pullX: number;
  pullY: number;
  pullAngle: number;
  pullDistance: number;
}

export interface Enemy {
  id: number;
  def: EnemyDef;
  x: number;
  y: number;
  hp: number;
  homeX: number;
  homeY: number;
  /** Canon: enemies do not know where the player is until they notice them. */
  aggro: boolean;
  cooldown: number;
  hitFlash: number;
  knockX: number;
  knockY: number;
  dead: boolean;
  facing: number;
  burn: number;
}

export interface CombatEvent {
  kind: 'player-hit' | 'enemy-hit' | 'enemy-killed' | 'player-died';
  enemy?: Enemy;
  amount?: number;
}

/** Non-interactive scenery, so the world does not read as an empty field. */
export interface Prop {
  x: number;
  y: number;
  size: number;
  kind: 'tuft' | 'stone' | 'spire';
  tone: number;
}

export type Facing = 'down' | 'up' | 'side';

export interface Player {
  /** Counts down while the swing animation plays. */
  attackAnim: number;
  attackCooldown: number;
  /** Consecutive hits on the same target, and how long they stay counted. */
  combo: number;
  comboTimer: number;
  comboTargetId: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  invulnerable: number;
  sinceHit: number;
  dead: boolean;
  respawnAt: number;
  facing: number;
  moving: boolean;
  bob: number;
  facing4: Facing;
  mirrored: boolean;
  frame: number;
  travelled: number;
}

export interface BiomeDisc {
  id: BiomeId;
  name: string;
  x: number;
  y: number;
  radius: number;
  palette: { ground: string; groundAlt: string; accent: string; fog: string };
  mood: string;
}

/** The player as they wake: one definition, so reset() cannot drift from it. */
function freshPlayer(combat: Content['progression']['combat']): Player {
  return {
    x: 0,
    y: 0,
    hp: combat.maxHp,
    maxHp: combat.maxHp,
    invulnerable: 0,
    sinceHit: combat.regenDelaySeconds,
    dead: false,
    respawnAt: 0,
    facing: -Math.PI / 2,
    moving: false,
    bob: 0,
    attackAnim: 0,
    attackCooldown: 0,
    combo: 0,
    comboTimer: 0,
    comboTargetId: -1,
    facing4: 'down',
    mirrored: false,
    frame: 0,
    travelled: 0,
  };
}

export class World {
  readonly nodes: WorldNode[] = [];
  readonly props: Prop[] = [];
  readonly enemies: Enemy[] = [];
  readonly discs: BiomeDisc[] = [];
  readonly player: Player;
  readonly boundaryRadius: number;

  /** Drained by the game layer each frame. */
  readonly events: CombatEvent[] = [];
  /** Materials absorbed this frame, in the order the spirals completed. */
  readonly absorbed: MaterialId[] = [];

  private elapsed = 0;
  private nextEnemyId = 0;

  constructor(private readonly content: Content) {
    const upp = content.unitsPerPixel;

    this.boundaryRadius = content.coliseum.boundaryRadius / upp;
    for (const b of content.biomes) {
      this.discs.push({
        id: b.id,
        name: b.name,
        x: b.centre.x / upp,
        y: b.centre.y / upp,
        radius: b.radius / upp,
        palette: b.palette,
        mood: b.mood,
      });
    }

    this.player = freshPlayer(content.progression.combat);
    this.populate();
  }

  /**
   * Everything the world generates, from the same seed every time.
   *
   * Split out of the constructor so reset() can re-run it in the same order:
   * props and nodes draw from one stream, so regenerating only the nodes would
   * give a restarted run a different Coliseum from the one a fresh load gives.
   */
  private populate(): void {
    const rng = new Rng(hashString('coliseum'));
    this.generateProps(rng);
    this.generateNodes(rng);
  }

  /**
   * Put the world back to how it opens.
   *
   * Starting over used to clear localStorage and nothing else, so the live
   * objects carried straight into the new run: the same standing position, the
   * same nodes already taken, the same corpses on the ground.
   */
  reset(): void {
    this.nodes.length = 0;
    this.props.length = 0;
    this.enemies.length = 0;
    this.events.length = 0;
    this.absorbed.length = 0;
    this.elapsed = 0;
    this.nextEnemyId = 0;
    Object.assign(this.player, freshPlayer(this.content.progression.combat));
    this.populate();
  }

  // ---------------------------------------------------------------- geography

  /** Which region a point falls in, or null for the connective forest between. */
  biomeAt(x: number, y: number): BiomeDisc | null {
    for (const d of this.discs) {
      if (Math.hypot(x - d.x, y - d.y) <= d.radius) return d;
    }
    return null;
  }

  disc(id: BiomeId): BiomeDisc {
    const d = this.discs.find((c) => c.id === id);
    if (!d) throw new Error(`unknown biome "${id}"`);
    return d;
  }

  private generateProps(rng: Rng): void {
    const count = 900;
    const kinds: Prop['kind'][] = ['tuft', 'stone', 'spire'];
    for (let i = 0; i < count; i++) {
      const angle = rng.range(0, Math.PI * 2);
      // Square-root so props spread evenly over area rather than bunching at
      // the centre, which is what a uniform radius would do.
      const r = Math.sqrt(rng.range(0, 1)) * this.boundaryRadius;
      this.props.push({
        x: Math.cos(angle) * r,
        y: Math.sin(angle) * r,
        size: rng.range(9, 26),
        kind: rng.weighted(kinds, (k) => (k === 'tuft' ? 6 : k === 'stone' ? 3 : 1)),
        tone: rng.range(-0.25, 0.2),
      });
    }
  }

  private pushNode(rng: Rng, material: MaterialId, biome: BiomeId, x: number, y: number): void {
    this.nodes.push({
      id: this.nodes.length,
      material,
      biome,
      x,
      y,
      available: true,
      respawnAt: 0,
      phase: rng.range(0, Math.PI * 2),
      scale: rng.range(0.92, 1.12),
      pull: 0,
      pullX: 0,
      pullY: 0,
      pullAngle: 0,
      pullDistance: 0,
    });
  }

  /**
   * Scatter, biome by biome. A material can only appear inside its own region -
   * canon states that outright, and the content build enforces it too, because
   * a stray node would quietly remove the reason to travel.
   *
   * Density is the thing that makes the loop work: the walk between biomes is
   * only enjoyable if it is productive, so there has to be enough here that a
   * player holding the pull picks something up every few seconds.
   */
  private generateNodes(rng: Rng): void {
    const minSpacing = 54;
    // Spacing is checked against a grid rather than against every node placed so
    // far - the whole world is a few thousand nodes, and comparing each against
    // all of them would stall the first frame.
    const cell = minSpacing;
    const grid = new Map<string, { x: number; y: number }[]>();
    const key = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
    const crowded = (x: number, y: number): boolean => {
      const cx = Math.floor(x / cell);
      const cy = Math.floor(y / cell);
      for (let ox = -1; ox <= 1; ox++) {
        for (let oy = -1; oy <= 1; oy++) {
          for (const n of grid.get(`${cx + ox},${cy + oy}`) ?? []) {
            if (Math.hypot(n.x - x, n.y - y) < minSpacing) return true;
          }
        }
      }
      return false;
    };
    const remember = (x: number, y: number) => {
      const k = key(x, y);
      const bucket = grid.get(k);
      if (bucket) bucket.push({ x, y });
      else grid.set(k, [{ x, y }]);
    };

    for (const b of this.content.biomes) {
      const disc = this.disc(b.id);
      const materials = b.materials;
      if (!materials.length) continue;

      for (let i = 0; i < b.nodeCount; i++) {
        const material = rng.pick(materials);
        let x = disc.x;
        let y = disc.y;
        for (let attempt = 0; attempt < 12; attempt++) {
          const angle = rng.range(0, Math.PI * 2);
          const r = Math.sqrt(rng.range(0, 1)) * (disc.radius - 40);
          x = disc.x + Math.cos(angle) * r;
          y = disc.y + Math.sin(angle) * r;
          if (!crowded(x, y)) break;
        }
        remember(x, y);
        this.pushNode(rng, material, b.id, x, y);
      }
    }

    // The connective terrain is forest, not a void, so it carries forest
    // material. That is what makes the walk between biomes productive, which
    // canon treats as the thing the whole world shape depends on.
    // Scaled to the gaps' share of the world, so the connective forest is as
    // worth crossing as the regions are worth arriving in.
    const forest = this.content.biome('plains_forest');
    for (let i = 0; i < 900; i++) {
      let x = 0;
      let y = 0;
      let placed = false;
      for (let attempt = 0; attempt < 12; attempt++) {
        const angle = rng.range(0, Math.PI * 2);
        const r = Math.sqrt(rng.range(0, 1)) * this.boundaryRadius;
        x = Math.cos(angle) * r;
        y = Math.sin(angle) * r;
        // Only the gaps: inside a region, that region's own scatter owns it.
        if (this.biomeAt(x, y) === null && !crowded(x, y)) {
          placed = true;
          break;
        }
      }
      if (!placed) continue;
      remember(x, y);
      this.pushNode(rng, rng.pick(forest.materials), 'plains_forest', x, y);
    }
  }

  // ---------------------------------------------------------------- the pull

  /**
   * Start and advance the spiral.
   *
   * Canon's most load-bearing requirement, section 4.1: the pull works at a run,
   * with no stopping, no precise aim and no charge-up, and it is a radius
   * overlap rather than a trace from a crosshair - anything nearby is fair game.
   * Nothing here consults the player's facing or asks whether they are moving.
   */
  updatePull(dt: number, active: boolean, radius: number, seconds: number, space: number): void {
    this.absorbed.length = 0;
    let room = space;

    for (const node of this.nodes) {
      if (!node.available) continue;

      if (node.pull > 0) {
        if (!active) {
          // Released: the node settles back rather than hanging in the air.
          node.pull = Math.max(0, node.pull - dt / Math.max(0.05, seconds));
          continue;
        }
        node.pull += dt / Math.max(0.05, seconds);
        if (node.pull >= 1) {
          if (room <= 0) {
            node.pull = 1;
            continue;
          }
          node.available = false;
          node.pull = 0;
          node.respawnAt = this.elapsed + this.respawnFor(node);
          this.absorbed.push(node.material);
          room -= 1;
        }
        continue;
      }

      if (!active || room <= 0) continue;
      const dx = node.x - this.player.x;
      const dy = node.y - this.player.y;
      const distance = Math.hypot(dx, dy);
      if (distance > radius) continue;

      node.pull = 0.0001;
      node.pullX = node.x;
      node.pullY = node.y;
      node.pullAngle = Math.atan2(dy, dx);
      node.pullDistance = distance;
    }
  }

  private respawnFor(node: WorldNode): number {
    const biome = this.content.biomes.find((b) => b.id === node.biome);
    return biome?.respawnSeconds ?? 18;
  }

  /**
   * Where a node being drawn in should be drawn, this frame. The spiral is
   * recomputed against the player's current position rather than a frozen
   * target, so walking away mid-pull curves the path instead of breaking it.
   */
  pullPosition(node: WorldNode): { x: number; y: number } {
    if (node.pull <= 0) return { x: node.x, y: node.y };
    const t = Math.min(1, node.pull);
    const angle = node.pullAngle + t * SPIRAL_TURNS * Math.PI * 2;
    const radius = node.pullDistance * (1 - t);
    return {
      x: this.player.x + Math.cos(angle) * radius,
      y: this.player.y + Math.sin(angle) * radius,
    };
  }

  /** Nodes currently inside the gauntlet's reach, for the pull ring readout. */
  nodesInReach(radius: number): WorldNode[] {
    return this.nodes.filter(
      (n) => n.available && Math.hypot(n.x - this.player.x, n.y - this.player.y) <= radius,
    );
  }

  // ---------------------------------------------------------------- movement

  movePlayer(dt: number, dirX: number, dirY: number, speed: number): void {
    const length = Math.hypot(dirX, dirY);
    this.player.moving = length > 0.01;

    if (!this.player.moving) {
      this.player.frame = 0;
      return;
    }

    const nx = dirX / length;
    const ny = dirY / length;
    const step = speed * dt;

    let x = this.player.x + nx * step;
    let y = this.player.y + ny * step;

    // The Coliseum is bounded, and the boundary is the edge of a disc.
    const fromCentre = Math.hypot(x, y);
    const limit = this.boundaryRadius - this.content.progression.player.radius;
    if (fromCentre > limit) {
      x = (x / fromCentre) * limit;
      y = (y / fromCentre) * limit;
    }

    this.player.x = x;
    this.player.y = y;
    this.faceToward(this.player.x + nx, this.player.y + ny);

    this.player.travelled += step;
    if (this.player.travelled >= STEP_DISTANCE) {
      this.player.travelled -= STEP_DISTANCE;
      this.player.frame = (this.player.frame + 1) % WALK_FRAMES;
    }
  }

  /** Point the player at a world position, updating both the angle and the sprite row. */
  faceToward(x: number, y: number): void {
    const dx = x - this.player.x;
    const dy = y - this.player.y;
    if (Math.hypot(dx, dy) < 0.0001) return;
    this.player.facing = Math.atan2(dy, dx);

    if (Math.abs(dx) > Math.abs(dy)) {
      this.player.facing4 = 'side';
      this.player.mirrored = dx < 0;
    } else {
      this.player.facing4 = dy > 0 ? 'down' : 'up';
      this.player.mirrored = false;
    }
  }

  // ---------------------------------------------------------------- enemies

  spawn(def: EnemyDef, x: number, y: number): Enemy {
    const enemy: Enemy = {
      id: this.nextEnemyId++,
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
      facing: 0,
      burn: 0,
    };
    this.enemies.push(enemy);
    return enemy;
  }

  /**
   * The nearest enemy the gauntlets could actually reach, for auto-targeting.
   * Returns null when nothing is in range, so the button can say so rather than
   * swinging at air.
   */
  nearestTarget(range: number): Enemy | null {
    let best: Enemy | null = null;
    let bestDistance = range;
    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const distance = Math.hypot(enemy.x - this.player.x, enemy.y - this.player.y);
      if (distance <= bestDistance) {
        best = enemy;
        bestDistance = distance;
      }
    }
    return best;
  }

  /**
   * A basic unarmed swing. Auto-targets and turns to face first, so the button
   * never promises a hit it cannot land - and the arc means neighbours of the
   * target get caught too, which is what stops a crowd becoming a queue.
   */
  swing(): { hit: Enemy[]; killed: Enemy[]; combo: number } | null {
    const player = this.player;
    const attack = this.content.progression.combat.basicAttack;
    if (player.dead || player.attackCooldown > 0) return null;

    const target = this.nearestTarget(attack.range);
    player.attackCooldown = attack.cooldownSeconds;
    player.attackAnim = 0.2;
    if (!target) {
      this.breakCombo();
      return { hit: [], killed: [], combo: 0 };
    }

    this.faceToward(target.x, target.y);

    // Staying on one target builds the combo; switching or losing it resets.
    if (player.comboTargetId === target.id && player.comboTimer > 0) {
      player.combo = Math.min(attack.comboMax, player.combo + 1);
    } else {
      player.combo = 0;
    }
    player.comboTargetId = target.id;
    player.comboTimer = attack.comboWindowSeconds;

    const damage = attack.damage + player.combo * attack.comboBonus;
    const halfArc = (attack.arcDegrees * Math.PI) / 360;
    const hit: Enemy[] = [];
    const killed: Enemy[] = [];

    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const dx = enemy.x - player.x;
      const dy = enemy.y - player.y;
      if (Math.hypot(dx, dy) > attack.range) continue;
      let delta = Math.atan2(dy, dx) - player.facing;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      if (Math.abs(delta) > halfArc) continue;

      const length = Math.max(0.001, Math.hypot(dx, dy));
      enemy.hitFlash = 0.16;
      enemy.aggro = true;
      enemy.knockX += (dx / length) * attack.knockback;
      enemy.knockY += (dy / length) * attack.knockback;
      const died = applyDamage(enemy, damage);
      this.events.push({ kind: 'enemy-hit', enemy, amount: damage });
      hit.push(enemy);
      if (died) {
        this.events.push({ kind: 'enemy-killed', enemy });
        killed.push(enemy);
      }
    }
    return { hit, killed, combo: player.combo };
  }

  private breakCombo(): void {
    this.player.combo = 0;
    this.player.comboTimer = 0;
    this.player.comboTargetId = -1;
  }

  /** Resolve one alchemical combination against whatever it catches. */
  cast(combination: AlchemyCombination): Enemy[] {
    const hits = abilityTargets(
      combination,
      this.player.x,
      this.player.y,
      this.player.facing,
      this.enemies,
    );
    const killed: Enemy[] = [];
    for (const hit of hits) {
      const enemy = hit.target;
      enemy.hitFlash = 0.18;
      enemy.aggro = true;
      enemy.knockX += hit.pushX * combination.effect.knockback;
      enemy.knockY += hit.pushY * combination.effect.knockback;
      if (combination.effect.burnSeconds) enemy.burn = combination.effect.burnSeconds;
      const died = applyDamage(enemy, hit.damage);
      this.events.push({ kind: 'enemy-hit', enemy, amount: hit.damage });
      if (died) {
        this.events.push({ kind: 'enemy-killed', enemy });
        killed.push(enemy);
      }
    }
    return killed;
  }

  private updateEnemies(dt: number): void {
    const player = this.player;
    for (const enemy of this.enemies) {
      enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);

      if (enemy.burn > 0) {
        enemy.burn -= dt;
        if (!enemy.dead && applyDamage(enemy, 4 * dt)) {
          this.events.push({ kind: 'enemy-killed', enemy });
        }
      }

      // Knockback bleeds off rather than stopping dead.
      enemy.x += enemy.knockX * dt;
      enemy.y += enemy.knockY * dt;
      enemy.knockX *= Math.max(0, 1 - dt * 7);
      enemy.knockY *= Math.max(0, 1 - dt * 7);

      if (enemy.dead || player.dead) continue;

      const dx = player.x - enemy.x;
      const dy = player.y - enemy.y;
      const distance = Math.hypot(dx, dy);

      // Canon's stealth asymmetry: an enemy has to notice the player first, and
      // loses them again at a longer range than it found them - so backing off
      // actually works rather than tethering them to you forever.
      if (!enemy.aggro && distance <= enemy.def.aggroRadius) enemy.aggro = true;
      else if (enemy.aggro && distance > enemy.def.aggroRadius * 2.2) enemy.aggro = false;

      const targetX = enemy.aggro ? player.x : enemy.homeX;
      const targetY = enemy.aggro ? player.y : enemy.homeY;
      const tx = targetX - enemy.x;
      const ty = targetY - enemy.y;
      const toTarget = Math.hypot(tx, ty);

      if (toTarget > (enemy.aggro ? enemy.def.attackRange * 0.85 : 6)) {
        enemy.x += (tx / toTarget) * enemy.def.speed * dt;
        enemy.y += (ty / toTarget) * enemy.def.speed * dt;
        enemy.facing = Math.atan2(ty, tx);
      }

      enemy.cooldown = Math.max(0, enemy.cooldown - dt);
      if (enemy.aggro && distance <= enemy.def.attackRange && enemy.cooldown <= 0) {
        enemy.cooldown = 1.2;
        this.hurtPlayer(enemy.def.damage, enemy);
      }
    }

    // Corpses are cleared once they have finished fading, in the game layer's
    // sight; nothing respawns on its own, because waves decide what exists.
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i];
      if (enemy && enemy.dead && enemy.hitFlash <= 0 && enemy.burn <= 0) {
        this.enemies.splice(i, 1);
      }
    }
  }

  private hurtPlayer(amount: number, enemy: Enemy): void {
    const player = this.player;
    if (player.invulnerable > 0 || player.dead) return;
    const combat = this.content.progression.combat;
    player.hp = Math.max(0, player.hp - amount);
    player.invulnerable = combat.invulnerableSeconds;
    player.sinceHit = 0;
    this.events.push({ kind: 'player-hit', amount, enemy });
    if (player.hp <= 0) {
      player.dead = true;
      player.respawnAt = this.elapsed + combat.respawnSeconds;
      this.events.push({ kind: 'player-died' });
    }
  }

  // ---------------------------------------------------------------- tick

  update(dt: number): void {
    this.elapsed += dt;
    const player = this.player;
    const combat = this.content.progression.combat;

    player.invulnerable = Math.max(0, player.invulnerable - dt);
    player.sinceHit += dt;
    player.bob += dt;
    player.attackAnim = Math.max(0, player.attackAnim - dt);
    player.attackCooldown = Math.max(0, player.attackCooldown - dt);
    player.comboTimer = Math.max(0, player.comboTimer - dt);
    if (player.comboTimer <= 0 && player.combo > 0) this.breakCombo();

    if (player.dead) {
      // Death is a setback, not a reset: canon never wipes the world or
      // progression for it. The player wakes back at the spawn.
      if (this.elapsed >= player.respawnAt) {
        player.dead = false;
        player.hp = combat.maxHp;
        player.x = 0;
        player.y = 0;
        player.invulnerable = combat.invulnerableSeconds;
      }
    } else if (player.sinceHit >= combat.regenDelaySeconds && player.hp < player.maxHp) {
      player.hp = Math.min(player.maxHp, player.hp + combat.regenPerSecond * dt);
    }

    for (const node of this.nodes) {
      if (!node.available && this.elapsed >= node.respawnAt) node.available = true;
    }

    this.updateEnemies(dt);
  }

  get time(): number {
    return this.elapsed;
  }
}
