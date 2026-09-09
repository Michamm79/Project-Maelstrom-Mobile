/**
 * Indexed, read-only view over the generated content bundle.
 *
 * Replaces Unity's Resources.LoadAll<T>() - the bundle is imported at build time,
 * so there is no async load and no missing-asset failure mode.
 */
import bundleJson from '@content/maelstrom-content.json';
import type {
  AlchemyRecipe,
  ContentBundle,
  ElementDef,
  ElementId,
  MaterialDef,
  MaterialId,
  ProgressionConfig,
  TransmutationRecipe,
  ZoneDef,
  ZoneId,
} from './types';

const bundle = bundleJson as unknown as ContentBundle;

export class Content {
  readonly progression: ProgressionConfig = bundle.progression;
  readonly elements: readonly ElementDef[] = bundle.elements;
  readonly materials: readonly MaterialDef[] = bundle.materials;
  readonly transmutation: readonly TransmutationRecipe[] = bundle.transmutation;
  readonly alchemy: readonly AlchemyRecipe[] = bundle.alchemy;
  readonly zones: readonly ZoneDef[] = bundle.zones;

  private readonly elementById = new Map<ElementId, ElementDef>();
  private readonly materialById = new Map<MaterialId, MaterialDef>();
  private readonly zoneById = new Map<ZoneId, ZoneDef>();

  /**
   * Transmutation lookup keyed by the sorted input pair, which is what makes
   * FindRecipe order-independent without scanning the list.
   */
  private readonly transmutationByPair = new Map<string, TransmutationRecipe>();

  constructor() {
    for (const e of this.elements) this.elementById.set(e.id, e);
    for (const m of this.materials) this.materialById.set(m.id, m);
    for (const z of this.zones) this.zoneById.set(z.id, z);
    for (const r of this.transmutation) this.transmutationByPair.set(pairKey(r.a, r.b), r);
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

  zone(id: ZoneId): ZoneDef {
    const z = this.zoneById.get(id);
    if (!z) throw new Error(`unknown zone "${id}"`);
    return z;
  }

  hasMaterial(id: MaterialId): boolean {
    return this.materialById.has(id);
  }

  recipeByPair(a: MaterialId, b: MaterialId): TransmutationRecipe | undefined {
    return this.transmutationByPair.get(pairKey(a, b));
  }

  /** Zones the player has reached, in unlock order. */
  unlockedZones(level: number): readonly ZoneDef[] {
    return this.zones.filter((z) => z.requiredLevel <= level);
  }

  /** Every recipe that consumes this material - powers the codex "used in" list. */
  recipesUsing(id: MaterialId): readonly TransmutationRecipe[] {
    return this.transmutation.filter((r) => r.a === id || r.b === id);
  }
}

export function pairKey(a: MaterialId, b: MaterialId): string {
  return a < b ? `${a}+${b}` : `${b}+${a}`;
}

/** Shared instance. The bundle is immutable, so a singleton is safe. */
export const content = new Content();
