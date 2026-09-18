/**
 * The wider effect vocabulary.
 *
 * Seven of canon's ten elements had no combination at all, and giving them one
 * meant teaching the engine four things it could not previously express: a
 * charge that travels between targets, a cast that lands on nobody, a slow, and
 * a shield. Every one of those fails silently when it is wrong - a chain that
 * revisits a target it has already hit still looks like lightning, a self-cast
 * that resolves as "caught nobody, did nothing" still plays its sound and
 * starts its cooldown - so they are asserted here rather than looked at.
 */
import { describe, expect, it } from 'vitest';
import { abilityTargets } from '../combat';
import { absorbDamage, beginHeal, freshStatus, raiseShield, tickStatus } from '../status';
import type { AlchemyCombination } from '../types';

interface Dummy {
  name: string;
  x: number;
  y: number;
  hp: number;
  dead: boolean;
}

const dummy = (name: string, x: number, y: number, dead = false): Dummy => ({
  name,
  x,
  y,
  hp: 100,
  dead,
});

function ability(effect: Partial<AlchemyCombination['effect']>): AlchemyCombination {
  return {
    id: 'test',
    name: 'Test',
    description: '',
    elements: {},
    cooldownSeconds: 1,
    effect: { kind: 'burst', damage: 10, knockback: 0, ...effect } as AlchemyCombination['effect'],
  };
}

describe('a chain', () => {
  const chain = ability({ kind: 'chain', damage: 100, range: 100, radius: 60, jumps: 3 });

  it('starts at the nearest thing inside range, not the first in the list', () => {
    const far = dummy('far', 90, 0);
    const near = dummy('near', 20, 0);
    const hits = abilityTargets(chain, 0, 0, 0, [far, near]);
    expect(hits[0]?.target.name).toBe('near');
  });

  it('walks outward from each target rather than from the caster', () => {
    // Each link is 50 apart, so the whole run is 200 units long - twice the
    // range the first link had. A chain measured from the caster would stop
    // at the second.
    const line = [dummy('a', 50, 0), dummy('b', 100, 0), dummy('c', 150, 0), dummy('d', 200, 0)];
    const hits = abilityTargets(chain, 0, 0, 0, line);
    expect(hits.map((h) => h.target.name)).toEqual(['a', 'b', 'c', 'd']);
  });

  it('loses a quarter of its damage at every leap', () => {
    const line = [dummy('a', 50, 0), dummy('b', 100, 0), dummy('c', 150, 0)];
    const hits = abilityTargets(chain, 0, 0, 0, line);
    expect(hits.map((h) => Math.round(h.damage))).toEqual([100, 75, 56]);
  });

  it('never returns to a target it has already hit', () => {
    // Two targets and three jumps: a chain that could revisit would bounce
    // between them for the full four links.
    const hits = abilityTargets(chain, 0, 0, 0, [dummy('a', 40, 0), dummy('b', 70, 0)]);
    expect(hits).toHaveLength(2);
  });

  it('stops where the next leap would be too far', () => {
    const hits = abilityTargets(chain, 0, 0, 0, [dummy('a', 40, 0), dummy('b', 140, 0)]);
    expect(hits.map((h) => h.target.name)).toEqual(['a']);
  });

  it('catches nothing at all when the first link cannot reach', () => {
    expect(abilityTargets(chain, 0, 0, 0, [dummy('a', 400, 0)])).toEqual([]);
  });

  it('skips the dead on its way past them', () => {
    const hits = abilityTargets(chain, 0, 0, 0, [dummy('corpse', 30, 0, true), dummy('live', 60, 0)]);
    expect(hits.map((h) => h.target.name)).toEqual(['live']);
  });

  it('pushes each target away from the link before it, not away from the caster', () => {
    /*
     * a is due east of the caster and b is due north of a. So conduction
     * pushes b straight north - pushX of 0 - while a chain that measured from
     * the player would push it north-EAST, at a pushX of about 0.78. The two
     * are only distinguishable on this axis, which is why the case is built
     * as a right angle rather than as a line.
     */
    const hits = abilityTargets(chain, 0, 0, 0, [dummy('a', 50, 0), dummy('b', 50, 40)]);
    expect(hits.map((h) => h.target.name)).toEqual(['a', 'b']);
    expect(hits[1]?.pushX).toBeCloseTo(0);
    expect(hits[1]?.pushY).toBeCloseTo(1);
  });
});

describe('a self-cast', () => {
  it('catches nobody, even when it is given a radius', () => {
    const veil = ability({ kind: 'self', damage: 0, radius: 900 });
    expect(abilityTargets(veil, 0, 0, 0, [dummy('right here', 0, 0)])).toEqual([]);
  });
});

describe('a shield', () => {
  it('soaks what it can and lets the rest land', () => {
    const status = freshStatus();
    raiseShield(status, 10, 5);
    expect(absorbDamage(status, 26)).toEqual({ soaked: 10, through: 16 });
  });

  it('is not all-or-nothing: an 11-point hit on a 10-point shield is not ignored', () => {
    const status = freshStatus();
    raiseShield(status, 10, 5);
    absorbDamage(status, 11);
    expect(status.shield).toBe(0);
  });

  it('lapses with its timer rather than lingering as an invisible buffer', () => {
    const status = freshStatus();
    raiseShield(status, 40, 2);
    tickStatus(status, 3);
    expect(status.shield).toBe(0);
    expect(absorbDamage(status, 10).through).toBe(10);
  });

  it('refreshes the clock rather than downgrading when a weaker one is cast', () => {
    const status = freshStatus();
    raiseShield(status, 40, 2);
    raiseShield(status, 5, 12);
    expect(status.shield).toBe(40);
    expect(status.shieldFor).toBe(12);
  });

  it('clears its own timer the moment it is spent', () => {
    const status = freshStatus();
    raiseShield(status, 10, 12);
    absorbDamage(status, 10);
    expect(status.shieldFor).toBe(0);
  });
});

describe('a heal', () => {
  it('pays out evenly over its duration and then stops', () => {
    const status = freshStatus();
    beginHeal(status, 30, 6);
    expect(tickStatus(status, 1)).toBeCloseTo(5);
    let total = 5;
    for (let i = 0; i < 100; i++) total += tickStatus(status, 0.5);
    expect(total).toBeCloseTo(30);
  });

  it('never pays more than it owes, however long the frame was', () => {
    const status = freshStatus();
    beginHeal(status, 30, 6);
    expect(tickStatus(status, 999)).toBeCloseTo(30);
  });

  it('rolls what is still owed into a second cast rather than discarding it', () => {
    const status = freshStatus();
    beginHeal(status, 30, 6);
    tickStatus(status, 3);
    beginHeal(status, 30, 6);
    expect(status.healLeft).toBeCloseTo(45);
  });
});

describe('the timers that decide what can see you', () => {
  it('run down and stay at zero', () => {
    const status = freshStatus();
    status.hidden = 1;
    status.revealed = 0.5;
    tickStatus(status, 2);
    expect(status.hidden).toBe(0);
    expect(status.revealed).toBe(0);
  });
});
