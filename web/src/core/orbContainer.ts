/**
 * Port of OrbContainer.cs - the two orb slots, the element pool, and the three
 * core actions (add / transmute / decompose), plus the state the mobile build
 * needs that the Unity prototype left to the scene: an inventory, XP, and the
 * discovery log.
 *
 * As in the original this file has no UI dependency. It emits events and exposes
 * plain accessors; the renderer and HUD subscribe. Deliberate differences from
 * the C# version, all of them forced by making this an actual game rather than a
 * system sketch:
 *
 *   - Results are material ids added to an inventory, not Instantiate()d prefabs.
 *     Crafted things have to be able to go back into an orb, or the tree can't chain.
 *   - Orbs can be loaded from the inventory, not just from world pickups.
 *   - Decomposition is lossy (progression.decompositionYield), so decompose ->
 *     recompose can't be farmed for free elements.
 */
import { Emitter } from './events';
import type { Content } from './content';
import {
  canFulfill,
  consumeElements,
  findAvailableRecipes,
  findRecipeForSelection,
  type ElementPool,
} from './alchemy';
import { findRecipe } from './transmutation';
import { levelForXp } from './progression';
import type {
  AlchemyRecipe,
  ElementId,
  Hand,
  MaterialId,
  RecipeId,
  TransmutationRecipe,
  ZoneId,
} from './types';

export interface GameStats {
  gathered: number;
  transmuted: number;
  alchemized: number;
  decomposed: number;
}

export interface GameState {
  level: number;
  xp: number;
  zoneId: ZoneId;
  orbs: Record<Hand, MaterialId | null>;
  elementPool: ElementPool;
  inventory: Record<MaterialId, number>;
  discovered: Set<RecipeId>;
  seenMaterials: Set<MaterialId>;
  stats: GameStats;
  playtimeMs: number;
}

export type XpReason = 'gather' | 'discover' | 'transmute' | 'alchemy' | 'decompose';

export interface OrbEvents {
  orbsChanged: void;
  poolChanged: void;
  inventoryChanged: void;
  stateChanged: void;
  xpGained: { amount: number; reason: XpReason };
  levelUp: { level: number; unlockedAlchemy: boolean; unlockedZones: ZoneId[] };
  discovered: { recipe: TransmutationRecipe | AlchemyRecipe; material: MaterialId };
  crafted: { material: MaterialId; via: 'transmutation' | 'alchemy'; isNew: boolean };
  gathered: { material: MaterialId; isNew: boolean; toOrb: Hand | null };
  decomposed: { material: MaterialId; gained: Record<ElementId, number> };
  notice: { text: string; tone: 'info' | 'good' | 'bad' };
  zoneChanged: { zoneId: ZoneId };
}

export class OrbContainer {
  readonly events = new Emitter<OrbEvents>();

  constructor(
    private readonly content: Content,
    readonly state: GameState,
  ) {}

  // ---------------------------------------------------------------- accessors

  get leftOrb(): MaterialId | null {
    return this.state.orbs.left;
  }

  get rightOrb(): MaterialId | null {
    return this.state.orbs.right;
  }

  get playerLevel(): number {
    return this.state.level;
  }

  /** OrbContainer.AlchemyUnlocked */
  get alchemyUnlocked(): boolean {
    return this.state.level >= this.content.progression.alchemyUnlockLevel;
  }

  orb(hand: Hand): MaterialId | null {
    return this.state.orbs[hand];
  }

  countOf(material: MaterialId): number {
    return this.state.inventory[material] ?? 0;
  }

  /** Inventory contents, deepest-tier first so late-game items surface at the top. */
  packContents(): { material: MaterialId; count: number }[] {
    return Object.entries(this.state.inventory)
      .filter(([, count]) => count > 0)
      .map(([material, count]) => ({ material, count }))
      .sort((x, y) => {
        const mx = this.content.material(x.material);
        const my = this.content.material(y.material);
        return my.tier - mx.tier || mx.name.localeCompare(my.name);
      });
  }

  // ---------------------------------------------------------------- orbs

  /** OrbContainer.AddMaterialToOrb - fails if that orb is already full. */
  addMaterialToOrb(hand: Hand, material: MaterialId): boolean {
    if (!this.content.hasMaterial(material)) return false;
    if (this.state.orbs[hand] !== null) return false;

    this.state.orbs[hand] = material;
    this.events.emit('orbsChanged', undefined);
    return true;
  }

  /** OrbContainer.AddMaterialToFreeOrb - returns the hand used, or null if both are full. */
  addMaterialToFreeOrb(material: MaterialId): Hand | null {
    if (this.addMaterialToOrb('left', material)) return 'left';
    if (this.addMaterialToOrb('right', material)) return 'right';
    return null;
  }

  /** OrbContainer.ClearOrb - discards the contents outright. */
  clearOrb(hand: Hand): void {
    this.state.orbs[hand] = null;
    this.events.emit('orbsChanged', undefined);
  }

  /** Move an orb's material back into the pack rather than losing it. */
  unloadOrb(hand: Hand): boolean {
    const material = this.state.orbs[hand];
    if (material === null) return false;

    this.state.orbs[hand] = null;
    this.addToInventory(material, 1);
    this.events.emit('orbsChanged', undefined);
    return true;
  }

  /** Draw from the pack into an orb - how tier-2+ crafting is actually done. */
  loadFromInventory(hand: Hand, material: MaterialId): boolean {
    if (this.countOf(material) <= 0) return false;
    if (this.state.orbs[hand] !== null) return false;

    this.removeFromInventory(material, 1);
    this.state.orbs[hand] = material;
    this.events.emit('orbsChanged', undefined);
    return true;
  }

  /** Load into whichever orb is free. */
  loadFromInventoryToFreeOrb(material: MaterialId): Hand | null {
    if (this.loadFromInventory('left', material)) return 'left';
    if (this.loadFromInventory('right', material)) return 'right';
    return null;
  }

  /**
   * Put a material into an orb whether or not it already holds something,
   * returning whatever was there to the pack. This is what lets the bench swap
   * one input for another without a clear-then-load dance.
   */
  replaceOrb(hand: Hand, material: MaterialId): boolean {
    if (this.countOf(material) <= 0) return false;

    const current = this.state.orbs[hand];
    if (current === material) return false;

    this.removeFromInventory(material, 1);
    if (current !== null) this.addToInventory(current, 1);

    this.state.orbs[hand] = material;
    this.events.emit('orbsChanged', undefined);
    this.events.emit('stateChanged', undefined);
    return true;
  }

  swapOrbs(): void {
    const { left, right } = this.state.orbs;
    this.state.orbs.left = right;
    this.state.orbs.right = left;
    this.events.emit('orbsChanged', undefined);
  }

  // ---------------------------------------------------------------- gathering

  /** Pick a material up out of the world. Falls through to the pack when both orbs are full. */
  gather(material: MaterialId): { toOrb: Hand | null; isNew: boolean } {
    const isNew = !this.state.seenMaterials.has(material);
    const toOrb = this.addMaterialToFreeOrb(material);
    if (toOrb === null) this.addToInventory(material, 1);

    this.state.stats.gathered++;
    this.markSeen(material);

    const xpConfig = this.content.progression.xp;
    this.addXp(isNew ? xpConfig.gatherNewMaterial : xpConfig.gather, isNew ? 'discover' : 'gather');

    this.events.emit('gathered', { material, isNew, toOrb });
    this.events.emit('stateChanged', undefined);
    return { toOrb, isNew };
  }

  // ---------------------------------------------------------------- transmutation

  /** OrbContainer.PeekTransmutation - what the current orb pair would produce. */
  peekTransmutation(): TransmutationRecipe | null {
    return findRecipe(this.content, this.leftOrb, this.rightOrb, this.state.level);
  }

  /**
   * OrbContainer.TryTransmute - consumes both orbs and produces the result.
   * Returns the resulting material id, or null when the pair has no usable recipe.
   */
  tryTransmute(): MaterialId | null {
    const recipe = this.peekTransmutation();
    if (recipe === null) return null;

    this.state.orbs.left = null;
    this.state.orbs.right = null;
    this.events.emit('orbsChanged', undefined);

    const isNew = !this.state.discovered.has(recipe.id);
    this.state.discovered.add(recipe.id);
    this.state.stats.transmuted++;

    this.addToInventory(recipe.result, 1);
    this.markSeen(recipe.result);

    const factor = isNew ? 1 : this.content.progression.xp.repeatTransmuteFactor;
    this.addXp(Math.max(1, Math.round(recipe.xp * factor)), isNew ? 'discover' : 'transmute');

    if (isNew) this.events.emit('discovered', { recipe, material: recipe.result });
    this.events.emit('crafted', { material: recipe.result, via: 'transmutation', isNew });
    this.events.emit('stateChanged', undefined);
    return recipe.result;
  }

  // ---------------------------------------------------------------- alchemy

  /**
   * OrbContainer.DecomposeMaterialAt - break an orb's material into its elements.
   * Gated behind alchemyUnlockLevel, exactly as the original.
   */
  decomposeMaterialAt(hand: Hand): boolean {
    if (!this.alchemyUnlocked) return false;

    const material = this.state.orbs[hand];
    if (material === null) return false;

    const gained: Record<ElementId, number> = {};
    for (const [element, quantity] of Object.entries(this.content.material(material).composition)) {
      if (quantity <= 0) continue;
      this.state.elementPool[element] = (this.state.elementPool[element] ?? 0) + quantity;
      gained[element] = quantity;
    }

    this.clearOrb(hand);
    this.state.stats.decomposed++;
    this.addXp(this.content.progression.xp.decompose, 'decompose');

    this.events.emit('poolChanged', undefined);
    this.events.emit('decomposed', { material, gained });
    this.events.emit('stateChanged', undefined);
    return true;
  }

  /** OrbContainer.GetAvailableAlchemyRecipes - populates the alchemy menu. */
  getAvailableAlchemyRecipes(): readonly AlchemyRecipe[] {
    if (!this.alchemyUnlocked) return [];
    return findAvailableRecipes(this.content, this.state.elementPool, this.state.level);
  }

  canAfford(recipe: AlchemyRecipe): boolean {
    return canFulfill(recipe, this.state.elementPool);
  }

  /**
   * Attempt a hand-mixed combination. Returns the result, or null when the
   * selection matches no recipe.
   *
   * A failed mix costs nothing. With nine elements and free quantities the
   * search space is large, and charging for wrong guesses would make
   * experimenting - the entire point of the table - feel punishing.
   */
  tryAlchemizeSelection(selection: Readonly<Record<ElementId, number>>): {
    result: MaterialId | null;
    reason: 'ok' | 'no-recipe' | 'locked' | 'short';
  } {
    if (!this.alchemyUnlocked) return { result: null, reason: 'locked' };

    const recipe = findRecipeForSelection(this.content, selection, this.state.level);
    if (!recipe) return { result: null, reason: 'no-recipe' };
    if (!canFulfill(recipe, this.state.elementPool)) return { result: null, reason: 'short' };

    return { result: this.tryAlchemize(recipe), reason: 'ok' };
  }

  /** OrbContainer.TryAlchemize - spends the elements and produces the result. */
  tryAlchemize(recipe: AlchemyRecipe): MaterialId | null {
    if (!this.alchemyUnlocked) return null;
    if (recipe.requiredLevel > this.state.level) return null;
    if (!consumeElements(recipe, this.state.elementPool)) return null;

    const isNew = !this.state.discovered.has(recipe.id);
    this.state.discovered.add(recipe.id);
    this.state.stats.alchemized++;

    this.addToInventory(recipe.result, 1);
    this.markSeen(recipe.result);

    const factor = isNew ? 1 : this.content.progression.xp.repeatAlchemyFactor;
    this.addXp(Math.max(1, Math.round(recipe.xp * factor)), isNew ? 'discover' : 'alchemy');

    this.events.emit('poolChanged', undefined);
    if (isNew) this.events.emit('discovered', { recipe, material: recipe.result });
    this.events.emit('crafted', { material: recipe.result, via: 'alchemy', isNew });
    this.events.emit('stateChanged', undefined);
    return recipe.result;
  }

  // ---------------------------------------------------------------- travel

  travelTo(zoneId: ZoneId): boolean {
    const zone = this.content.zone(zoneId);
    if (zone.requiredLevel > this.state.level) return false;
    if (this.state.zoneId === zoneId) return false;

    this.state.zoneId = zoneId;
    this.events.emit('zoneChanged', { zoneId });
    this.events.emit('stateChanged', undefined);
    return true;
  }

  // ---------------------------------------------------------------- progression

  addXp(amount: number, reason: XpReason): void {
    if (amount <= 0) return;

    const before = this.state.level;
    this.state.xp += amount;
    const after = levelForXp(this.content.progression, this.state.xp);
    this.events.emit('xpGained', { amount, reason });

    if (after <= before) return;

    this.state.level = after;
    const unlockLevel = this.content.progression.alchemyUnlockLevel;
    const unlockedZones = this.content.zones
      .filter((z) => z.requiredLevel > before && z.requiredLevel <= after)
      .map((z) => z.id);

    this.events.emit('levelUp', {
      level: after,
      unlockedAlchemy: before < unlockLevel && after >= unlockLevel,
      unlockedZones,
    });
  }

  // ---------------------------------------------------------------- inventory

  private addToInventory(material: MaterialId, count: number): void {
    this.state.inventory[material] = this.countOf(material) + count;
    this.events.emit('inventoryChanged', undefined);
  }

  private removeFromInventory(material: MaterialId, count: number): void {
    const remaining = this.countOf(material) - count;
    if (remaining > 0) this.state.inventory[material] = remaining;
    else delete this.state.inventory[material];
    this.events.emit('inventoryChanged', undefined);
  }

  private markSeen(material: MaterialId): void {
    this.state.seenMaterials.add(material);
  }
}

/** A fresh run: level 1, empty orbs, standing in the first zone. */
export function createInitialState(content: Content): GameState {
  const firstZone = content.zones[0];
  if (!firstZone) throw new Error('content bundle defines no zones');

  return {
    level: 1,
    xp: 0,
    zoneId: firstZone.id,
    orbs: { left: null, right: null },
    elementPool: {},
    inventory: {},
    discovered: new Set(),
    seenMaterials: new Set(),
    stats: { gathered: 0, transmuted: 0, alchemized: 0, decomposed: 0 },
    playtimeMs: 0,
  };
}
