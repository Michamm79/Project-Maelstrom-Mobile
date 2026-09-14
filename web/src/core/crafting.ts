/**
 * Crafting: materials in, permanent gauntlet upgrades out.
 *
 * GDD section 6.1. The first recipes are all gauntlet improvements on purpose,
 * which keeps the loop self-feeding: gather -> craft -> gather better -> craft
 * more. Each recipe is a one-off; an upgrade already taken is spent.
 *
 * This replaces the pair-combination "transmutation" from the earlier build.
 * That was a faithful port of TransmutationRecipe.cs in the Project_Maelstrom
 * repo - a Unity prototype that is a different project from the Unreal game the
 * GDD describes. Two materials making a third is not a Maelstrom mechanic.
 */
import type { ContentBundle, CraftingRecipe, RecipeId } from './types';
import type { Inventory } from './inventory';

export type CraftBlock = 'already-built' | 'missing-materials';

export interface CraftOutlook {
  recipe: CraftingRecipe;
  /** What is still needed, by material id. Empty when the recipe is affordable. */
  shortfall: Record<string, number>;
  built: boolean;
  can: boolean;
  blockedBy: CraftBlock | null;
}

export interface CraftResult {
  ok: boolean;
  recipe?: CraftingRecipe;
  reason?: CraftBlock;
}

export class Crafting {
  /** Recipes already taken. Upgrades are permanent, so each is available once. */
  private readonly built = new Set<RecipeId>();

  constructor(private readonly content: ContentBundle) {}

  recipes(): readonly CraftingRecipe[] {
    return this.content.crafting.recipes;
  }

  isBuilt(id: RecipeId): boolean {
    return this.built.has(id);
  }

  get builtCount(): number {
    return this.built.size;
  }

  /**
   * What the menu needs to draw a row: whether it can be made, and if not, what
   * is missing. Canon requires this menu to be fast to read and fast to act in,
   * because it does not pause the world - so "why not" has to be visible without
   * opening anything further.
   */
  outlook(recipe: CraftingRecipe, inventory: Inventory): CraftOutlook {
    const built = this.built.has(recipe.id);
    const shortfall: Record<string, number> = {};
    for (const [id, qty] of Object.entries(recipe.cost)) {
      const missing = qty - inventory.count(id);
      if (missing > 0) shortfall[id] = missing;
    }
    const affordable = Object.keys(shortfall).length === 0;
    const can = !built && affordable;
    const blockedBy: CraftBlock | null = built
      ? 'already-built'
      : affordable
        ? null
        : 'missing-materials';
    return { recipe, shortfall, built, can, blockedBy };
  }

  outlooks(inventory: Inventory): CraftOutlook[] {
    return this.recipes().map((r) => this.outlook(r, inventory));
  }

  /** Spend the materials and apply the upgrade, or change nothing. */
  craft(id: RecipeId, inventory: Inventory): CraftResult {
    const recipe = this.content.crafting.recipes.find((r) => r.id === id);
    if (!recipe) return { ok: false };

    const outlook = this.outlook(recipe, inventory);
    if (!outlook.can) return { ok: false, recipe, reason: outlook.blockedBy ?? undefined };

    if (!inventory.spend(recipe.cost)) return { ok: false, recipe, reason: 'missing-materials' };
    inventory.applyUpgrade(recipe.effect.stat, recipe.effect.amount);
    this.built.add(recipe.id);
    return { ok: true, recipe };
  }

  toJSON(): RecipeId[] {
    return [...this.built];
  }

  load(ids: readonly RecipeId[] | undefined, inventory: Inventory): void {
    this.built.clear();
    for (const id of ids ?? []) {
      const recipe = this.content.crafting.recipes.find((r) => r.id === id);
      if (recipe) this.built.add(id);
    }
    // Upgrades are re-derived from what was built rather than saved separately,
    // so a content rebalance reaches an existing save instead of being frozen
    // into it.
    for (const id of this.built) {
      const recipe = this.content.crafting.recipes.find((r) => r.id === id);
      if (recipe) inventory.applyUpgrade(recipe.effect.stat, recipe.effect.amount);
    }
  }
}
