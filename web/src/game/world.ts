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
import {
  absorbDamage,
  beginHeal,
  freshStatus,
  raiseShield,
  tickStatus,
  type PlayerStatus,
} from '../core/status';
import type { AlchemyCombination, BiomeId, EnemyDef, MaterialId, TerrainDef } from '../core/types';

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
  /** Where it entered the world; roam targets are chosen around this. */
  homeX: number;
  homeY: number;
  /** Canon: enemies do not know where the player is until they notice them. */
  aggro: boolean;
  /**
   * Seconds of pursuit left once the player is past loseRadius. Aggro is not a
   * latch: an enemy that has lost you keeps coming for a while and then gives
   * up and goes back to wandering, which is what makes backing off work.
   */
  alertFor: number;
  /** The point it is currently ambling towards, and how long it is resting first. */
  roamX: number;
  roamY: number;
  roamPause: number;
  /** Winds up before it strikes, so a hit is something you can see coming. */
  windUp: number;
  /** Reeling from a hit: cannot move, and whatever it was winding up is lost. */
  stagger: number;
  cooldown: number;
  hitFlash: number;
  knockX: number;
  knockY: number;
  dead: boolean;
  facing: number;
  burn: number;
  /** Seconds left moving at `slowScale` of its own pace. */
  slow: number;
  slowScale: number;
}

export interface CombatEvent {
  kind: 'player-hit' | 'enemy-hit' | 'enemy-killed' | 'player-died';
  enemy?: Enemy;
  amount?: number;
  /** player-hit: how much of it the shield took, so the HUD can say so. */
  soaked?: number;
}

/** Non-interactive scenery, so the world does not read as an empty field. */
export interface Prop {
  x: number;
  y: number;
  size: number;
  kind: 'tuft' | 'stone' | 'tree' | 'drift' | 'crag' | 'shard' | 'dune' | 'bone' | 'reed' | 'pool' | 'rack' | 'conduit';
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
  /** Shield, heal, concealment and revelation - see core/status.ts. */
  status: PlayerStatus;
}

export interface BiomeDisc {
  id: BiomeId;
  name: string;
  x: number;
  y: number;
  radius: number;
  palette: { ground: string; groundAlt: string; accent: string; fog: string };
  mood: string;
  terrain: TerrainDef;
}

/** What the connective forest between the regions does: nothing. */
const NEUTRAL: TerrainDef = {
  moveScale: 1,
  concealment: 1,
  sight: 1,
  fog: 0,
  propDensity: 1,
  props: ['tuft', 'stone', 'tree'],
};

/** Bucket size for the prop index, in world units: about a third of a screen. */
const PROP_CELL = 220;

/** Cantor-ish pairing, so a cell is one number rather than a string key. */
function propKey(cx: number, cy: number): number {
  return (cx + 4096) * 8192 + (cy + 4096);
}

/** How wide the blend between a region and the forest is, in world units. */
const TERRAIN_FEATHER = 90;

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
    status: freshStatus(),
  };
}

/** Seeds the wander stream, kept apart from the world's generation stream. */
const ROAM_SEED = 0x9e3779b9;

/** How close counts as having arrived at a roam target. */
const ARRIVE_DISTANCE = 14;
/** Share of the full shove that a combo-less hit delivers. */
const COMBO_SHOVE_FLOOR = 0.4;

/**
 * How fast an enemy is moving right now, as a fraction of its own speed.
 *
 * Applied to the wander as well as the chase, because a slow that only bit
 * while something was pursuing you would let a frozen crowd stroll away at
 * full speed the moment they lost interest.
 */
function paceScale(enemy: Enemy): number {
  return enemy.slow > 0 ? Math.max(0.1, enemy.slowScale) : 1;
}

/** How long a swing takes to draw. The renderer reads attackAnim against it. */
export const SWING_SECONDS = 0.26;

/** The tell before a blow lands, so a hit is something you can see coming. */
export const WIND_UP_SECONDS = 0.42;

/** What crafting adds to the swing. See GAUNTLET_STATS: the hands are the weapon. */
export interface StrikeBonus {
  damage: number;
  range: number;
}

export class World {
  readonly nodes: WorldNode[] = [];
  readonly props: Prop[] = [];
  /**
   * Props bucketed by cell, so drawing walks the handful in view instead of
   * every one in the world. At 9000 props the linear scan cost about 10fps on
   * its own, and the scatter is fixed at generation - nothing moves - so the
   * index never needs rebuilding.
   */
  private readonly propGrid = new Map<number, Prop[]>();
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
  /** Its own stream, so wandering never perturbs the world's generation. */
  private roamRng = new Rng(ROAM_SEED);

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
        terrain: b.terrain,
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
    this.propGrid.clear();
    this.enemies.length = 0;
    this.events.length = 0;
    this.absorbed.length = 0;
    this.elapsed = 0;
    this.nextEnemyId = 0;
    this.roamRng = new Rng(ROAM_SEED);
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

  /** Props overlapping a world rectangle, from the bucket index. */
  propsIn(left: number, top: number, right: number, bottom: number): Prop[] {
    const found: Prop[] = [];
    const x0 = Math.floor(left / PROP_CELL);
    const x1 = Math.floor(right / PROP_CELL);
    const y0 = Math.floor(top / PROP_CELL);
    const y1 = Math.floor(bottom / PROP_CELL);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const cell = this.propGrid.get(propKey(cx, cy));
        if (cell) found.push(...cell);
      }
    }
    return found;
  }

  /**
   * What the ground does at a point, blended across the disc edge.
   *
   * A hard lookup would snap the player's speed and the enemies' reach the
   * instant they crossed a circle, which reads as a bug rather than as a
   * border. Over TERRAIN_FEATHER units the values ease back to neutral, so
   * walking into the Wetland slows you down over a couple of steps.
   */
  terrainAt(x: number, y: number): TerrainDef {
    for (const disc of this.discs) {
      const from = Math.hypot(x - disc.x, y - disc.y);
      if (from > disc.radius) continue;
      const depth = Math.min(1, (disc.radius - from) / TERRAIN_FEATHER);
      if (depth >= 1) return disc.terrain;
      const t = disc.terrain;
      return {
        moveScale: NEUTRAL.moveScale + (t.moveScale - NEUTRAL.moveScale) * depth,
        concealment: NEUTRAL.concealment + (t.concealment - NEUTRAL.concealment) * depth,
        sight: NEUTRAL.sight + (t.sight - NEUTRAL.sight) * depth,
        fog: t.fog * depth,
        propDensity: t.propDensity,
        props: t.props,
      };
    }
    return NEUTRAL;
  }

  disc(id: BiomeId): BiomeDisc {
    const d = this.discs.find((c) => c.id === id);
    if (!d) throw new Error(`unknown biome "${id}"`);
    return d;
  }

  /**
   * Scenery, drawn from whatever grows where it lands.
   *
   * This used to scatter grass tufts, stones and trees uniformly across the
   * whole Coliseum and tint them with the local accent colour, so the Snowy
   * Mountain had grass and the Data-Center had trees - just blue ones and
   * purple ones. Each region names its own prop kinds now, which is most of
   * what makes crossing a border look like arriving somewhere.
   */
  private generateProps(rng: Rng): void {
    /*
     * 900 put 1.7 props on a screen, across a world of 116 million square
     * units. That is not scenery, it is the occasional lonely shrub - and it
     * is why every region read as bare ground however distinct its palette
     * was. 9000 puts about 17 on screen, which is ground cover.
     *
     * The cost is a bounds comparison per prop per frame and roughly 17 fills;
     * the draw is culled, so the scatter size is bounded by memory, not by
     * frame time.
     */
    const count = 9000;
    for (let i = 0; i < count; i++) {
      const angle = rng.range(0, Math.PI * 2);
      // Square-root so props spread evenly over area rather than bunching at
      // the centre, which is what a uniform radius would do.
      const r = Math.sqrt(rng.range(0, 1)) * this.boundaryRadius;
      const x = Math.cos(angle) * r;
      const y = Math.sin(angle) * r;

      const terrain = this.terrainAt(x, y);
      // Density is a rejection roll rather than a per-biome count, so the
      // Desert thins out and the Wetland crowds without either needing its own
      // scatter pass.
      if (terrain.propDensity < 1 && rng.next() > terrain.propDensity) continue;

      const kinds = terrain.props as Prop['kind'][];
      const kind = kinds[rng.int(0, kinds.length)] ?? 'tuft';
      this.addProp({ x, y, size: rng.range(9, 26), kind, tone: rng.range(-0.25, 0.2) });
      // Over-dense regions get a second prop near the first, which reads as
      // undergrowth rather than as a denser uniform sprinkle.
      if (terrain.propDensity > 1 && rng.next() < terrain.propDensity - 1) {
        this.addProp({
          x: x + rng.range(-26, 26),
          y: y + rng.range(-26, 26),
          size: rng.range(8, 20),
          kind: kinds[rng.int(0, kinds.length)] ?? 'tuft',
          tone: rng.range(-0.25, 0.2),
        });
      }
    }
  }

  private addProp(prop: Prop): void {
    this.props.push(prop);
    const key = propKey(Math.floor(prop.x / PROP_CELL), Math.floor(prop.y / PROP_CELL));
    const cell = this.propGrid.get(key);
    if (cell) cell.push(prop);
    else this.propGrid.set(key, [prop]);
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
    // The Wetland is "slow going" and the Snowy Mountain is deep: the mood
    // lines said so long before anything made them true.
    speed *= this.terrainAt(this.player.x, this.player.y).moveScale;
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
      alertFor: 0,
      roamX: x,
      roamY: y,
      roamPause: 0,
      windUp: 0,
      stagger: 0,
      cooldown: 0,
      hitFlash: 0,
      knockX: 0,
      knockY: 0,
      dead: false,
      facing: 0,
      burn: 0,
      slow: 0,
      slowScale: 1,
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
  swing(bonus: StrikeBonus = { damage: 0, range: 0 }): { hit: Enemy[]; killed: Enemy[]; combo: number } | null {
    const player = this.player;
    const attack = this.content.progression.combat.basicAttack;
    if (player.dead || player.attackCooldown > 0) return null;

    /*
     * The gauntlets are the weapon, so crafting reaches the swing.
     *
     * Passed in rather than held, because the world does not own an inventory
     * and a copy of these numbers kept here would be a copy that goes stale
     * the moment something is crafted.
     */
    const reach = attack.range + bonus.range;
    const target = this.nearestTarget(reach);
    player.attackCooldown = attack.cooldownSeconds;
    player.attackAnim = SWING_SECONDS;
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

    const damage = attack.damage + bonus.damage + player.combo * attack.comboBonus;
    const halfArc = (attack.arcDegrees * Math.PI) / 360;
    const hit: Enemy[] = [];
    const killed: Enemy[] = [];

    for (const enemy of this.enemies) {
      if (enemy.dead) continue;
      const dx = enemy.x - player.x;
      const dy = enemy.y - player.y;
      if (Math.hypot(dx, dy) > reach) continue;
      let delta = Math.atan2(dy, dx) - player.facing;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      if (Math.abs(delta) > halfArc) continue;

      const length = Math.max(0.001, Math.hypot(dx, dy));
      enemy.hitFlash = 0.16;
      enemy.aggro = true;
      const weight = Math.max(1, enemy.def.weight);
      // Interrupts: whatever it was about to do, it is not doing it now.
      enemy.stagger = Math.max(enemy.stagger, attack.staggerSeconds / weight);
      enemy.windUp = 0;

      /*
       * The shove grows through the combo instead of being flat.
       *
       * Flat, it broke the combo outright: a full 46-unit push on the first hit
       * put a goblin past the 46-unit reach that threw it, so the second swing
       * could never land and Amorratua's "consecutive hits" hook was dead for
       * tier 1. Ramped, early hits hold the target inside reach and the last
       * one sends it - which is also the more satisfying shape.
       */
      const through = attack.comboMax > 0 ? player.combo / attack.comboMax : 1;
      const shove = (attack.knockback * (COMBO_SHOVE_FLOOR + (1 - COMBO_SHOVE_FLOOR) * through)) / weight;
      enemy.knockX += (dx / length) * shove;
      enemy.knockY += (dy / length) * shove;
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
    const effect = combination.effect;
    // Whatever the shape, the caster's own timers are set first: a self-cast
    // catches nobody and would otherwise fall straight past the loop below and
    // do nothing at all.
    this.applySelf(combination);

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
      /*
       * A cast gives you away.
       *
       * Even from inside a veil: dampening what notices you is not the same as
       * being able to hit things from inside it for free, and an ability that
       * broke canon's asymmetry in the player's favour permanently would make
       * every other combination pointless.
       */
      enemy.aggro = true;
      const heft = Math.max(1, enemy.def.weight);
      enemy.stagger = Math.max(enemy.stagger, this.content.progression.combat.basicAttack.staggerSeconds / heft);
      enemy.windUp = 0;
      const push = effect.knockback / heft;
      enemy.knockX += hit.pushX * push;
      enemy.knockY += hit.pushY * push;
      if (effect.burnSeconds) enemy.burn = effect.burnSeconds;
      if (effect.slowSeconds) {
        // Longest wins, rather than latest: a fresh short slow landing on a
        // long one should not cut it short.
        enemy.slow = Math.max(enemy.slow, effect.slowSeconds);
        enemy.slowScale = Math.min(enemy.slowScale, effect.slowScale ?? 0.5);
      }
      const died = applyDamage(enemy, hit.damage);
      this.events.push({ kind: 'enemy-hit', enemy, amount: hit.damage });
      if (died) {
        this.events.push({ kind: 'enemy-killed', enemy });
        killed.push(enemy);
      }
    }
    return killed;
  }

  /** The half of a combination that lands on the caster rather than on a target. */
  private applySelf(combination: AlchemyCombination): void {
    const { shieldAmount, shieldSeconds, healAmount, healSeconds, hideSeconds, revealSeconds } =
      combination.effect;
    const status = this.player.status;

    if (shieldAmount) raiseShield(status, shieldAmount, shieldSeconds ?? 0);
    if (healAmount) beginHeal(status, healAmount, healSeconds ?? 0);
    if (hideSeconds) {
      status.hidden = Math.max(status.hidden, hideSeconds);
      /*
       * Going quiet drops what is already chasing you.
       *
       * Without this the veil only stopped new enemies noticing, which meant
       * casting it while being chased did nothing whatsoever - and being
       * chased is the only time anybody would cast it.
       */
      for (const enemy of this.enemies) {
        if (enemy.dead) continue;
        enemy.aggro = false;
        enemy.alertFor = 0;
        enemy.windUp = 0;
        this.chooseRoam(enemy);
      }
    }
    if (revealSeconds) status.revealed = Math.max(status.revealed, revealSeconds);
  }

  private updateEnemies(dt: number): void {
    const player = this.player;
    const cover = this.terrainAt(player.x, player.y).concealment;
    for (const enemy of this.enemies) {
      enemy.hitFlash = Math.max(0, enemy.hitFlash - dt);
      if (enemy.slow > 0) {
        enemy.slow = Math.max(0, enemy.slow - dt);
        if (enemy.slow === 0) enemy.slowScale = 1;
      }

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

      const def = enemy.def;
      const dx = player.x - enemy.x;
      const dy = player.y - enemy.y;
      const distance = Math.hypot(dx, dy);

      /*
       * Canon's asymmetry, the right way round: the program does not know where
       * the intruder is. So noticing is an encounter - you have to be close -
       * and it decays rather than latching.
       *
       * This used to be a detection sweep of 220-360uu, most of a screen, with
       * the enemy then walking the exact line to the player's current position.
       * That is a lock-on however it is labelled: there was no way to be near
       * one without being found, and no way to lose one except by outrunning a
       * radius. Now they amble between roam targets and find the player by
       * bumping into them, which is also what makes hunting one down a thing
       * the player can choose to do.
       */
      // Scaled by the ground the PLAYER is standing on, not the enemy: this is
      // how visible the player is, so the Wetland's cover and the Desert's
      // exposure are properties of where you chose to stand.
      // A veil is dampening, not invisibility: it is the noticing that stops,
      // and this is the one place canon's asymmetry is decided.
      const notice = player.status.hidden > 0 ? 0 : def.noticeRadius * cover;
      if (distance <= notice) {
        enemy.aggro = true;
        enemy.alertFor = def.forgetSeconds;
      } else if (enemy.aggro && distance > def.loseRadius * cover) {
        enemy.alertFor -= dt;
        if (enemy.alertFor <= 0) {
          enemy.aggro = false;
          this.chooseRoam(enemy);
        }
      }

      enemy.stagger = Math.max(0, enemy.stagger - dt);
      enemy.cooldown = Math.max(0, enemy.cooldown - dt);

      // Reeling: it takes the shove whole instead of walking through it, which
      // is what makes the knockback something you can see.
      if (enemy.stagger > 0) continue;

      if (enemy.aggro) this.pursue(enemy, dt, dx, dy, distance);
      else this.wander(enemy, dt);

      enemy.windUp = Math.max(0, enemy.windUp - dt);
      if (enemy.aggro && distance <= def.attackRange && enemy.cooldown <= 0) {
        // The wind-up is the tell. A hit that lands on the same frame the enemy
        // arrives is one the player had no way to read.
        if (enemy.windUp <= 0) {
          enemy.windUp = WIND_UP_SECONDS;
        } else if (enemy.windUp <= dt) {
          enemy.cooldown = 1.2;
          this.hurtPlayer(def.damage, enemy);
        }
      } else if (!enemy.aggro || distance > def.attackRange) {
        // Stepped out of reach mid-swing: the blow does not follow you.
        enemy.windUp = 0;
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

  /** Closing on a player it can currently see. */
  private pursue(enemy: Enemy, dt: number, dx: number, dy: number, distance: number): void {
    // Stop at the edge of its reach rather than walking into the player.
    const stopAt = enemy.def.attackRange * 0.85;
    if (distance <= stopAt) {
      enemy.facing = Math.atan2(dy, dx);
      return;
    }
    const pace = enemy.def.speed * paceScale(enemy);
    enemy.x += (dx / distance) * pace * dt;
    enemy.y += (dy / distance) * pace * dt;
    enemy.facing = Math.atan2(dy, dx);
  }

  /** Ambling between roam targets, with a rest at each one. */
  private wander(enemy: Enemy, dt: number): void {
    if (enemy.roamPause > 0) {
      enemy.roamPause -= dt;
      return;
    }

    const tx = enemy.roamX - enemy.x;
    const ty = enemy.roamY - enemy.y;
    const toTarget = Math.hypot(tx, ty);

    if (toTarget <= ARRIVE_DISTANCE) {
      // Destructured defensively: a def assembled by hand - a test fixture, a
      // half-migrated save, content mid-edit - used to throw here and take the
      // whole world update with it, which reads as the game freezing rather
      // than as one enemy being wrong.
      const pause = enemy.def.pauseSeconds ?? [];
      enemy.roamPause = this.roamRng.range(pause[0] ?? 0.6, pause[1] ?? 2.2);
      this.chooseRoam(enemy);
      return;
    }

    const pace = enemy.def.wanderSpeed * paceScale(enemy);
    enemy.x += (tx / toTarget) * pace * dt;
    enemy.y += (ty / toTarget) * pace * dt;
    enemy.facing = Math.atan2(ty, tx);
  }

  /**
   * A new point to drift to, around where this enemy entered the world and
   * inside the boundary - the Coliseum is bounded, so nothing wanders out of it.
   */
  private chooseRoam(enemy: Enemy): void {
    const angle = this.roamRng.range(0, Math.PI * 2);
    // Square-rooted so targets spread over the area rather than bunching at the
    // centre, the same reason the props scatter that way.
    const reach = Math.sqrt(this.roamRng.range(0.05, 1)) * enemy.def.roamRadius;
    let x = enemy.homeX + Math.cos(angle) * reach;
    let y = enemy.homeY + Math.sin(angle) * reach;

    const fromCentre = Math.hypot(x, y);
    const limit = this.boundaryRadius - 40;
    if (fromCentre > limit) {
      x = (x / fromCentre) * limit;
      y = (y / fromCentre) * limit;
    }
    enemy.roamX = x;
    enemy.roamY = y;
  }

  private hurtPlayer(amount: number, enemy: Enemy): void {
    const player = this.player;
    if (player.invulnerable > 0 || player.dead) return;
    const combat = this.content.progression.combat;
    // The shield soaks what it can and the rest lands. It still costs the hit:
    // invulnerability and the regen delay both start, because being shielded
    // is not the same as not having been hit.
    const { soaked, through } = absorbDamage(player.status, amount);
    player.hp = Math.max(0, player.hp - through);
    player.invulnerable = combat.invulnerableSeconds;
    player.sinceHit = 0;
    this.events.push({ kind: 'player-hit', amount: through, enemy, soaked });
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
    // Before the regen below, so a heal and the passive regen in the same frame
    // both count against the same maxHp rather than the heal being clamped away.
    const healed = tickStatus(player.status, dt);
    if (healed > 0 && !player.dead) player.hp = Math.min(player.maxHp, player.hp + healed);
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
        // Dying clears what you were holding. A shield that survives the thing
        // it failed to stop is a shield that was not doing anything.
        Object.assign(player.status, freshStatus());
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
