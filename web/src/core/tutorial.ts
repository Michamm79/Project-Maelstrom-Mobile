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
  orbsFilled: number;
  transmuted: number;
  enemiesHit: number;
  benchOpened: number;
}

export function emptyProgress(): TutorialProgress {
  return { travelled: 0, gathered: 0, orbsFilled: 0, transmuted: 0, enemiesHit: 0, benchOpened: 0 };
}

/**
 * Roughly two body lengths - far enough that it cannot be satisfied by the
 * drift of a thumb resting on the screen, short enough to not feel like a chore.
 */
const MOVE_DISTANCE = 140;

export const TUTORIAL_RULES: Record<string, (p: TutorialProgress) => boolean> = {
  move: (p) => p.travelled >= MOVE_DISTANCE,
  gather: (p) => p.gathered >= 1,
  fill: (p) => p.orbsFilled >= 2,
  transmute: (p) => p.transmuted >= 1,
  fight: (p) => p.enemiesHit >= 1,
  bench: (p) => p.benchOpened >= 1,
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
