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

/**
 * What would happen if this material were placed opposite `partner`.
 *
 * The bench uses this to grey out what cannot react and light up what can, so
 * finding the one material in a pack of forty that does something is a glance
 * rather than forty taps. "locked" is kept distinct from "inert" on purpose:
 * "nothing happens" and "nothing happens yet" are different lessons, and
 * conflating them teaches the player to stop trying a pair that works later.
 */
export type PairOutlook = 'combines' | 'locked' | 'inert';

export interface PairPreview {
  outlook: PairOutlook;
  /** Present for 'combines' and 'locked'. */
  recipe: TransmutationRecipe | null;
}

export function previewPair(
  content: Content,
  candidate: MaterialId,
  partner: MaterialId | null,
  playerLevel: number,
): PairPreview {
  // With nothing opposite it, every material is still a live option - greying
  // the whole pack out would be noise, not information.
  if (partner === null) return { outlook: 'combines', recipe: null };

  const recipe = content.recipeByPair(candidate, partner);
  if (!recipe) return { outlook: 'inert', recipe: null };

  return recipe.requiredLevel > playerLevel
    ? { outlook: 'locked', recipe }
    : { outlook: 'combines', recipe };
}

/** How many of these materials react with `partner` right now. */
export function countCombinable(
  content: Content,
  candidates: readonly MaterialId[],
  partner: MaterialId | null,
  playerLevel: number,
): number {
  if (partner === null) return candidates.length;
  return candidates.filter(
    (c) => previewPair(content, c, partner, playerLevel).outlook === 'combines',
  ).length;
}
