/**
 * Behaviour of the four canon systems: what you carry, what crafting does to the
 * gauntlets, what alchemy spends, and what actually earns XP.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { content } from '../content';
import { Inventory } from '../inventory';
import { Crafting } from '../crafting';
import { Alchemy } from '../alchemy';
import { Progression } from '../progression';

const bundle = {
  version: content.progression ? 2 : 2,
  progression: content.progression,
  tutorial: content.tutorial,
  elements: content.elements,
  materials: content.materials,
  biomes: content.biomes,
  coliseum: content.coliseum,
  crafting: content.crafting,
  alchemy: content.alchemy,
  enemies: content.enemies,
  waves: content.waves,
};

let inventory: Inventory;

beforeEach(() => {
  inventory = new Inventory(bundle as never);
});

describe('carrying', () => {
  it('starts at the canon capacity of 60', () => {
    expect(inventory.capacity).toBe(60);
    expect(inventory.free).toBe(60);
  });

  it('stops acquiring when full rather than silently dropping the pull', () => {
    expect(inventory.add('loamstone', 60)).toBe(60);
    expect(inventory.full).toBe(true);
    expect(inventory.add('riverglass', 1)).toBe(0);
    expect(inventory.count('riverglass')).toBe(0);
  });

  it('takes only what fits, and reports how much that was', () => {
    inventory.add('loamstone', 58);
    expect(inventory.add('riverglass', 5)).toBe(2);
    expect(inventory.used).toBe(60);
  });

  it('shows everything held across the two orbs without splitting a stack', () => {
    for (const id of ['loamstone', 'riverglass', 'ironvine', 'stormpetal']) inventory.add(id, 3);
    const shown = [...inventory.orbView('left'), ...inventory.orbView('right')];
    expect(shown).toHaveLength(inventory.stacks().length);
    expect(shown.reduce((n, s) => n + s.quantity, 0)).toBe(inventory.used);
  });

  it('pools the elements inside what is held, without consuming it', () => {
    inventory.add('stormpetal', 2); // AYL + ARC
    const pool = inventory.elementPool();
    expect(pool.aeryl).toBe(2);
    expect(pool.arcen).toBe(2);
    expect(inventory.count('stormpetal')).toBe(2);
  });
});

describe('crafting', () => {
  it('raises carry capacity permanently and cannot be taken twice', () => {
    const crafting = new Crafting(bundle as never);
    inventory.add('heartwood_burl', 4);
    inventory.add('ironvine', 3);

    expect(crafting.craft('reinforced_weave', inventory).ok).toBe(true);
    expect(inventory.capacity).toBe(100);
    expect(inventory.count('heartwood_burl')).toBe(0);

    inventory.add('heartwood_burl', 4);
    inventory.add('ironvine', 3);
    const second = crafting.craft('reinforced_weave', inventory);
    expect(second.ok).toBe(false);
    expect(second.reason).toBe('already-built');
    expect(inventory.count('ironvine')).toBe(3);
  });

  it('spends nothing when the materials are short', () => {
    const crafting = new Crafting(bundle as never);
    inventory.add('heartwood_burl', 4);
    const result = crafting.craft('reinforced_weave', inventory);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('missing-materials');
    expect(inventory.count('heartwood_burl')).toBe(4);
  });

  it('names exactly what is missing, so the menu can say why', () => {
    const crafting = new Crafting(bundle as never);
    inventory.add('heartwood_burl', 1);
    const recipe = content.crafting.recipes.find((r) => r.id === 'reinforced_weave')!;
    expect(crafting.outlook(recipe, inventory).shortfall).toEqual({ heartwood_burl: 3, ironvine: 3 });
  });

  it('widens the pull rather than the pack when that is what was built', () => {
    const crafting = new Crafting(bundle as never);
    const before = inventory.pullRadius;
    inventory.add('riverglass', 4);
    inventory.add('stormpetal', 3);
    expect(crafting.craft('widened_aperture', inventory).ok).toBe(true);
    expect(inventory.pullRadius).toBe(before + 250);
    expect(inventory.capacity).toBe(60);
  });

  it('rebuilds the upgrades from what was built when a save loads', () => {
    const crafting = new Crafting(bundle as never);
    inventory.add('heartwood_burl', 4);
    inventory.add('ironvine', 3);
    crafting.craft('reinforced_weave', inventory);

    const restoredInventory = new Inventory(bundle as never);
    new Crafting(bundle as never).load(crafting.toJSON(), restoredInventory);
    expect(restoredInventory.capacity).toBe(100);
  });
});

describe('alchemy', () => {
  it('keeps the menu shut until level 2', () => {
    const alchemy = new Alchemy(bundle as never);
    expect(alchemy.menuInteractive(1)).toBe(false);
    expect(alchemy.menuInteractive(2)).toBe(true);
  });

  it('still lets the three handed-over combinations fire at level 1', () => {
    const alchemy = new Alchemy(bundle as never);
    for (const c of content.alchemy.filter((x) => x.tutorial)) {
      expect(alchemy.unlocked(c, 1)).toBe(true);
    }
  });

  it('spends the elements by consuming what was carrying them', () => {
    const alchemy = new Alchemy(bundle as never);
    const cost = content.combination('gust').elements.aeryl ?? 0;
    inventory.add('stormpetal', 4); // AYL + ARC, one of each per unit
    expect(alchemy.cast('gust', inventory, 1)?.id).toBe('gust');
    expect(inventory.count('stormpetal')).toBe(4 - cost);
  });

  it('casts nothing when the pool is short, and spends nothing either', () => {
    const alchemy = new Alchemy(bundle as never);
    // Torrent wants Vossen as well as Aeryl, and Stormpetal carries none of it.
    inventory.add('stormpetal', 4);
    expect(alchemy.cast('torrent', inventory, 2)).toBeNull();
    expect(inventory.count('stormpetal')).toBe(4);
  });

  it('leaves a level 1 player able to cast something from spawn material alone', () => {
    // Canon: the handed-over combinations are what the first wave bundle is
    // fought with, so arriving at it with nothing castable is a broken opening.
    const alchemy = new Alchemy(bundle as never);
    for (const m of content.materialsOf('plains_forest')) inventory.add(m.id, 1);
    const castable = alchemy.outlooks(inventory, 1).filter((o) => o.can);
    expect(castable.length).toBeGreaterThan(0);
  });

  it('reports the missing elements rather than just refusing', () => {
    const alchemy = new Alchemy(bundle as never);
    const torrent = content.combination('torrent');
    expect(alchemy.outlook(torrent, inventory, 2).shortfall).toEqual({ aeryl: 2, vossen: 3 });
  });
});

describe('XP', () => {
  it('pays for a material once and never again', () => {
    const p = new Progression(content.progression);
    expect(p.award('firstMaterial', 'riverglass')).toBe(content.progression.xp.firstMaterial);
    expect(p.award('firstMaterial', 'riverglass')).toBe(0);
    expect(p.award('firstMaterial', 'loamstone')).toBeGreaterThan(0);
  });

  it('holds level 1 back until the gathering tutorial is actually done', () => {
    // Canon puts the first wave bundle at Level 1 and gives Level 0 no enemies
    // at all, so Level 1 must not arrive after a pickup or two.
    const p = new Progression(content.progression);
    p.award('firstMaterial', 'loamstone');
    p.award('firstMaterial', 'riverglass');
    expect(p.level).toBe(0);
  });

  it('reaches level 2 on canon\'s own opening - the spawn, a craft, one bundle', () => {
    const p = new Progression(content.progression);
    for (const m of content.materialsOf('plains_forest')) p.award('firstMaterial', m.id);
    p.award('firstCraft', 'reinforced_weave');
    // Level 2 is granted for clearing all three waves of the first bundle.
    for (const wave of ['1', '2', '3']) p.award('clearWave', wave);
    expect(p.level).toBeGreaterThanOrEqual(2);
  });

  it('does not pay for waking up at the spawn', () => {
    // Waking somewhere is not a visit. Paying for it put the player at Level 1
    // before they had pressed Begin, which armed the waves immediately.
    const p = new Progression(content.progression);
    p.award('firstBiome', 'plains_forest');
    expect(p.level).toBe(0);
  });

  it('cannot be farmed off one node', () => {
    const p = new Progression(content.progression);
    for (let i = 0; i < 500; i++) p.award('firstMaterial', 'loamstone');
    expect(p.level).toBe(0);
  });

  it('survives a save round trip', () => {
    const p = new Progression(content.progression);
    p.award('firstMaterial', 'riverglass');
    const q = new Progression(content.progression);
    q.load(p.toJSON());
    expect(q.xp).toBe(p.xp);
    expect(q.award('firstMaterial', 'riverglass')).toBe(0);
  });
});
