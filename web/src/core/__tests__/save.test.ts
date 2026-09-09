import { describe, expect, it } from 'vitest';
import { content } from '../content';
import { createInitialState, OrbContainer } from '../orbContainer';
import { deserialize, serialize } from '../save';

const populated = () => {
  const state = createInitialState(content);
  const orb = new OrbContainer(content, state);
  state.level = 6;
  state.xp = content.progression.xpTable[5] ?? 0;
  orb.gather('stick');
  orb.gather('stone');
  orb.tryTransmute();
  state.elementPool = { pyron: 3, terran: 2 };
  return state;
};

describe('save', () => {
  it('round-trips a populated run', () => {
    const original = populated();
    const restored = deserialize(content, JSON.parse(JSON.stringify(serialize(original))));

    expect(restored).not.toBeNull();
    if (!restored) return;

    expect(restored.level).toBe(original.level);
    expect(restored.xp).toBe(original.xp);
    expect(restored.zoneId).toBe(original.zoneId);
    expect(restored.inventory).toEqual(original.inventory);
    expect(restored.elementPool).toEqual(original.elementPool);
    expect([...restored.discovered]).toEqual([...original.discovered]);
    expect([...restored.seenMaterials]).toEqual([...original.seenMaterials]);
    expect(restored.stats).toEqual(original.stats);
  });

  it('rejects a save from a different schema version', () => {
    const raw = serialize(populated()) as unknown as Record<string, unknown>;
    raw['version'] = 999;
    expect(deserialize(content, raw)).toBeNull();
  });

  it('rejects junk instead of throwing', () => {
    expect(deserialize(content, null)).toBeNull();
    expect(deserialize(content, 'not a save')).toBeNull();
    expect(deserialize(content, 42)).toBeNull();
  });

  it('drops ids the current content bundle no longer defines', () => {
    const raw = serialize(populated()) as unknown as Record<string, unknown>;
    raw['inventory'] = { stone_axe: 2, deleted_material: 5 };
    raw['elementPool'] = { pyron: 3, deleted_element: 9 };
    raw['discovered'] = ['tr_stone_axe', 'tr_deleted'];
    raw['seenMaterials'] = ['stick', 'deleted_material'];
    raw['orbs'] = { left: 'deleted_material', right: 'stone' };

    const restored = deserialize(content, raw);
    expect(restored).not.toBeNull();
    if (!restored) return;

    expect(restored.inventory).toEqual({ stone_axe: 2 });
    expect(restored.elementPool).toEqual({ pyron: 3 });
    expect([...restored.discovered]).toEqual(['tr_stone_axe']);
    expect([...restored.seenMaterials]).toEqual(['stick']);
    expect(restored.orbs.left).toBeNull();
    expect(restored.orbs.right).toBe('stone');
  });

  it('falls back to the first zone when the saved zone is now out of reach', () => {
    const raw = serialize(populated()) as unknown as Record<string, unknown>;
    raw['zoneId'] = 'maelstrom_rim';
    raw['level'] = 2;
    raw['xp'] = 0;

    const restored = deserialize(content, raw);
    expect(restored?.zoneId).toBe(content.zones[0]?.id);
  });

  it('never restores a level lower than the saved XP earned', () => {
    const raw = serialize(populated()) as unknown as Record<string, unknown>;
    raw['level'] = 1;

    const restored = deserialize(content, raw);
    expect(restored?.level).toBeGreaterThan(1);
  });
});
