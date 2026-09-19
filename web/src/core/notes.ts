/**
 * Information Integrity: two channels that can disagree.
 *
 * Canon describes one plentiful and unreliable source and one rare and accurate
 * one, and names Jakindur as the author of the second. The whole system only
 * means anything if the two can contradict each other - a single channel, or
 * two that agree, is just lore with extra steps - so the contradiction is
 * modelled rather than implied: every note in the rare channel names the
 * bulletin it disagrees with, and the log shows the pairing the moment the
 * player is holding both halves.
 *
 * The functions here are pure and the interesting one is `pairings`. A player
 * who finds only the bulletins finishes the game believing something specific
 * and wrong, and that is the intended outcome rather than a bug - so the code
 * that decides whether a contradiction is visible has to be arithmetic that can
 * be asserted, not a condition buried in a render pass.
 */
import type { BiomeId } from './types';

export type NoteChannel = 'bulletin' | 'jakindur';

export interface NoteDef {
  id: string;
  channel: NoteChannel;
  biome: BiomeId;
  title: string;
  text: string;
  /** Rare-channel only: the bulletin this one says is wrong. */
  contradicts?: string;
}

export interface Pairing {
  found: NoteDef;
  bulletin: NoteDef;
}

/**
 * The contradictions the player can actually see.
 *
 * Both halves have to be held. Showing a contradiction against a bulletin the
 * player has never read would hand them the accurate channel's conclusion
 * without the unreliable one's claim, which is the one thing this system exists
 * to make them do for themselves.
 */
export function pairings(all: readonly NoteDef[], held: ReadonlySet<string>): Pairing[] {
  const byId = new Map(all.map((note) => [note.id, note]));
  const out: Pairing[] = [];
  for (const note of all) {
    if (!note.contradicts || !held.has(note.id)) continue;
    const bulletin = byId.get(note.contradicts);
    if (!bulletin || !held.has(bulletin.id)) continue;
    out.push({ found: note, bulletin });
  }
  return out;
}

/** Notes of one channel, in content order. */
export function channel(all: readonly NoteDef[], which: NoteChannel): NoteDef[] {
  return all.filter((note) => note.channel === which);
}

/** How much of the accurate channel the player is holding, as a count and a total. */
export function accuracyHeld(all: readonly NoteDef[], held: ReadonlySet<string>): {
  found: number;
  total: number;
} {
  const rare = channel(all, 'jakindur');
  return { found: rare.filter((note) => held.has(note.id)).length, total: rare.length };
}

/**
 * Where a note sits in the world.
 *
 * Deterministic from the note's own id and the disc it belongs to, so the
 * Coliseum is the same place on every run and a player can be told where one
 * is. Pushed out past `inset` of the radius because the material nodes cluster
 * further in, and a note sharing a spot with an ore is a note that gets pulled
 * before it is noticed.
 */
export function placeNote(
  note: NoteDef,
  disc: { x: number; y: number; radius: number },
  inset: number,
): { x: number; y: number } {
  // A cheap hash of the id, so two notes in one region never land on top of
  // each other and the same note never moves between runs.
  let seed = 2166136261;
  for (let i = 0; i < note.id.length; i++) {
    seed ^= note.id.charCodeAt(i);
    seed = Math.imul(seed, 16777619) >>> 0;
  }
  const angle = (seed / 4294967296) * Math.PI * 2;
  // The rare channel sits further out than the bulletins: he was not posting
  // them where a notice board would go.
  const far = note.channel === 'jakindur' ? 0.94 : 0.5 + ((seed >>> 8) % 1000) / 2500;
  const reach = disc.radius * Math.max(inset, Math.min(0.96, far));
  return { x: disc.x + Math.cos(angle) * reach, y: disc.y + Math.sin(angle) * reach };
}
