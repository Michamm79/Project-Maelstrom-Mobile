/**
 * Where players stop.
 *
 * Deliberately NOT a third-party analytics SDK. Dropping one of those into a
 * game aimed at the public means shipping someone else's tracker to every
 * player, taking on a consent obligation, and adding more script weight than
 * the entire game currently occupies - to answer questions that are mostly
 * answerable from the device itself.
 *
 * So: nothing leaves the device. This records a small set of first-time
 * milestones and counters in localStorage, and `report()` prints them. If a
 * hosted funnel is wanted later, this is the shape the events would take and
 * one send() is the only thing missing - but that is a decision with privacy
 * consequences and it belongs to the author, not to this file.
 */

const STORAGE_KEY = 'maelstrom.funnel.v1';

/**
 * The milestones worth knowing about, in the order a player meets them. The
 * useful question is never "how many sessions" - it is which of these is the
 * one where the numbers fall off a cliff.
 */
export const STEPS = [
  'loaded',
  'began',
  'wokeUp',
  'walked',
  'gathered',
  'gatheredWhileMoving',
  'heldThreeMaterials',
  'crafted',
  'reachedLevel1',
  'sawWarning',
  'struck',
  'killed',
  'reachedLevel2',
  /*
   * The two moments the system says something about the player.
   *
   * Neither is chosen from a menu, so these are the only evidence that anybody
   * noticed it happened - and the spread of which archetype is granted is the
   * only evidence the read is doing anything more interesting than always
   * returning the same one.
   */
  'gotRune',
  'gotClass',
  'cast',
  'leftSpawnBiome',
  'readBulletin',
  /*
   * The three that say whether Information Integrity is landing.
   *
   * The rare channel sits out near the edge of each region, so `foundNote` is
   * the number that says whether anybody is exploring past the ring the
   * material nodes cluster in - and `sawContradiction` is the only evidence
   * that the two channels are doing the one job they exist for.
   */
  'foundNote',
  'sawContradiction',
  'sawAllBiomes',
  'died',
  /*
   * The two that say whether anybody finishes.
   *
   * `startedBreach` means a player worked out what the boundary is for -
   * either from the one note that says so, or from the bar that appears when
   * they walk to the edge holding the right gauntlet. The gap between these
   * two is the only measure of whether the ending is too long a hold.
   */
  'startedBreach',
  'gotOut',
  'restarted',
  /*
   * Last because it can happen at any point, and because it is the one
   * milestone that says a player meant to come back. With no store account
   * this is the only distribution number the project has.
   */
  'installed',
] as const;

export type Step = (typeof STEPS)[number];

interface Record_ {
  /** Milestone -> ms since the run's first load. First time only. */
  first: Partial<Record<Step, number>>;
  /** Milestone -> how many times it has happened, across all sessions. */
  count: Partial<Record<Step, number>>;
  sessions: number;
  /** Total play time in ms, so a drop-off can be read against effort spent. */
  playedMs: number;
  startedAt: number;
}

function blank(): Record_ {
  return { first: {}, count: {}, sessions: 0, playedMs: 0, startedAt: Date.now() };
}

export class Funnel {
  private data: Record_ = blank();
  private readonly openedAt = Date.now();

  constructor() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Record_>;
        this.data = {
          first: parsed.first ?? {},
          count: parsed.count ?? {},
          sessions: parsed.sessions ?? 0,
          playedMs: parsed.playedMs ?? 0,
          startedAt: parsed.startedAt ?? Date.now(),
        };
      }
    } catch {
      // A blocked or corrupt store just means starting the record over; it is
      // never worth interrupting play for.
    }
    this.data.sessions += 1;
    this.mark('loaded');
  }

  /** Record a milestone. Safe to call every frame: the first time is what counts. */
  mark(step: Step): void {
    this.data.count[step] = (this.data.count[step] ?? 0) + 1;
    if (this.data.first[step] === undefined) {
      this.data.first[step] = Date.now() - this.data.startedAt;
      this.save();
    }
  }

  /** Called on the same cadence as the save, so it survives a closed tab. */
  tick(playedMs: number): void {
    this.data.playedMs = playedMs;
    this.save();
  }

  /**
   * The funnel as a table, for the author to read.
   *
   * Reachable from the console as `maelstrom.funnel.report()`. Printed rather
   * than uploaded, which is the whole point of this file.
   */
  report(): string {
    const lines = [
      `sessions ${this.data.sessions}   played ${(this.data.playedMs / 60000).toFixed(1)} min`,
      '',
      'step                     first seen   times',
    ];
    for (const step of STEPS) {
      const at = this.data.first[step];
      const when = at === undefined ? '        -' : `${(at / 1000).toFixed(0).padStart(8)}s`;
      const n = this.data.count[step] ?? 0;
      lines.push(`${step.padEnd(22)} ${when}   ${String(n).padStart(5)}`);
    }
    // The first step never reached is the one that matters.
    const stalled = STEPS.find((s) => this.data.first[s] === undefined);
    lines.push('', stalled ? `stopped before: ${stalled}` : 'reached every milestone');
    return lines.join('\n');
  }

  /** Everything recorded, for a caller that wants to do its own analysis. */
  toJSON(): Record_ {
    return { ...this.data, playedMs: this.data.playedMs };
  }

  reset(): void {
    this.data = blank();
    this.data.sessions = 1;
    this.save();
  }

  /** How long this particular session has been open. */
  get sessionMs(): number {
    return Date.now() - this.openedAt;
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      // Full or blocked. The run continues either way.
    }
  }
}
