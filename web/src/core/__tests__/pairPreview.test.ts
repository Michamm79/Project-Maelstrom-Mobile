/**
 * The bench's grey-out / light-up logic.
 *
 * These are the rules behind "which of the forty things I am carrying actually
 * does something with this?", so they are worth pinning independently of the
 * DOM that renders them.
 */
import { describe, expect, it } from 'vitest';
import { content } from '../content';
import { countCombinable, previewPair } from '../transmutation';
import type { MaterialId } from '../types';

const HIGH = 99;

describe('previewPair', () => {
  it('marks a real pair as combining', () => {
    // stick + stone -> stone axe, available from the start.
    expect(previewPair(content, 'stick', 'stone', HIGH).outlook).toBe('combines');
    expect(previewPair(content, 'stick', 'stone', HIGH).recipe?.result).toBe('stone_axe');
  });

  it('is order independent, like the recipe lookup it wraps', () => {
    expect(previewPair(content, 'stone', 'stick', HIGH).outlook).toBe('combines');
  });

  it('marks a pair with no recipe as inert', () => {
    const recipe = content.recipeByPair('stick', 'stick');
    // Guard the fixture: if someone later adds stick+stick, this test is lying.
    expect(recipe).toBeUndefined();
    expect(previewPair(content, 'stick', 'stick', HIGH).outlook).toBe('inert');
  });

  it('separates "nothing happens" from "nothing happens yet"', () => {
    // Find a recipe gated above level 1 and check it reads as locked, not inert.
    const gated = content.transmutation.find((r) => r.requiredLevel > 1);
    expect(gated).toBeDefined();

    const preview = previewPair(content, gated!.a, gated!.b, 1);
    expect(preview.outlook).toBe('locked');
    expect(preview.recipe?.requiredLevel).toBe(gated!.requiredLevel);

    // Same pair, high enough level, becomes a live option.
    expect(previewPair(content, gated!.a, gated!.b, gated!.requiredLevel).outlook).toBe('combines');
  });

  it('treats an empty partner slot as "everything is still possible"', () => {
    // Greying the whole pack out before a partner is chosen would be noise.
    expect(previewPair(content, 'stick', null, HIGH).outlook).toBe('combines');
    expect(previewPair(content, 'stick', null, HIGH).recipe).toBeNull();
  });
});

describe('countCombinable', () => {
  const carrying: MaterialId[] = ['stick', 'stone', 'fiber', 'flint'];

  it('counts only what reacts with the partner', () => {
    const n = countCombinable(content, carrying, 'stick', HIGH);
    const manual = carrying.filter(
      (m) => previewPair(content, m, 'stick', HIGH).outlook === 'combines',
    ).length;
    expect(n).toBe(manual);
  });

  it('counts everything when no partner is set', () => {
    expect(countCombinable(content, carrying, null, HIGH)).toBe(carrying.length);
  });

  it('does not count a pair the player has not levelled into', () => {
    const gated = content.transmutation.find((r) => r.requiredLevel > 1);
    expect(gated).toBeDefined();
    expect(countCombinable(content, [gated!.a], gated!.b, 1)).toBe(0);
    expect(countCombinable(content, [gated!.a], gated!.b, gated!.requiredLevel)).toBe(1);
  });

  it('reports zero when nothing carried reacts, which the bench says out loud', () => {
    expect(countCombinable(content, ['stick'], 'stick', HIGH)).toBe(0);
  });
});
