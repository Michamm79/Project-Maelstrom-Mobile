/**
 * What the system decides about you while you are not looking.
 *
 * Canon reads the player continuously and grants a rune at Level 2 and a class
 * at Level 5, neither ever chosen from a menu. The failures are all silent: a
 * profile that does not normalise reads a two-hour run and a ten-minute one as
 * different people; one that does not scale reads everybody as whichever
 * signal is counted in the smallest units; and a read that cannot handle an
 * empty profile hands a brand new player whichever archetype is first in the
 * file.
 */
import { describe, expect, it } from 'vitest';
import {
  blend,
  emptyReading,
  mergeGrants,
  profile,
  readArchetype,
  type ArchetypeDef,
} from '../telemetry';
import { content } from '../content';

const config = content.archetypes;
const scales = config.scales;

/** A reading with everything at zero except what is named. */
function played(parts: Record<string, number>) {
  return { ...emptyReading(config.signals), ...parts };
}

describe('the profile', () => {
  it('sums to one, so a long run and a short one describe the same person', () => {
    const short = profile(played({ aggression: 60, roaming: 26000 }), scales);
    const long = profile(played({ aggression: 600, roaming: 260000 }), scales);
    for (const signal of config.signals) {
      expect(short[signal]).toBeCloseTo(long[signal] ?? 0, 5);
    }
  });

  it('scales each signal, so walking does not drown out casting', () => {
    // 26,000 units walked and 12 casts are one unit of evidence each. Without
    // scaling the raw numbers make everybody a wanderer by a factor of 2000.
    const p = profile(played({ roaming: 26000, alchemy: 12 }), scales);
    expect(p.roaming).toBeCloseTo(0.5, 2);
    expect(p.alchemy).toBeCloseTo(0.5, 2);
  });

  it('stays all zeroes for somebody who has done nothing', () => {
    const p = profile(emptyReading(config.signals), scales);
    expect(Object.values(p).every((v) => v === 0)).toBe(true);
  });

  it('ignores a negative counter rather than inverting the profile', () => {
    const p = profile(played({ aggression: 60, risk: -9999 }), scales);
    expect(p.aggression).toBe(1);
    expect(p.risk).toBe(0);
  });
});

describe('the two periods', () => {
  it('weights the earlier one at the share it is given', () => {
    const early = { aggression: 1, patience: 0 };
    const late = { aggression: 0, patience: 1 };
    expect(blend(early, late, 0.5)).toEqual({ aggression: 0.5, patience: 0.5 });
  });

  it('is canon’s "roughly half its evidence" at the shipped weight', () => {
    expect(config.tutorialWeight).toBeGreaterThan(0.3);
    expect(config.tutorialWeight).toBeLessThan(0.7);
  });

  it('clamps a nonsense weight instead of producing a nonsense profile', () => {
    expect(blend({ a: 1 }, { a: 0 }, 5).a).toBe(1);
    expect(blend({ a: 1 }, { a: 0 }, -5).a).toBe(0);
  });
});

describe('the read', () => {
  const archetypes = config.archetypes as readonly ArchetypeDef[];

  it('decides nothing about somebody who has done nothing', () => {
    // Being told the system has already made up its mind about you before you
    // have done anything is worse than being told nothing.
    expect(readArchetype(emptyReading(config.signals), archetypes)).toBeNull();
  });

  it('reads somebody who only ever swings as Amorratua', () => {
    const p = profile(played({ aggression: 400, risk: 300 }), scales);
    expect(readArchetype(p, archetypes)?.id).toBe('amorratua');
  });

  it('reads somebody who gathers and casts as Nahaste', () => {
    const p = profile(played({ alchemy: 60, gathering: 300, curiosity: 30 }), scales);
    expect(readArchetype(p, archetypes)?.id).toBe('nahaste');
  });

  it('reads somebody who walks and waits as Dotore', () => {
    const p = profile(played({ patience: 1400, roaming: 80000, gathering: 60 }), scales);
    expect(readArchetype(p, archetypes)?.id).toBe('dotore');
  });

  it('can be read as all three, which is the only thing that makes it a read', () => {
    const outcomes = new Set(
      [
        played({ aggression: 400, risk: 300 }),
        played({ alchemy: 60, gathering: 300 }),
        played({ patience: 1400, roaming: 80000 }),
      ].map((r) => readArchetype(profile(r, scales), archetypes)?.id),
    );
    expect(outcomes.size).toBe(3);
  });

  it('survives an archetype list with nothing in it', () => {
    expect(readArchetype(profile(played({ aggression: 9 }), scales), [])).toBeNull();
  });
});

describe('merging what the rune and the class grant', () => {
  it('lets the later one win field by field', () => {
    expect(mergeGrants({ comboMax: 2, chargeSeconds: 3 }, { comboMax: 5 })).toEqual({
      comboMax: 5,
      chargeSeconds: 3,
    });
  });

  it('keeps the rune whole when the class says nothing', () => {
    expect(mergeGrants({ comboMax: 2 }, null)).toEqual({ comboMax: 2 });
  });

  it('is empty when nothing has been granted yet', () => {
    expect(mergeGrants(null, undefined)).toEqual({});
  });
});

describe('the shipped archetypes', () => {
  it('are the three GDD section 9 names', () => {
    expect(config.archetypes.map((a) => a.id).sort()).toEqual(['amorratua', 'dotore', 'nahaste']);
  });

  it('give Nahaste the unarmed cost canon states outright', () => {
    const nahaste = config.archetypes.find((a) => a.id === 'nahaste')!;
    expect(nahaste.classGrants.strikeScale).toBeLessThan(1);
    expect(nahaste.classGrants.castScale).toBeGreaterThan(1);
  });

  it('give Amorratua the combo and Dotore the charge', () => {
    const amorratua = config.archetypes.find((a) => a.id === 'amorratua')!;
    const dotore = config.archetypes.find((a) => a.id === 'dotore')!;
    expect(amorratua.classGrants.comboMax).toBeGreaterThan(0);
    expect(dotore.classGrants.chargeBonus).toBeGreaterThan(0);
    expect(dotore.classGrants.chargeSeconds).toBeGreaterThan(0);
  });

  it('land at the two levels canon names, and not a third', () => {
    expect(config.runeLevel).toBe(content.progression.alchemyUnlockLevel);
    expect(content.progression.classLevel).toBeGreaterThan(config.runeLevel);
  });
});
