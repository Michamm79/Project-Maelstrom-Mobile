/**
 * What happens after the authored bundles run out.
 *
 * content/waves.json holds four composition rows, and the director clamped the
 * bundle index to the last of them - so bundle 4 and bundle 40 were the same
 * fight, forever. That was invisible for as long as Level 5 was unreachable and
 * the cycle never started; it becomes the whole late game the moment it does.
 *
 * Canon's own shape is kept: a bundle is three waves, at most one bundle is
 * alive at once, and the gap is timed from the end of the last one. What
 * escalates is how much arrives and how long the quiet lasts - which is also
 * where the Scythe-bearer stops being a rumour, since canon's "only a few"
 * reads as scarcity rather than as a hard limit of one.
 *
 * Pure, because every one of these is a number that looks plausible while being
 * wrong: a multiplier that compounds past the cap, a gap that shrinks below its
 * floor, a rounding rule that turns "0 to 1 Scythe-bearers" into "always one".
 */

export interface EscalationRules {
  /** Fractional growth added per bundle past the last authored row. */
  growthPerBundle: number;
  /** Hard ceiling on that growth, so a long run stays playable. */
  maxMultiplier: number;
  /** What the gap between bundles is multiplied by, per bundle. */
  gapShrink: number;
  /** The shortest the quiet is ever allowed to get. */
  minSecondsBetweenBundles: number;
  /** Nothing spawns past this many live enemies, however big the roll was. */
  maxLiveEnemies: number;
}

/**
 * How much bigger this bundle is than the row describing it.
 *
 * Linear rather than compounding. Compounding growth reaches any cap you set
 * and then sits on it, which means the difference between bundle 8 and bundle
 * 30 is nothing at all - the opposite of escalation.
 */
export function bundleMultiplier(
  bundleIndex: number,
  authoredRows: number,
  rules: EscalationRules,
): number {
  const past = Math.max(0, bundleIndex - (authoredRows - 1));
  return Math.min(rules.maxMultiplier, 1 + past * rules.growthPerBundle);
}

/**
 * The quiet before the next bundle, in seconds.
 *
 * Shrinks geometrically and stops at the floor. The floor is the point of it:
 * canon spaces bundles roughly half an hour apart because the gap IS the
 * exploration, and an escalation with no floor eventually deletes the half of
 * the game that the world exists for.
 */
export function bundleGap(bundleIndex: number, baseSeconds: number, rules: EscalationRules): number {
  const shrunk = baseSeconds * Math.pow(rules.gapShrink, Math.max(0, bundleIndex));
  return Math.max(rules.minSecondsBetweenBundles, shrunk);
}

/**
 * How many of something a scaled roll produces.
 *
 * Rounds rather than flooring, and holds a zero at zero. That second part is
 * what keeps "0 to 1 Scythe-bearers" meaning what it says: a floor would delete
 * the rare one entirely, and a ceiling would make every wave carry one from the
 * first bundle it appears in.
 */
export function scaledCount(rolled: number, multiplier: number): number {
  if (rolled <= 0) return 0;
  return Math.max(1, Math.round(rolled * multiplier));
}

/** How many more of a roll will actually fit, given what is already alive. */
export function roomFor(wanted: number, alive: number, rules: EscalationRules): number {
  return Math.max(0, Math.min(wanted, rules.maxLiveEnemies - alive));
}
