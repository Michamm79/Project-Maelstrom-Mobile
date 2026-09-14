/**
 * Alchemy: elements in, combat abilities out.
 *
 * GDD section 6.2. Deliberately separate from crafting because it consumes a
 * different layer - crafting spends the material, alchemy spends what is inside
 * it. Locked until Level 2 but visible before, "so the player knows something is
 * coming"; at Level 1 they carry two or three fixed combinations someone else
 * made, which is what they fight the first wave bundle with.
 *
 *   "Level 1 hands you a couple of tools someone else made.
 *    Level 2 gives you the workshop."
 */
import type { AlchemyCombination, CombinationId, ContentBundle } from './types';
import type { Inventory } from './inventory';

export type CastBlock = 'locked' | 'missing-elements';

export interface CombinationOutlook {
  combination: AlchemyCombination;
  /** What is still needed, by element id. Empty when castable. */
  shortfall: Record<string, number>;
  /** Available at the player's level: tutorial combos are, before Level 2. */
  unlocked: boolean;
  can: boolean;
  blockedBy: CastBlock | null;
}

export class Alchemy {
  constructor(private readonly content: ContentBundle) {}

  combinations(): readonly AlchemyCombination[] {
    return this.content.alchemy;
  }

  /** The menu itself is visible from the first minute; this is whether it responds. */
  menuInteractive(level: number): boolean {
    return level >= this.content.progression.alchemyUnlockLevel;
  }

  /**
   * A tutorial combination works from Level 1 because it was handed over rather
   * than discovered. Everything else waits for the workshop at Level 2.
   */
  unlocked(combination: AlchemyCombination, level: number): boolean {
    if (combination.tutorial) return level >= 1;
    return this.menuInteractive(level);
  }

  outlook(combination: AlchemyCombination, inventory: Inventory, level: number): CombinationOutlook {
    const pool = inventory.elementPool();
    const shortfall: Record<string, number> = {};
    for (const [id, qty] of Object.entries(combination.elements)) {
      const missing = qty - (pool[id] ?? 0);
      if (missing > 0) shortfall[id] = missing;
    }
    const unlocked = this.unlocked(combination, level);
    const affordable = Object.keys(shortfall).length === 0;
    const can = unlocked && affordable;
    const blockedBy: CastBlock | null = !unlocked ? 'locked' : affordable ? null : 'missing-elements';
    return { combination, shortfall, unlocked, can, blockedBy };
  }

  outlooks(inventory: Inventory, level: number): CombinationOutlook[] {
    return this.combinations().map((c) => this.outlook(c, inventory, level));
  }

  /**
   * Spend the elements for one cast. Elements live inside materials, so paying
   * for a cast consumes the materials that carried them - cheapest first, so a
   * player is never quietly charged a rare material for a common element.
   */
  cast(id: CombinationId, inventory: Inventory, level: number): AlchemyCombination | null {
    const combination = this.content.alchemy.find((c) => c.id === id);
    if (!combination) return null;
    if (!this.outlook(combination, inventory, level).can) return null;

    for (const [element, qty] of Object.entries(combination.elements)) {
      let owed = qty;
      const carriers = inventory
        .stacks()
        .filter((s) => this.content.materials.find((m) => m.id === s.material)?.elements.includes(element))
        // Spend from the biggest stack first: it is the one the player is least
        // likely to be saving for a craft.
        .sort((a, b) => b.quantity - a.quantity);
      for (const stack of carriers) {
        if (owed <= 0) break;
        owed -= inventory.remove(stack.material, Math.min(owed, stack.quantity));
      }
    }
    return combination;
  }
}
