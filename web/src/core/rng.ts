/** Small deterministic PRNG (mulberry32) so a zone lays out the same way each visit. */
export class Rng {
  private seed: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
  }

  next(): number {
    this.seed = (this.seed + 0x6d2b79f5) >>> 0;
    let t = this.seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  int(min: number, maxExclusive: number): number {
    return Math.floor(this.range(min, maxExclusive));
  }

  pick<T>(items: readonly T[]): T {
    const item = items[this.int(0, items.length)];
    if (item === undefined) throw new Error('Rng.pick called with an empty list');
    return item;
  }

  /** Weighted pick. Weights must be positive; the caller guarantees a non-empty list. */
  weighted<T>(items: readonly T[], weightOf: (item: T) => number): T {
    let total = 0;
    for (const item of items) total += weightOf(item);

    let roll = this.next() * total;
    for (const item of items) {
      roll -= weightOf(item);
      if (roll <= 0) return item;
    }
    return this.pick(items);
  }
}

/** Stable 32-bit hash, for turning a zone id into a layout seed. */
export function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
