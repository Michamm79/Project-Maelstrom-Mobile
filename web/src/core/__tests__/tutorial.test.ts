import { describe, expect, it } from 'vitest';
import { content } from '../content';
import {
  advanceTutorial,
  emptyProgress,
  tutorialComplete,
  TUTORIAL_RULES,
  type TutorialProgress,
} from '../tutorial';

const steps = content.tutorial;

describe('tutorial content', () => {
  it('ships a non-empty script', () => {
    expect(steps.length).toBeGreaterThan(0);
  });

  it('gives every step a rule that can complete it', () => {
    for (const step of steps) {
      expect(TUTORIAL_RULES[step.id], `step "${step.id}" has no rule`).toBeTypeOf('function');
    }
  });

  it('has no rule without a step, which would never run', () => {
    const ids = new Set(steps.map((s) => s.id));
    for (const id of Object.keys(TUTORIAL_RULES)) expect(ids.has(id), `rule "${id}"`).toBe(true);
  });

  it('gives every step readable text', () => {
    for (const step of steps) {
      expect(step.title.length).toBeGreaterThan(2);
      expect(step.hint.length).toBeGreaterThan(10);
    }
  });
});

describe('advanceTutorial', () => {
  it('holds on the first step until its rule is met', () => {
    expect(advanceTutorial(steps, 0, emptyProgress())).toBe(0);
  });

  it('advances once the rule is satisfied', () => {
    const progress: TutorialProgress = { ...emptyProgress(), travelled: 500 };
    expect(advanceTutorial(steps, 0, progress)).toBe(1);
  });

  it('skips ahead through everything already done', () => {
    // A player who wandered off and played for a while should not be walked
    // back through steps they have already satisfied several times over.
    const progress: TutorialProgress = {
      travelled: 9000,
      gathered: 6,
      gatheredMoving: 4,
      distinctHeld: 5,
      crafted: 3,
      warned: true,
      struck: 3,
      combinationsUsed: 4,
    };
    expect(advanceTutorial(steps, 0, progress)).toBe(steps.length);
  });

  it('stops at the first unmet rule rather than running to the end', () => {
    const progress: TutorialProgress = { ...emptyProgress(), travelled: 9000, gathered: 1 };
    // move and pull are done; pulling while walking is not.
    expect(advanceTutorial(steps, 0, progress)).toBe(2);
  });

  it('treats a finished or skipped guide as complete', () => {
    expect(tutorialComplete(steps, -1)).toBe(true);
    expect(tutorialComplete(steps, steps.length)).toBe(true);
    expect(tutorialComplete(steps, 0)).toBe(false);
  });

  it('leaves a skipped guide skipped', () => {
    expect(advanceTutorial(steps, -1, emptyProgress())).toBe(-1);
  });

  it('cannot be completed by a thumb resting on the screen', () => {
    const nudge: TutorialProgress = { ...emptyProgress(), travelled: 12 };
    expect(advanceTutorial(steps, 0, nudge)).toBe(0);
  });
});
