/** Orb replacement and hand-mixed alchemy - the two behaviours the bench and the table need. */
import { beforeEach, describe, expect, it } from 'vitest';
import { content } from '../content';
import { createInitialState, OrbContainer, type GameState } from '../orbContainer';
import { findRecipeForSelection, selectionSize } from '../alchemy';

let state: GameState;
let orb: OrbContainer;

const atLevel = (level: number) => {
  const fresh = createInitialState(content);
  fresh.level = level;
  return new OrbContainer(content, fresh);
};

beforeEach(() => {
  state = createInitialState(content);
  orb = new OrbContainer(content, state);
});

describe('replacing an orb from the pack', () => {
  it('swaps into an occupied slot and returns the old material', () => {
    orb.gather('stick');
    orb.gather('stone');
    orb.gather('flint'); // orbs full, so this lands in the pack

    expect(orb.leftOrb).toBe('stick');
    expect(orb.countOf('flint')).toBe(1);

    expect(orb.replaceOrb('left', 'flint')).toBe(true);
    expect(orb.leftOrb).toBe('flint');
    expect(orb.countOf('stick')).toBe(1);
    expect(orb.countOf('flint')).toBe(0);
  });

  it('fills an empty slot without returning anything', () => {
    orb.gather('stick');
    orb.unloadOrb('left');

    expect(orb.replaceOrb('right', 'stick')).toBe(true);
    expect(orb.rightOrb).toBe('stick');
    expect(orb.leftOrb).toBeNull();
  });

  it('refuses a material that is not carried', () => {
    expect(orb.replaceOrb('left', 'stone')).toBe(false);
    expect(orb.leftOrb).toBeNull();
  });

  it('is a no-op when the slot already holds that material', () => {
    orb.gather('stick');
    orb.gather('stick');
    expect(orb.countOf('stick')).toBe(0);
    expect(orb.replaceOrb('left', 'stick')).toBe(false);
    expect(orb.leftOrb).toBe('stick');
  });

  it('never loses a material across repeated swaps', () => {
    for (const m of ['stick', 'stone', 'flint', 'fiber']) orb.gather(m);
    const total = () =>
      ['stick', 'stone', 'flint', 'fiber'].reduce(
        (n, m) => n + orb.countOf(m) + (orb.leftOrb === m ? 1 : 0) + (orb.rightOrb === m ? 1 : 0),
        0,
      );

    const before = total();
    orb.replaceOrb('left', 'flint');
    orb.replaceOrb('right', 'fiber');
    orb.replaceOrb('left', 'stone');
    expect(total()).toBe(before);
  });
});

describe('mixing elements by hand', () => {
  it('matches a selection that is exactly a recipe', () => {
    const match = findRecipeForSelection(content, { pyron: 2, zephyr: 1 });
    expect(match?.result).toBe('fireball');
  });

  it('rejects a superset, so dumping everything in does not fire a recipe', () => {
    expect(findRecipeForSelection(content, { pyron: 2, zephyr: 1, terran: 4 })).toBeNull();
  });

  it('rejects wrong quantities and empty selections', () => {
    expect(findRecipeForSelection(content, { pyron: 1, zephyr: 1 })).toBeNull();
    expect(findRecipeForSelection(content, { pyron: 3, zephyr: 1 })).toBeNull();
    expect(findRecipeForSelection(content, {})).toBeNull();
  });

  it('honours the level gate', () => {
    const late = content.alchemy.find((r) => r.requiredLevel >= 15);
    if (!late) throw new Error('expected a late-game recipe');
    expect(findRecipeForSelection(content, late.requires, 5)).toBeNull();
    expect(findRecipeForSelection(content, late.requires, late.requiredLevel)?.id).toBe(late.id);
  });

  it('counts a selection', () => {
    expect(selectionSize({ pyron: 2, zephyr: 1 })).toBe(3);
    expect(selectionSize({})).toBe(0);
  });

  it('brews a correct mixture and spends the pool', () => {
    const unlocked = atLevel(5);
    unlocked.state.elementPool = { pyron: 3, zephyr: 2 };

    const outcome = unlocked.tryAlchemizeSelection({ pyron: 2, zephyr: 1 });
    expect(outcome.reason).toBe('ok');
    expect(outcome.result).toBe('fireball');
    expect(unlocked.state.elementPool).toEqual({ pyron: 1, zephyr: 1 });
  });

  it('costs nothing when the mixture forms nothing', () => {
    const unlocked = atLevel(5);
    unlocked.state.elementPool = { pyron: 3, zephyr: 2 };

    const outcome = unlocked.tryAlchemizeSelection({ pyron: 3, zephyr: 2 });
    expect(outcome.reason).toBe('no-recipe');
    expect(outcome.result).toBeNull();
    expect(unlocked.state.elementPool).toEqual({ pyron: 3, zephyr: 2 });
  });

  it('reports a shortfall without spending anything', () => {
    const unlocked = atLevel(5);
    unlocked.state.elementPool = { pyron: 1, zephyr: 1 };

    const outcome = unlocked.tryAlchemizeSelection({ pyron: 2, zephyr: 1 });
    expect(outcome.reason).toBe('short');
    expect(unlocked.state.elementPool).toEqual({ pyron: 1, zephyr: 1 });
  });

  it('refuses entirely below the unlock level', () => {
    expect(orb.tryAlchemizeSelection({ pyron: 2, zephyr: 1 }).reason).toBe('locked');
  });
});

describe('the element table', () => {
  it('gives every element a unique symbol, number and cell', () => {
    const symbols = new Set(content.elements.map((e) => e.symbol));
    const numbers = new Set(content.elements.map((e) => e.number));
    const cells = new Set(content.elements.map((e) => `${e.row},${e.col}`));

    expect(symbols.size).toBe(content.elements.length);
    expect(numbers.size).toBe(content.elements.length);
    expect(cells.size).toBe(content.elements.length);
  });

  it('keeps symbols short enough for a table cell', () => {
    for (const e of content.elements) {
      expect(e.symbol.length).toBeGreaterThan(0);
      expect(e.symbol.length).toBeLessThanOrEqual(2);
    }
  });

  it('lays out on a grid with no negative or zero coordinates', () => {
    for (const e of content.elements) {
      expect(e.row).toBeGreaterThanOrEqual(1);
      expect(e.col).toBeGreaterThanOrEqual(1);
    }
  });
});
