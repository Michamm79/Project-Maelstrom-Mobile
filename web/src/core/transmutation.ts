/**
 * Port of TransmutationSystem.cs.
 *
 * Same contract as the original: stateless, data in / data out, no rendering
 * dependency, order-independent pair matching, level filtering. The only change
 * is that lookup goes through a pre-built pair index instead of a linear scan.
 */
import type { Content } from './content';
import type { MaterialId, TransmutationRecipe } from './types';

/**
 * Find the recipe matching two input materials, in either order.
 * Returns null when no recipe exists, or when the player has not reached the
 * recipe's required level.
 */
export function findRecipe(
  content: Content,
  a: MaterialId | null,
  b: MaterialId | null,
  playerLevel = Number.MAX_SAFE_INTEGER,
): TransmutationRecipe | null {
  if (a === null || b === null) return null;

  const recipe = content.recipeByPair(a, b);
  if (!recipe) return null;
  if (recipe.requiredLevel > playerLevel) return null;

  return recipe;
}

/**
 * A recipe exists for this pair but the player is too low a level for it.
 * The UI uses this to show a locked preview ("something happens here, later")
 * rather than a flat "no reaction", which is a much better teaching signal.
 */
export function findLockedRecipe(
  content: Content,
  a: MaterialId | null,
  b: MaterialId | null,
  playerLevel: number,
): TransmutationRecipe | null {
  if (a === null || b === null) return null;

  const recipe = content.recipeByPair(a, b);
  if (!recipe) return null;

  return recipe.requiredLevel > playerLevel ? recipe : null;
}

/** Every transmutation the player has the level for. Powers the codex. */
export function availableRecipes(content: Content, playerLevel: number): readonly TransmutationRecipe[] {
  return content.transmutation.filter((r) => r.requiredLevel <= playerLevel);
}
