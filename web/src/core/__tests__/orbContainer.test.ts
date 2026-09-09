import { beforeEach, describe, expect, it } from 'vitest';
import { content } from '../content';
import { createInitialState, OrbContainer, type GameState } from '../orbContainer';

let state: GameState;
let orb: OrbContainer;

const atLevel = (level: number): OrbContainer => {
  const fresh = createInitialState(content);
  fresh.level = level;
  return new OrbContainer(content, fresh);
};

beforeEach(() => {
  state = createInitialState(content);
  orb = new OrbContainer(content, state);
});

describe('orb slots', () => {
  it('fills a named orb and refuses to overwrite it', () => {
    expect(orb.addMaterialToOrb('left', 'stick')).toBe(true);
    expect(orb.leftOrb).toBe('stick');
    expect(orb.addMaterialToOrb('left', 'stone')).toBe(false);
    expect(orb.leftOrb).toBe('stick');
  });

  it('fills left first, then right, then reports full', () => {
    expect(orb.addMaterialToFreeOrb('stick')).toBe('left');
    expect(orb.addMaterialToFreeOrb('stone')).toBe('right');
    expect(orb.addMaterialToFreeOrb('flint')).toBeNull();
  });

  it('rejects a material the content bundle does not define', () => {
    expect(orb.addMaterialToOrb('left', 'unobtainium')).toBe(false);
    expect(orb.leftOrb).toBeNull();
  });

  it('unloads an orb back into the pack rather than losing it', () => {
    orb.addMaterialToOrb('left', 'stick');
    expect(orb.unloadOrb('left')).toBe(true);
    expect(orb.leftOrb).toBeNull();
    expect(orb.countOf('stick')).toBe(1);
  });

  it('loads from the pack and takes the item out of it', () => {
    orb.addMaterialToOrb('left', 'stick');
    orb.unloadOrb('left');

    expect(orb.loadFromInventory('right', 'stick')).toBe(true);
    expect(orb.rightOrb).toBe('stick');
    expect(orb.countOf('stick')).toBe(0);
    expect(orb.loadFromInventory('left', 'stick')).toBe(false);
  });

  it('swaps orb contents', () => {
    orb.addMaterialToOrb('left', 'stick');
    orb.addMaterialToOrb('right', 'stone');
    orb.swapOrbs();
    expect(orb.leftOrb).toBe('stone');
    expect(orb.rightOrb).toBe('stick');
  });
});

describe('gathering', () => {
  it('routes overflow into the pack when both orbs are full', () => {
    orb.gather('stick');
    orb.gather('stone');
    const result = orb.gather('flint');

    expect(result.toOrb).toBeNull();
    expect(orb.countOf('flint')).toBe(1);
  });

  it('awards the discovery bonus only the first time', () => {
    const first = orb.state.xp;
    orb.gather('stick');
    const afterNew = orb.state.xp - first;

    orb.unloadOrb('left');
    orb.gather('stick');
    const afterRepeat = orb.state.xp - first - afterNew;

    expect(afterNew).toBe(content.progression.xp.gatherNewMaterial);
    expect(afterRepeat).toBe(content.progression.xp.gather);
  });
});

describe('transmutation', () => {
  it('consumes both orbs and puts the result in the pack', () => {
    orb.addMaterialToOrb('left', 'stick');
    orb.addMaterialToOrb('right', 'stone');

    expect(orb.peekTransmutation()?.result).toBe('stone_axe');
    expect(orb.tryTransmute()).toBe('stone_axe');
    expect(orb.leftOrb).toBeNull();
    expect(orb.rightOrb).toBeNull();
    expect(orb.countOf('stone_axe')).toBe(1);
  });

  it('does nothing when the pair has no recipe', () => {
    orb.addMaterialToOrb('left', 'stick');
    orb.addMaterialToOrb('right', 'bone');

    expect(orb.tryTransmute()).toBeNull();
    expect(orb.leftOrb).toBe('stick');
    expect(orb.rightOrb).toBe('bone');
  });

  it('does not consume the orbs when the recipe is level-gated', () => {
    const gated = content.transmutation.find((r) => r.requiredLevel > 1);
    if (!gated) throw new Error('expected at least one level-gated recipe');

    orb.addMaterialToOrb('left', gated.a);
    orb.addMaterialToOrb('right', gated.b);

    expect(orb.tryTransmute()).toBeNull();
    expect(orb.leftOrb).toBe(gated.a);
  });

  it('pays full XP once, then the repeat rate', () => {
    const recipe = content.transmutation.find((r) => r.id === 'tr_stone_axe');
    if (!recipe) throw new Error('fixture recipe missing');

    orb.addMaterialToOrb('left', 'stick');
    orb.addMaterialToOrb('right', 'stone');
    const before = orb.state.xp;
    orb.tryTransmute();
    const firstGain = orb.state.xp - before;

    orb.addMaterialToOrb('left', 'stick');
    orb.addMaterialToOrb('right', 'stone');
    const mid = orb.state.xp;
    orb.tryTransmute();
    const repeatGain = orb.state.xp - mid;

    expect(firstGain).toBe(recipe.xp);
    expect(repeatGain).toBeLessThan(firstGain);
  });
});

describe('alchemy gating', () => {
  it('refuses to decompose below the unlock level', () => {
    orb.addMaterialToOrb('left', 'stick');
    expect(orb.alchemyUnlocked).toBe(false);
    expect(orb.decomposeMaterialAt('left')).toBe(false);
    expect(orb.leftOrb).toBe('stick');
  });

  it('decomposes into the material composition once unlocked', () => {
    const unlocked = atLevel(content.progression.alchemyUnlockLevel);
    unlocked.addMaterialToOrb('left', 'stick');

    expect(unlocked.decomposeMaterialAt('left')).toBe(true);
    expect(unlocked.leftOrb).toBeNull();
    expect(unlocked.state.elementPool).toEqual(content.material('stick').composition);
  });

  it('accumulates elements across several decompositions', () => {
    const unlocked = atLevel(content.progression.alchemyUnlockLevel);
    for (let i = 0; i < 3; i++) {
      unlocked.addMaterialToOrb('left', 'stone');
      unlocked.decomposeMaterialAt('left');
    }
    expect(unlocked.state.elementPool['terran']).toBe(content.material('stone').composition['terran']! * 3);
  });

  it('hides the alchemy menu entirely below the unlock level', () => {
    expect(orb.getAvailableAlchemyRecipes()).toEqual([]);
  });

  it('brews an affordable recipe and spends the elements', () => {
    const unlocked = atLevel(content.progression.alchemyUnlockLevel);
    const fireball = content.alchemy.find((r) => r.id === 'alc_fireball');
    if (!fireball) throw new Error('fixture recipe missing');

    unlocked.state.elementPool = { pyron: 3, zephyr: 2 };
    expect(unlocked.tryAlchemize(fireball)).toBe('fireball');
    expect(unlocked.countOf('fireball')).toBe(1);
    expect(unlocked.state.elementPool).toEqual({ pyron: 1, zephyr: 1 });
  });

  it('refuses a recipe the pool cannot pay for', () => {
    const unlocked = atLevel(content.progression.alchemyUnlockLevel);
    const fireball = content.alchemy.find((r) => r.id === 'alc_fireball');
    if (!fireball) throw new Error('fixture recipe missing');

    unlocked.state.elementPool = { pyron: 1 };
    expect(unlocked.tryAlchemize(fireball)).toBeNull();
    expect(unlocked.state.elementPool).toEqual({ pyron: 1 });
  });

  it('cannot be farmed: decomposing a brew returns less than it cost', () => {
    const unlocked = atLevel(15);
    const fireball = content.alchemy.find((r) => r.id === 'alc_fireball');
    if (!fireball) throw new Error('fixture recipe missing');

    unlocked.state.elementPool = { pyron: 2, zephyr: 1 };
    unlocked.tryAlchemize(fireball);
    unlocked.loadFromInventory('left', 'fireball');
    unlocked.decomposeMaterialAt('left');

    const returned = Object.values(unlocked.state.elementPool).reduce((a, b) => a + b, 0);
    const spent = Object.values(fireball.requires).reduce((a, b) => a + b, 0);
    expect(returned).toBeLessThan(spent);
  });
});

describe('progression', () => {
  it('levels up when the XP threshold is crossed and reports the unlocks', () => {
    const events: { level: number; unlockedAlchemy: boolean }[] = [];
    orb.events.on('levelUp', (payload) => events.push(payload));

    orb.addXp(content.progression.xpTable[4] ?? 5000, 'discover');

    expect(orb.playerLevel).toBeGreaterThanOrEqual(5);
    expect(events.at(-1)?.unlockedAlchemy).toBe(true);
    expect(orb.alchemyUnlocked).toBe(true);
  });

  it('refuses travel to a zone above the player level', () => {
    const gated = content.zones.find((z) => z.requiredLevel > 1);
    if (!gated) throw new Error('expected a level-gated zone');

    expect(orb.travelTo(gated.id)).toBe(false);
    expect(orb.state.zoneId).not.toBe(gated.id);
  });
});
