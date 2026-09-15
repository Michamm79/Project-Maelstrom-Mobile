/**
 * Enemies wander; they do not home in.
 *
 * The informational advantage is the player's: they can see what is around
 * them, and the program cannot see them. The old AI inverted that in practice -
 * a notice radius of 220-360 world units covered most of a screen, and once
 * inside it an enemy walked the exact line to the player's current position
 * until it was outrun. That is a lock-on whatever the field is called.
 *
 * These tests drive real time through the world rather than asserting on
 * content numbers, because the numbers were never the part that was wrong.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { World } from '../world';
import { content } from '../../core/content';

let world: World;

function goblin() {
  return content.enemy('goblin');
}

/** Run the world forward in fixed steps, so a test reads as elapsed time. */
function advance(seconds: number, step = 1 / 60): void {
  for (let t = 0; t < seconds; t += step) world.update(step);
}

beforeEach(() => {
  world = new World(content);
  world.nodes.length = 0;
  world.enemies.length = 0;
  world.player.x = 0;
  world.player.y = 0;
});

describe('an enemy that has not noticed the player', () => {
  it('does not walk towards them from outside its notice radius', () => {
    const def = goblin();
    // Comfortably outside notice, comfortably inside the old aggro radius of
    // 220 - which is the case that used to produce a beeline.
    const enemy = world.spawn(def, 180, 0);
    expect(180).toBeGreaterThan(def.noticeRadius);

    advance(4);

    const closed = 180 - Math.hypot(enemy.x - world.player.x, enemy.y - world.player.y);
    expect(enemy.aggro).toBe(false);
    // It may drift nearer by chance; what it must not do is close the distance
    // the way something walking at you does. At 26/s over 4s a beeline covers
    // 104 units.
    expect(closed).toBeLessThan(40);
  });

  it('moves anyway, rather than standing where it spawned', () => {
    const enemy = world.spawn(goblin(), 600, 600);
    const from = { x: enemy.x, y: enemy.y };

    advance(6);

    expect(Math.hypot(enemy.x - from.x, enemy.y - from.y)).toBeGreaterThan(20);
  });

  it('stays inside the Coliseum while wandering', () => {
    // Spawned at the rim with a roam radius that would happily take it outside.
    const enemy = world.spawn(goblin(), world.boundaryRadius - 60, 0);
    advance(40);
    expect(Math.hypot(enemy.x, enemy.y)).toBeLessThanOrEqual(world.boundaryRadius);
  });

  it('wanders slower than it chases', () => {
    const def = goblin();
    const far = world.spawn(def, 900, 0);
    const near = world.spawn(def, def.noticeRadius - 10, 0);

    const farFrom = { x: far.x, y: far.y };
    const nearFrom = { x: near.x, y: near.y };
    advance(1);

    const ambled = Math.hypot(far.x - farFrom.x, far.y - farFrom.y);
    const charged = Math.hypot(near.x - nearFrom.x, near.y - nearFrom.y);
    expect(near.aggro).toBe(true);
    expect(charged).toBeGreaterThan(ambled);
  });
});

describe('an enemy that has noticed the player', () => {
  it('notices only on getting close', () => {
    const def = goblin();
    const outside = world.spawn(def, def.noticeRadius + 30, 0);
    const inside = world.spawn(def, def.noticeRadius - 5, 0);

    advance(0.2);

    expect(outside.aggro).toBe(false);
    expect(inside.aggro).toBe(true);
  });

  it('closes on the player', () => {
    const def = goblin();
    const enemy = world.spawn(def, def.noticeRadius - 5, 0);
    advance(1);
    expect(enemy.aggro).toBe(true);
    expect(enemy.x).toBeLessThan(def.noticeRadius - 5);
  });

  it('gives up and goes back to wandering once the player is away', () => {
    const def = goblin();
    const enemy = world.spawn(def, def.noticeRadius - 5, 0);
    advance(0.2);
    expect(enemy.aggro).toBe(true);

    // Out past loseRadius: backing off has to actually work.
    world.player.x = def.loseRadius + 400;
    advance(def.forgetSeconds + 1);

    expect(enemy.aggro).toBe(false);
  });

  it('is woken by being hit, even from outside its notice radius', () => {
    const def = goblin();
    const enemy = world.spawn(def, 40, 0);
    // Inside melee range but the notice check is what normally wakes it; a hit
    // has to as well, or attacking something asleep is free forever.
    world.swing();
    expect(enemy.aggro).toBe(true);
  });
});

describe('the wind-up', () => {
  it('does not land a hit on the frame it arrives', () => {
    const def = goblin();
    world.spawn(def, def.attackRange - 4, 0);
    const before = world.player.hp;

    // One frame: noticed and in range, but the blow is telegraphed first.
    world.update(1 / 60);

    expect(world.player.hp).toBe(before);
  });

  it('lands once the wind-up has run', () => {
    const def = goblin();
    world.spawn(def, def.attackRange - 4, 0);
    const before = world.player.hp;

    advance(1.2);

    expect(world.player.hp).toBeLessThan(before);
  });
});

/*
 * Knockback is measured at its peak rather than where the enemy ends up. A hit
 * wakes what it hits, so the thing walks back in as soon as the shove bleeds
 * off - which is the behaviour we want (the hit buys a moment, not safety) and
 * exactly what made a resting-position assertion read the wrong number.
 */
function peakPush(enemy: { x: number; y: number }, seconds = 1): number {
  const from = { x: enemy.x, y: enemy.y };
  let peak = 0;
  for (let t = 0; t < seconds; t += 1 / 60) {
    world.update(1 / 60);
    peak = Math.max(peak, Math.hypot(enemy.x - from.x, enemy.y - from.y));
  }
  return peak;
}

describe('the basic attack', () => {
  it('keeps an opening hit inside its own reach, so a combo can be chained', () => {
    const def = goblin();
    const enemy = world.spawn(def, 24, 0);
    const attack = content.progression.combat.basicAttack;
    world.swing();
    // A flat shove put the target past the reach that threw it, which killed
    // Amorratua's consecutive-hits hook outright for tier 1.
    expect(peakPush(enemy) + 24).toBeLessThan(attack.range);
  });

  it('shoves a little on a first hit and a lot on a combo finisher', () => {
    const first = world.spawn(goblin(), 30, 0);
    world.swing();
    const opening = peakPush(first);

    // Same swing at the top of the combo. knockback/decay is 320/7, so the
    // finisher is around 46 world units against a drawn body of about 34; the
    // old flat 40/7 was under six either way, which is invisible in play.
    world.enemies.length = 0;
    const last = world.spawn(goblin(), 30, 0);
    world.player.combo = content.progression.combat.basicAttack.comboMax;
    world.player.comboTargetId = last.id;
    world.player.comboTimer = 5;
    world.swing();
    const finisher = peakPush(last);

    expect(opening).toBeGreaterThan(8);
    expect(finisher).toBeGreaterThan(opening * 1.6);
  });

  it('shoves a heavier enemy less', () => {
    const light = world.spawn(content.enemy('goblin'), 30, 0);
    const heavy = world.spawn(content.enemy('scythe_bearer'), 30, 1);
    world.swing();

    const from = { light: { ...light }, heavy: { ...heavy } };
    let lightPeak = 0;
    let heavyPeak = 0;
    for (let t = 0; t < 1; t += 1 / 60) {
      world.update(1 / 60);
      lightPeak = Math.max(lightPeak, Math.hypot(light.x - from.light.x, light.y - from.light.y));
      heavyPeak = Math.max(heavyPeak, Math.hypot(heavy.x - from.heavy.x, heavy.y - from.heavy.y));
    }

    expect(heavy.def.weight).toBeGreaterThan(light.def.weight);
    expect(heavyPeak).toBeLessThan(lightPeak);
  });

  it('pushes a goblin clear of its own reach on a finisher, so the hit buys a moment', () => {
    const def = goblin();
    const enemy = world.spawn(def, def.attackRange - 6, 0);
    const start = def.attackRange - 6;
    world.player.combo = content.progression.combat.basicAttack.comboMax;
    world.player.comboTargetId = enemy.id;
    world.player.comboTimer = 5;
    world.swing();

    let peak = 0;
    for (let t = 0; t < 1; t += 1 / 60) {
      world.update(1 / 60);
      peak = Math.max(peak, Math.hypot(enemy.x, enemy.y));
    }

    expect(start).toBeLessThan(def.attackRange);
    expect(peak).toBeGreaterThan(def.attackRange);
  });
});

/**
 * Terrain: the biomes were a palette and a loot table.
 *
 * Every region stated a mechanical identity in its own mood line - "cover in
 * every direction", "nowhere to hide", "slow going" - and none of it existed,
 * so the Wetland played exactly like the Desert. These check the lines are true
 * in the simulation rather than only in the prose.
 */
describe('the ground under the player', () => {
  function at(id: string) {
    const disc = world.disc(id as never);
    return world.terrainAt(disc.x, disc.y);
  }

  it('leaves the spawn neutral, since it is the baseline', () => {
    const spawn = at('plains_forest');
    expect(spawn.moveScale).toBe(1);
    expect(spawn.concealment).toBe(1);
    expect(spawn.sight).toBe(1);
    expect(spawn.fog).toBe(0);
  });

  it('makes the Wetland slow going, as its mood line says', () => {
    expect(at('wetland').moveScale).toBeLessThan(at('plains_forest').moveScale);
  });

  it('actually slows the player down there', () => {
    const spawn = world.disc('plains_forest');
    world.player.x = spawn.x;
    world.player.y = spawn.y;
    const before = { x: world.player.x, y: world.player.y };
    world.movePlayer(1, 1, 0, 100);
    const onPlains = world.player.x - before.x;

    const marsh = world.disc('wetland');
    world.player.x = marsh.x;
    world.player.y = marsh.y;
    const from = world.player.x;
    world.movePlayer(1, 1, 0, 100);
    const inMarsh = world.player.x - from;

    expect(inMarsh).toBeGreaterThan(0);
    expect(inMarsh).toBeLessThan(onPlains);
  });

  it('gives the Wetland cover and the Desert exposure', () => {
    expect(at('wetland').concealment).toBeLessThan(1);
    expect(at('desert').concealment).toBeGreaterThan(1);
  });

  it('hides the player in cover and reveals them in the open', () => {
    const def = goblin();
    // The same standoff distance in both places: only the ground differs.
    const gap = def.noticeRadius + 10;

    const marsh = world.disc('wetland');
    world.player.x = marsh.x;
    world.player.y = marsh.y;
    const hidden = world.spawn(def, marsh.x + gap, marsh.y);
    world.update(1 / 60);
    expect(hidden.aggro).toBe(false);

    world.enemies.length = 0;
    const dunes = world.disc('desert');
    world.player.x = dunes.x;
    world.player.y = dunes.y;
    const exposed = world.spawn(def, dunes.x + gap, dunes.y);
    world.update(1 / 60);
    expect(exposed.aggro).toBe(true);
  });

  it('blends across the border rather than snapping', () => {
    const marsh = world.disc('wetland');
    // Just inside the rim: the feather should leave it part way to neutral.
    const edge = world.terrainAt(marsh.x + marsh.radius - 20, marsh.y);
    const middle = world.terrainAt(marsh.x, marsh.y);
    expect(edge.moveScale).toBeGreaterThan(middle.moveScale);
    expect(edge.moveScale).toBeLessThan(1);
  });

  it('leaves the forest between regions neutral', () => {
    const between = world.terrainAt(world.boundaryRadius * 0.62, 0);
    expect(between.moveScale).toBe(1);
    expect(between.fog).toBe(0);
  });

  it('scatters different scenery in each region', () => {
    const kindsIn = (id: string) => {
      const d = world.disc(id as never);
      return new Set(
        world.props
          .filter((p) => Math.hypot(p.x - d.x, p.y - d.y) < d.radius * 0.8)
          .map((p) => p.kind),
      );
    };
    const snow = kindsIn('snowy_mountain');
    const marsh = kindsIn('wetland');
    expect(snow.size).toBeGreaterThan(0);
    expect(marsh.size).toBeGreaterThan(0);
    // No shared scenery at all: a snowfield has nothing a marsh has.
    for (const kind of snow) expect(marsh.has(kind)).toBe(false);
  });

  it('puts enough scenery on screen to read as ground cover', () => {
    // A screen is about 315x700 world units at the shipped zoom.
    const inView = world.propsIn(-158, -350, 158, 350).length;
    expect(inView).toBeGreaterThan(5);
  });
});
