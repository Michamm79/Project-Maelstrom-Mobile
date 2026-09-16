/**
 * Information Integrity.
 *
 * Canon puts a plentiful unreliable channel against a rare accurate one, and
 * the system only means anything if the two can disagree. That makes the
 * interesting failure a quiet one: a build where nothing contradicts anything
 * plays exactly like a build where the system works, and just has no system in
 * it. So the pairing is arithmetic, and this is where it is checked.
 */
import { describe, expect, it } from 'vitest';
import { accuracyHeld, channel, pairings, placeNote, type NoteDef } from '../notes';
import { content } from '../content';

const bulletin: NoteDef = {
  id: 'b',
  channel: 'bulletin',
  biome: 'plains_forest',
  title: 'NOTICE 1-2',
  text: 'It is not a test.',
};
const note: NoteDef = {
  id: 'j',
  channel: 'jakindur',
  biome: 'plains_forest',
  title: 'Scratched into a burl',
  text: 'It is a test.',
  contradicts: 'b',
};
const all = [bulletin, note];

describe('a contradiction', () => {
  it('shows only when the player is holding both halves', () => {
    expect(pairings(all, new Set(['b', 'j']))).toHaveLength(1);
  });

  it('stays hidden with only the accurate half', () => {
    // Otherwise the player is handed the conclusion without ever having read
    // the claim, which is the one thing this system asks them to do themselves.
    expect(pairings(all, new Set(['j']))).toEqual([]);
  });

  it('stays hidden with only the unreliable half', () => {
    expect(pairings(all, new Set(['b']))).toEqual([]);
  });

  it('is nothing at all when the player is holding nothing', () => {
    expect(pairings(all, new Set())).toEqual([]);
  });

  it('survives a note pointing at something that no longer exists', () => {
    const orphan = { ...note, contradicts: 'deleted_in_a_rebalance' };
    expect(() => pairings([orphan], new Set(['j']))).not.toThrow();
    expect(pairings([orphan], new Set(['j']))).toEqual([]);
  });
});

describe('how much of the accurate channel is held', () => {
  it('counts only the rare channel', () => {
    expect(accuracyHeld(all, new Set(['b', 'j']))).toEqual({ found: 1, total: 1 });
    expect(accuracyHeld(all, new Set(['b']))).toEqual({ found: 0, total: 1 });
  });
});

describe('where a note lies', () => {
  const disc = { x: 100, y: -50, radius: 1000 };

  it('is the same place on every run', () => {
    expect(placeNote(note, disc, 0.1)).toEqual(placeNote(note, disc, 0.1));
  });

  it('is not the same place as its neighbour', () => {
    const other = placeNote({ ...note, id: 'j2' }, disc, 0.1);
    const first = placeNote(note, disc, 0.1);
    expect(Math.hypot(other.x - first.x, other.y - first.y)).toBeGreaterThan(50);
  });

  it('stays inside the region it belongs to', () => {
    for (const def of content.notes) {
      const at = placeNote(def, disc, 0.1);
      expect(Math.hypot(at.x - disc.x, at.y - disc.y)).toBeLessThanOrEqual(disc.radius);
    }
  });

  it('puts the rare channel further out than the bulletins', () => {
    // He was not posting them where a notice board would go, and it is what
    // makes finding one mean the player actually explored.
    const far = Math.hypot(placeNote(note, disc, 0.1).x - disc.x, placeNote(note, disc, 0.1).y - disc.y);
    const near = Math.hypot(
      placeNote(bulletin, disc, 0.1).x - disc.x,
      placeNote(bulletin, disc, 0.1).y - disc.y,
    );
    expect(far).toBeGreaterThan(near);
  });
});

describe('the shipped notes', () => {
  it('are plentiful on one channel and rare on the other', () => {
    const loud = channel(content.notes, 'bulletin');
    const quiet = channel(content.notes, 'jakindur');
    expect(quiet.length).toBeGreaterThan(0);
    expect(loud.length).toBeGreaterThan(quiet.length * 2);
  });

  it('give every region something the system claims about it', () => {
    for (const biome of content.biomes) {
      expect(channel(content.notes, 'bulletin').some((n) => n.biome === biome.id)).toBe(true);
    }
  });

  it('let every one of the rare channel disagree with something', () => {
    const ids = new Set(content.notes.map((n) => n.id));
    for (const n of channel(content.notes, 'jakindur')) {
      expect(n.contradicts).toBeTruthy();
      expect(ids.has(n.contradicts!)).toBe(true);
    }
  });

  it('produce a full set of disagreements for a player who found everything', () => {
    const everything = new Set(content.notes.map((n) => n.id));
    expect(pairings(content.notes, everything)).toHaveLength(
      channel(content.notes, 'jakindur').length,
    );
  });
});
