/**
 * Combat rules, kept free of rendering and of the world so they can be reasoned
 * about and tested directly.
 *
 * The central design decision: there is no equip slot. Damage is the base plus
 * the strongest weapon you happen to be carrying, which makes the tech tree
 * itself the combat progression. Crafting an Iron Sword is the upgrade - there
 * is no second step where you remember to equip it.
 */
import type { Content } from './content';
import type { CombatConfig, MaterialId } from './types';

export interface Attacker {
  x: number;
  y: number;
  /** Facing in radians. */
  facing: number;
}

export interface Damageable {
  x: number;
  y: number;
  hp: number;
}

/** The best weapon in a set of carried materials, or null when unarmed. */
export function bestWeapon(
  content: Content,
  carried: Iterable<MaterialId>,
): { material: MaterialId; damage: number } | null {
  let best: { material: MaterialId; damage: number } | null = null;

  for (const id of carried) {
    if (!content.hasMaterial(id)) continue;
    const damage = content.material(id).damage;
    if (damage === undefined) continue;
    if (!best || damage > best.damage) best = { material: id, damage };
  }
  return best;
}

/** Total damage per swing: base plus the best carried weapon. */
export function playerDamage(content: Content, carried: Iterable<MaterialId>): number {
  return content.progression.combat.baseDamage + (bestWeapon(content, carried)?.damage ?? 0);
}

/**
 * Is the target inside the swing? Range plus an arc in front of the attacker,
 * rather than a plain circle - swinging away from something should miss it.
 */
export function inSwing(
  attacker: Attacker,
  target: { x: number; y: number },
  config: CombatConfig,
): boolean {
  const dx = target.x - attacker.x;
  const dy = target.y - attacker.y;
  if (Math.hypot(dx, dy) > config.attackRange) return false;

  const toTarget = Math.atan2(dy, dx);
  return Math.abs(angleDelta(toTarget, attacker.facing)) <= config.attackArc;
}

/** Smallest signed difference between two angles, in (-PI, PI]. */
export function angleDelta(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/** Apply damage, clamping at zero. Returns whether this blow was lethal. */
export function applyDamage(target: Damageable, amount: number): boolean {
  if (amount <= 0) return false;
  target.hp = Math.max(0, target.hp - amount);
  return target.hp === 0;
}

/** Which drops a defeated enemy yields, given a roll source. */
export function rollDrops(
  drops: readonly { material: MaterialId; chance: number }[],
  roll: () => number,
): MaterialId[] {
  const out: MaterialId[] = [];
  for (const drop of drops) {
    if (roll() < drop.chance) out.push(drop.material);
  }
  return out;
}

/**
 * How long until health starts coming back, and how fast.
 * Regen is deliberately generous: in a crafting game, dying should cost time,
 * not the materials you walked across three regions to collect.
 */
export function regenFor(config: CombatConfig, secondsSinceHit: number, dt: number): number {
  if (secondsSinceHit < config.regenDelaySeconds) return 0;
  return config.regenPerSecond * dt;
}
