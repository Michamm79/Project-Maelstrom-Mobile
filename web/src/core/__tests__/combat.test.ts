/** Combat rules: weapon selection, swing geometry, damage and drops. */
import { describe, expect, it } from 'vitest';
import { content } from '../content';
import { angleDelta, applyDamage, bestWeapon, inSwing, playerDamage, regenFor, rollDrops } from '../combat';

const combat = content.progression.combat;

describe('weapon selection', () => {
  it('picks the strongest weapon carried', () => {
    const best = bestWeapon(content, ['stick', 'flint_knife', 'iron_sword', 'stone']);
    expect(best?.material).toBe('iron_sword');
  });

  it('ignores materials that are not weapons', () => {
    expect(bestWeapon(content, ['stick', 'stone', 'cord'])).toBeNull();
  });

  it('ignores ids the bundle does not define', () => {
    expect(bestWeapon(content, ['not_a_thing'])).toBeNull();
  });

  it('adds the weapon to the base damage', () => {
    const sword = content.material('iron_sword').damage ?? 0;
    expect(playerDamage(content, ['iron_sword'])).toBe(combat.baseDamage + sword);
  });

  it('leaves an unarmed player on base damage alone', () => {
    expect(playerDamage(content, ['stick'])).toBe(combat.baseDamage);
  });

  it('makes every weapon tier a real upgrade', () => {
    const order = ['flint_knife', 'stone_axe', 'bow', 'obsidian_spear', 'iron_sword', 'void_blade'];
    const damages = order.map((id) => content.material(id).damage ?? 0);
    for (let i = 1; i < damages.length; i++) {
      expect(damages[i]!).toBeGreaterThan(damages[i - 1]!);
    }
  });
});

describe('swing geometry', () => {
  const attacker = { x: 0, y: 0, facing: 0 }; // facing +x

  it('hits a target in front and in range', () => {
    expect(inSwing(attacker, { x: combat.attackRange - 5, y: 0 }, combat)).toBe(true);
  });

  it('misses a target beyond range', () => {
    expect(inSwing(attacker, { x: combat.attackRange + 5, y: 0 }, combat)).toBe(false);
  });

  it('misses a target behind the attacker', () => {
    expect(inSwing(attacker, { x: -(combat.attackRange - 5), y: 0 }, combat)).toBe(false);
  });

  it('wraps angles correctly across the PI boundary', () => {
    expect(angleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(-0.2, 5);
    expect(Math.abs(angleDelta(0, Math.PI * 2))).toBeLessThan(1e-9);
  });
});

describe('damage and drops', () => {
  it('clamps at zero and reports a lethal blow', () => {
    const target = { x: 0, y: 0, hp: 5 };
    expect(applyDamage(target, 3)).toBe(false);
    expect(target.hp).toBe(2);
    expect(applyDamage(target, 99)).toBe(true);
    expect(target.hp).toBe(0);
  });

  it('ignores non-positive damage', () => {
    const target = { x: 0, y: 0, hp: 5 };
    expect(applyDamage(target, 0)).toBe(false);
    expect(target.hp).toBe(5);
  });

  it('rolls drops against their chances', () => {
    const drops = [{ material: 'fiber', chance: 0.5 }, { material: 'resin', chance: 0.2 }];
    expect(rollDrops(drops, () => 0.1)).toEqual(['fiber', 'resin']);
    expect(rollDrops(drops, () => 0.3)).toEqual(['fiber']);
    expect(rollDrops(drops, () => 0.9)).toEqual([]);
  });

  it('holds regeneration until the delay has passed', () => {
    expect(regenFor(combat, combat.regenDelaySeconds - 0.1, 1)).toBe(0);
    expect(regenFor(combat, combat.regenDelaySeconds + 0.1, 1)).toBeCloseTo(combat.regenPerSecond, 5);
  });
});

describe('enemy content', () => {
  it('gives every enemy an attack range it will actually close to', () => {
    for (const e of content.enemies) {
      expect(e.attackRange).toBeLessThanOrEqual(e.aggroRadius);
      expect(e.hp).toBeGreaterThan(0);
    }
  });

  it('drops only materials that exist', () => {
    for (const e of content.enemies) {
      for (const d of e.drops) expect(content.hasMaterial(d.material)).toBe(true);
    }
  });

  it('scales enemy difficulty across the regions', () => {
    const order = ['mire_husk', 'pine_stalker', 'ember_wisp', 'deep_crawler', 'rift_shade'];
    const hp = order.map((id) => content.enemy(id).hp);
    for (let i = 1; i < hp.length; i++) expect(hp[i]!).toBeGreaterThan(hp[i - 1]!);
  });

  it('lets a starting player beat a starting enemy unarmed, but slowly', () => {
    const husk = content.enemy('mire_husk');
    const swings = Math.ceil(husk.hp / playerDamage(content, []));
    expect(swings).toBeGreaterThan(3);
    expect(swings).toBeLessThan(10);
  });
});
