/**
 * Indexed, read-only view over the generated content bundle.
 *
 * The bundle is imported at build time, so there is no async load and no
 * missing-asset failure mode.
 */
import bundleJson from '@content/maelstrom-content.json';
import type {
  AlchemyCombination,
  BiomeDef,
  BiomeId,
  ColiseumDef,
  CombinationId,
  ContentBundle,
  CraftingDef,
  ElementDef,
  ElementId,
  EnemyDef,
  EnemyId,
  MaterialDef,
  MaterialId,
  ProgressionConfig,
  TutorialStep,
  WavesDef,
} from './types';

const bundle = bundleJson as unknown as ContentBundle;

export class Content {
  readonly progression: ProgressionConfig = bundle.progression;
  readonly elements: readonly ElementDef[] = bundle.elements;
  readonly materials: readonly MaterialDef[] = bundle.materials;
  readonly biomes: readonly BiomeDef[] = bundle.biomes;
  readonly coliseum: ColiseumDef = bundle.coliseum;
  readonly crafting: CraftingDef = bundle.crafting;
  readonly alchemy: readonly AlchemyCombination[] = bundle.alchemy;
  readonly enemies: readonly EnemyDef[] = bundle.enemies;
  readonly waves: WavesDef = bundle.waves;
  readonly tutorial: readonly TutorialStep[] = bundle.tutorial;
  /** Unreal units per screen unit; canon distances are stored in uu. */
  readonly unitsPerPixel: number = bundle.unitsPerPixel ?? 12;

  private readonly elementById = new Map<ElementId, ElementDef>();
  private readonly materialById = new Map<MaterialId, MaterialDef>();
  private readonly biomeById = new Map<BiomeId, BiomeDef>();
  private readonly enemyById = new Map<EnemyId, EnemyDef>();
  private readonly combinationById = new Map<CombinationId, AlchemyCombination>();

  constructor() {
    for (const e of this.elements) this.elementById.set(e.id, e);
    for (const m of this.materials) this.materialById.set(m.id, m);
    for (const b of this.biomes) this.biomeById.set(b.id, b);
    for (const e of this.enemies) this.enemyById.set(e.id, e);
    for (const c of this.alchemy) this.combinationById.set(c.id, c);
  }

  element(id: ElementId): ElementDef {
    const e = this.elementById.get(id);
    if (!e) throw new Error(`unknown element "${id}"`);
    return e;
  }

  material(id: MaterialId): MaterialDef {
    const m = this.materialById.get(id);
    if (!m) throw new Error(`unknown material "${id}"`);
    return m;
  }

  biome(id: BiomeId): BiomeDef {
    const b = this.biomeById.get(id);
    if (!b) throw new Error(`unknown biome "${id}"`);
    return b;
  }

  enemy(id: EnemyId): EnemyDef {
    const e = this.enemyById.get(id);
    if (!e) throw new Error(`unknown enemy "${id}"`);
    return e;
  }

  combination(id: CombinationId): AlchemyCombination {
    const c = this.combinationById.get(id);
    if (!c) throw new Error(`unknown combination "${id}"`);
    return c;
  }

  hasMaterial(id: MaterialId): boolean {
    return this.materialById.has(id);
  }

  /** The permanent spawn. Canon fixes it as Plains/Forest at the origin. */
  get spawnBiome(): BiomeDef {
    return this.biome('plains_forest');
  }

  /** Which region a point in Unreal units falls in, or null for connective terrain. */
  biomeAt(x: number, y: number): BiomeDef | null {
    for (const b of this.biomes) {
      if (Math.hypot(x - b.centre.x, y - b.centre.y) <= b.radius) return b;
    }
    return null;
  }

  materialsOf(biome: BiomeId): readonly MaterialDef[] {
    return this.materials.filter((m) => m.biome === biome);
  }

  /** Which biomes a material's elements can be reached from - powers the codex. */
  biomesYielding(element: ElementId): readonly BiomeDef[] {
    const ids = new Set(this.materials.filter((m) => m.elements.includes(element)).map((m) => m.biome));
    return this.biomes.filter((b) => ids.has(b.id));
  }

  /** Crafting recipes that consume this material - the codex "used in" list. */
  recipesUsing(id: MaterialId): readonly CraftingDef['recipes'][number][] {
    return this.crafting.recipes.filter((r) => id in r.cost);
  }

  /** Combinations that spend this element. */
  combinationsUsing(element: ElementId): readonly AlchemyCombination[] {
    return this.alchemy.filter((c) => element in c.elements);
  }

  get activePacing(): WavesDef['pacing'][string] {
    const pacing = this.waves.pacing[this.waves.activePacing];
    if (!pacing) throw new Error(`unknown wave pacing "${this.waves.activePacing}"`);
    return pacing;
  }
}

/** Shared instance. The bundle is immutable, so a singleton is safe. */
export const content = new Content();
