/**
 * What the system decides about you while you are not looking.
 *
 * GDD section 10: the player is read continuously, and what it reads grants a
 * rune at Level 2 and a class at Level 5. Neither is ever chosen from a menu -
 * canon is specific that the player is assessed rather than asked, which is the
 * same joke the bulletins are telling and the reason this system belongs to the
 * setting rather than being a character sheet with the lid on.
 *
 * Canon warns this cannot be retrofitted, because the rune reads the tutorial
 * period as roughly half its evidence. That is a warning about WHEN the data
 * starts existing, not about the grant - so the reading starts on the first
 * frame of a run, the tutorial period is banked the moment the rune lands, and
 * the class read weights that banked period at exactly half against everything
 * since. `blend` below is that sentence in arithmetic.
 *
 * Pure, and worth it: a profile that does not normalise reads a two-hour run
 * and a ten-minute one completely differently, an archetype match that does not
 * handle an all-zero profile hands a brand new player whichever one happens to
 * be first in the file, and neither failure looks like anything.
 */

export interface ArchetypeDef {
  id: string;
  name: string;
  /** The rune's own name, granted at the earlier level. */
  rune: string;
  leans: Readonly<Record<string, number>>;
  runeGrants: ArchetypeGrants;
  classGrants: ArchetypeGrants;
  runeDescription: string;
  description: string;
}

/**
 * What an archetype changes. Every field is optional and absent means "no
 * opinion", so a rune and a class merge by taking whichever one speaks.
 */
export interface ArchetypeGrants {
  /** Added to the basic attack's combo ceiling. */
  comboMax?: number;
  /** Multiplies the per-hit combo bonus. */
  comboBonus?: number;
  /** Multiplies basic attack damage. Below 1 for Nahaste, which is canon's own cost. */
  strikeScale?: number;
  /** Multiplies combination damage. */
  castScale?: number;
  /** Multiplies cooldowns. Below 1 is faster. */
  cooldownScale?: number;
  /** Dotore: seconds of not swinging to reach a full charge. */
  chargeSeconds?: number;
  /** Dotore: fraction added to the next blow at full charge. */
  chargeBonus?: number;
}

export interface ArchetypeConfig {
  runeLevel: number;
  tutorialWeight: number;
  signals: readonly string[];
  archetypes: readonly ArchetypeDef[];
}

/** Raw counters, in whatever units each one naturally has. */
export type Reading = Record<string, number>;

export function emptyReading(signals: readonly string[]): Reading {
  const out: Reading = {};
  for (const signal of signals) out[signal] = 0;
  return out;
}

/**
 * A profile that sums to 1, or all zeroes for a player who has done nothing.
 *
 * Normalised because the raw counters are in incompatible units - steps against
 * swings against notes - and because a two-hour run and a ten-minute one should
 * describe the same person if they were played the same way.
 *
 * Each signal is first divided by its own `scale`, which is what stops "walked
 * 40,000 units" drowning out "cast eleven times" purely by being counted in
 * smaller pieces.
 */
export function profile(reading: Reading, scales: Readonly<Record<string, number>>): Reading {
  const scaled: Reading = {};
  let total = 0;
  for (const [signal, value] of Object.entries(reading)) {
    const unit = Math.max(1e-6, scales[signal] ?? 1);
    const amount = Math.max(0, value) / unit;
    scaled[signal] = amount;
    total += amount;
  }
  if (total <= 0) return scaled;
  for (const signal of Object.keys(scaled)) scaled[signal] = (scaled[signal] ?? 0) / total;
  return scaled;
}

/**
 * Two profiles, weighted. `weight` is the share given to the first.
 *
 * This is canon's "the tutorial period is roughly half its evidence", and it is
 * a separate function so that sentence has somewhere to be tested.
 */
export function blend(early: Reading, late: Reading, weight: number): Reading {
  const w = Math.min(1, Math.max(0, weight));
  const out: Reading = {};
  for (const signal of new Set([...Object.keys(early), ...Object.keys(late)])) {
    out[signal] = (early[signal] ?? 0) * w + (late[signal] ?? 0) * (1 - w);
  }
  return out;
}

/**
 * Which archetype a profile reads as.
 *
 * Scored on how far each signal sits from an even share of the seven, not on
 * the raw share. That is the difference between a read and a horoscope, and it
 * was measured rather than reasoned about: with raw shares, a realistic run
 * through the opening returned the same archetype for a player who fought, a
 * player who cast, a player who explored and a player who only gathered. Every
 * one of them was Dotore, because the signals a normal player accumulates most
 * of are the ones Dotore leans on, and the winner was decided before anybody
 * had done anything distinctive.
 *
 * Centred, an average player scores near zero on everything and the read is
 * decided by whatever they actually did more of than the rest.
 *
 * An all-zero profile - somebody who has genuinely done nothing - returns null
 * rather than whichever archetype happens to be first in the file, because
 * being told the system has already decided something about you before you
 * have done anything is worse than being told nothing.
 */
export function readArchetype(
  reading: Reading,
  archetypes: readonly ArchetypeDef[],
): ArchetypeDef | null {
  const signals = Object.keys(reading);
  let any = false;
  for (const value of Object.values(reading)) if (value > 0) any = true;
  if (!any || !archetypes.length || !signals.length) return null;

  const even = 1 / signals.length;
  let best: ArchetypeDef | null = null;
  let bestScore = -Infinity;
  for (const archetype of archetypes) {
    let score = 0;
    for (const [signal, weight] of Object.entries(archetype.leans)) {
      score += ((reading[signal] ?? 0) - even) * weight;
    }
    if (score > bestScore) {
      bestScore = score;
      best = archetype;
    }
  }
  return best;
}

/**
 * The rune's grants and the class's, as one set of numbers.
 *
 * Later entries win field by field rather than replacing wholesale, so a class
 * that only speaks about cooldowns leaves the rune's charge alone. That matters
 * because the two can be different archetypes: the rune reads the tutorial and
 * the class reads the run, and a player whose play changed will hold one of
 * each. Canon never says they have to agree.
 */
export function mergeGrants(...grants: (ArchetypeGrants | null | undefined)[]): ArchetypeGrants {
  const out: ArchetypeGrants = {};
  for (const grant of grants) {
    if (!grant) continue;
    for (const [key, value] of Object.entries(grant)) {
      if (value !== undefined) (out as Record<string, number>)[key] = value;
    }
  }
  return out;
}
