/**
 * Enemy pressure.
 *
 * GDD section 7. The unit of pressure is the bundle - three waves - not the
 * single wave, and the shape of it matters more than the numbers:
 *
 *   - Waves inside a bundle land close together, so ignoring the first means
 *     the second arrives on top of it.
 *   - The gap to the next bundle is timed from the END of the previous one, so
 *     a player who struggles is not punished with a shorter break.
 *   - At most one full bundle is alive at once. Ignore a whole bundle and you
 *     are at maximum pressure with the next one already inbound.
 *
 * Timing is scheduled; composition is rolled. When enemies arrive is a design
 * knob, not a random one.
 */
import { Rng } from '../core/rng';
import { bundleGap, bundleMultiplier, roomFor, scaledCount } from '../core/escalation';
import type { Content } from '../core/content';
import type { World } from './world';

/**
 * `quiet` is the long exploratory stretch after the first bundle: the cycle has
 * not started yet, and nothing is scheduled. It leaves only when the player
 * reaches the level where canon says the game escalates.
 */
type Phase = 'idle' | 'between-bundles' | 'in-bundle' | 'quiet';

const WAVE_SEED = 0x5eed1234;

export class WaveDirector {
  private phase: Phase = 'idle';
  private level = 0;
  private timer = 0;
  private bundleIndex = -1;
  private waveInBundle = 0;
  private liveGroups = 0;
  private cleared = 0;
  private clearedPending = 0;
  /** How many ambient enemies the world should be holding, once it holds any. */
  private ambientTarget = 0;
  private ambientTimer = 0;

  private rng = new Rng(WAVE_SEED);
  private readonly messages: string[] = [];

  constructor(
    private readonly content: Content,
    private readonly world: World,
  ) {}

  /**
   * Back to before anything was armed, seed included, so a restarted run gets
   * the same first bundle a fresh load would.
   */
  reset(): void {
    this.phase = 'idle';
    this.level = 0;
    this.timer = 0;
    this.bundleIndex = -1;
    this.waveInBundle = 0;
    this.liveGroups = 0;
    this.cleared = 0;
    this.clearedPending = 0;
    this.ambientTarget = 0;
    this.ambientTimer = 0;
    this.messages.length = 0;
    this.rng = new Rng(WAVE_SEED);
  }

  /**
   * Canon puts no enemies in the world at all until the player reaches Level 1.
   * Level 0 is the gathering tutorial, and it is meant to be undisturbed.
   */
  arm(): void {
    if (this.phase !== 'idle') return;
    this.phase = 'between-bundles';
    // Long enough for the warning to land and be read. Canon wants the player
    // to know something is coming, not to be standing in it already.
    this.timer = 9;
  }

  get armed(): boolean {
    return this.phase !== 'idle';
  }

  get wavesCleared(): number {
    return this.cleared;
  }

  /**
   * Every enemy is shown during the first bundle only - a tutorial affordance
   * that then fades. Permanent tracking would invert canon's stealth asymmetry:
   * enemies not knowing where you are only matters if you do not automatically
   * know where they are.
   */
  get showingEnemies(): boolean {
    return this.content.waves.showEnemiesDuringFirstBundle && this.bundleIndex <= 0;
  }

  drainMessages(): string[] {
    return this.messages.splice(0, this.messages.length);
  }

  takeClearedWaves(): number {
    const n = this.clearedPending;
    this.clearedPending = 0;
    return n;
  }

  notifyKills(_count: number): void {
    // Nothing to bank: a wave counts as cleared when the field is empty, which
    // update() notices on its own. Kept as the hook the game layer calls so the
    // two sides do not drift.
  }

  update(dt: number, level: number): void {
    if (level >= this.gates.firstBundleAtLevel) this.arm();
    if (this.phase === 'idle') return;
    this.level = level;

    /*
     * Only wave enemies decide whether a wave is cleared.
     *
     * The ambient population is a population - it is never empty, and never
     * meant to be. Counting it here would have meant that from the first
     * ambient spawn onward no wave was ever cleared, no wave XP was ever paid
     * and no bundle ever ended, with nothing anywhere reporting a problem.
     */
    const { alive, fromWaves } = this.world.census();
    if (this.liveGroups > 0 && fromWaves === 0) {
      this.cleared += this.liveGroups;
      this.clearedPending += this.liveGroups;
      this.liveGroups = 0;
      // The break starts now, not when the bundle began.
      if (this.waveInBundle >= this.pacing.wavesPerBundle) this.endBundle();
    }

    // Leaving the quiet stretch is a level event, not a timer.
    if (this.phase === 'quiet') {
      if (level < this.gates.repeatingBundlesFromLevel) return;
      this.phase = 'between-bundles';
      this.timer = this.nextGap();
      if (level >= this.gates.ambientFromLevel) this.startAmbient();
      return;
    }

    this.topUpAmbient(dt, alive);
    this.timer -= dt;
    if (this.timer > 0) return;

    if (this.phase === 'between-bundles') this.startBundle();
    else this.nextWave();
  }

  private get pacing() {
    return this.content.activePacing;
  }

  private get gates() {
    return this.content.waves.gates;
  }

  private roll(range: readonly number[]): number {
    const [min, max] = range;
    return this.rng.range(min ?? 0, max ?? min ?? 0);
  }

  /** Roll the ambient population and put it in the world, once. */
  private startAmbient(): void {
    if (this.ambientTarget > 0) return;
    for (const [id, range] of Object.entries(this.content.waves.ambient)) {
      if (id.startsWith('$')) continue;
      const count = Math.round(this.roll(range as readonly number[]));
      this.ambientTarget += count;
      for (let i = 0; i < count; i++) this.spawnOne(id, 260, 900, false);
    }
    this.ambientTimer = this.content.waves.ambientTopUpSeconds;
  }

  /**
   * Put back what the player killed, during the quiet only.
   *
   * It used to spawn exactly once, so an hour in - by which point the player
   * has walked through it several times with the gauntlets working - the world
   * between bundles was empty again and the "population that persists between
   * bundles" persisted in name only. Never during a bundle, because canon is
   * specific that this is what lives in the gaps.
   */
  private topUpAmbient(dt: number, alive: number): void {
    if (this.ambientTarget <= 0 || this.phase === 'in-bundle') return;
    this.ambientTimer -= dt;
    if (this.ambientTimer > 0) return;
    this.ambientTimer = this.content.waves.ambientTopUpSeconds;

    const short = this.ambientTarget - alive;
    if (short <= 0) return;
    const entries = Object.entries(this.content.waves.ambient).filter(([id]) => !id.startsWith('$'));
    for (let i = 0; i < roomFor(short, alive, this.content.waves.escalation); i++) {
      const pick = entries[this.rng.int(0, entries.length)];
      if (pick) this.spawnOne(pick[0], 300, 1000, false);
    }
  }

  private startBundle(): void {
    this.bundleIndex += 1;
    this.waveInBundle = 0;
    this.phase = 'in-bundle';
    this.messages.push(this.bundleIndex === 0 ? 'Three waves inbound.' : 'Another bundle is coming.');
    this.nextWave();
  }

  private endBundle(): void {
    this.phase = 'between-bundles';

    // The opening is one bundle, then quiet. Canon's production status defers
    // BOTH repeating bundles and the ambient population to a later milestone,
    // and the deck puts the escalation at Level 5 - so until then, finishing
    // the first bundle hands the world back to the player rather than starting
    // a countdown to the next siege.
    if (this.level < this.gates.repeatingBundlesFromLevel) {
      this.phase = 'quiet';
      this.timer = Number.POSITIVE_INFINITY;
      this.messages.push('Quiet again. Whatever that was, it has stopped looking.');
      return;
    }

    this.timer = this.nextGap();
    // Canon calls the ambient population "a separate population that persists
    // BETWEEN bundles", so it arrives once a bundle is done, not alongside one.
    if (this.level >= this.gates.ambientFromLevel) this.startAmbient();
  }

  /** The quiet before the next bundle, shrinking as the cycle wears on. */
  private nextGap(): number {
    return bundleGap(
      Math.max(0, this.bundleIndex),
      this.roll(this.pacing.secondsBetweenBundles),
      this.content.waves.escalation,
    );
  }

  private nextWave(): void {
    if (this.waveInBundle >= this.pacing.wavesPerBundle) {
      // Every wave of the bundle has landed; the break waits on the field
      // clearing, which update() watches for.
      this.timer = Number.POSITIVE_INFINITY;
      return;
    }

    // Hard cap: exactly one full bundle can be live. Past that the schedule
    // holds rather than piling on, which is what makes ignoring a bundle a
    // decision instead of a death sentence.
    if (this.liveGroups >= this.content.waves.maxLiveWaveGroups) {
      this.timer = 2;
      return;
    }

    this.waveInBundle += 1;
    this.liveGroups += 1;
    this.spawnWave();
    this.timer = this.roll(this.pacing.secondsBetweenWaves);
  }

  /**
   * Everything, now, at the player.
   *
   * The breach is the one moment the director stops being a schedule. It is
   * called once per interval by the game layer while the boundary is being
   * pulled apart, and it deliberately ignores bundles, gaps and phases: the
   * system is not running an assessment any more.
   *
   * Still capped, because the cap is a phone rather than a design opinion, and
   * still spawned off screen, because arriving on top of the player is not
   * difficulty.
   */
  assault(pressure: number): void {
    const rows = this.content.waves.composition;
    const row = (rows[rows.length - 1] ?? {}) as unknown as Record<string, readonly number[]>;
    for (const [id, range] of Object.entries(row)) {
      if (id === 'bundleIndex' || id.startsWith('$')) continue;
      const wanted = scaledCount(Math.round(this.roll(range)), pressure);
      const alive = this.world.census().alive;
      for (let i = 0; i < roomFor(wanted, alive, this.content.waves.escalation); i++) {
        this.spawnOne(id, 380, 700);
      }
    }
  }

  private composition(): Record<string, readonly number[]> {
    const rows = this.content.waves.composition;
    const row = rows[Math.min(this.bundleIndex, rows.length - 1)] ?? rows[0] ?? {};
    return row as unknown as Record<string, readonly number[]>;
  }

  /**
   * How much bigger this bundle is than the row that describes it.
   *
   * Past the last authored row the shape stays and the size grows, which is
   * also what finally makes the Scythe-bearer appear more than once: canon's
   * "only a few" is scarcity, and a roll of 0-to-1 scaled up is still scarce
   * while no longer being a hard limit of one for the rest of the run.
   */
  get pressure(): number {
    return bundleMultiplier(
      Math.max(0, this.bundleIndex),
      this.content.waves.composition.length,
      this.content.waves.escalation,
    );
  }

  private spawnWave(): void {
    const row = this.composition();
    const multiplier = this.pressure;
    for (const [id, range] of Object.entries(row)) {
      if (id === 'bundleIndex' || id.startsWith('$')) continue;
      const wanted = scaledCount(Math.round(this.roll(range)), multiplier);
      // The cap is a phone, not a design opinion: the roll is honoured up to
      // what the world can carry and the rest is simply not spawned.
      const alive = this.world.census().alive;
      for (let i = 0; i < roomFor(wanted, alive, this.content.waves.escalation); i++) {
        this.spawnOne(id, 420, 760);
      }
    }
  }

  /** Enter from off the player's screen, never on top of them. */
  private spawnOne(id: string, minDistance: number, maxDistance: number, fromWave = true): void {
    const def = this.content.enemy(id);
    const player = this.world.player;
    for (let attempt = 0; attempt < 20; attempt++) {
      const angle = this.rng.range(0, Math.PI * 2);
      const distance = this.rng.range(minDistance, maxDistance);
      const x = player.x + Math.cos(angle) * distance;
      const y = player.y + Math.sin(angle) * distance;
      if (Math.hypot(x, y) > this.world.boundaryRadius - 40) continue;
      this.world.spawn(def, x, y, fromWave);
      return;
    }
  }
}
