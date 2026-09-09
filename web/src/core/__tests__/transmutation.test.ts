import { describe, expect, it } from 'vitest';
import { content } from '../content';
import { findLockedRecipe, findRecipe } from '../transmutation';

describe('transmutation', () => {
  it('matches a pair in either order, as FindRecipe does', () => {
    const forward = findRecipe(content, 'stick', 'stone');
    const reverse = findRecipe(content, 'stone', 'stick');

    expect(forward).not.toBeNull();
    expect(forward?.result).toBe('stone_axe');
    expect(reverse).toBe(forward);
  });

  it('matches a pair of two identical materials', () => {
    expect(findRecipe(content, 'fiber', 'fiber')?.result).toBe('cord');
  });

  it('returns null for a pair with no recipe', () => {
    expect(findRecipe(content, 'stick', 'bone')).toBeNull();
  });

  it('returns null when either input is missing', () => {
    expect(findRecipe(content, 'stick', null)).toBeNull();
    expect(findRecipe(content, null, 'stone')).toBeNull();
    expect(findRecipe(content, null, null)).toBeNull();
  });

  it('filters out recipes above the player level', () => {
    const recipe = content.transmutation.find((r) => r.id === 'tr_iron_sword');
    expect(recipe).toBeDefined();
    if (!recipe) return;

    expect(findRecipe(content, recipe.a, recipe.b, recipe.requiredLevel - 1)).toBeNull();
    expect(findRecipe(content, recipe.a, recipe.b, recipe.requiredLevel)).not.toBeNull();
  });

  it('reports a level-gated pair separately so the UI can explain the lock', () => {
    const recipe = content.transmutation.find((r) => r.id === 'tr_iron_sword');
    if (!recipe) throw new Error('fixture recipe missing');

    expect(findLockedRecipe(content, recipe.a, recipe.b, 1)?.id).toBe('tr_iron_sword');
    expect(findLockedRecipe(content, recipe.a, recipe.b, recipe.requiredLevel)).toBeNull();
    expect(findLockedRecipe(content, 'stick', 'bone', 1)).toBeNull();
  });
});
