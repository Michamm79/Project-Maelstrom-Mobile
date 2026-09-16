/**
 * What the four non-damage combinations do to a running world.
 *
 * The unit tests next door prove the arithmetic. These prove it is wired in,
 * which is a different question and the one that was actually at risk: a slow
 * that is applied to a field nothing reads, or a veil that stops new enemies
 * noticing while leaving the three already chasing you exactly where they were,
 * both pass every test of their own maths.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { World } from '../world';
import { content } from '../../core/content';
import type { AlchemyCombination } from '../../core/types';

let world: World;

function advance(seconds: number, step = 1 / 60): void {
  for (let t = 0; t < seconds; t += step) world.update(step);
}

function combination(id: string): AlchemyCombination {
  const found = content.alchemy.find((c) => c.id === id);
  if (!found) throw new Error(`no combination "${id}" - the test is out of date, not the game`);
  return found;
}

beforeEach(() => {
  world = new World(content);
  world.nodes.length = 0;
  world.enemies.length = 0;
  world.player.x = 0;
  world.player.y = 0;
});

describe('Rimebind', () => {
  it('leaves what it caught moving at a fraction of its own pace', () => {
    const def = content.enemy('goblin');
    const slowed = world.spawn(def, 0, 60);
    const loose = world.spawn(def, 0, 900);
    // Both are already chasing, so the only difference between them is the ice.
    slowed.aggro = true;
    slowed.alertFor = 99;
    loose.aggro = true;
    loose.alertFor = 99;

    world.cast(combination('rimebind'));
    expect(slowed.slow).toBeGreaterThan(0);
    expect(loose.slow).toBe(0);

    const slowedFrom = slowed.y;
    const looseFrom = loose.y;
    advance(1);
    const slowedBy = slowedFrom - slowed.y;
    const looseBy = looseFrom - loose.y;
    expect(slowedBy).toBeGreaterThan(0);
    expect(slowedBy).toBeLessThan(looseBy * 0.6);
  });

  it('wears off, and full pace comes back with it', () => {
    const enemy = world.spawn(content.enemy('goblin'), 0, 60);
    world.cast(combination('rimebind'));
    advance(6);
    expect(enemy.slow).toBe(0);
    expect(enemy.slowScale).toBe(1);
  });
});

describe('Nightfall', () => {
  it('stops anything noticing the player at all', () => {
    const enemy = world.spawn(content.enemy('goblin'), 0, 20);
    world.cast(combination('nightfall'));
    advance(2);
    expect(enemy.aggro).toBe(false);
  });

  it('drops a pursuit already in progress, which is the only time anyone casts it', () => {
    const enemy = world.spawn(content.enemy('goblin'), 0, 40);
    enemy.aggro = true;
    enemy.alertFor = 99;
    world.cast(combination('nightfall'));
    expect(enemy.aggro).toBe(false);
  });

  it('wears off and the world starts noticing again', () => {
    const enemy = world.spawn(content.enemy('goblin'), 0, 20);
    world.cast(combination('nightfall'));
    advance(10);
    expect(world.player.status.hidden).toBe(0);

    // Put it back within arm's reach first. Eight seconds of being ignored is
    // eight seconds of ambling off towards a roam target, so the enemy that
    // was beside the player is a couple of hundred units away by now - which
    // is the veil working, not the noticing being broken.
    enemy.x = 0;
    enemy.y = 20;
    advance(0.5);
    expect(enemy.aggro).toBe(true);
  });

  it('is given away the moment the player casts anything else', () => {
    const enemy = world.spawn(content.enemy('goblin'), 0, 60);
    world.cast(combination('nightfall'));
    expect(enemy.aggro).toBe(false);
    world.cast(combination('gust'));
    expect(enemy.aggro).toBe(true);
  });
});

describe('Ironward', () => {
  it('takes the hit instead of the player', () => {
    const enemy = world.spawn(content.enemy('minotaur'), 0, 20);
    enemy.aggro = true;
    enemy.alertFor = 99;
    world.cast(combination('ironward'));

    const before = world.player.hp;
    advance(4);
    expect(world.player.hp).toBe(before);
    // It cost the shield, though - being shielded is not being unhurt.
    expect(world.player.status.shield).toBeLessThan(40);
  });
});

describe('Verdance', () => {
  it('gives health back over time rather than all at once', () => {
    world.player.hp = 20;
    world.cast(combination('verdance'));

    advance(1);
    const afterOne = world.player.hp;
    expect(afterOne).toBeGreaterThan(20);
    expect(afterOne).toBeLessThan(32);

    advance(8);
    expect(world.player.hp).toBeGreaterThan(50);
  });

  it('never takes the player past their maximum', () => {
    world.player.hp = world.player.maxHp;
    world.cast(combination('verdance'));
    advance(10);
    expect(world.player.hp).toBe(world.player.maxHp);
  });
});

describe('Clarion', () => {
  it('runs on a clock of its own and expires', () => {
    world.cast(combination('clarion'));
    expect(world.player.status.revealed).toBeGreaterThan(0);
    advance(25);
    expect(world.player.status.revealed).toBe(0);
  });
});

describe('dying', () => {
  it('clears whatever was being held, because it plainly did not work', () => {
    world.cast(combination('ironward'));
    world.cast(combination('clarion'));
    world.player.hp = 0;
    world.player.dead = true;
    world.player.respawnAt = world.time;
    advance(4);
    expect(world.player.dead).toBe(false);
    expect(world.player.status.shield).toBe(0);
    expect(world.player.status.revealed).toBe(0);
  });
});

describe('the gauntlets as the weapon', () => {
  it('reaches further and hits harder with the strike recipes made', () => {
    const def = content.enemy('goblin');
    const attack = content.progression.combat.basicAttack;

    // Just outside the bare reach, just inside the upgraded one.
    const out = world.spawn(def, attack.range + 8, 0);
    expect(world.swing()?.hit).toHaveLength(0);

    world.player.attackCooldown = 0;
    const upgraded = world.swing({ damage: 7, range: 14 });
    expect(upgraded?.hit).toHaveLength(1);
    // 9 base + 7 crafted, with no combo yet.
    expect(out.hp).toBe(def.hp - (attack.damage + 7));
  });
});
