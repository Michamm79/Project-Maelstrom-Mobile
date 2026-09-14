/**
 * The opening guide.
 *
 * Every step is completed by playing, never by pressing "next": the rules below
 * read a running tally of what the player has actually done. Step text lives in
 * content/tutorial.json so it travels with the rest of the content, and the
 * build refuses to emit a bundle whose step ids do not match the rules here.
 */
import type { TutorialStep } from './types';

/** What the guide watches. The Game keeps this up to date from world events. */
export interface TutorialProgress {
  /** World units walked since the guide began. */
  travelled: number;
  gathered: number;
  /** Pulls that landed while the player was actually moving. */
  gatheredMoving: number;
  /** Distinct materials held - the orbs are a display of this. */
  distinctHeld: number;
  crafted: number;
  warned: boolean;
  /** Basic-attack hits landed. */
  struck: number;
  combinationsUsed: number;
}

export function emptyProgress(): TutorialProgress {
  return {
    travelled: 0,
    gathered: 0,
    gatheredMoving: 0,
    distinctHeld: 0,
    crafted: 0,
    warned: false,
    struck: 0,
    combinationsUsed: 0,
  };
}

/**
 * Roughly two body lengths - far enough that it cannot be satisfied by the
 * drift of a thumb resting on the screen, short enough to not feel like a chore.
 */
const MOVE_DISTANCE = 140;

export const TUTORIAL_RULES: Record<string, (p: TutorialProgress) => boolean> = {
  move: (p) => p.travelled >= MOVE_DISTANCE,
  pull: (p) => p.gathered >= 1,
  // Canon's load-bearing rule: the pull has to work without stopping. The guide
  // asks for it explicitly rather than hoping the player discovers it, because
  // a player who learns to stop for every node has learned the wrong game.
  pull_moving: (p) => p.gatheredMoving >= 2,
  carry: (p) => p.distinctHeld >= 3,
  craft: (p) => p.crafted >= 1,
  warning: (p) => p.warned,
  strike: (p) => p.struck >= 1,
  combine: (p) => p.combinationsUsed >= 1,
};

/** True once the step index is past the end of the script. */
export function tutorialComplete(steps: readonly TutorialStep[], step: number): boolean {
  return step < 0 || step >= steps.length;
}

/**
 * Advance past every step whose rule is already satisfied, so a player who
 * happens to gather twice before reading the second card does not have to
 * repeat themselves.
 */
export function advanceTutorial(
  steps: readonly TutorialStep[],
  step: number,
  progress: TutorialProgress,
): number {
  let next = step;
  while (next >= 0 && next < steps.length) {
    const current = steps[next];
    if (!current) break;
    const rule = TUTORIAL_RULES[current.id];
    if (!rule || !rule(progress)) break;
    next += 1;
  }
  return next;
}
