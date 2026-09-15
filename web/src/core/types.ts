/**
 * Type mirrors of the generated content bundle and of the runtime state.
 *
 * These follow the GDD rather than the Unity `OrbSystem` scripts: that prototype
 * is a different project, and its pair-combination "transmutation" is not a
 * Maelstrom mechanic. The two disciplines here are the canon ones -
 *
 *   Crafting consumes MATERIALS and produces permanent gauntlet upgrades.
 *   Alchemy  consumes ELEMENTS  and produces combat abilities.
 *
 * - and they are deliberately separate, because they consume different things.
 */

export type ElementId = string;
export type MaterialId = string;
export type BiomeId = string;
export type RecipeId = string;
export type CombinationId = string;
export type EnemyId = string;

/** One of the ten invented elements. Never real chemistry; see content/elements.json. */
export interface ElementDef {
  id: ElementId;
  name: string;
  /** Exactly three uppercase letters, enforced at build time. */
  symbol: string;
  /** What it governs, e.g. "Air, pressure, motion". */
  domain: string;
  color: string;
}

/** An id-to-quantity map, e.g. what a combination costs. */
export type Quantities = Readonly<Record<string, number>>;

/** A physical gatherable. Crafting consumes these; alchemy consumes what's inside them. */
export interface MaterialDef {
  id: MaterialId;
  name: string;
  description: string;
  /** The only biome it can be found in. Enforced at build time. */
  biome: BiomeId;
  /** Exactly two, always. */
  elements: readonly ElementId[];
  /** Key into the procedural icon renderer. */
  shape: string;
  color: string;
}

/** A region of the Coliseum. Not a level: there is one continuous world. */
/**
 * What a region does to the player standing in it.
 *
 * Every biome already claimed a mechanical identity in its mood line and none
 * of it existed, so the Wetland's "cover in every direction" played exactly
 * like the Desert's "nowhere to hide". These make the lines true.
 */
export interface TerrainDef {
  /** Multiplies walking speed. */
  moveScale: number;
  /** Multiplies how far enemies notice the player here: under 1 is cover. */
  concealment: number;
  /** Multiplies how far the player senses enemies. */
  sight: number;
  /** 0..1 haze, drawn in the palette's fog colour. */
  fog: number;
  /** Relative scatter density for props. */
  propDensity: number;
  /** Which prop kinds grow here. Repeats weight a kind more heavily. */
  props: readonly string[];
}

export interface BiomeDef {
  id: BiomeId;
  name: string;
  /** Human-readable placement, e.g. "Upper left". */
  position: string;
  /** Centre in Unreal units, relative to the spawn at the origin. */
  centre: { x: number; y: number };
  radius: number;
  distanceFromCentre: number;
  mood: string;
  palette: { ground: string; groundAlt: string; accent: string; fog: string };
  nodeCount: number;
  respawnSeconds: number;
  /** Derived at build time from every material that belongs here. */
  materials: readonly MaterialId[];
  terrain: TerrainDef;
}

export interface ColiseumDef {
  boundaryRadius: number;
  travelSeconds: { walk: readonly number[]; sprint: readonly number[] };
}

/** Which gauntlet stat a crafting recipe permanently raises. */
export type GauntletStat = 'carryCapacity' | 'pullRadius' | 'pullSpeed';

export interface CraftingRecipe {
  id: RecipeId;
  name: string;
  description: string;
  cost: Quantities;
  effect: { stat: GauntletStat; amount: number };
}

export interface CraftingDef {
  baseStats: Readonly<Record<GauntletStat, number>>;
  recipes: readonly CraftingRecipe[];
}

export type AbilityKind = 'shove' | 'beam' | 'burst';

export interface AlchemyCombination {
  id: CombinationId;
  name: string;
  description: string;
  /** Elements spent to cast it. */
  elements: Quantities;
  /** One of the two or three someone else made, handed over at Level 1. */
  tutorial?: boolean;
  cooldownSeconds: number;
  effect: {
    kind: AbilityKind;
    damage: number;
    knockback: number;
    radius?: number;
    range?: number;
    burnSeconds?: number;
  };
}

/** A rendering of hostile code, in one of exactly three tiers. */
export interface EnemyDef {
  id: EnemyId;
  name: string;
  tier: 1 | 2 | 3;
  represents: string;
  description: string;
  shape: string;
  color: string;
  hp: number;
  /** How much of a shove it absorbs: knockback is divided by this. */
  weight: number;
  damage: number;
  /** Pursuit speed, once the player has actually been noticed. */
  speed: number;
  /**
   * An encounter distance, not a detection sweep. Canon gives the player the
   * informational advantage, so this is a body length or two - the old
   * aggroRadius covered most of a screen, which is what made them read as
   * locked on from across the world.
   */
  noticeRadius: number;
  /** Past this the enemy starts losing the player, and forgets after forgetSeconds. */
  loseRadius: number;
  forgetSeconds: number;
  attackRange: number;
  /** The amble between roam targets: slower than pursuit, so a chase reads as one. */
  wanderSpeed: number;
  /** How far from where it entered the world an enemy will drift. */
  roamRadius: number;
  /** Min and max seconds spent standing still before choosing the next target. */
  pauseSeconds: readonly number[];
}

export interface WavePacing {
  wavesPerBundle: number;
  secondsBetweenWaves: readonly number[];
  secondsBetweenBundles: readonly number[];
  secondsToClearWave: readonly number[];
}

/** Which parts of the pressure system exist at which level. */
export interface WaveGates {
  firstBundleAtLevel: number;
  repeatingBundlesFromLevel: number;
  ambientFromLevel: number;
}

export interface WavesDef {
  activePacing: string;
  pacing: Readonly<Record<string, WavePacing>>;
  gates: WaveGates;
  maxLiveWaveGroups: number;
  composition: readonly Readonly<Record<string, number | readonly number[]>>[];
  ambient: Readonly<Record<string, readonly number[]>>;
  showEnemiesDuringFirstBundle: boolean;
  /**
   * How far the player senses the program, in world units. The other half of
   * canon's asymmetry: enemies notice only at an encounter distance, so without
   * this the player would be exactly as blind as they are.
   */
  awarenessRadius: number;
}

export interface ProgressionConfig {
  alchemyUnlockLevel: number;
  classLevel: number;
  /** Canon says the menu does not pause; the author asked for it to. */
  pauseWithMenu: boolean;
  /** Novelty only. There is deliberately no per-unit gather award. */
  xp: {
    firstMaterial: number;
    firstCraft: number;
    firstAlchemy: number;
    firstBiome: number;
    clearWave: number;
  };
  levelCurve: { thresholds: readonly number[] };
  levels: readonly { level: number; trigger: string; grants: string }[];
  player: {
    moveSpeed: number;
    sprintSpeed: number;
    radius: number;
    /** How long the spiral takes to bring a node in. */
    pullSeconds: number;
  };
  combat: {
    maxHp: number;
    invulnerableSeconds: number;
    regenPerSecond: number;
    regenDelaySeconds: number;
    respawnSeconds: number;
    /** The gauntlets themselves. Canon has no weapon items but does imply this. */
    basicAttack: {
      damage: number;
      range: number;
      arcDegrees: number;
      cooldownSeconds: number;
      comboWindowSeconds: number;
      comboBonus: number;
      comboMax: number;
      knockback: number;
      /** How long a hit interrupts for, before tier weight divides it. */
      staggerSeconds: number;
    };
  };
  /** Cumulative XP needed to reach each level; index 0 is level 0. */
  xpTable: readonly number[];
}

/** One card of the opening guide. The rule that completes it lives in core/tutorial.ts. */
export interface TutorialStep {
  id: string;
  title: string;
  hint: string;
}

/**
 * The waking scene: black, then a fade up onto the Coliseum under a few lines
 * of text, before the first guide card. Durations are content because the pace
 * of the opening is an authored decision, not a constant in the renderer.
 */
export interface OpeningScript {
  fadeSeconds: number;
  lineSeconds: number;
  lines: readonly string[];
}

export interface ContentBundle {
  version: number;
  progression: ProgressionConfig;
  tutorial: readonly TutorialStep[];
  opening: OpeningScript;
  elements: readonly ElementDef[];
  materials: readonly MaterialDef[];
  biomes: readonly BiomeDef[];
  coliseum: ColiseumDef;
  crafting: CraftingDef;
  alchemy: readonly AlchemyCombination[];
  enemies: readonly EnemyDef[];
  waves: WavesDef;
  unitsPerPixel?: number;
}

/**
 * Which gauntlet a material is shown in. Canon: "The orbs display; they do not
 * store. Inventory stores." So a hand is a view, never a slot - nothing is
 * loaded into one and nothing is consumed out of one.
 */
export type Hand = 'left' | 'right';
export const HANDS: readonly Hand[] = ['left', 'right'];
