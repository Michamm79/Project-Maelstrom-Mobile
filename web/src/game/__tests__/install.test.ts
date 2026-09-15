/**
 * Which install offer a player should see.
 *
 * The precedence is the whole feature. Get it wrong and the failure is not an
 * error, it is a button offering to install the game to somebody who is already
 * running it from their home screen — which is exactly how a prompt teaches
 * people to stop reading that corner of the screen.
 */
import { describe, expect, it } from 'vitest';
import { installState } from '../install';

const at = (standalone: boolean, deferred: boolean, ios: boolean) =>
  installState({ standalone, deferred, ios });

describe('what to offer, and to whom', () => {
  it('offers the real prompt when the browser handed one over', () => {
    expect(at(false, true, false)).toBe('ready');
  });

  it('falls back to instructions on a platform that has no prompt', () => {
    expect(at(false, false, true)).toBe('manual');
  });

  it('offers nothing where there is neither', () => {
    expect(at(false, false, false)).toBe('unavailable');
  });

  /*
   * Installed wins over everything, including a prompt the browser fired
   * anyway. A second copy is not a thing anyone wants.
   */
  it('never offers an install to someone who has already installed it', () => {
    expect(at(true, false, false)).toBe('installed');
    expect(at(true, true, false)).toBe('installed');
    expect(at(true, true, true)).toBe('installed');
    expect(at(true, false, true)).toBe('installed');
  });

  /*
   * iOS can fire nothing, so `deferred` there means some future Safari grew the
   * event. If it ever does, the real prompt should win over our instructions
   * without anyone having to remember to come back and change this.
   */
  it('prefers a real prompt to instructions, even on iOS', () => {
    expect(at(false, true, true)).toBe('ready');
  });
});
