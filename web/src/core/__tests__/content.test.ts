/**
 * Integrity checks over the shipped content bundle. tools/build-content.mjs
 * already refuses to emit a broken graph; these assert the properties that
 * matter at runtime, and that the game can actually be finished.
 */
import { describe, expect, it } from 'vitest';
import { content } from '../content';
import { knownShapes } from '../../game/icons';
import { canFulfill, consumeElements, type ElementPool } from '../alchemy';
import type { MaterialId } from '../types';

describe('content bundle', () => {
  it('gives every material a shape the icon renderer knows', () => {
    const unknown = content.materials.filter((m) => !knownShapes.includes(m.shape));
    expect(unknown.map((m) => `${m.id}:${m.shape}`)).toEqual([]);
  });

  it('gives every material a non-empty element composition', () => {
    const empty = content.materials.filter((m) => Object.keys(m.composition).length === 0);
    expect(empty.map((m) => m.id)).toEqual([]);
  });

  it('resolves every recipe input and output to a real material', () => {
    for (const recipe of content.transmutation) {
      expect(content.hasMaterial(recipe.a)).toBe(true);
      expect(content.hasMaterial(recipe.b)).toBe(true);
      expect(content.hasMaterial(recipe.result)).toBe(true);
    }
    for (const recipe of content.alchemy) {
      expect(content.hasMaterial(recipe.result)).toBe(true);
    }
  });

  it('keeps the XP table strictly increasing', () => {
    const table = content.progression.xpTable;
    expect(table.length).toBe(content.progression.maxLevel);
    for (let i = 1; i < table.length; i++) {
      expect(table[i]!).toBeGreaterThan(table[i - 1]!);
    }
  });

  it('spawns only gathered materials in zones, and every gathered material somewhere', () => {
    const spawned = new Set<MaterialId>();
    for (const zone of content.zones) {
      for (const spawn of zone.spawns) {
        expect(content.material(spawn.material).source).toBe('gathered');
        spawned.add(spawn.material);
      }
    }
    const orphans = content.materials.filter((m) => m.source === 'gathered' && !spawned.has(m.id));
    expect(orphans.map((m) => m.id)).toEqual([]);
  });

  it('never gates a recipe below the level at which its inputs become obtainable', () => {
    const tooEarly = content.transmutation.filter((recipe) => {
      const a = content.material(recipe.a).availableAtLevel ?? Infinity;
      const b = content.material(recipe.b).availableAtLevel ?? Infinity;
      return Math.max(a, b) > recipe.requiredLevel;
    });
    expect(tooEarly.map((r) => r.id)).toEqual([]);
  });

  it('is completable: every material is reachable by a player who levels up', () => {
    // Simulate the actual loop rather than trusting the graph: at each level,
    // gather everything the unlocked zones offer, craft everything craftable,
    // decompose everything for elements, brew everything affordable. If the
    // final item never appears, the tech tree has a hole in it.
    const held = new Set<MaterialId>();
    const pool: ElementPool = {};

    for (let level = 1; level <= content.progression.maxLevel; level++) {
      for (const zone of content.unlockedZones(level)) {
        for (const spawn of zone.spawns) held.add(spawn.material);
      }

      // Repeat until the set stops growing: one craft can unlock the next.
      let changed = true;
      while (changed) {
        changed = false;

        for (const recipe of content.transmutation) {
          if (recipe.requiredLevel > level) continue;
          if (!held.has(recipe.a) || !held.has(recipe.b)) continue;
          if (held.has(recipe.result)) continue;
          held.add(recipe.result);
          changed = true;
        }

        if (level >= content.progression.alchemyUnlockLevel) {
          for (const id of held) {
            for (const [element, qty] of Object.entries(content.material(id).composition)) {
              pool[element] = (pool[element] ?? 0) + qty;
            }
          }
          for (const recipe of content.alchemy) {
            if (recipe.requiredLevel > level) continue;
            if (held.has(recipe.result)) continue;
            if (!canFulfill(recipe, pool)) continue;
            consumeElements(recipe, pool);
            held.add(recipe.result);
            changed = true;
          }
        }
      }
    }

    const unreachable = content.materials.filter((m) => !held.has(m.id));
    expect(unreachable.map((m) => m.id)).toEqual([]);
    expect(held.has('maelstrom_key')).toBe(true);
  });
});
