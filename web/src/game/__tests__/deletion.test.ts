/**
 * How a rendering comes apart.
 *
 * The timeline is the part worth asserting, because every way it can be wrong
 * still produces a screenshot full of binary: a sweep running the wrong way, a
 * shape that scatters before anyone can read it, glyphs that outlive the effect
 * that owns them. None of those throw.
 */
import { describe, expect, it } from 'vitest';
import { DELETION_SECONDS, glyphPhase, type Glyph } from '../deletion';

/** `oy` grows downward, so a smaller oy is higher up the creature. */
const glyph = (oy: number, delay: number): Glyph => ({
  ox: 0,
  oy,
  vx: 0,
  vy: -40,
  bit: 0,
  delay,
  flicker: 10,
});

describe('the conversion sweep', () => {
  /*
   * The delay is built from how far up the creature a point sits, so the feet
   * convert first. Backwards, the effect runs down from the head - which looks
   * fine and is the opposite of a thing being deleted out from under itself.
   */
  it('reaches the feet before the head', () => {
    const feet = glyph(20, 0);
    const head = glyph(-20, 0.3);
    const early = 0.15;
    expect(glyphPhase(early, feet)).not.toBeNull();
    expect(glyphPhase(early, head)).toBeNull();
  });

  it('shows nothing at all during the flash', () => {
    expect(glyphPhase(0.05, glyph(0, 0))).toBeNull();
  });
});

describe('the shape holds before it leaves', () => {
  const g = glyph(0, 0);

  it('stays put while the silhouette is being read', () => {
    const early = glyphPhase(0.18, g);
    expect(early).not.toBeNull();
    // Still within a glyph's width of where the creature had a pixel.
    expect(Math.abs(early!.y - g.oy)).toBeLessThan(5);
  });

  it('and has travelled by the end', () => {
    const late = glyphPhase(DELETION_SECONDS * 0.95, g);
    expect(late!.y).toBeLessThan(g.oy - 20);
  });

  it('fades out rather than cutting off', () => {
    const mid = glyphPhase(DELETION_SECONDS * 0.5, g)!;
    const late = glyphPhase(DELETION_SECONDS * 0.95, g)!;
    expect(late.alpha).toBeLessThan(mid.alpha);
    expect(late.alpha).toBeGreaterThanOrEqual(0);
  });

  /*
   * White at the point of conversion and the creature's own colour afterwards,
   * which is what makes a sweep visible as a sweep rather than as a block of
   * digits appearing all in one tone.
   */
  it('is white only for the moment it stops being a creature', () => {
    expect(glyphPhase(0.12, g)!.hot).toBe(true);
    expect(glyphPhase(0.6, g)!.hot).toBe(false);
  });

  it('flickers between the two digits', () => {
    const seen = new Set<number>();
    for (let age = 0.11; age < 0.9; age += 0.02) seen.add(glyphPhase(age, g)!.bit);
    expect(seen).toEqual(new Set([0, 1]));
  });

  /*
   * A glyph that converted late gets a shorter life rather than a later end,
   * so the whole effect finishes together and nothing is left hanging over the
   * ground after the deletion is notionally done.
   */
  it('is finished by the time the effect is, however late it converted', () => {
    for (const delay of [0, 0.15, 0.3]) {
      const phase = glyphPhase(DELETION_SECONDS, glyph(0, delay));
      expect(phase!.k).toBe(1);
      expect(phase!.alpha).toBe(0);
    }
  });
});
