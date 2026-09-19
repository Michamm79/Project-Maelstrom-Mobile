/**
 * The pressure cycle, driven end to end.
 *
 * Everything here is about the half of the game that had never actually run:
 * the Level 5 gate was unreachable, so the repeating bundles and the ambient
 * population were code nobody had executed. The first thing found when they
 * did run was that a wave could never be cleared again once the ambient
 * population existed - the field is never empty, by design - which would have
 * stopped wave XP, stopped the bundle ending, and reported nothing.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { World } from '../world';
import { WaveDirector } from '../waves';
import { content } from '../../core/content';

let world: World;
let waves: WaveDirector;

/** Run the director forward, killing nothing. */
function run(seconds: number, level: number, step = 0.5): void {
  for (let t = 0; t < seconds; t += step) waves.update(step, level);
}

/**
 * Run forward, deleting every WAVE enemy the moment it arrives.
 *
 * The ambient population is deliberately left alone: it is the thing most of
 * these tests are about, and a helper that quietly swept it up too would have
 * made the bug this file exists for impossible to reproduce.
 */
function clearAsTheyCome(seconds: number, level: number, step = 0.5): void {
  for (let t = 0; t < seconds; t += step) {
    waves.update(step, level);
    for (let i = world.enemies.length - 1; i >= 0; i--) {
      if (world.enemies[i]?.fromWave) world.enemies.splice(i, 1);
    }
  }
}

beforeEach(() => {
  world = new World(content);
  world.nodes.length = 0;
  world.enemies.length = 0;
  waves = new WaveDirector(content, world);
});

describe('the opening', () => {
  it('puts nothing in the world at level 0', () => {
    run(600, 0);
    expect(world.enemies).toHaveLength(0);
  });

  it('arms at level 1 and sends a bundle', () => {
    run(60, 1);
    expect(waves.armed).toBe(true);
    expect(world.enemies.length).toBeGreaterThan(0);
  });

  it('then goes quiet and stays quiet below the escalation level', () => {
    clearAsTheyCome(900, 2);
    const cleared = waves.wavesCleared;
    expect(cleared).toBeGreaterThanOrEqual(3);
    // An hour later, nothing new. The gap is the exploration.
    clearAsTheyCome(3600, 2);
    expect(waves.wavesCleared).toBe(cleared);
  });
});

describe('the escalation', () => {
  it('starts the cycle again once the player reaches the gate', () => {
    clearAsTheyCome(900, 2);
    const before = waves.wavesCleared;
    clearAsTheyCome(4000, content.waves.gates.repeatingBundlesFromLevel);
    expect(waves.wavesCleared).toBeGreaterThan(before);
  });

  it('keeps clearing waves with an ambient population in the world', () => {
    /*
     * The one that was broken. `alive === 0` could never be true again once
     * anything ambient existed, so this would have counted zero waves for the
     * rest of the run however many the player actually fought.
     */
    clearAsTheyCome(900, 2);
    clearAsTheyCome(5000, 5);
    const ambient = world.enemies.filter((e) => !e.fromWave).length;
    expect(ambient).toBeGreaterThan(0);
    expect(waves.wavesCleared).toBeGreaterThan(6);
  });

  it('gets heavier as it goes', () => {
    expect(waves.pressure).toBe(1);
    clearAsTheyCome(900, 2);
    clearAsTheyCome(20000, 6);
    expect(waves.pressure).toBeGreaterThan(1.2);
  });

  it('never puts more in the world at once than the cap allows', () => {
    let peak = 0;
    clearAsTheyCome(900, 2);
    // Killing nothing now, so the field only grows.
    for (let t = 0; t < 20000; t += 0.5) {
      waves.update(0.5, 6);
      peak = Math.max(peak, world.census().alive);
    }
    expect(peak).toBeGreaterThan(10);
    expect(peak).toBeLessThanOrEqual(content.waves.escalation.maxLiveEnemies);
  });

  it('brings the Scythe-bearer back, rather than allowing exactly one ever', () => {
    clearAsTheyCome(900, 2);
    let seen = 0;
    for (let t = 0; t < 30000; t += 0.5) {
      waves.update(0.5, 6);
      seen += world.enemies.filter((e) => e.fromWave && e.def.id === 'scythe_bearer').length;
      for (let i = world.enemies.length - 1; i >= 0; i--) {
        if (world.enemies[i]?.fromWave) world.enemies.splice(i, 1);
      }
    }
    expect(seen).toBeGreaterThan(1);
  });
});

describe('the ambient population', () => {
  it('comes back after being cleared out', () => {
    clearAsTheyCome(900, 2);
    run(1, 5);
    // Reach the gap, where the population lives.
    clearAsTheyCome(3000, 5);
    const settled = world.enemies.filter((e) => !e.fromWave).length;
    expect(settled).toBeGreaterThan(0);

    for (const enemy of [...world.enemies]) {
      if (!enemy.fromWave) world.enemies.splice(world.enemies.indexOf(enemy), 1);
    }
    expect(world.enemies.filter((e) => !e.fromWave)).toHaveLength(0);

    clearAsTheyCome(content.waves.ambientTopUpSeconds * 2, 5);
    expect(world.enemies.filter((e) => !e.fromWave).length).toBeGreaterThan(0);
  });
});
