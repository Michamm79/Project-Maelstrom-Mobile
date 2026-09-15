/**
 * The screen box: which way up it sits, and how much world it shows.
 *
 * Both of these are silent when wrong. A rotation that swaps the axes does not
 * throw, it walks the player sideways; a zoom clamp that swallows a setting
 * does not throw either, it just hands back the same view as the step below.
 * So the arithmetic is separated from the DOM and asserted directly.
 */
import { describe, expect, it } from 'vitest';
import { layoutFor, localPoint, VIEW_ORDER, VIEW_SPANS, type Turn } from '../screen';
import { zoomFor } from '../renderer';

const LANDSCAPE = { landscape: true, turn: 'cw' as Turn };
const FREE = { landscape: false, turn: 'cw' as Turn };

/** A phone, held upright, with the OS refusing to rotate. */
const PORTRAIT = [412, 915] as const;
/** The same phone once something has turned it. */
const TURNED = [915, 412] as const;

describe('holding the game sideways', () => {
  it('turns a portrait viewport into a landscape box', () => {
    const box = layoutFor(...PORTRAIT, LANDSCAPE);
    expect(box.rotate).toBe('cw');
    expect(box.width).toBe(915);
    expect(box.height).toBe(412);
  });

  it('leaves the box alone once the device is already landscape', () => {
    const box = layoutFor(...TURNED, LANDSCAPE);
    expect(box.rotate).toBeNull();
    expect([box.width, box.height]).toEqual([915, 412]);
  });

  /*
   * The whole point of asking the OS first: a lock that worked shows up as a
   * landscape viewport, and rotating on top of that would turn the game face
   * down. That is the case above, and it is the ONLY evidence a granted lock
   * gets to offer.
   *
   * Because the other case is real and shipped broken: a browser can resolve
   * `screen.orientation.lock()` and rotate nothing. CI runs on one. Trusting
   * the promise meant a player pressed Begin and landed back in portrait with
   * the fallback switched off - stranded by the call meant to help them.
   */
  it('keeps holding the game sideways when a granted lock turned nothing', () => {
    expect(layoutFor(...PORTRAIT, LANDSCAPE).rotate).toBe('cw');
  });

  /*
   * A tall narrow desktop window - a docked inspector, a split screen - is not
   * a phone, and rotating it would leave the game unreadable with no way to
   * turn the monitor.
   */
  it('leaves a window alone, however tall, when nothing can hold it', () => {
    expect(layoutFor(...PORTRAIT, LANDSCAPE, /* touch */ false).rotate).toBeNull();
    expect(layoutFor(...PORTRAIT, LANDSCAPE, /* touch */ true).rotate).toBe('cw');
  });

  it('does nothing at all when the player turns the setting off', () => {
    expect(layoutFor(...PORTRAIT, FREE).rotate).toBeNull();
    expect(layoutFor(...PORTRAIT, FREE).width).toBe(412);
  });

  it('gives the same box either way it is turned', () => {
    const cw = layoutFor(...PORTRAIT, { landscape: true, turn: 'cw' });
    const ccw = layoutFor(...PORTRAIT, { landscape: true, turn: 'ccw' });
    expect([cw.width, cw.height]).toEqual([ccw.width, ccw.height]);
  });

  /*
   * The HUD's compact layout used to come from `@media (orientation:
   * landscape)`, which asks the viewport - still portrait while we hold a
   * landscape box inside it. These two flags replace that question, so they
   * have to describe the BOX.
   */
  it('reports the shape of the box, not of the viewport', () => {
    const box = layoutFor(...PORTRAIT, LANDSCAPE);
    expect(box.squat).toBe(true);
    expect(box.wide).toBe(true);

    const upright = layoutFor(...PORTRAIT, FREE);
    expect(upright.squat).toBe(false);
    expect(upright.wide).toBe(false);
  });
});

describe('touches land where they were aimed', () => {
  const box = layoutFor(...PORTRAIT, LANDSCAPE);

  it('maps every corner of the viewport to a corner of the box', () => {
    // Viewport is 412x915; the box inside it is 915x412.
    expect(localPoint(0, 0, box)).toEqual({ x: 915, y: 0 });
    expect(localPoint(412, 0, box)).toEqual({ x: 915, y: 412 });
    expect(localPoint(0, 915, box)).toEqual({ x: 0, y: 0 });
    expect(localPoint(412, 915, box)).toEqual({ x: 0, y: 412 });
  });

  it('keeps every touch inside the box', () => {
    for (let x = 0; x <= 412; x += 41) {
      for (let y = 0; y <= 915; y += 61) {
        const at = localPoint(x, y, box);
        expect(at.x).toBeGreaterThanOrEqual(0);
        expect(at.x).toBeLessThanOrEqual(box.width);
        expect(at.y).toBeGreaterThanOrEqual(0);
        expect(at.y).toBeLessThanOrEqual(box.height);
      }
    }
  });

  /*
   * The bug this exists to prevent, stated as the player experiences it.
   *
   * The stick only claims the left 62% of the screen. Read through a bounding
   * rect, a rotated box reports its axis-aligned cover and "left" becomes an
   * axis that is not there any more: the thumb reaching for the attack button
   * would grab the stick instead, and the stick would walk the player sideways.
   */
  it('puts the steering half on the player left and the action half on their right', () => {
    const player = (vx: number, vy: number) => localPoint(vx, vy, box).x / box.width;
    // Turned clockwise the game's top edge is along the phone's right, so the
    // player's left - the steering half - is the HIGH end of the viewport's y.
    expect(player(206, 850)).toBeLessThan(0.3);
    expect(player(206, 60)).toBeGreaterThan(0.7);
  });

  it('preserves distance, so the stick deflects by what the thumb moved', () => {
    const a = localPoint(100, 300, box);
    const b = localPoint(140, 340, box);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(Math.hypot(40, 40), 6);
  });

  it('changes nothing while the box is upright', () => {
    const upright = layoutFor(...TURNED, LANDSCAPE);
    expect(localPoint(123, 45, upright)).toEqual({ x: 123, y: 45 });
  });

  it('is turned the other way round by the other turn direction', () => {
    const ccw = layoutFor(...PORTRAIT, { landscape: true, turn: 'ccw' });
    // Top-left of the viewport is the opposite corner of the box from `cw`.
    expect(localPoint(0, 0, ccw)).toEqual({ x: 0, y: 412 });
  });
});

describe('how much world is on screen', () => {
  it('steps wider in the order the menu lists them', () => {
    const spans = VIEW_ORDER.map((v) => VIEW_SPANS[v]);
    expect(spans).toEqual([...spans].sort((a, b) => a - b));
  });

  /*
   * The complaint that started this: a phone held sideways showed 700x315
   * world units, and the playfield read as a letterbox.
   */
  it('shows meaningfully more ground than the 700 it replaced', () => {
    const [w, h] = TURNED;
    const before = { w: w / zoomFor(w, h, 700), h: h / zoomFor(w, h, 700) };
    const after = { w: w / zoomFor(w, h, VIEW_SPANS.normal), h: h / zoomFor(w, h, VIEW_SPANS.normal) };
    expect(after.w / before.w).toBeGreaterThan(1.25);
    expect(after.h / before.h).toBeGreaterThan(1.25);
  });

  /*
   * The floor used to be 0.9, which meant Wide and Normal drew the same view on
   * a phone - a setting that silently did nothing. Each step has to actually
   * move on the device the game is for.
   */
  it('gives every step a different view on a phone', () => {
    const [w, h] = TURNED;
    const widths = VIEW_ORDER.map((v) => Math.round(w / zoomFor(w, h, VIEW_SPANS[v])));
    expect(new Set(widths).size).toBe(VIEW_ORDER.length);
  });

  it('keeps the character legible at the widest setting', () => {
    // The sprite is 24px of art drawn at 2x, so 48 world units tall.
    const [w, h] = TURNED;
    const pixels = 48 * zoomFor(w, h, VIEW_SPANS.wide);
    expect(pixels).toBeGreaterThan(36);
  });

  it('turning the phone shows the same view, rotated', () => {
    const portrait = layoutFor(...PORTRAIT, FREE);
    const landscape = layoutFor(...TURNED, FREE);
    const span = VIEW_SPANS.normal;
    const p = {
      w: portrait.width / zoomFor(portrait.width, portrait.height, span),
      h: portrait.height / zoomFor(portrait.width, portrait.height, span),
    };
    const l = {
      w: landscape.width / zoomFor(landscape.width, landscape.height, span),
      h: landscape.height / zoomFor(landscape.width, landscape.height, span),
    };
    expect(p.w).toBeCloseTo(l.h, 6);
    expect(p.h).toBeCloseTo(l.w, 6);
  });
});
