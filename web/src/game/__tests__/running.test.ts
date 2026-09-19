/**
 * The run toggle.
 *
 * `sprintSpeed` sat in content/progression.json from the first content pass
 * and was read by nothing: the game moved the player at moveSpeed and had no
 * control that could ask for the other number. Nothing failed - there was
 * simply a second speed in the content that the game had never once used.
 *
 * What makes it a toggle rather than a speed buff is the cost, and the cost is
 * the kind of thing that fails silently in both directions: applied to the
 * wrong radius it makes running the wrong move in a panic, and not applied at
 * all it leaves a button every player turns on in the first minute and never
 * touches again. So these drive real time through the world and check what a
 * creature actually does, rather than asserting on the numbers in the bundle.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { World } from '../world';
import { content } from '../../core/content';

let world: World;

const player = () => content.progression.player;

/** Push the stick due east for a while, at one pace or the other. */
function walkEast(seconds: number, running: boolean, step = 1 / 60): number {
  let strides = 0;
  for (let t = 0; t < seconds; t += step) {
    world.movePlayer(step, 1, 0, running ? player().sprintSpeed : player().moveSpeed, running);
    if (world.player.stepped) strides += 1;
  }
  return strides;
}

beforeEach(() => {
  world = new World(content);
  world.nodes.length = 0;
  world.enemies.length = 0;
  world.player.x = 0;
  world.player.y = 0;
});

describe('the pace', () => {
  it('covers more ground running than walking, in the same time', () => {
    walkEast(1, false);
    const walked = world.player.x;

    world.player.x = 0;
    walkEast(1, true);

    expect(world.player.x).toBeGreaterThan(walked);
    // The ratio is the content's, whatever the content says it is - the point
    // is that the toggle reaches the OTHER authored number and not some third
    // one invented in the movement code.
    expect(world.player.x / walked).toBeCloseTo(player().sprintSpeed / player().moveSpeed, 2);
  });

  it('is a real difference rather than a rounding one', () => {
    // A toggle the player cannot feel is a toggle they will not use. Ten
    // seconds of running should put clear daylight between the two.
    walkEast(10, false);
    const walked = world.player.x;
    world.player.x = 0;
    walkEast(10, true);

    expect(world.player.x - walked).toBeGreaterThan(100);
  });
});

describe('running is something you are doing, not something switched on', () => {
  it('is false while the player stands still with the toggle on', () => {
    world.movePlayer(1 / 60, 0, 0, player().sprintSpeed, true);
    expect(world.player.running).toBe(false);
  });

  it('is true the moment they move with it on', () => {
    world.movePlayer(1 / 60, 1, 0, player().sprintSpeed, true);
    expect(world.player.running).toBe(true);
  });

  it('is false when they move with it off', () => {
    world.movePlayer(1 / 60, 1, 0, player().moveSpeed, false);
    expect(world.player.running).toBe(false);
  });
});

describe('footfalls', () => {
  it('come off the stride, so a run produces more of them per second', () => {
    const walking = walkEast(4, false);
    world.player.x = 0;
    world.player.travelled = 0;
    const running = walkEast(4, true);

    expect(walking).toBeGreaterThan(0);
    expect(running).toBeGreaterThan(walking);
  });

  it('are set for one frame only, so nothing counts a stride twice', () => {
    // Long enough to land a stride, then one more frame with the stick centred.
    walkEast(1, true);
    world.movePlayer(1 / 60, 0, 0, player().moveSpeed, false);
    expect(world.player.stepped).toBe(false);
  });
});

describe('what running costs', () => {
  /** The band between walking's notice radius and running's, at this spot. */
  function band(def: ReturnType<typeof content.enemy>) {
    const cover = world.terrainAt(0, 0).concealment;
    const walking = def.noticeRadius * cover;
    return { walking, running: walking * player().runNoticeScale };
  }

  it('is noticed from further away', () => {
    const def = content.enemy('goblin');
    const { walking, running } = band(def);
    const at = (walking + running) / 2;
    expect(running).toBeGreaterThan(walking);

    // Standing still at that distance: outside the walking radius, so nothing
    // happens however long it stands there.
    const quiet = world.spawn(def, at, 0);
    world.update(1 / 60);
    expect(quiet.aggro).toBe(false);

    // The same distance, running past. The creature is placed fresh each time
    // because a noticed enemy walks at you and the distance stops being the
    // thing under test.
    world.enemies.length = 0;
    const loud = world.spawn(def, at, 0);
    world.movePlayer(1 / 60, 0, 1, player().sprintSpeed, true);
    world.player.x = 0;
    world.player.y = 0;
    world.update(1 / 60);
    expect(loud.aggro).toBe(true);
  });

  it('does not make you harder to lose', () => {
    /*
     * The one that would be wrong in the way that matters.
     *
     * Scaling loseRadius alongside noticeRadius is the obvious symmetric
     * reading and it makes running WORSE at the thing every player will use it
     * for. The control someone grabs while something is chasing them has to
     * do what they expect.
     */
    const def = content.enemy('goblin');
    const enemy = world.spawn(def, 40, 0);
    world.update(1 / 60);
    expect(enemy.aggro).toBe(true);

    /*
     * Held at a distance inside the band, rather than allowed to run out of
     * it. A player who simply sprints away leaves BOTH radii behind within a
     * second or two, so the enemy forgets either way and the test proves
     * nothing - which is exactly what the first version of it did.
     */
    const cover = world.terrainAt(0, 0).concealment;
    const walking = def.loseRadius * cover;
    const at = (walking + walking * player().runNoticeScale) / 2;
    expect(at).toBeGreaterThan(walking);

    for (let t = 0; t < def.forgetSeconds + 1; t += 1 / 60) {
      // Running - and then pinned, so the geometry stays the thing under test
      // and neither the player's pace nor the goblin's pursuit can move it.
      world.movePlayer(1 / 60, -1, 0, player().sprintSpeed, true);
      world.player.x = -at;
      world.player.y = 0;
      enemy.x = 0;
      enemy.y = 0;
      world.update(1 / 60);
    }

    expect(world.player.running).toBe(true);
    expect(enemy.aggro).toBe(false);
  });

  it('is beaten outright by a veil, which is dampening and not stealth', () => {
    const def = content.enemy('goblin');
    const { walking, running } = band(def);
    const enemy = world.spawn(def, (walking + running) / 2, 0);

    world.player.status.hidden = 5;
    world.movePlayer(1 / 60, 0, 1, player().sprintSpeed, true);
    world.player.x = 0;
    world.player.y = 0;
    world.update(1 / 60);

    expect(world.player.running).toBe(true);
    expect(enemy.aggro).toBe(false);
  });
});

describe('the content the toggle depends on', () => {
  it('has a run that is faster than the walk', () => {
    expect(player().sprintSpeed).toBeGreaterThan(player().moveSpeed);
  });

  it('charges something for it, or there is no reason to turn it off', () => {
    expect(player().runNoticeScale).toBeGreaterThan(1);
  });
});
