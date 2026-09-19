/**
 * The four under the thumb.
 *
 * Worth testing because every failure here is silent: a removal that does not
 * stick, a saved bar quietly refilled on load, or a full bar that evicts
 * something instead of saying no. All three look like the game working.
 */
import { describe, expect, it } from 'vitest';
import { admit, toggleCarried, LOADOUT_SLOTS } from '../loadout';

describe('toggleCarried', () => {
  it('adds to a bar with room', () => {
    expect(toggleCarried(['gust'], 'torrent')).toEqual({
      carried: ['gust', 'torrent'],
      change: 'added',
    });
  });

  it('removes something already carried', () => {
    expect(toggleCarried(['gust', 'torrent'], 'gust')).toEqual({
      carried: ['torrent'],
      change: 'removed',
    });
  });

  it('refuses rather than evicting when the bar is full', () => {
    const full = ['a', 'b', 'c', 'd'];
    const result = toggleCarried(full, 'e');
    expect(result.change).toBe('full');
    expect(result.carried).toEqual(full);
  });

  it('can always take something off a full bar', () => {
    expect(toggleCarried(['a', 'b', 'c', 'd'], 'c').carried).toEqual(['a', 'b', 'd']);
  });

  it('never mutates the array it was given', () => {
    const before = ['gust'];
    toggleCarried(before, 'torrent');
    expect(before).toEqual(['gust']);
  });
});

describe('admit', () => {
  it('hands over everything newly unlocked, up to the slot count', () => {
    const state = admit({ carried: [], known: [] }, ['a', 'b', 'c', 'd', 'e', 'f']);
    expect(state.carried).toEqual(['a', 'b', 'c', 'd']);
    // Everything was offered, even what did not fit - otherwise the two that
    // missed out would be handed over again on every single refresh.
    expect(state.known).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('leaves a deliberate removal removed', () => {
    const first = admit({ carried: [], known: [] }, ['a', 'b']);
    const after = { carried: first.carried.filter((id) => id !== 'a'), known: first.known };
    expect(admit(after, ['a', 'b']).carried).toEqual(['b']);
  });

  it('fills the slot a removal freed with the next new thing', () => {
    const state = admit({ carried: ['a', 'b'], known: ['a', 'b'] }, ['a', 'b', 'c']);
    expect(state.carried).toEqual(['a', 'b', 'c']);
  });

  it('drops a combination the content no longer defines', () => {
    const state = admit({ carried: ['a', 'gone'], known: ['a', 'gone'] }, ['a']);
    expect(state.carried).toEqual(['a']);
    // And forgets it was ever offered, so a rename does not permanently
    // consume a slot's worth of memory.
    expect(state.known).toEqual(['a']);
  });

  it('re-offers something that comes back after being unavailable', () => {
    const away = admit({ carried: ['a', 'b'], known: ['a', 'b'] }, ['a']);
    expect(away.carried).toEqual(['a']);
    expect(admit(away, ['a', 'b']).carried).toEqual(['a', 'b']);
  });

  it('keeps the player order rather than the content order', () => {
    const state = admit({ carried: ['c', 'a'], known: ['a', 'b', 'c'] }, ['a', 'b', 'c']);
    expect(state.carried).toEqual(['c', 'a']);
  });

  it('is idempotent, because it runs on every level-up and every load', () => {
    const once = admit({ carried: [], known: [] }, ['a', 'b', 'c']);
    expect(admit(once, ['a', 'b', 'c'])).toEqual(once);
  });

  it('holds four, which is what the arc has room to draw', () => {
    expect(LOADOUT_SLOTS).toBe(4);
  });
});
