/**
 * What the world says, and how often.
 *
 * The failure worth guarding is repetition: a reading about a thing coming
 * apart into digits is worth something once and is noise on the fortieth kill,
 * and "fires every time" looks exactly like "fires" until you play for a while.
 */
import { describe, expect, it } from 'vitest';
import { content } from '../content';
import { FRAGMENT_TRIGGERS, fragmentFor, type Fragment } from '../fragments';

const all = content.fragments as readonly Fragment[];

describe('the world speaks once', () => {
  it('has something to say at every moment the game raises', () => {
    for (const trigger of FRAGMENT_TRIGGERS) {
      expect(fragmentFor(all, trigger, new Set())).not.toBeNull();
    }
  });

  it('says it the first time and never again', () => {
    const seen = new Set<string>();
    const first = fragmentFor(all, 'firstKill', seen);
    expect(first).not.toBeNull();
    seen.add(first!.id);
    expect(fragmentFor(all, 'firstKill', seen)).toBeNull();
  });

  it('keeps the moments separate', () => {
    const seen = new Set<string>();
    const kill = fragmentFor(all, 'firstKill', seen)!;
    seen.add(kill.id);
    // Reading one does not spend another.
    expect(fragmentFor(all, 'firstCraft', seen)).not.toBeNull();
  });

  /*
   * Two on one trigger would stack and the player would see whichever drew
   * last, which is a content mistake rather than a code one - so the build
   * rejects it and this proves the built bundle is clean.
   */
  it('never puts two readings on the same moment', () => {
    const byTrigger = all.map((fragment) => fragment.on);
    expect(new Set(byTrigger).size).toBe(byTrigger.length);
  });

  it('stays short enough to read while something walks at you', () => {
    for (const fragment of all) {
      expect(fragment.text.length).toBeLessThanOrEqual(240);
      expect(fragment.title.length).toBeGreaterThan(0);
    }
  });
});

describe('the waking scene', () => {
  /*
   * It holds the game before the player has any control, so its length is a
   * soft lock rather than a style question. The content build caps the total;
   * this is the same promise stated where a reader of the scene will see it.
   */
  it('is over before anyone would put the phone down', () => {
    const { lines, lineSeconds, fadeSeconds } = content.opening;
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines.length * lineSeconds).toBeLessThanOrEqual(15);
    expect(fadeSeconds).toBeGreaterThan(0);
  });

  it('never opens on an empty line', () => {
    for (const line of content.opening.lines) expect(line.trim().length).toBeGreaterThan(0);
  });
});
