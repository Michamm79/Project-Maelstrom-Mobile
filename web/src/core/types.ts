/**
 * Type mirrors of the generated content bundle and of the runtime state.
 *
 * These correspond 1:1 to the ScriptableObjects in Project_Maelstrom:
 *   ElementDef          <- ElementSO.cs
 *   MaterialDef         <- MaterialSO.cs
 *   TransmutationRecipe <- TransmutationRecipe.cs
 *   AlchemyRecipe       <- AlchemyRecipe.cs
 *
 * One deliberate difference from the Unity originals: a recipe result here is a
 * material id rather than a prefab reference. Results have to be able to go back
 * into an orb for the crafting tree to chain, which a spawned GameObject can't do.
 */

export type ElementId = string;
export type MaterialId = string;
export type RecipeId = string;
export type ZoneId = string;

/** ElementSO.cs */
export interface ElementDef {
  id: ElementId;
  name: string;
  description: string;
  color: string;
  /** One- or two-letter symbol, e.g. "Py". */
  symbol: string;
  /** Ordinal, in table reading order. */
  number: number;
  /** Family label shown on the table's legend. */
  group: string;
  /** Position in the alchemy table. Gaps in the grid are intentional. */
  row: number;
  col: number;
}

/** ElementQuantity in MaterialSO.cs, flattened to a record for lookup speed. */
export type Composition = Readonly<Record<ElementId, number>>;

/** How a material enters the player's hands. */
export type MaterialSource = 'gathered' | 'transmuted' | 'alchemized';

/** MaterialSO.cs */
export interface MaterialDef {
  id: MaterialId;
  name: string;
  description: string;
  tags: readonly string[];
  /** Key into the procedural icon renderer - stands in for MaterialSO.icon. */
  shape: string;
  color: string;
  source: MaterialSource;
  /** 0 for world-gathered; otherwise 1 + the deepest input's tier. */
  tier: number;
  /** Lowest player level at which this can actually be held, or null if unreachable. */
  availableAtLevel: number | null;
  composition: Composition;
  /** Weapons only: added to the player's base damage when carried. */
  damage?: number;
}

export type EnemyId = string;

export interface EnemyDrop {
  material: MaterialId;
  /** 0..1 */
  chance: number;
}

export interface EnemyDef {
  id: EnemyId;
  name: string;
  description: string;
  shape: string;
  color: string;
  hp: number;
  damage: number;
  speed: number;
  aggroRadius: number;
  attackRange: number;
  attackCooldown: number;
  xp: number;
  drops: readonly EnemyDrop[];
}

export interface CombatConfig {
  maxHp: number;
  baseDamage: number;
  attackRange: number;
  attackCooldown: number;
  /** Half-angle of the swing, in radians, measured from the facing direction. */
  attackArc: number;
  knockback: number;
  invulnerableSeconds: number;
  regenPerSecond: number;
  regenDelaySeconds: number;
  respawnSeconds: number;
}

/** TransmutationRecipe.cs */
export interface TransmutationRecipe {
  id: RecipeId;
  a: MaterialId;
  b: MaterialId;
  result: MaterialId;
  requiredLevel: number;
  xp: number;
}

/** AlchemyRecipe.cs */
export interface AlchemyRecipe {
  id: RecipeId;
  requires: Composition;
  result: MaterialId;
  requiredLevel: number;
  xp: number;
}

export interface ZoneSpawn {
  material: MaterialId;
  weight: number;
}

export interface ZoneDef {
  id: ZoneId;
  name: string;
  subtitle: string;
  description: string;
  requiredLevel: number;
  size: { w: number; h: number };
  palette: { ground: string; groundAlt: string; accent: string; fog: string };
  nodeCount: number;
  respawnSeconds: number;
  spawns: readonly ZoneSpawn[];
  enemies: readonly EnemyId[];
  enemyCount: number;
}

export interface ProgressionConfig {
  alchemyUnlockLevel: number;
  orbCount: number;
  maxLevel: number;
  decompositionYield: number;
  xp: {
    gather: number;
    gatherNewMaterial: number;
    repeatTransmuteFactor: number;
    repeatAlchemyFactor: number;
    decompose: number;
  };
  levelCurve: { base: number; exponent: number };
  player: {
    moveSpeed: number;
    gatherRadius: number;
    radius: number;
    /** How long a node stays gatherable after you walk out of range. */
    gatherGraceSeconds: number;
    /** How far past normal range that grace still applies, as a multiplier. */
    gatherGraceRangeFactor: number;
  };
  /** Cumulative XP needed to reach each level; index 0 is level 1. */
  xpTable: readonly number[];
  combat: CombatConfig;
}

/** One card of the opening guide. The rule that completes it lives in core/tutorial.ts. */
export interface TutorialStep {
  id: string;
  title: string;
  hint: string;
}

export interface ContentBundle {
  version: number;
  progression: ProgressionConfig;
  tutorial: readonly TutorialStep[];
  enemies: readonly EnemyDef[];
  elements: readonly ElementDef[];
  materials: readonly MaterialDef[];
  transmutation: readonly TransmutationRecipe[];
  alchemy: readonly AlchemyRecipe[];
  zones: readonly ZoneDef[];
}

/** OrbContainer.Hand */
export type Hand = 'left' | 'right';
export const HANDS: readonly Hand[] = ['left', 'right'];
