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
 *
 * A beam is the only shape that can miss, and it is deliberately generous:
 * canon's whole gathering rule is that the player never has to aim precisely,
 * and an ability that demanded it would sit badly against that.
 */
const BEAM_HALF_ANGLE = Math.PI / 5;

export function abilityTargets<T extends Hittable>(
  combination: AlchemyCombination,
  originX: number,
  originY: number,
  facing: number,
  candidates: readonly T[],
): AbilityHit<T>[] {
  const { kind, damage, radius, range } = combination.effect;
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

/** Apply damage and report whether this was the killing blow. */
export function applyDamage(target: Hittable, amount: number): boolean {
  if (target.dead) return false;
  target.hp = Math.max(0, target.hp - amount);
  if (target.hp > 0) return false;
  target.dead = true;
  return true;
}
