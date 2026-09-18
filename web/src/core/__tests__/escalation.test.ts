/**
 * What happens after the authored bundles run out.
 *
 * The director clamped the bundle index to the last composition row, so bundle
 * 4 and bundle 40 were the same fight. That is invisible in a build where the
 * level gating the cycle is unreachable, and it is the entire late game in one
 * where it is not.
 */
import { describe, expect, it } from 'vitest';
import { bundleGap, bundleMultiplier, roomFor, scaledCount } from '../escalation';
import { content } from '../content';

const rules = {
  growthPerBundle: 0.2,
  maxMultiplier: 2,
  gapShrink: 0.9,
  minSecondsBetweenBundles: 400,
  maxLiveEnemies: 30,
};

describe('bundle size', () => {
  it('leaves the authored rows exactly as authored', () => {
    for (let i = 0; i < 4; i++) expect(bundleMultiplier(i, 4, rules)).toBe(1);
  });

  it('grows once the table runs out', () => {
    expect(bundleMultiplier(4, 4, rules)).toBeCloseTo(1.2);
    expect(bundleMultiplier(5, 4, rules)).toBeCloseTo(1.4);
  });

  it('grows linearly rather than compounding', () => {
    // Compounding hits any cap you set and then sits on it, which makes the
    // difference between bundle 8 and bundle 30 nothing at all. Measured
    // under a cap high enough to be out of the way - at the shipped cap of 2
    // both of these later steps are zero, which would pass for the wrong
    // reason.
    const uncapped = { ...rules, maxMultiplier: 99 };
    const early = bundleMultiplier(6, 4, uncapped) - bundleMultiplier(5, 4, uncapped);
    const late = bundleMultiplier(29, 4, uncapped) - bundleMultiplier(28, 4, uncapped);
    expect(early).toBeCloseTo(0.2);
    expect(late).toBeCloseTo(early);
  });

  it('stops at the cap', () => {
    expect(bundleMultiplier(500, 4, rules)).toBe(2);
  });
});

describe('the quiet between bundles', () => {
  it('starts at the authored gap', () => {
    expect(bundleGap(0, 1200, rules)).toBeCloseTo(1200);
  });

  it('shortens as the cycle wears on', () => {
    expect(bundleGap(3, 1200, rules)).toBeLessThan(bundleGap(1, 1200, rules));
  });

  it('never goes below the floor, because the gap is the exploration', () => {
    expect(bundleGap(999, 1200, rules)).toBe(400);
  });
});

describe('scaling a roll', () => {
  it('keeps a zero at zero, so the rare tier stays rare', () => {
    // "0 to 1 Scythe-bearers" has to keep meaning that. Rounding up would put
    // one in every wave from the moment they appear.
    expect(scaledCount(0, 2.2)).toBe(0);
  });

  it('never rounds a real roll away to nothing', () => {
    expect(scaledCount(1, 0.2)).toBe(1);
  });

  it('scales the rest', () => {
    expect(scaledCount(5, 2)).toBe(10);
    expect(scaledCount(7, 1.18)).toBe(8);
  });
});

describe('the live cap', () => {
  it('honours the roll while there is room', () => {
    expect(roomFor(8, 10, rules)).toBe(8);
  });

  it('spawns only what fits', () => {
    expect(roomFor(8, 26, rules)).toBe(4);
  });

  it('never returns a negative, even over the cap', () => {
    expect(roomFor(8, 90, rules)).toBe(0);
  });
});

describe('the shipped numbers', () => {
  const esc = content.waves.escalation;

  it('let a late bundle be meaningfully bigger than the last authored one', () => {
    const rows = content.waves.composition.length;
    expect(bundleMultiplier(rows + 5, rows, esc)).toBeGreaterThan(1.5);
  });

  it('keep the quiet long enough to cross the Coliseum in', () => {
    // Canon's own travel figures: spawn to a biome edge is 30-35 seconds
    // walking, so the floor has to leave room for a round trip and then some.
    const walk = content.coliseum.travelSeconds.walk;
    const roundTrip = (walk[1] ?? 35) * 2;
    expect(esc.minSecondsBetweenBundles).toBeGreaterThan(roundTrip * 3);
  });
});
