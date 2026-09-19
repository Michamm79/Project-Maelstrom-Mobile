/**
 * What the world tells you about itself, and when.
 *
 * The guide says what to do. Canon is explicit that it withholds why, and that
 * is right - but withholding why is not the same as saying nothing, and the
 * build had the player wake with no memory into a world that then never
 * mentioned the situation again. These are the six moments where the game has
 * just shown the player something and can afford one sentence about it.
 *
 * They fire on first-time actions rather than on a timer or a trigger volume,
 * so the reading always lands on the thing it is about: the deletion fragment
 * arrives the first time something comes apart into digits in front of you.
 *
 * Deliberately one channel and no narrator. Canon's Jakindur notes are a TWO
 * channel system - plentiful and unreliable against rare and accurate, which
 * only works if the two can disagree - and building that needs the real prose.
 * Nothing here claims to be either channel, so that system can replace this
 * rather than having to argue with it.
 */

/**
 * The moments a fragment may hang off.
 *
 * Read by tools/build-content.mjs, the same way the tutorial rules are: a
 * fragment naming a trigger that does not exist here would simply never fire,
 * and silently never firing is the failure mode worth a build error.
 */
export const FRAGMENT_TRIGGERS = [
  'firstMaterial',
  'firstCraft',
  'firstKill',
  'firstCast',
  'newBiome',
  'waveCleared',
] as const;

export type FragmentTrigger = (typeof FRAGMENT_TRIGGERS)[number];

export interface Fragment {
  id: string;
  on: FragmentTrigger;
  title: string;
  text: string;
}

/**
 * The fragment for this moment, or null if there is nothing to say.
 *
 * `seen` is per run and cleared by starting over, because the whole point is
 * that it lands the first time - a reading about a thing coming apart into
 * digits is worth nothing on the fortieth kill.
 */
export function fragmentFor(
  all: readonly Fragment[],
  on: FragmentTrigger,
  seen: ReadonlySet<string>,
): Fragment | null {
  const match = all.find((fragment) => fragment.on === on);
  if (!match || seen.has(match.id)) return null;
  return match;
}
