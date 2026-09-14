/**
 * What the player is carrying.
 *
 * Canon, GDD section 4.1, and the line that shapes this whole file:
 *
 *   "The orbs display; they do not store. Inventory stores."
 *
 * So there are no slots. The previous build gave each gauntlet one material and
 * made those two the input to crafting, which came from the Unity OrbSystem
 * prototype rather than from Maelstrom. Here the gauntlets are a readout: they
 * show what is in the inventory, and `orbView` is the only thing that knows
 * about hands at all.
 */
import type { ContentBundle, GauntletStat, Hand, MaterialId, Quantities } from './types';

export interface CarriedStack {
  material: MaterialId;
  quantity: number;
}

/** Permanent gauntlet upgrades, applied on top of the base stats from content. */
export type GauntletUpgrades = Readonly<Record<GauntletStat, number>>;

export class Inventory {
  private readonly counts = new Map<MaterialId, number>();
  private readonly upgrades: Record<GauntletStat, number> = {
    carryCapacity: 0,
    pullRadius: 0,
    pullSpeed: 0,
  };

  constructor(private readonly content: ContentBundle) {}

  // -------------------------------------------------------------- capacity

  /** Canon default 60, raised permanently through crafting and never lowered. */
  get capacity(): number {
    return this.content.crafting.baseStats.carryCapacity + this.upgrades.carryCapacity;
  }

  get pullRadius(): number {
    return this.content.crafting.baseStats.pullRadius + this.upgrades.pullRadius;
  }

  get pullSpeed(): number {
    return this.content.crafting.baseStats.pullSpeed + this.upgrades.pullSpeed;
  }

  /** One material is one unit; canon gives no per-material weights. */
  get used(): number {
    let total = 0;
    for (const n of this.counts.values()) total += n;
    return total;
  }

  get free(): number {
    return Math.max(0, this.capacity - this.used);
  }

  get full(): boolean {
    return this.free <= 0;
  }

  // -------------------------------------------------------------- contents

  count(material: MaterialId): number {
    return this.counts.get(material) ?? 0;
  }

  /** Everything held, in the order it was first picked up. */
  stacks(): CarriedStack[] {
    return [...this.counts.entries()].map(([material, quantity]) => ({ material, quantity }));
  }

  get distinctCount(): number {
    return this.counts.size;
  }

  /**
   * Add what fits and report what actually went in. Canon is explicit that a
   * full gauntlet stops acquiring and says so, rather than pulling a node across
   * a clearing and refusing it on arrival.
   */
  add(material: MaterialId, quantity = 1): number {
    const taken = Math.min(quantity, this.free);
    if (taken > 0) this.counts.set(material, this.count(material) + taken);
    return taken;
  }

  /** Remove up to `quantity`, returning how many were actually removed. */
  remove(material: MaterialId, quantity = 1): number {
    const held = this.count(material);
    const removed = Math.min(quantity, held);
    if (removed <= 0) return 0;
    if (removed === held) this.counts.delete(material);
    else this.counts.set(material, held - removed);
    return removed;
  }

  has(cost: Quantities): boolean {
    return Object.entries(cost).every(([id, qty]) => this.count(id) >= qty);
  }

  /** Spend a whole cost, or spend nothing. */
  spend(cost: Quantities): boolean {
    if (!this.has(cost)) return false;
    for (const [id, qty] of Object.entries(cost)) this.remove(id, qty);
    return true;
  }

  // -------------------------------------------------------------- elements

  /**
   * The element pool alchemy draws on: every element inside everything held.
   * Materials are not consumed to reach it - alchemy consumes elements, and
   * canon keeps the two layers distinct on purpose.
   */
  elementPool(): Record<string, number> {
    const pool: Record<string, number> = {};
    for (const [id, quantity] of this.counts) {
      const def = this.content.materials.find((m) => m.id === id);
      if (!def) continue;
      for (const element of def.elements) pool[element] = (pool[element] ?? 0) + quantity;
    }
    return pool;
  }

  // -------------------------------------------------------------- upgrades

  applyUpgrade(stat: GauntletStat, amount: number): void {
    this.upgrades[stat] += amount;
  }

  get appliedUpgrades(): GauntletUpgrades {
    return { ...this.upgrades };
  }

  // -------------------------------------------------------------- display

  /**
   * What each gauntlet shows. Canon: miniatures of held materials float and
   * swirl inside the orbs, reflecting real amounts - "collect a little, see a
   * little". Splitting the held stacks across two hands is presentation only;
   * nothing here affects what can be crafted or spent.
   */
  orbView(hand: Hand): CarriedStack[] {
    const all = this.stacks();
    return all.filter((_, i) => (i % 2 === 0) === (hand === 'left'));
  }

  /** 0..1, for how full the orbs look. */
  get fillFraction(): number {
    return this.capacity <= 0 ? 0 : Math.min(1, this.used / this.capacity);
  }

  // -------------------------------------------------------------- save

  /**
   * Upgrades are deliberately NOT saved here. They are re-derived from the
   * recipes that were built, which keeps one source of truth and lets a content
   * rebalance reach an existing save instead of being frozen into it. Saving
   * them too meant loading applied every upgrade twice.
   */
  toJSON(): { counts: [MaterialId, number][] } {
    return { counts: [...this.counts.entries()] };
  }

  load(data: { counts?: [MaterialId, number][] }): void {
    this.counts.clear();
    for (const [id, n] of data.counts ?? []) {
      if (this.content.materials.some((m) => m.id === id) && n > 0) this.counts.set(id, n);
    }
    for (const stat of ['carryCapacity', 'pullRadius', 'pullSpeed'] as const) this.upgrades[stat] = 0;
  }
}
