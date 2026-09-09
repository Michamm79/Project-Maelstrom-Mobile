import { describe, expect, it } from 'vitest';
import { canFulfill, consumeElements, findAvailableRecipes, shortfall, type ElementPool } from '../alchemy';
import { content } from '../content';
import type { AlchemyRecipe } from '../types';

const recipe = (id: string): AlchemyRecipe => {
  const found = content.alchemy.find((r) => r.id === id);
  if (!found) throw new Error(`fixture recipe "${id}" missing`);
  return found;
};

describe('alchemy', () => {
  it('accepts a pool that meets every requirement', () => {
    const fireball = recipe('alc_fireball');
    expect(canFulfill(fireball, { pyron: 2, zephyr: 1 })).toBe(true);
    expect(canFulfill(fireball, { pyron: 9, zephyr: 9, terran: 4 })).toBe(true);
  });

  it('rejects a pool short of any single element', () => {
    const fireball = recipe('alc_fireball');
    expect(canFulfill(fireball, { pyron: 1, zephyr: 1 })).toBe(false);
    expect(canFulfill(fireball, { pyron: 2 })).toBe(false);
    expect(canFulfill(fireball, {})).toBe(false);
  });

  it('reports how far short the pool is', () => {
    const fireball = recipe('alc_fireball');
    expect(shortfall(fireball, { pyron: 1 })).toEqual({ pyron: 1, zephyr: 1 });
    expect(shortfall(fireball, { pyron: 2, zephyr: 1 })).toEqual({});
  });

  it('consumes exactly the required elements and drops emptied keys', () => {
    const fireball = recipe('alc_fireball');
    const pool: ElementPool = { pyron: 3, zephyr: 1, terran: 2 };

    expect(consumeElements(fireball, pool)).toBe(true);
    expect(pool).toEqual({ pyron: 1, terran: 2 });
  });

  it('leaves the pool untouched when it cannot pay', () => {
    const fireball = recipe('alc_fireball');
    const pool: ElementPool = { pyron: 1, zephyr: 5 };

    expect(consumeElements(fireball, pool)).toBe(false);
    expect(pool).toEqual({ pyron: 1, zephyr: 5 });
  });

  it('returns every affordable recipe, not just the first', () => {
    const pool: ElementPool = { pyron: 4, zephyr: 3, verdant: 4, aqualis: 4 };
    const available = findAvailableRecipes(content, pool, 5);
    const ids = available.map((r) => r.id);

    expect(ids).toContain('alc_fireball');
    expect(ids).toContain('alc_healing');
    expect(available.length).toBeGreaterThanOrEqual(2);
  });

  it('filters by player level', () => {
    const generous: ElementPool = Object.fromEntries(content.elements.map((e) => [e.id, 99]));
    expect(findAvailableRecipes(content, generous, 5).every((r) => r.requiredLevel <= 5)).toBe(true);
    expect(findAvailableRecipes(content, generous, 99).length).toBe(content.alchemy.length);
  });
});
