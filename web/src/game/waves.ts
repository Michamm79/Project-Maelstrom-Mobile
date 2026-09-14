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
import type { Content } from '../core/content';
import type { World } from './world';

type Phase = 'idle' | 'between-bundles' | 'in-bundle';

export class WaveDirector {
  private phase: Phase = 'idle';
  private timer = 0;
  private bundleIndex = -1;
  private waveInBundle = 0;
  private liveGroups = 0;
  private cleared = 0;
  private clearedPending = 0;
  private ambientSpawned = false;

  private readonly rng = new Rng(0x5eed1234);
  private readonly messages: string[] = [];

  constructor(
    private readonly content: Content,
    private readonly world: World,
  ) {}

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
    if (level >= 1) this.arm();
    if (this.phase === 'idle') return;

    const alive = this.world.enemies.filter((e) => !e.dead).length;
    if (this.liveGroups > 0 && alive === 0) {
      this.cleared += this.liveGroups;
      this.clearedPending += this.liveGroups;
      this.liveGroups = 0;
      // The break starts now, not when the bundle began.
      if (this.waveInBundle >= this.pacing.wavesPerBundle) this.endBundle();
    }

    this.timer -= dt;
    if (this.timer > 0) return;

    if (this.phase === 'between-bundles') this.startBundle();
    else this.nextWave();
  }

  private get pacing() {
    return this.content.activePacing;
  }

  private roll(range: readonly number[]): number {
    const [min, max] = range;
    return this.rng.range(min ?? 0, max ?? min ?? 0);
  }

  private spawnAmbientOnce(): void {
    if (this.ambientSpawned) return;
    this.ambientSpawned = true;
    for (const [id, range] of Object.entries(this.content.waves.ambient)) {
      if (id.startsWith('$')) continue;
      const count = Math.round(this.roll(range as readonly number[]));
      for (let i = 0; i < count; i++) this.spawnOne(id, 260, 900);
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
    this.timer = this.roll(this.pacing.secondsBetweenBundles);
    // Canon calls the ambient population "a separate population that persists
    // BETWEEN bundles" - so it arrives once the first bundle is done, not
    // alongside it. Spawning both at once turned the combat tutorial into a
    // nine-enemy ambush.
    this.spawnAmbientOnce();
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

  private composition(): Record<string, readonly number[]> {
    const rows = this.content.waves.composition;
    const row = rows[Math.min(this.bundleIndex, rows.length - 1)] ?? rows[0] ?? {};
    return row as unknown as Record<string, readonly number[]>;
  }

  private spawnWave(): void {
    const row = this.composition();
    for (const [id, range] of Object.entries(row)) {
      if (id === 'bundleIndex' || id.startsWith('$')) continue;
      const count = Math.round(this.roll(range));
      for (let i = 0; i < count; i++) this.spawnOne(id, 420, 760);
    }
  }

  /** Enter from off the player's screen, never on top of them. */
  private spawnOne(id: string, minDistance: number, maxDistance: number): void {
    const def = this.content.enemy(id);
    const player = this.world.player;
    for (let attempt = 0; attempt < 20; attempt++) {
      const angle = this.rng.range(0, Math.PI * 2);
      const distance = this.rng.range(minDistance, maxDistance);
      const x = player.x + Math.cos(angle) * distance;
      const y = player.y + Math.sin(angle) * distance;
      if (Math.hypot(x, y) > this.world.boundaryRadius - 40) continue;
      this.world.spawn(def, x, y);
      return;
    }
  }
}
