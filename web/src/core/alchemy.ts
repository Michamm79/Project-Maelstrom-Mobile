/**
 * Port of AlchemySystem.cs.
 *
 * Alchemy is the harder of the two systems, exactly as the original describes:
 * instead of matching two inputs, it asks whether the player's element pool
 * *contains* everything a recipe requires, and returns every recipe that passes -
 * because one pool usually satisfies several recipes, and that choice is the
 * menu the UI is meant to present.
 */
import type { Content } from './content';
import type { AlchemyRecipe, Composition, ElementId } from './types';

export type ElementPool = Record<ElementId, number>;

/** Does the pool hold enough of every element the recipe requires? */
export function canFulfill(recipe: AlchemyRecipe, pool: Readonly<ElementPool>): boolean {
  for (const [element, needed] of Object.entries(recipe.requires)) {
    if ((pool[element] ?? 0) < needed) return false;
  }
  return true;
}

/**
 * How short the pool is for each element, for recipes the player can't afford yet.
 * Showing the gap ("need 2 more Aether") is far more useful than hiding the recipe.
 */
export function shortfall(recipe: AlchemyRecipe, pool: Readonly<ElementPool>): Composition {
  const missing: Record<ElementId, number> = {};
  for (const [element, needed] of Object.entries(recipe.requires)) {
    const gap = needed - (pool[element] ?? 0);
    if (gap > 0) missing[element] = gap;
  }
  return missing;
}

/** Every recipe the player can perform right now, given their pool and level. */
export function findAvailableRecipes(
  content: Content,
  pool: Readonly<ElementPool>,
  playerLevel = Number.MAX_SAFE_INTEGER,
): readonly AlchemyRecipe[] {
  return content.alchemy.filter((r) => r.requiredLevel <= playerLevel && canFulfill(r, pool));
}

/** Every recipe unlocked by level, affordable or not - the alchemy menu's full list. */
export function knownRecipes(content: Content, playerLevel: number): readonly AlchemyRecipe[] {
  return content.alchemy.filter((r) => r.requiredLevel <= playerLevel);
}

/**
 * Consume a recipe's elements from the pool. Mutates the pool in place and
 * returns false without touching it if the pool can't cover the cost.
 */
export function consumeElements(recipe: AlchemyRecipe, pool: ElementPool): boolean {
  if (!canFulfill(recipe, pool)) return false;

  for (const [element, needed] of Object.entries(recipe.requires)) {
    const remaining = (pool[element] ?? 0) - needed;
    if (remaining > 0) pool[element] = remaining;
    else delete pool[element];
  }
  return true;
}
