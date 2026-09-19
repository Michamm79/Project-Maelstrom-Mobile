/**
 * localStorage persistence.
 *
 * Loading is defensive on purpose: this is a game whose content file keeps
 * changing under an existing save, so anything the current bundle no longer
 * defines is dropped rather than allowed to crash the run.
 *
 * The version bumped to 2 with the rebuild onto the GDD. A v1 save describes
 * orb slots and a transmutation tree that no longer exist, so it is discarded
 * rather than migrated - there is nothing in it that maps onto the canon model.
 */
import type { Content } from './content';
import type { Inventory } from './inventory';
import type { Crafting } from './crafting';
import type { Progression } from './progression';
import type { LoadoutState } from './loadout';
import type { CombinationId, MaterialId } from './types';

const STORAGE_KEY = 'maelstrom.save.v2';
const SAVE_VERSION = 2;

export interface SaveBundle {
  inventory: Inventory;
  crafting: Crafting;
  progression: Progression;
}

export interface SavedRun {
  version: number;
  inventory: { counts: [MaterialId, number][] };
  crafted: string[];
  progression: { xp: number; seen: string[] };
  player: { x: number; y: number; hp: number };
  started: boolean;
  tutorialStep: number;
  playtimeMs: number;
  fragmentsSeen?: string[];
  notesHeld?: string[];
  breach?: number;
  finished?: boolean;
  telemetry?: {
    reading?: Record<string, number>;
    tutorial?: Record<string, number> | null;
    rune?: string | null;
    archetype?: string | null;
  };
  loadout?: { carried?: string[]; known?: string[] };
}

export interface RunState {
  player: { x: number; y: number; hp: number };
  started: boolean;
  tutorialStep: number;
  playtimeMs: number;
  /**
   * Which world fragments have already been read.
   *
   * Part of the run rather than the device, so starting over gives them back:
   * the whole point of a reading about a thing coming apart into digits is
   * that it lands the first time.
   */
  fragmentsSeen: string[];
  /**
   * Notes picked up off the ground, from either channel.
   *
   * Part of the run rather than the device, like the fragments: starting over
   * puts the paper back where it was, which it has to, because the thing the
   * two channels are for is the first read.
   */
  notesHeld: string[];
  /**
   * How far along the boundary breach the run got, 0..1.
   *
   * Saved because it is minutes of held pull under everything the system has
   * left, and closing the app on a phone mid-attempt is not a decision to
   * throw that away.
   */
  breach: number;
  /** Whether this run has already got out. The world survives it; the ending does not repeat. */
  finished: boolean;
  /**
   * The seven signals, the banked tutorial period, and what they were read as.
   *
   * Saved in full rather than just the granted ids, because canon reads the
   * tutorial period as roughly half the evidence for the class - and a run
   * resumed on a second day with that period gone would be read as somebody
   * who never did a tutorial.
   */
  telemetry: {
    reading: Record<string, number>;
    tutorial: Record<string, number> | null;
    rune: string | null;
    archetype: string | null;
  };
  /**
   * The four on the arc, and everything that has ever been offered a slot.
   *
   * `known` is saved alongside `carried` because without it a deliberate
   * removal only lasts until the next load: the fill pass would see a free
   * slot, decide the combination was new, and put it straight back.
   */
  loadout: LoadoutState;
}

export function serialize(bundle: SaveBundle, run: RunState): SavedRun {
  return {
    version: SAVE_VERSION,
    inventory: bundle.inventory.toJSON(),
    crafted: bundle.crafting.toJSON(),
    progression: bundle.progression.toJSON(),
    player: { ...run.player },
    started: run.started,
    tutorialStep: run.tutorialStep,
    playtimeMs: Math.round(run.playtimeMs),
    fragmentsSeen: [...run.fragmentsSeen],
    notesHeld: [...run.notesHeld],
    breach: run.breach,
    finished: run.finished,
    telemetry: {
      reading: { ...run.telemetry.reading },
      tutorial: run.telemetry.tutorial ? { ...run.telemetry.tutorial } : null,
      rune: run.telemetry.rune,
      archetype: run.telemetry.archetype,
    },
    loadout: { carried: [...run.loadout.carried], known: [...run.loadout.known] },
  };
}

/**
 * Rehydrate into the live systems. Returns the run-level state, or null when
 * the payload is unusable - in which case the caller starts a new run rather
 * than half-restoring one.
 */
export function deserialize(content: Content, bundle: SaveBundle, raw: unknown): RunState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const saved = raw as Partial<SavedRun>;
  if (saved.version !== SAVE_VERSION) return null;

  bundle.inventory.load(saved.inventory ?? { counts: [] });
  // Crafting re-derives the gauntlet upgrades from what was built, so it has to
  // load after the inventory has cleared its own.
  bundle.crafting.load(saved.crafted, bundle.inventory);
  bundle.progression.load(saved.progression);

  const maxHp = content.progression.combat.maxHp;
  return {
    player: {
      x: Number.isFinite(saved.player?.x) ? (saved.player?.x as number) : 0,
      y: Number.isFinite(saved.player?.y) ? (saved.player?.y as number) : 0,
      hp: clamp(saved.player?.hp ?? maxHp, 1, maxHp),
    },
    started: saved.started === true,
    tutorialStep: Math.max(0, Math.trunc(saved.tutorialStep ?? 0)),
    // Optional in the saved shape: a run written before fragments existed
    // simply has none read yet, which is the right answer for it.
    fragmentsSeen: Array.isArray(saved.fragmentsSeen) ? saved.fragmentsSeen.filter((id) => typeof id === 'string') : [],
    // Also optional: a run saved before the arc had slots simply has none
    // chosen, and admit() hands it the first four the moment it loads.
    notesHeld: ids(saved.notesHeld),
    // Clamped rather than trusted: a hand-edited or half-written save must not
    // be able to hand somebody the ending, or to hand them a meter above full
    // that never completes.
    breach: clamp(saved.breach ?? 0, 0, 1),
    finished: saved.finished === true,
    telemetry: {
      reading: counters(saved.telemetry?.reading),
      tutorial: saved.telemetry?.tutorial ? counters(saved.telemetry.tutorial) : null,
      rune: typeof saved.telemetry?.rune === 'string' ? saved.telemetry.rune : null,
      archetype: typeof saved.telemetry?.archetype === 'string' ? saved.telemetry.archetype : null,
    },
    loadout: {
      carried: ids(saved.loadout?.carried),
      known: ids(saved.loadout?.known),
    },
    playtimeMs: Math.max(0, saved.playtimeMs ?? 0),
  };
}

/** Finite, non-negative numbers only: a NaN here would poison the whole read. */
function counters(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (typeof value !== 'object' || value === null) return out;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) out[key] = raw;
  }
  return out;
}

function ids(value: unknown): CombinationId[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
}

function clamp(value: number, min: number, max: number): number {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : max;
}

export function save(bundle: SaveBundle, run: RunState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(serialize(bundle, run)));
  } catch {
    // A full or blocked store is not worth interrupting play for.
  }
}

export function load(content: Content, bundle: SaveBundle): RunState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return deserialize(content, bundle, JSON.parse(raw));
  } catch {
    return null;
  }
}

export function clearSave(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
    // The v1 key described a model that no longer exists; clear it too so a
    // returning player is not carrying dead bytes around forever.
    localStorage.removeItem('maelstrom.save.v1');
  } catch {
    // Nothing to do.
  }
}

export function hasSave(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}
