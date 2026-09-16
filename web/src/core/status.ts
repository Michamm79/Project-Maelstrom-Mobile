/**
 * What a combination leaves behind on the person who cast it.
 *
 * Canon gives four of the ten elements domains that are not damage at all -
 * Umbrel is "absorption, dampening, concealment", Solvane is "radiance,
 * revealing", Ferrune is "metal, structure", Sporel is "organic growth, decay"
 * - and every one of them had no combination, because the effect vocabulary
 * could only express hitting things. These are the timers that let a
 * combination do what those words say.
 *
 * Pure arithmetic, deliberately. A shield that silently fails to absorb, or a
 * heal that pays out twice on a long frame, looks exactly like the game working
 * and would only ever be noticed as "that felt wrong" - so it is arithmetic
 * that can be asserted rather than behaviour that has to be watched.
 */

export interface PlayerStatus {
  /** Damage still to be soaked before health is touched. */
  shield: number;
  /** Seconds before what is left of the shield lapses. */
  shieldFor: number;
  /** Health still owed, and the rate it is paid at. */
  healLeft: number;
  healRate: number;
  /** Seconds during which nothing notices the player. */
  hidden: number;
  /** Seconds during which everything nearby is marked on screen. */
  revealed: number;
}

export function freshStatus(): PlayerStatus {
  return { shield: 0, shieldFor: 0, healLeft: 0, healRate: 0, hidden: 0, revealed: 0 };
}

/**
 * Advance every timer and report the health the heal paid this frame.
 *
 * The heal is returned rather than applied because clamping to maxHp belongs to
 * whoever owns the health bar - but the payment still has to come off healLeft
 * here, or a heal cast at full health would sit there and pay out again later.
 */
export function tickStatus(status: PlayerStatus, dt: number): number {
  status.hidden = Math.max(0, status.hidden - dt);
  status.revealed = Math.max(0, status.revealed - dt);

  if (status.shieldFor > 0) {
    status.shieldFor = Math.max(0, status.shieldFor - dt);
    // Lapsed: what is left of it goes with the timer rather than lingering as
    // an invisible buffer the player has no way to know about.
    if (status.shieldFor === 0) status.shield = 0;
  }

  if (status.healLeft <= 0) return 0;
  const paid = Math.min(status.healLeft, status.healRate * dt);
  status.healLeft -= paid;
  return paid;
}

export interface Absorbed {
  /** What the shield took. */
  soaked: number;
  /** What got through to health. */
  through: number;
}

/**
 * Put a hit against the shield first.
 *
 * A shield that only blocks a hit it can fully stop would make a 12-point
 * Minotaur blow ignore an 11-point shield entirely, which is the opposite of
 * what "absorption" means - so it soaks what it can and the rest lands.
 */
export function absorbDamage(status: PlayerStatus, amount: number): Absorbed {
  if (amount <= 0) return { soaked: 0, through: 0 };
  const soaked = Math.min(status.shield, amount);
  status.shield -= soaked;
  if (status.shield <= 0) status.shieldFor = 0;
  return { soaked, through: amount - soaked };
}

/**
 * Start a heal, or refresh one already running.
 *
 * Whatever was still owed rolls into the new one rather than being thrown away,
 * because a player who casts it twice under pressure has spent twice and should
 * not be punished for the timing.
 */
export function beginHeal(status: PlayerStatus, amount: number, seconds: number): void {
  if (amount <= 0 || seconds <= 0) return;
  status.healLeft += amount;
  status.healRate = status.healLeft / seconds;
}

/** Raise a shield. A stronger one replaces a weaker one; a weaker one is ignored. */
export function raiseShield(status: PlayerStatus, amount: number, seconds: number): void {
  if (amount <= 0 || seconds <= 0) return;
  if (amount < status.shield) {
    // Refresh the clock on what is already there rather than downgrading it:
    // the player cast something, so something should have happened.
    status.shieldFor = Math.max(status.shieldFor, seconds);
    return;
  }
  status.shield = amount;
  status.shieldFor = seconds;
}
