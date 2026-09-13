/**
 * The action button must not promise a hit it cannot land.
 *
 * enemyInReach() decides what the button says, using distance alone. attack()
 * additionally tests a swing arc. Those two disagreeing is what let the button
 * read ATTACK while the swing whiffed behind the player, so the invariant below
 * is the thing that actually matters: anything the button offers must be
 * hittable once the press turns the player to face it.
 */
import { describe, expect, it } from 'vitest';
import { content } from '../../core/content';
import { inSwing } from '../../core/combat';
import { World } from '../world';

const combat = content.progression.combat;
const zone = content.zones.find((z) => z.enemies.length > 0)!;

/** A world with exactly one living enemy, placed relative to the player. */
function worldWithEnemyAt(dx: number, dy: number): World {
  const world = new World(content, zone);
  for (const enemy of world.enemies) enemy.dead = true;

  const enemy = world.enemies[0]!;
  enemy.dead = false;
  enemy.hp = enemy.def.hp;
  enemy.x = world.player.x + dx;
  enemy.y = world.player.y + dy;
  return world;
}

describe('faceToward', () => {
  it('turns the player toward a target', () => {
    const world = worldWithEnemyAt(30, 0);
    world.faceToward(world.player.x + 30, world.player.y);
    expect(world.player.facing4).toBe('side');
    expect(world.player.mirrored).toBe(true);
  });

  it('commits the sprite row by dominant axis, like walking does', () => {
    const world = worldWithEnemyAt(0, -30);
    world.faceToward(world.player.x, world.player.y - 30);
    expect(world.player.facing4).toBe('up');

    world.faceToward(world.player.x - 30, world.player.y);
    expect(world.player.facing4).toBe('side');
    expect(world.player.mirrored).toBe(false);
  });

  it('ignores a target the player is standing exactly on', () => {
    const world = worldWithEnemyAt(0, 0);
    const before = world.player.facing;
    world.faceToward(world.player.x, world.player.y);
    expect(world.player.facing).toBe(before);
  });
});

describe('the button never promises an unlandable hit', () => {
  // Eight directions, so "behind" is covered rather than assumed.
  const directions = [0, 45, 90, 135, 180, 225, 270, 315];

  for (const degrees of directions) {
    it(`an enemy ${degrees}° away is hittable after the press turns to face it`, () => {
      const radians = (degrees * Math.PI) / 180;
      const distance = combat.attackRange - 6;
      const world = worldWithEnemyAt(Math.cos(radians) * distance, Math.sin(radians) * distance);
      const enemy = world.enemies[0]!;

      // The button offers this enemy...
      expect(world.enemyInReach()).toBe(enemy);

      // ...so after facing it, the swing must actually reach it.
      world.faceToward(enemy.x, enemy.y);
      expect(inSwing(world.player, enemy, combat)).toBe(true);
    });
  }

  it('an enemy directly behind was NOT hittable before facing it', () => {
    // The regression itself: without the turn, a 180° target fails the arc.
    const distance = combat.attackRange - 6;
    const world = worldWithEnemyAt(-distance, 0);
    const enemy = world.enemies[0]!;

    world.faceToward(world.player.x + 100, world.player.y); // face away
    expect(world.enemyInReach()).toBe(enemy);
    expect(inSwing(world.player, enemy, combat)).toBe(false);
  });

  it('still offers nothing when the nearest enemy is out of range', () => {
    const world = worldWithEnemyAt(combat.attackRange + 40, 0);
    expect(world.enemyInReach()).toBeNull();
  });
});
