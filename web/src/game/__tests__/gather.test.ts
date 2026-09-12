/**
 * Gather range and the grace window.
 *
 * World is pure simulation - no canvas, no DOM - so it can be driven directly.
 */
import { describe, expect, it } from 'vitest';
import { content } from '../../core/content';
import { World } from '../world';

const zone = content.zones[0]!;
const cfg = content.progression.player;
const RANGE = cfg.gatherRadius + cfg.radius;

/** A world with exactly one node, placed relative to the player. */
function worldWithNodeAt(dx: number, dy: number): World {
  const world = new World(content, zone);
  for (const node of world.nodes) node.available = false;

  const node = world.nodes[0]!;
  node.available = true;
  node.material = 'stick';
  node.x = world.player.x + dx;
  node.y = world.player.y + dy;
  return world;
}

describe('gather range', () => {
  it('finds a node inside range', () => {
    const world = worldWithNodeAt(RANGE - 5, 0);
    expect(world.nodeInRange()?.material).toBe('stick');
  });

  it('finds nothing when far beyond range', () => {
    const world = worldWithNodeAt(RANGE * 5, 0);
    expect(world.nodeInRange()).toBeNull();
  });

  it('leaves a workable window while walking straight over a node', () => {
    // The bug this guards: at the original 34px radius a node was in range for
    // about half a second, which is under thumb reaction time.
    const secondsInRange = (RANGE * 2) / cfg.moveSpeed;
    const withGrace = secondsInRange + cfg.gatherGraceSeconds;
    expect(withGrace).toBeGreaterThan(1);
  });
});

describe('grace window', () => {
  it('keeps a node gatherable just after walking out of range', () => {
    const world = worldWithNodeAt(0, 0);
    expect(world.nodeInRange()).not.toBeNull(); // arms the grace

    // Step out of strict range but not far.
    world.player.x += RANGE * 1.4;
    expect(world.nodeInRange()?.material).toBe('stick');
  });

  it('expires the grace after its time is up', () => {
    const world = worldWithNodeAt(0, 0);
    world.nodeInRange();
    world.player.x += RANGE * 1.4;

    world.update(cfg.gatherGraceSeconds + 0.1);
    expect(world.nodeInRange()).toBeNull();
  });

  it('does not stretch grace to a node left far behind', () => {
    const world = worldWithNodeAt(0, 0);
    world.nodeInRange();

    world.player.x += RANGE * cfg.gatherGraceRangeFactor + 10;
    expect(world.nodeInRange()).toBeNull();
  });

  it('drops the grace target once that node is harvested', () => {
    const world = worldWithNodeAt(0, 0);
    const node = world.nodeInRange();
    expect(node).not.toBeNull();
    if (!node) return;

    world.harvest(node);
    world.player.x += RANGE * 1.4;
    expect(world.nodeInRange()).toBeNull();
  });

  it('prefers a genuinely in-range node over the grace target', () => {
    const world = worldWithNodeAt(0, 0);
    world.nodeInRange();

    const second = world.nodes[1]!;
    second.available = true;
    second.material = 'stone';
    second.x = world.player.x;
    second.y = world.player.y;

    world.player.x += RANGE * 1.4;
    second.x = world.player.x;
    second.y = world.player.y;

    expect(world.nodeInRange()?.material).toBe('stone');
  });
});
