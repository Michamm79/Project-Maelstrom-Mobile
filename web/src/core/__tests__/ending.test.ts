/**
 * How a run ends, and whether it can.
 *
 * The build had no win condition at all: you reached the top of the curve and
 * then cleared waves until you stopped opening the game. The risk in adding one
 * is not that it crashes - it is that it quietly cannot be reached, which is
 * exactly what had already happened to the Level 5 escalation, and which looks
 * from the outside like a game that simply goes on forever.
 */
import { describe, expect, it } from 'vitest';
import {
  advanceBreach,
  breachBlocked,
  epilogueFor,
  stageIndex,
  type EndingDef,
} from '../ending';
import { content } from '../content';

const ending = content.ending;
const at = (over: Partial<Parameters<typeof breachBlocked>[0]> = {}) => ({
  fromCentre: 6000,
  boundaryRadius: 6083,
  level: 9,
  built: true,
  ...over,
});

describe('whether the boundary will take a pull', () => {
  it('will, standing at the edge with the level and the gauntlet', () => {
    expect(breachBlocked(at(), ending)).toBeNull();
  });

  it('says which of the three is missing, rather than just refusing', () => {
    // Nothing happening at the edge of the world with no explanation is
    // indistinguishable from a bug.
    expect(breachBlocked(at({ level: 1 }), ending)).toBe('level');
    expect(breachBlocked(at({ built: false }), ending)).toBe('recipe');
    expect(breachBlocked(at({ fromCentre: 0 }), ending)).toBe('distance');
  });

  it('reports the level before the distance, so the answer is the useful one', () => {
    expect(breachBlocked(at({ level: 1, fromCentre: 0 }), ending)).toBe('level');
  });
});

describe('the meter', () => {
  const rules = { secondsOfPull: 50, decayPerSecond: 0.006, reach: 300, spawnEverySeconds: [5, 9], pressure: 2 };

  it('fills in the time the content says it does', () => {
    let progress = 0;
    for (let t = 0; t < 50; t += 1 / 60) progress = advanceBreach(progress, 1 / 60, true, rules);
    expect(progress).toBeCloseTo(1, 1);
  });

  it('never goes above full, however long the pull is held', () => {
    let progress = 0;
    for (let t = 0; t < 300; t += 1 / 60) progress = advanceBreach(progress, 1 / 60, true, rules);
    expect(progress).toBe(1);
  });

  it('holds rather than empties when the player breaks off to fight', () => {
    // Twenty seconds of fighting should cost something and not undo the
    // attempt: a meter that emptied would make the only viable play standing
    // still and tanking, which is the least interesting thing the combat does.
    let progress = 0.6;
    for (let t = 0; t < 20; t += 1 / 60) progress = advanceBreach(progress, 1 / 60, false, rules);
    expect(progress).toBeGreaterThan(0.45);
    expect(progress).toBeLessThan(0.6);
  });

  it('never goes below empty', () => {
    let progress = 0.02;
    for (let t = 0; t < 200; t += 1 / 60) progress = advanceBreach(progress, 1 / 60, false, rules);
    expect(progress).toBe(0);
  });

  it('gains faster than it decays, at the numbers that actually ship', () => {
    const real = ending.breach;
    expect(real.decayPerSecond).toBeLessThan(1 / real.secondsOfPull);
  });
});

describe('the stage lines', () => {
  const stages = [{ at: 0, text: 'a' }, { at: 0.5, text: 'b' }, { at: 0.9, text: 'c' }];

  it('are nothing before the first', () => {
    expect(stageIndex(-0.1, stages)).toBe(-1);
  });

  it('advance with the meter', () => {
    expect(stageIndex(0, stages)).toBe(0);
    expect(stageIndex(0.6, stages)).toBe(1);
    expect(stageIndex(1, stages)).toBe(2);
  });

  it('do not move backwards partway through a bracket', () => {
    expect(stageIndex(0.89, stages)).toBe(stageIndex(0.51, stages));
  });
});

describe('which ending you get', () => {
  const table = [
    { minNotes: 0, title: 'none', text: '' },
    { minNotes: 2, title: 'some', text: '' },
    { minNotes: 5, title: 'all', text: '' },
  ];

  it('is the best one the player qualifies for', () => {
    expect(epilogueFor(0, table)?.title).toBe('none');
    expect(epilogueFor(1, table)?.title).toBe('none');
    expect(epilogueFor(2, table)?.title).toBe('some');
    expect(epilogueFor(4, table)?.title).toBe('some');
    expect(epilogueFor(5, table)?.title).toBe('all');
  });

  it('never leaves anyone with nothing, even out of order or over the top', () => {
    expect(epilogueFor(99, table)?.title).toBe('all');
    expect(epilogueFor(3, [...table].reverse())?.title).toBe('some');
  });

  it('covers a player who read none of the rare channel, because that is winnable', () => {
    expect(epilogueFor(0, ending.epilogues)).not.toBeNull();
  });
});

describe('the shipped ending', () => {
  it('is gated on a recipe that exists', () => {
    expect(content.crafting.recipes.some((r) => r.id === ending.requires.recipe)).toBe(true);
  });

  it('is gated on a recipe that needs every region, which is the point of it', () => {
    const recipe = content.crafting.recipes.find((r) => r.id === ending.requires.recipe)!;
    const regions = new Set(Object.keys(recipe.cost).map((id) => content.material(id).biome));
    expect(regions.size).toBe(content.biomes.length);
  });

  it('is gated on a level a run can actually reach', () => {
    const table = content.progression.xpTable;
    const ceiling =
      content.notes.length * content.progression.xp.firstNote +
      content.materials.length * content.progression.xp.firstMaterial +
      content.crafting.recipes.length * content.progression.xp.firstCraft +
      content.alchemy.length * content.progression.xp.firstAlchemy +
      (content.biomes.length - 1) * content.progression.xp.firstBiome;
    expect(table[ending.requires.level]).toBeLessThan(ceiling);
  });

  it('sits at the edge of the world rather than most of the way across it', () => {
    expect(ending.breach.reach).toBeLessThan(content.coliseum.boundaryRadius * 0.1);
  });

  it('gives every stage something to say', () => {
    expect(ending.stages.length).toBeGreaterThan(0);
    for (const stage of ending.stages) expect(stage.text.length).toBeGreaterThan(10);
  });
});

/** A guard against the ending type drifting away from the content that feeds it. */
const _typed: EndingDef = ending;
void _typed;
