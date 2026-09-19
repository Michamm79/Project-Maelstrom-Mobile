/**
 * The pull is the verb, and canon states the rule the whole world shape depends
 * on: it must work at walking pace, with no stopping, no precise aim and no
 * charge-up, implemented as a radius overlap rather than a trace from a
 * crosshair. These tests exist so that rule cannot quietly regress.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { World } from '../world';
import { content } from '../../core/content';

const RADIUS = 50;
const SECONDS = 0.45;

let world: World;

/** Put one node at a known offset from the player and clear everything else. */
function onlyNodeAt(dx: number, dy: number, material = 'loamstone'): void {
  world.nodes.length = 0;
  world.nodes.push({
    id: 0,
    material,
    biome: 'plains_forest',
    x: world.player.x + dx,
    y: world.player.y + dy,
    available: true,
    respawnAt: 0,
    phase: 0,
    scale: 1,
    pull: 0,
    pullX: 0,
    pullY: 0,
    pullAngle: 0,
    pullDistance: 0,
  });
}

/** Run the pull to completion, optionally walking the whole time. */
function pullFor(seconds: number, opts: { moving?: boolean; space?: number } = {}): void {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    if (opts.moving) world.movePlayer(dt, 1, 0, content.progression.player.moveSpeed);
    world.updatePull(dt, true, RADIUS, SECONDS, opts.space ?? 60);
    world.update(dt);
  }
}

beforeEach(() => {
  world = new World(content);
  world.enemies.length = 0;
});

describe('the pull', () => {
  it('takes a node that is simply nearby', () => {
    onlyNodeAt(20, 0);
    pullFor(SECONDS + 0.1);
    expect(world.nodes[0]?.available).toBe(false);
  });

  it('works while walking - the rule the world shape depends on', () => {
    onlyNodeAt(0, 18);
    const startX = world.player.x;
    pullFor(SECONDS + 0.1, { moving: true });
    expect(world.player.x).toBeGreaterThan(startX + 10);
    expect(world.nodes[0]?.available).toBe(false);
  });

  it('does not care which way the player is facing', () => {
    onlyNodeAt(0, -25);
    world.faceToward(world.player.x, world.player.y + 100); // look the other way
    pullFor(SECONDS + 0.1);
    expect(world.nodes[0]?.available).toBe(false);
  });

  it('ignores anything outside the radius', () => {
    onlyNodeAt(RADIUS + 30, 0);
    pullFor(SECONDS + 0.2);
    expect(world.nodes[0]?.available).toBe(true);
    expect(world.nodes[0]?.pull).toBe(0);
  });

  it('reaches further once the aperture has been widened', () => {
    onlyNodeAt(RADIUS + 30, 0);
    const dt = 1 / 60;
    for (let t = 0; t < SECONDS + 0.2; t += dt) {
      world.updatePull(dt, true, RADIUS + 60, SECONDS, 60);
      world.update(dt);
    }
    expect(world.nodes[0]?.available).toBe(false);
  });

  it('spirals inward rather than snapping', () => {
    onlyNodeAt(40, 0);
    const dt = 1 / 60;
    const seen: number[] = [];
    for (let t = 0; t < SECONDS * 0.9; t += dt) {
      world.updatePull(dt, true, RADIUS, SECONDS, 60);
      const node = world.nodes[0];
      if (node && node.pull > 0) {
        const p = world.pullPosition(node);
        seen.push(Math.hypot(p.x - world.player.x, p.y - world.player.y));
      }
      world.update(dt);
    }
    expect(seen.length).toBeGreaterThan(10);
    // Distance closes monotonically, but the path is not the straight line
    // between the two points - the angle keeps turning.
    expect(seen[0]).toBeGreaterThan(seen[seen.length - 1]!);
    const mid = world.nodes[0]!;
    expect(mid.pullAngle).not.toBeUndefined();
  });

  it('settles back when the button is released', () => {
    onlyNodeAt(20, 0);
    const dt = 1 / 60;
    for (let i = 0; i < 8; i++) world.updatePull(dt, true, RADIUS, SECONDS, 60);
    expect(world.nodes[0]?.pull).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) world.updatePull(dt, false, RADIUS, SECONDS, 60);
    expect(world.nodes[0]?.pull).toBe(0);
    expect(world.nodes[0]?.available).toBe(true);
  });

  it('stops acquiring when there is no room, rather than taking and dropping', () => {
    onlyNodeAt(20, 0);
    pullFor(SECONDS + 0.2, { space: 0 });
    expect(world.nodes[0]?.available).toBe(true);
    expect(world.absorbed).toHaveLength(0);
  });

  it('respawns a gathered node after its biome delay', () => {
    onlyNodeAt(20, 0);
    pullFor(SECONDS + 0.1);
    expect(world.nodes[0]?.available).toBe(false);
    for (let t = 0; t < 20; t += 0.25) world.update(0.25);
    expect(world.nodes[0]?.available).toBe(true);
  });
});

describe('the Coliseum', () => {
  it('starts the player at the spawn, in Plains/Forest', () => {
    expect(world.player.x).toBe(0);
    expect(world.player.y).toBe(0);
    expect(world.biomeAt(0, 0)?.id).toBe('plains_forest');
  });

  it('never scatters a material outside its own biome', () => {
    for (const node of world.nodes) {
      expect(content.material(node.material).biome).toBe(node.biome);
      const disc = world.biomeAt(node.x, node.y);
      // A node is either inside its own region, or in the connective forest -
      // which is forest, so it carries forest material.
      if (disc) expect(disc.id).toBe(node.biome);
      else expect(node.biome).toBe('plains_forest');
    }
  });

  it('keeps the player inside the boundary', () => {
    for (let i = 0; i < 4000; i++) world.movePlayer(1 / 60, 1, 1, 400);
    expect(Math.hypot(world.player.x, world.player.y)).toBeLessThanOrEqual(world.boundaryRadius);
  });

  it('puts cold and concealment out of reach of the spawn', () => {
    const spawnDisc = world.disc('plains_forest');
    for (const node of world.nodes) {
      const elements = content.material(node.material).elements;
      if (!elements.includes('glacite') && !elements.includes('umbrel')) continue;
      expect(Math.hypot(node.x - spawnDisc.x, node.y - spawnDisc.y)).toBeGreaterThan(spawnDisc.radius);
    }
  });

  it('walks from the spawn to a biome edge in roughly the measured time', () => {
    const mountain = world.disc('snowy_mountain');
    const distance = Math.hypot(mountain.x, mountain.y) - mountain.radius;
    const seconds = distance / content.progression.player.moveSpeed;
    const [walkMin, walkMax] = content.coliseum.travelSeconds.walk;
    expect(seconds).toBeGreaterThanOrEqual(walkMin! - 5);
    expect(seconds).toBeLessThanOrEqual(walkMax! + 5);
  });
});

describe('notes lying in the world', () => {
  /** Put one note at a known offset and clear everything else out of the way. */
  function onlyNoteAt(dx: number, dy: number, id = 'b_intake_1'): void {
    world.nodes.length = 0;
    world.notes.length = 0;
    world.notes.push({ id, x: world.player.x + dx, y: world.player.y + dy, taken: false, pull: 0 });
  }

  it('come in on the same draw as everything else', () => {
    onlyNoteAt(RADIUS - 5, 0);
    for (let t = 0; t < 2; t += 1 / 60) world.updatePull(1 / 60, true, RADIUS, SECONDS, 60);
    expect(world.notes[0]?.taken).toBe(true);
  });

  it('are reported once and once only', () => {
    onlyNoteAt(RADIUS - 5, 0);
    let reported = 0;
    for (let t = 0; t < 4; t += 1 / 60) {
      world.updatePull(1 / 60, true, RADIUS, SECONDS, 60);
      reported += world.read.length;
    }
    expect(reported).toBe(1);
  });

  it('stay put with the pull switched off', () => {
    onlyNoteAt(RADIUS - 5, 0);
    for (let t = 0; t < 2; t += 1 / 60) world.updatePull(1 / 60, false, RADIUS, SECONDS, 60);
    expect(world.notes[0]?.taken).toBe(false);
  });

  it('are picked up with the pack completely full', () => {
    // Paper is not ore. A player at capacity standing on the one note that
    // explains the ending should not be quietly unable to read it.
    onlyNoteAt(RADIUS - 5, 0);
    for (let t = 0; t < 2; t += 1 / 60) world.updatePull(1 / 60, true, RADIUS, SECONDS, 0);
    expect(world.notes[0]?.taken).toBe(true);
  });

  it('are out of reach past the pull radius', () => {
    onlyNoteAt(RADIUS + 40, 0);
    for (let t = 0; t < 3; t += 1 / 60) world.updatePull(1 / 60, true, RADIUS, SECONDS, 60);
    expect(world.notes[0]?.taken).toBe(false);
  });

  it('all sit inside the region they were written for', () => {
    const fresh = new World(content);
    for (const note of fresh.notes) {
      const def = content.notes.find((n) => n.id === note.id);
      const disc = fresh.disc(def!.biome);
      expect(Math.hypot(note.x - disc.x, note.y - disc.y)).toBeLessThanOrEqual(disc.radius);
    }
  });

  it('are all actually in the world, both channels', () => {
    const fresh = new World(content);
    expect(fresh.notes).toHaveLength(content.notes.length);
  });
});
