/**
 * Combat resolution.
 *
 * Canon has no weapon items and no melee swing: every offensive option is an
 * alchemical combination, so what gets resolved here is an ability landing on
 * whatever is in its shape. The previous build had a weapon-damage model taken
 * from the Unity prototype; there is nothing in the GDD for it to implement.
 */
import type { AlchemyCombination } from './types';

export interface Hittable {
  x: number;
  y: number;
  hp: number;
  dead: boolean;
}

export interface AbilityHit<T extends Hittable> {
  target: T;
  damage: number;
  /** Unit vector the hit pushes along. */
  pushX: number;
  pushY: number;
}

/**
 * Who an ability catches, given where the player is and which way they face.
 *
 *   shove / burst - everything inside a radius, no aiming required
 *   beam          - everything within range inside a forward cone
 *   chain         - one target inside range, then leaps of radius to the next
 *   self          - nobody at all
 *
 * A beam is the only shape that can miss by being aimed wrongly, and it is
 * deliberately generous: canon's whole gathering rule is that the player never
 * has to aim precisely, and an ability that demanded it would sit badly
 * against that.
 */
const BEAM_HALF_ANGLE = Math.PI / 5;

/**
 * What a chain keeps after each leap.
 *
 * A constant rather than a content knob because it is not a tuning decision,
 * it is the reason a chain is not simply a burst that ignores walls: without
 * falloff, four full-damage hits for the price of one makes every radius
 * ability pointless, and with it a chain is a good opener into a crowd and a
 * poor finisher on anything that survived.
 */
const CHAIN_FALLOFF = 0.75;

export function abilityTargets<T extends Hittable>(
  combination: AlchemyCombination,
  originX: number,
  originY: number,
  facing: number,
  candidates: readonly T[],
): AbilityHit<T>[] {
  const { kind, damage, radius, range } = combination.effect;
  // Nothing to catch: the whole effect lands on the caster, and returning here
  // rather than falling through means a self-cast can never accidentally do
  // damage by being given a radius.
  if (kind === 'self') return [];
  if (kind === 'chain') return chainTargets(combination, originX, originY, candidates);

  const reach = kind === 'beam' ? (range ?? 0) : (radius ?? 0);
  const hits: AbilityHit<T>[] = [];

  for (const target of candidates) {
    if (target.dead) continue;
    const dx = target.x - originX;
    const dy = target.y - originY;
    const distance = Math.hypot(dx, dy);
    if (distance > reach) continue;

    if (kind === 'beam' && distance > 1) {
      let delta = Math.atan2(dy, dx) - facing;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      if (Math.abs(delta) > BEAM_HALF_ANGLE) continue;
    }

    const length = distance > 0.001 ? distance : 1;
    hits.push({ target, damage, pushX: dx / length, pushY: dy / length });
  }
  return hits;
}

/**
 * A charge that walks from one target to the next.
 *
 * `range` is how far the first link reaches from the caster; `radius` is how
 * far it will leap from each target to the one after. The push is away from
 * the previous link rather than away from the player, so a chain scatters a
 * group outward from itself instead of sweeping it all one way - which is what
 * makes it read as conduction rather than as a differently shaped shove.
 */
function chainTargets<T extends Hittable>(
  combination: AlchemyCombination,
  originX: number,
  originY: number,
  candidates: readonly T[],
): AbilityHit<T>[] {
  const { damage, radius, range, jumps } = combination.effect;
  const hits: AbilityHit<T>[] = [];
  const taken = new Set<T>();

  let fromX = originX;
  let fromY = originY;
  let reach = range ?? 0;
  let carried = damage;

  for (let link = 0; link <= (jumps ?? 0); link++) {
    let best: T | null = null;
    let bestDistance = reach;
    for (const target of candidates) {
      if (target.dead || taken.has(target)) continue;
      const distance = Math.hypot(target.x - fromX, target.y - fromY);
      if (distance <= bestDistance) {
        best = target;
        bestDistance = distance;
      }
    }
    // The chain stops where it runs out of things to reach, which is what
    // makes a lone enemy a poor target for it and a crowd a good one.
    if (!best) break;

    const dx = best.x - fromX;
    const dy = best.y - fromY;
    const length = Math.max(0.001, Math.hypot(dx, dy));
    hits.push({ target: best, damage: carried, pushX: dx / length, pushY: dy / length });

    taken.add(best);
    fromX = best.x;
    fromY = best.y;
    reach = radius ?? 0;
    carried *= CHAIN_FALLOFF;
  }

  return hits;
}

/** Apply damage and report whether this was the killing blow. */
export function applyDamage(target: Hittable, amount: number): boolean {
  if (target.dead) return false;
  target.hp = Math.max(0, target.hp - amount);
  if (target.hp > 0) return false;
  target.dead = true;
  return true;
}
