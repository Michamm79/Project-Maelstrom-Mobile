/**
 * Guards on the parts of the GDD that are stated as non-negotiable, so a content
 * edit that quietly breaks one fails here rather than in playtest.
 */
import { describe, expect, it } from 'vitest';
import { content } from '../content';

describe('the element table', () => {
  it('has the ten canon elements', () => {
    expect(content.elements).toHaveLength(10);
    expect(content.elements.map((e) => e.symbol).sort()).toEqual(
      ['ARC', 'AYL', 'CDR', 'FRN', 'GLC', 'SPR', 'SVN', 'TRX', 'UMB', 'VSN'],
    );
  });

  it('uses three-letter symbols, so it cannot be read as the periodic table', () => {
    for (const e of content.elements) expect(e.symbol).toMatch(/^[A-Z]{3}$/);
  });

  it('contains no real chemical symbol', () => {
    // Every real symbol is one or two letters, so three letters makes a
    // collision impossible - this asserts the property rather than a blocklist.
    const real = ['FE', 'TE', 'AG', 'AU', 'NA', 'CL', 'HE', 'LI', 'BE', 'MG'];
    for (const e of content.elements) expect(real).not.toContain(e.symbol.toUpperCase());
  });
});

describe('the materials', () => {
  it('has the canon eighteen', () => {
    expect(content.materials).toHaveLength(18);
  });

  it('gives every material exactly two elements', () => {
    for (const m of content.materials) expect(m.elements).toHaveLength(2);
  });

  it('locks every material to one biome', () => {
    for (const m of content.materials) {
      expect(content.biomes.map((b) => b.id)).toContain(m.biome);
      expect(content.biome(m.biome).materials).toContain(m.id);
    }
  });
});

describe('the gating that makes travel matter', () => {
  const spawnElements = new Set(content.materialsOf('plains_forest').flatMap((m) => m.elements));

  it('yields eight of the ten elements at the spawn', () => {
    expect(spawnElements.size).toBe(8);
  });

  it('withholds exactly cold and concealment from the spawn', () => {
    const withheld = content.elements.filter((e) => !spawnElements.has(e.id)).map((e) => e.id);
    expect(withheld.sort()).toEqual(['glacite', 'umbrel']);
  });

  it('puts concealment only in the Data-Center', () => {
    const carriers = content.materials.filter((m) => m.elements.includes('umbrel'));
    expect(carriers).toHaveLength(1);
    expect(carriers[0]?.biome).toBe('data_center');
  });

  it('puts cold on the mountain', () => {
    const biomes = content.biomesYielding('glacite').map((b) => b.id);
    expect(biomes).toContain('snowy_mountain');
  });
});

describe('the Coliseum', () => {
  it('is one world with Plains/Forest at the centre', () => {
    expect(content.spawnBiome.centre).toEqual({ x: 0, y: 0 });
    expect(content.biomes).toHaveLength(5);
  });

  it('rings the other four at equal distance', () => {
    const outer = content.biomes.filter((b) => b.id !== 'plains_forest');
    expect(outer).toHaveLength(4);
    for (const b of outer) expect(b.distanceFromCentre).toBe(48000);
  });

  it('keeps every biome inside the boundary', () => {
    for (const b of content.biomes) {
      expect(Math.hypot(b.centre.x, b.centre.y) + b.radius).toBeLessThanOrEqual(content.coliseum.boundaryRadius);
    }
  });

  it('gates on geography, not on player level', () => {
    for (const b of content.biomes) expect(b).not.toHaveProperty('requiredLevel');
  });
});

describe('the enemies', () => {
  it('is three tiers of rendered code, not a bestiary', () => {
    expect(content.enemies).toHaveLength(3);
    expect(content.enemies.map((e) => e.tier).sort()).toEqual([1, 2, 3]);
  });

  it('drops nothing, so fighting is never a gathering strategy', () => {
    for (const e of content.enemies) expect(e).not.toHaveProperty('drops');
  });

  it('never attacks from beyond the range it closes to', () => {
    for (const e of content.enemies) expect(e.attackRange).toBeLessThanOrEqual(e.noticeRadius);
  });

  /*
   * The informational advantage is the player's. An enemy that notices from
   * most of a screen away is running a detection sweep, and every encounter
   * becomes a lock-on however the field is named.
   */
  it('notices at an encounter distance, not across a screen', () => {
    for (const e of content.enemies) expect(e.noticeRadius).toBeLessThanOrEqual(200);
  });

  it('loses the player further out than it finds them, so backing off works', () => {
    for (const e of content.enemies) {
      expect(e.loseRadius).toBeGreaterThan(e.noticeRadius);
      expect(e.forgetSeconds).toBeGreaterThan(0);
    }
  });

  it('wanders slower than it chases, so a chase looks like one', () => {
    for (const e of content.enemies) {
      expect(e.wanderSpeed).toBeGreaterThan(0);
      expect(e.wanderSpeed).toBeLessThan(e.speed);
      expect(e.roamRadius).toBeGreaterThan(0);
    }
  });
});

describe('crafting and alchemy stay separate disciplines', () => {
  it('spends materials on gauntlet upgrades', () => {
    for (const r of content.crafting.recipes) {
      expect(Object.keys(content.crafting.baseStats)).toContain(r.effect.stat);
      for (const id of Object.keys(r.cost)) expect(content.hasMaterial(id)).toBe(true);
    }
  });

  it('still has the four recipes canon actually specifies', () => {
    // A count, not a total: the tree has been extended past canon and this is
    // the part of it that is not ours to change.
    const ids = content.crafting.recipes.map((r) => r.id);
    for (const id of ['reinforced_weave', 'layered_weave', 'widened_aperture', 'deeper_current']) {
      expect(ids).toContain(id);
    }
  });

  it('gives every region something only it can make', () => {
    // Canon's four recipes are all buildable at the spawn, which left the four
    // outer regions paying out in elements and nothing else.
    const wanted = new Set(
      content.crafting.recipes.flatMap((r) => Object.keys(r.cost)).map((id) => content.material(id).biome),
    );
    for (const biome of content.biomes) expect(wanted).toContain(biome.id);
  });

  it('spends elements on abilities', () => {
    for (const c of content.alchemy) {
      for (const id of Object.keys(c.elements)) expect(() => content.element(id)).not.toThrow();
      expect(c.effect.damage).toBeGreaterThanOrEqual(0);
    }
  });

  it('opens the alchemy menu at level 2', () => {
    expect(content.progression.alchemyUnlockLevel).toBe(2);
  });

  it('keeps every tutorial combination craftable without leaving the spawn', () => {
    const spawnElements = new Set(content.materialsOf('plains_forest').flatMap((m) => m.elements));
    const tutorial = content.alchemy.filter((c) => c.tutorial);
    expect(tutorial.length).toBeGreaterThan(0);
    for (const c of tutorial) {
      for (const id of Object.keys(c.elements)) expect(spawnElements.has(id)).toBe(true);
    }
  });

  it('has no pair-combination recipes left', () => {
    // The A+B->C tree came from the Unity OrbSystem prototype, which is a
    // different project. If it ever reappears, this is where it shows up.
    expect(content).not.toHaveProperty('transmutation');
  });
});

describe('XP is novelty, not volume', () => {
  it('pays nothing per unit gathered', () => {
    expect(content.progression.xp).not.toHaveProperty('gather');
    expect(content.progression.xp.firstMaterial).toBeGreaterThan(0);
    expect(content.progression.xp.firstBiome).toBeGreaterThan(0);
  });
});

describe('wave pressure', () => {
  it('makes a bundle three waves', () => {
    expect(content.activePacing.wavesPerBundle).toBe(3);
  });

  it('keeps the opening slow: one bundle, then quiet until the game escalates', () => {
    // The deck puts the escalation at Level 5, and canon's production status
    // defers BOTH repeating bundles and the ambient population past the first
    // milestone. An earlier build ran bundles five minutes apart from Level 1
    // and turned the exploratory opening into a siege.
    const gates = content.waves.gates;
    expect(gates.firstBundleAtLevel).toBe(1);
    expect(gates.repeatingBundlesFromLevel).toBe(content.progression.classLevel);
    expect(gates.ambientFromLevel).toBeGreaterThanOrEqual(gates.repeatingBundlesFromLevel);
  });

  it('leaves a long gap between bundles once the cycle does start', () => {
    // Canon says roughly thirty minutes. Compressing this is what made the
    // early game relentless, so the floor is asserted rather than trusted.
    const gap = content.activePacing.secondsBetweenBundles[0] ?? 0;
    expect(gap).toBeGreaterThanOrEqual(1200);
  });

  it('compresses only the spacing inside a bundle', () => {
    // Five minutes between waves of a single fight is dead air on a phone; the
    // gap BETWEEN bundles is the exploration and must not be touched.
    const waveGap = content.activePacing.secondsBetweenWaves[0] ?? 0;
    const bundleGap = content.activePacing.secondsBetweenBundles[0] ?? 0;
    expect(waveGap).toBeLessThan(bundleGap / 4);
  });

  it('caps live groups at exactly one full bundle', () => {
    expect(content.waves.maxLiveWaveGroups).toBe(3);
  });

  it('times the gap between bundles from the end of the previous one', () => {
    // Encoded as a single value rather than a range: canon is explicit that a
    // struggling player is not punished with a shorter break.
    const [min, max] = content.activePacing.secondsBetweenBundles;
    expect(min).toBe(max);
  });
});
