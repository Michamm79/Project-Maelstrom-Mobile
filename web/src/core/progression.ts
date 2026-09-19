/**
 * Levels and XP.
 *
 * GDD section 8.2: XP is novelty, not volume. It comes from first-time events -
 * the first collection of each material, the first successful craft, the first
 * visit to each biome - and deliberately not from per-unit gathering, which
 * would reward farming one node and teach nothing about the variety the crafting
 * and alchemy systems depend on.
 *
 * The tracker below is the whole reason that rule holds: an award is only paid
 * the first time its key is seen.
 */
import type { ProgressionConfig } from './types';

export type NoveltyKind =
  | 'firstNote'
  | 'firstMaterial'
  | 'firstCraft'
  | 'firstAlchemy'
  | 'firstBiome'
  | 'clearWave';

export class Progression {
  private xpTotal = 0;
  /** Every novelty key already paid for, e.g. "firstMaterial:riverglass". */
  private readonly seen = new Set<string>();

  constructor(private readonly config: ProgressionConfig) {}

  get xp(): number {
    return this.xpTotal;
  }

  get level(): number {
    return this.levelAt(this.xpTotal);
  }

  /** The level a given XP total corresponds to - used to detect a level change. */
  levelAt(xp: number): number {
    const table = this.config.xpTable;
    let level = 0;
    for (let i = 1; i < table.length; i++) {
      if (xp >= (table[i] ?? Infinity)) level = i;
      else break;
    }
    return level;
  }

  get maxLevel(): number {
    return this.config.xpTable.length - 1;
  }

  xpAtLevelStart(level = this.level): number {
    return this.config.xpTable[level] ?? 0;
  }

  xpAtNextLevel(level = this.level): number | null {
    return this.config.xpTable[level + 1] ?? null;
  }

  /** 0..1 through the current level, or 1 at the cap. */
  get levelProgress(): number {
    const start = this.xpAtLevelStart();
    const next = this.xpAtNextLevel();
    if (next === null) return 1;
    const span = next - start;
    return span <= 0 ? 1 : Math.min(1, (this.xpTotal - start) / span);
  }

  /**
   * Pay the award for `kind` the first time `key` is seen, and nothing after.
   * Returns the XP actually awarded, so a caller can tell a novelty from a
   * repeat without asking twice.
   */
  award(kind: NoveltyKind, key: string): number {
    const id = `${kind}:${key}`;
    if (this.seen.has(id)) return 0;
    this.seen.add(id);
    const amount = this.config.xp[kind] ?? 0;
    this.xpTotal += amount;
    return amount;
  }

  /**
   * Record a novelty as already paid without paying for it.
   *
   * Waking somewhere is not visiting it. The spawn biome was being run through
   * award() to keep it from paying out later, which marked it seen *and* banked
   * its 80 XP - so a brand new run opened at 80 of the 150 needed for Level 1,
   * and the warning that Level 1 triggers fired while the guide was still on
   * "watch the orbs fill", two cards before it tells you to craft.
   */
  markSeen(kind: NoveltyKind, key: string): void {
    this.seen.add(`${kind}:${key}`);
  }

  hasSeen(kind: NoveltyKind, key: string): boolean {
    return this.seen.has(`${kind}:${key}`);
  }

  /** How many distinct keys of a kind have been paid - "materials discovered". */
  countSeen(kind: NoveltyKind): number {
    let n = 0;
    for (const id of this.seen) if (id.startsWith(`${kind}:`)) n += 1;
    return n;
  }

  toJSON(): { xp: number; seen: string[] } {
    return { xp: this.xpTotal, seen: [...this.seen] };
  }

  load(data: { xp?: number; seen?: string[] } | undefined): void {
    this.xpTotal = Math.max(0, data?.xp ?? 0);
    this.seen.clear();
    for (const id of data?.seen ?? []) this.seen.add(id);
  }
}
