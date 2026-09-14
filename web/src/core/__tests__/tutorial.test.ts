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

/**
 * The guide and the level curve have to agree.
 *
 * Reaching Level 1 is what arms the wave director, and the guide's `warning`
 * card is the one that explains it - so Level 1 must not arrive before the
 * cards that come first. It used to, because the spawn biome was banking 80 XP
 * at the start of every run: three distinct materials then tipped the player
 * into Level 1 during "watch the orbs fill", two cards before the game had said
 * anything about crafting, and the warning landed on a player mid-sentence.
 */
describe('the opening levels in step with the guide', () => {
  const xp = content.progression.xp;
  const levelOneAt = content.progression.xpTable[1] ?? Infinity;

  it('does not reach Level 1 on the materials the carry card asks for', () => {
    // `carry` completes at three distinct materials held.
    expect(xp.firstMaterial * 3).toBeLessThan(levelOneAt);
  });

  it('reaches Level 1 by the time the craft card is done', () => {
    expect(xp.firstMaterial * 3 + xp.firstCraft).toBeGreaterThanOrEqual(levelOneAt);
  });

  it('puts the warning card after the craft card, where Level 1 lands', () => {
    const ids = content.tutorial.map((s) => s.id);
    expect(ids.indexOf('warning')).toBeGreaterThan(ids.indexOf('craft'));
  });

  it('can be finished without leaving the spawn biome', () => {
    const local = content.materials.filter((m) => m.biome === content.spawnBiome.id);
    // Every card up to the warning is satisfied by local material alone.
    expect(local.length).toBeGreaterThanOrEqual(3);
  });
});

/**
 * The waking scene holds the world while it plays, which makes a bad duration a
 * soft lock rather than a cosmetic problem. The build validates these too; this
 * is the same guard from the side that reads them.
 */
describe('the waking scene', () => {
  it('has lines to show', () => {
    expect(content.opening.lines.length).toBeGreaterThan(0);
    for (const line of content.opening.lines) expect(line.trim()).not.toBe('');
  });

  it('withholds why, as canon requires', () => {
    const text = content.opening.lines.join(' ');
    expect(text).toMatch(/nobody explains|no memory|not there before/i);
  });

  it('is over quickly enough that it never reads as a hang', () => {
    expect(content.opening.fadeSeconds).toBeGreaterThan(0);
    expect(content.opening.lineSeconds * content.opening.lines.length).toBeLessThanOrEqual(15);
  });
});
