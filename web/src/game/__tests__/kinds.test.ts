/**
 * The four kinds that are not canon's three.
 *
 * Canon gives three tiers and each one resolves the same way - walk at the
 * player and hit them - so a fight was only ever a question of how long it
 * took. These add a decision each, and every one of them fails quietly: a
 * ranged kind that closes to melee still works and simply is not ranged, a
 * mender whose aura never fires looks like a slow enemy, and armour applied
 * in one damage path but not the other looks like a damage roll.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { World, afterArmour } from '../world';
import { content } from '../../core/content';

let world: World;

function advance(seconds: number, step = 1 / 60): void {
  for (let t = 0; t < seconds; t += step) world.update(step);
}

beforeEach(() => {
  world = new World(content);
  world.nodes.length = 0;
  world.notes.length = 0;
  world.enemies.length = 0;
  world.projectiles.length = 0;
  world.player.x = 0;
  world.player.y = 0;
});

describe('the roster', () => {
  it('is seven kinds over canon’s three tiers', () => {
    expect(content.enemies).toHaveLength(7);
    expect(new Set(content.enemies.map((e) => e.tier))).toEqual(new Set([1, 2, 3]));
  });

  it('keeps canon’s three exactly as they were named', () => {
    const ids = content.enemies.map((e) => e.id);
    for (const id of ['goblin', 'minotaur', 'scythe_bearer']) expect(ids).toContain(id);
  });

  it('gives every kind its own art, or it would vanish instead of deleting', () => {
    // The deletion effect samples the real silhouette and returns null when
    // there is none, so a kind with no drawing quietly disappears on death.
    for (const def of content.enemies) {
      expect(() => world.spawn(def, 400, 400)).not.toThrow();
    }
    expect(content.enemies.every((e) => e.color && e.shape)).toBe(true);
  });
});

describe('armour', () => {
  it('subtracts a flat amount rather than a share', () => {
    expect(afterArmour(9, 6)).toBe(3);
    expect(afterArmour(26, 6)).toBe(20);
  });

  it('never blocks a hit outright, so it is a question and not a wall', () => {
    expect(afterArmour(4, 50)).toBeGreaterThan(0);
  });

  it('leaves the unarmoured alone', () => {
    expect(afterArmour(9, undefined)).toBe(9);
    expect(afterArmour(9, 0)).toBe(9);
  });

  it('applies to a swing in the live world', () => {
    const golem = content.enemy('golem');
    const enemy = world.spawn(golem, world.player.x + 20, world.player.y);
    const attack = content.progression.combat.basicAttack;
    world.player.attackCooldown = 0;
    world.swing();
    // The punch lands for less than its own number, and for more than nothing.
    const taken = golem.hp - enemy.hp;
    expect(taken).toBeLessThan(attack.damage);
    expect(taken).toBeGreaterThan(0);
  });

  it('applies to a cast too, so neither path is the cheap one', () => {
    const golem = content.enemy('golem');
    const enemy = world.spawn(golem, world.player.x + 20, world.player.y);
    const gust = content.alchemy.find((c) => c.id === 'emberlash')!;
    world.cast(gust);
    expect(golem.hp - enemy.hp).toBeLessThan(gust.effect.damage);
  });
});

describe('a ranged kind', () => {
  const wisp = () => content.enemy('wisp');

  it('fires instead of closing', () => {
    const enemy = world.spawn(wisp(), 0, 220);
    enemy.aggro = true;
    enemy.alertFor = 99;
    advance(4);
    expect(world.projectiles.length + world.player.status.shield).toBeGreaterThan(0);
  });

  it('holds its distance rather than walking into the player', () => {
    const def = wisp();
    const enemy = world.spawn(def, 0, 300);
    enemy.aggro = true;
    enemy.alertFor = 99;
    advance(6);
    // It closes, but not past the distance it wants to keep.
    const gap = Math.hypot(enemy.x - world.player.x, enemy.y - world.player.y);
    expect(gap).toBeGreaterThan((def.keepDistance ?? 0) * 0.6);
    expect(gap).toBeLessThan(320);
  });

  it('sends a bolt that can actually reach and hurt', () => {
    const enemy = world.spawn(wisp(), 0, 120);
    enemy.aggro = true;
    enemy.alertFor = 99;
    const before = world.player.hp;
    advance(8);
    expect(world.player.hp).toBeLessThan(before);
  });

  it('fires a bolt slow enough to walk out of', () => {
    const def = wisp();
    expect(def.ranged!.speed).toBeLessThan(content.progression.player.sprintSpeed * 4);
  });

  it('gives up its bolts rather than filling the world with them', () => {
    const enemy = world.spawn(wisp(), 0, 280);
    enemy.aggro = true;
    enemy.alertFor = 99;
    // Out of the way, so nothing is ever hit and only expiry can clear them.
    advance(3);
    world.player.x = 4000;
    world.player.y = 4000;
    advance(12);
    expect(world.projectiles.length).toBeLessThan(6);
  });
});

describe('a mender', () => {
  it('repairs the wounded around it', () => {
    const goblin = content.enemy('goblin');
    const hurt = world.spawn(goblin, 60, 0);
    hurt.hp = 4;
    world.spawn(content.enemy('lich'), 90, 0);
    advance(2);
    expect(hurt.hp).toBeGreaterThan(4);
  });

  it('never repairs itself, because killing it first is the whole point', () => {
    const lichDef = content.enemy('lich');
    const lich = world.spawn(lichDef, 60, 0);
    lich.hp = 20;
    advance(3);
    expect(lich.hp).toBe(20);
  });

  it('does not reach past its own radius', () => {
    const lichDef = content.enemy('lich');
    const far = world.spawn(content.enemy('goblin'), lichDef.mends!.radius + 300, 0);
    far.hp = 4;
    world.spawn(lichDef, 0, 0);
    advance(2);
    expect(far.hp).toBe(4);
  });

  it('never overfills what it is repairing', () => {
    const goblin = content.enemy('goblin');
    const hurt = world.spawn(goblin, 60, 0);
    hurt.hp = goblin.hp - 1;
    world.spawn(content.enemy('lich'), 90, 0);
    advance(5);
    expect(hurt.hp).toBe(goblin.hp);
  });

  it('leaves the dead alone', () => {
    const corpse = world.spawn(content.enemy('goblin'), 60, 0);
    corpse.hp = 0;
    corpse.dead = true;
    world.spawn(content.enemy('lich'), 90, 0);
    advance(2);
    expect(corpse.hp).toBe(0);
  });
});

describe('a mender that holds its distance', () => {
  /**
   * The Lich keeps 150 units and swings at 38, which reads on paper like an
   * enemy that backs away from its own attack forever - its damage would be
   * dead data and the kind would be a healing aura with legs. It backs off at
   * 58 and the player sprints at 84, so the gap closes; this asserts that it
   * does, because the alternative is silent.
   */
  it('can be run down, and its melee is real when it is', () => {
    const def = content.enemy('lich');
    expect(def.keepDistance!).toBeGreaterThan(def.attackRange);

    const lich = world.spawn(def, 120, 0);
    const before = world.player.hp;
    let closest = Infinity;
    for (let t = 0; t < 30; t += 1 / 60) {
      const dx = lich.x - world.player.x;
      const dy = lich.y - world.player.y;
      const d = Math.hypot(dx, dy) || 1;
      closest = Math.min(closest, d);
      world.player.x += (dx / d) * content.progression.player.sprintSpeed * (1 / 60);
      world.player.y += (dy / d) * content.progression.player.sprintSpeed * (1 / 60);
      world.update(1 / 60);
    }

    expect(closest).toBeLessThan(def.attackRange);
    expect(world.player.hp).toBeLessThan(before);
  });
});
