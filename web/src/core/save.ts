/**
 * localStorage persistence.
 *
 * Loading is defensive on purpose: this is a game whose content file will keep
 * changing under an existing save, so anything the current bundle no longer
 * defines is dropped rather than allowed to crash the run.
 */
import type { Content } from './content';
import { createInitialState, type GameState } from './orbContainer';
import { levelForXp } from './progression';
import type { Hand, MaterialId } from './types';

const STORAGE_KEY = 'maelstrom.save.v1';
const SAVE_VERSION = 1;

interface SavedState {
  version: number;
  level: number;
  xp: number;
  zoneId: string;
  orbs: { left: MaterialId | null; right: MaterialId | null };
  elementPool: Record<string, number>;
  inventory: Record<string, number>;
  discovered: string[];
  seenMaterials: string[];
  stats: { gathered: number; transmuted: number; alchemized: number; decomposed: number; slain: number; deaths: number };
  vitals: { hp: number; maxHp: number };
  started: boolean;
  tutorialStep: number;
  playtimeMs: number;
}

export function serialize(state: GameState): SavedState {
  return {
    version: SAVE_VERSION,
    level: state.level,
    xp: state.xp,
    zoneId: state.zoneId,
    orbs: { left: state.orbs.left, right: state.orbs.right },
    elementPool: { ...state.elementPool },
    inventory: { ...state.inventory },
    discovered: [...state.discovered],
    seenMaterials: [...state.seenMaterials],
    stats: { ...state.stats },
    vitals: { ...state.vitals },
    started: state.started,
    tutorialStep: state.tutorialStep,
    playtimeMs: Math.round(state.playtimeMs),
  };
}

export function deserialize(content: Content, raw: unknown): GameState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const saved = raw as Partial<SavedState>;
  if (saved.version !== SAVE_VERSION) return null;

  const state = createInitialState(content);
  const knownRecipes = new Set<string>([
    ...content.transmutation.map((r) => r.id),
    ...content.alchemy.map((r) => r.id),
  ]);
  const knownElements = new Set(content.elements.map((e) => e.id));

  state.xp = numberOr(saved.xp, 0);
  state.level = Math.min(
    content.progression.maxLevel,
    Math.max(numberOr(saved.level, 1), levelForXp(content.progression, state.xp)),
  );

  // A zone can be removed, renamed, or (after a rebalance) gated above the
  // player's level. Any of those falls back to the first zone rather than
  // stranding the save.
  if (typeof saved.zoneId === 'string') {
    const zone = content.zones.find((z) => z.id === saved.zoneId);
    if (zone && zone.requiredLevel <= state.level) state.zoneId = zone.id;
  }

  for (const hand of ['left', 'right'] as Hand[]) {
    const material = saved.orbs?.[hand];
    if (typeof material === 'string' && content.hasMaterial(material)) state.orbs[hand] = material;
  }

  for (const [element, count] of Object.entries(saved.elementPool ?? {})) {
    if (knownElements.has(element) && numberOr(count, 0) > 0) {
      state.elementPool[element] = Math.floor(count as number);
    }
  }

  for (const [material, count] of Object.entries(saved.inventory ?? {})) {
    if (content.hasMaterial(material) && numberOr(count, 0) > 0) {
      state.inventory[material] = Math.floor(count as number);
    }
  }

  for (const id of saved.discovered ?? []) if (knownRecipes.has(id)) state.discovered.add(id);
  for (const id of saved.seenMaterials ?? []) if (content.hasMaterial(id)) state.seenMaterials.add(id);

  state.stats = {
    gathered: numberOr(saved.stats?.gathered, 0),
    transmuted: numberOr(saved.stats?.transmuted, 0),
    alchemized: numberOr(saved.stats?.alchemized, 0),
    decomposed: numberOr(saved.stats?.decomposed, 0),
    slain: numberOr(saved.stats?.slain, 0),
    deaths: numberOr(saved.stats?.deaths, 0),
  };

  // Clamp to the current max: a rebalance that lowers maxHp must not leave a
  // save reporting more health than the bar can show.
  const maxHp = content.progression.combat.maxHp;
  state.vitals = {
    maxHp,
    hp: Math.min(maxHp, Math.max(1, numberOr(saved.vitals?.hp, maxHp))),
  };
  state.started = saved.started === true;
  state.tutorialStep = numberOr(saved.tutorialStep, -1);
  state.playtimeMs = numberOr(saved.playtimeMs, 0);

  return state;
}

export function save(state: GameState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize(state)));
  } catch {
    // Private browsing, a full quota, or storage disabled entirely. Losing the
    // save is bad; taking the running game down with it is worse.
  }
}

export function load(content: Content): GameState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return deserialize(content, JSON.parse(raw));
  } catch {
    return null;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing useful to do if storage is unavailable.
  }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
