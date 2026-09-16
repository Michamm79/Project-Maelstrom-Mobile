/**
 * How a run ends.
 *
 * There was no win condition anywhere in the build. A player reached the top of
 * the level curve and then cleared waves until they stopped opening the game,
 * which is not an ending, it is a place where one should have been.
 *
 * The one built here is deliberately made out of systems that already exist
 * rather than bolted to the end of them. It needs the escalation level, so it
 * needs progression. It needs a recipe costing material from all five regions,
 * so it needs the gathering loop and the travel the world is shaped around. It
 * is performed with the PULL, which is canon's core verb rather than something
 * invented for a finale. And how it reads afterwards depends on how much of the
 * rare note channel the player found.
 *
 * Everything here is pure arithmetic, because the failure modes are all quiet:
 * a breach that can be started from the middle of the map, a meter that empties
 * faster than it fills, or an epilogue table with a hole in it that hands a
 * player who did everything nothing at all.
 */

export interface EndingRequirements {
  level: number;
  recipe: string;
}

export interface BreachRules {
  secondsOfPull: number;
  /** Fraction of the meter lost per second while the pull is off. */
  decayPerSecond: number;
  /** How close to the boundary the player has to be standing, in world units. */
  reach: number;
  spawnEverySeconds: readonly number[];
  pressure: number;
}

export interface EndingStage {
  at: number;
  text: string;
}

export interface Epilogue {
  minNotes: number;
  title: string;
  text: string;
}

export interface EndingDef {
  requires: EndingRequirements;
  breach: BreachRules;
  stages: readonly EndingStage[];
  epilogues: readonly Epilogue[];
}

export type BreachBlock = 'level' | 'recipe' | 'distance' | null;

export interface BreachStanding {
  /** Distance from the centre of the Coliseum, in world units. */
  fromCentre: number;
  boundaryRadius: number;
  level: number;
  built: boolean;
}

/**
 * Why the boundary will not take a pull, or null when it will.
 *
 * Returns the reason rather than a boolean so the HUD can say which of the
 * three it is. "Nothing happens" at the edge of the world, with no explanation,
 * is indistinguishable from a bug - and a player who has walked all the way out
 * there has earned a sentence.
 */
export function breachBlocked(standing: BreachStanding, ending: EndingDef): BreachBlock {
  if (standing.level < ending.requires.level) return 'level';
  if (!standing.built) return 'recipe';
  if (standing.boundaryRadius - standing.fromCentre > ending.breach.reach) return 'distance';
  return null;
}

/**
 * Advance the meter by one frame.
 *
 * Progress is HELD rather than lost when the pull comes off, and decays only
 * slowly. The intended shape is pull, break off to fight, come back - a meter
 * that emptied would make the only viable play standing still and tanking,
 * which is the least interesting thing the combat can do.
 */
export function advanceBreach(
  progress: number,
  dt: number,
  pulling: boolean,
  rules: BreachRules,
): number {
  if (pulling) {
    const step = dt / Math.max(0.1, rules.secondsOfPull);
    return Math.min(1, progress + step);
  }
  return Math.max(0, progress - rules.decayPerSecond * dt);
}

/**
 * The index of the last stage the meter has passed, or -1 before the first.
 *
 * An index rather than the stage itself, so the caller can tell "still on
 * stage 2" from "has just reached stage 2" without keeping a copy of the text
 * to compare against.
 */
export function stageIndex(progress: number, stages: readonly EndingStage[]): number {
  let index = -1;
  for (let i = 0; i < stages.length; i++) {
    if (progress >= (stages[i]?.at ?? Infinity)) index = i;
  }
  return index;
}

/**
 * Which ending the player gets, for the number of rare notes they hold.
 *
 * The highest entry they qualify for. Falls back to the first in the table
 * rather than to nothing, because an epilogue table with a hole in it would
 * end the game on a blank screen for whoever fell in it.
 */
export function epilogueFor(notesFound: number, epilogues: readonly Epilogue[]): Epilogue | null {
  let best: Epilogue | null = null;
  for (const entry of epilogues) {
    if (notesFound >= entry.minNotes && (!best || entry.minNotes > best.minNotes)) best = entry;
  }
  return best ?? epilogues[0] ?? null;
}
