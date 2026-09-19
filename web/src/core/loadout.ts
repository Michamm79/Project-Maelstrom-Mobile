/**
 * Which combinations are under your thumb.
 *
 * The cast bar drew one button per combination the player had unlocked, which
 * was fine at three and stops being fine immediately after: the arc runs up the
 * right-hand side of a phone held sideways, and there is room for four circles
 * before they start walking off the top of the screen or over the menu button.
 *
 * So the arc holds four and the workshop is where you decide which four. That
 * is the honest version of what canon already promised - "Level 1 hands you a
 * couple of tools someone else made, Level 2 gives you the workshop" - because
 * a workshop whose entire output is automatically strapped to your hand is a
 * cupboard, not a workshop.
 *
 * Pure on purpose. Everything here is array arithmetic with no DOM and no
 * content lookup, which is what lets the awkward cases - a saved loadout naming
 * something the content no longer defines, a new combination unlocking while
 * the bar is full - be tested rather than discovered.
 */
import type { CombinationId } from './types';

/** How many fit on the arc. See the CSS: `.skillarc .skill:nth-child(2..4)`. */
export const LOADOUT_SLOTS = 4;

export type LoadoutChange = 'added' | 'removed' | 'full';

export interface ToggleResult {
  carried: CombinationId[];
  change: LoadoutChange;
}

/**
 * Put a combination on the bar, or take it off.
 *
 * A full bar refuses rather than silently evicting something: the player is
 * looking at four things they chose, and having one of them quietly replaced by
 * the row they just tapped is how a loadout becomes a thing people stop
 * touching.
 */
export function toggleCarried(
  carried: readonly CombinationId[],
  id: CombinationId,
  slots = LOADOUT_SLOTS,
): ToggleResult {
  if (carried.includes(id)) {
    return { carried: carried.filter((c) => c !== id), change: 'removed' };
  }
  if (carried.length >= slots) return { carried: [...carried], change: 'full' };
  return { carried: [...carried, id], change: 'added' };
}

export interface LoadoutState {
  carried: CombinationId[];
  /**
   * Every combination that has already been offered a slot.
   *
   * Without it, taking something off the bar lasted until the next refresh:
   * the fill pass saw a free slot and an available combination and put it
   * straight back. This is what makes a removal mean something.
   */
  known: CombinationId[];
}

/**
 * Reconcile the bar against what is actually available right now.
 *
 * Two jobs, and they have to happen in this order. Anything no longer available
 * - a combination the content dropped, or one from a save written against a
 * different bundle - comes off first, because it frees a slot. Then anything
 * newly unlocked goes on, so reaching a level that hands you something new does
 * not also hand you a menu to go and find it in.
 */
export function admit(
  state: LoadoutState,
  available: readonly CombinationId[],
  slots = LOADOUT_SLOTS,
): LoadoutState {
  const offered = new Set(available);
  const carried = state.carried.filter((id) => offered.has(id));
  const known = new Set(state.known.filter((id) => offered.has(id)));

  for (const id of available) {
    if (known.has(id)) continue;
    known.add(id);
    if (carried.length < slots) carried.push(id);
  }

  return { carried, known: [...known] };
}
