#!/usr/bin/env node
/**
 * Content build step for Project Maelstrom Mobile.
 *
 * Reads the hand-authored JSON in content/, validates it against the GDD's
 * non-negotiable rules, and emits one bundle consumed by BOTH runtimes:
 *
 *   content/generated/maelstrom-content.json      -> imported by the web game
 *   unity/Assets/Resources/maelstrom-content.json -> loaded by ContentDatabase.cs
 *
 * The validations here are not style checks. Three of them protect design
 * decisions canon states cannot be broken:
 *
 *   1. Every element symbol is three letters, so the table can never be
 *      mistaken for the periodic table (safety rule, GDD section 5).
 *   2. A material may only spawn in its own biome, "not even by the developer",
 *      because scattering a material outside its region quietly destroys the
 *      reason to travel (section 5.3).
 *   3. Plains/Forest yields exactly eight of the ten elements; Glacite is
 *      mountain-only and Umbrel is Data-Center-only. That gating IS the world's
 *      reason to leave the centre, and it is asserted rather than assumed.
 *
 * Run: npm run build:content   (or: node tools/build-content.mjs)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));

const typeSource = readFileSync(join(ROOT, 'web/src/core/types.ts'), 'utf8');

/** A named `export const X = [...] as const;` block out of types.ts. */
function typeSourceFor(name) {
  const match = typeSource.match(new RegExp(`export const ${name} = \\[([^\\]]*)\\]`));
  if (!match) errors.push(`could not find ${name} in web/src/core/types.ts`);
  return match?.[1] ?? '';
}

const errors = [];
const warnings = [];
const fail = (msg) => errors.push(msg);
const warn = (msg) => warnings.push(msg);

// ---------------------------------------------------------------- load

const elements = read('content/elements.json').elements;
const materials = read('content/materials.json').materials;
const biomesFile = read('content/biomes.json');
const biomes = biomesFile.biomes;
const crafting = read('content/crafting.json');
const alchemy = read('content/alchemy.json').combinations;
const enemyTiers = read('content/enemies.json').tiers;
const waves = read('content/waves.json');
const tutorialFile = read('content/tutorial.json');
const tutorial = tutorialFile.steps;
const opening = tutorialFile.opening;
const fragments = tutorialFile.fragments?.list ?? [];
const progression = read('content/progression.json');
const notesFile = read('content/notes.json');
const notes = notesFile.notes;
const ending = read('content/ending.json');
const archetypes = read('content/archetypes.json');

// ---------------------------------------------------------------- elements

const elementIds = new Set();
const seenSymbols = new Map();

for (const e of elements) {
  for (const field of ['id', 'name', 'symbol', 'domain', 'color']) {
    if (!e[field]) fail(`element "${e.id ?? '?'}" is missing "${field}"`);
  }
  if (elementIds.has(e.id)) fail(`duplicate element id "${e.id}"`);
  elementIds.add(e.id);

  // SAFETY RULE from the GDD, stated there as non-negotiable: the alchemy table
  // must never be mistakable for the periodic table, and the game must never
  // read as a lookup for combining real substances. Every real element symbol is
  // one or two letters, so requiring exactly three makes a collision impossible
  // rather than relying on a blocklist someone can forget to update. This check
  // exists because an earlier table shipped two-letter symbols including "Fe".
  if (!/^[A-Z]{3}$/.test(String(e.symbol))) {
    fail(
      `element "${e.id}" has symbol "${e.symbol}" - symbols must be exactly three ` +
        'uppercase letters, so the table cannot be mistaken for the periodic table',
    );
  }
  if (seenSymbols.has(e.symbol)) {
    fail(`elements "${seenSymbols.get(e.symbol)}" and "${e.id}" share the symbol "${e.symbol}"`);
  }
  seenSymbols.set(e.symbol, e.id);
}

// ---------------------------------------------------------------- biomes

const biomeIds = new Set();
for (const b of biomes) {
  if (biomeIds.has(b.id)) fail(`duplicate biome id "${b.id}"`);
  biomeIds.add(b.id);
  if (!b.centre || typeof b.centre.x !== 'number' || typeof b.centre.y !== 'number') {
    fail(`biome "${b.id}" is missing a numeric centre`);
  }
  if (Math.hypot(b.centre.x, b.centre.y) + b.radius > biomesFile.boundaryRadius) {
    fail(`biome "${b.id}" extends past the Coliseum boundary`);
  }
}
if (!biomeIds.has('plains_forest')) fail('there is no "plains_forest" biome, and canon makes it the permanent spawn');

/*
 * Terrain. These are the numbers that stop a biome being a palette with a loot
 * table, so a missing or absurd one is a region that silently plays like the
 * spawn no matter what its mood line claims.
 */
const PROP_KINDS = new Set(['tuft', 'stone', 'tree', 'drift', 'crag', 'shard', 'dune', 'bone', 'reed', 'pool', 'rack', 'conduit']);
for (const b of biomes) {
  const t = b.terrain;
  if (!t) {
    fail(`biome "${b.id}" has no terrain, so it will play exactly like the spawn`);
    continue;
  }
  for (const [key, min, max] of [['moveScale', 0.5, 1.2], ['concealment', 0.3, 2], ['sight', 0.4, 2], ['propDensity', 0.1, 3]]) {
    const v = t[key];
    if (typeof v !== 'number' || v < min || v > max) {
      fail(`biome "${b.id}" has ${key} ${v}; outside ${min}..${max} it stops being a flavour and becomes a wall`);
    }
  }
  if (typeof t.fog !== 'number' || t.fog < 0 || t.fog > 0.6) {
    fail(`biome "${b.id}" has fog ${t.fog}; past 0.6 the player cannot see the game`);
  }
  if (!Array.isArray(t.props) || t.props.length === 0) fail(`biome "${b.id}" scatters no props, so it will read as bare ground`);
  else for (const kind of t.props) {
    if (!PROP_KINDS.has(kind)) fail(`biome "${b.id}" wants prop "${kind}", which nothing knows how to draw`);
  }
}

// The spawn is the baseline every other region is read against, so it is the
// one that has to be neutral - a "slow going" Wetland means nothing if the
// Plains are slower still.
const spawnTerrain = biomes.find((b) => b.id === 'plains_forest')?.terrain;
if (spawnTerrain) {
  for (const key of ['moveScale', 'concealment', 'sight']) {
    if (spawnTerrain[key] !== 1) fail(`plains_forest has ${key} ${spawnTerrain[key]}; the spawn is the baseline and must be 1`);
  }
  if (spawnTerrain.fog !== 0) fail('plains_forest has fog; canon calls the spawn open and bright');
}

// Somebody has to be cover and somebody has to be exposure, or the concealment
// axis is authored and unused.
const conceal = biomes.map((b) => b.terrain?.concealment ?? 1);
if (!conceal.some((c) => c < 0.9)) fail('no biome offers cover; the concealment axis exists but nothing uses it');
if (!conceal.some((c) => c > 1.1)) fail('no biome is exposed; the concealment axis exists but nothing uses it');

// ---------------------------------------------------------------- materials

const materialIds = new Set();
const byBiome = new Map([...biomeIds].map((id) => [id, []]));
const elementSources = new Map();

// Shapes are drawn procedurally; an unknown key would silently fall back to a
// rock, so a typo would ship as "every ore looks like a stone".
const iconSource = readFileSync(join(ROOT, 'web/src/game/icons.ts'), 'utf8');
const knownShapes = new Set([...iconSource.matchAll(/^\s{2}([a-z][a-zA-Z0-9]*):\s*\(ctx/gm)].map((m) => m[1]));
if (knownShapes.size < 10) fail('could not read the shape list out of web/src/game/icons.ts');

for (const m of materials) {
  if (materialIds.has(m.id)) fail(`duplicate material id "${m.id}"`);
  materialIds.add(m.id);

  if (!biomeIds.has(m.biome)) fail(`material "${m.id}" belongs to unknown biome "${m.biome}"`);
  else byBiome.get(m.biome).push(m.id);

  if (!Array.isArray(m.elements) || m.elements.length !== 2) {
    fail(`material "${m.id}" must list exactly two elements - canon gives every material a pair`);
  } else {
    for (const el of m.elements) {
      if (!elementIds.has(el)) fail(`material "${m.id}" references unknown element "${el}"`);
      else {
        if (!elementSources.has(el)) elementSources.set(el, []);
        elementSources.get(el).push(m.id);
      }
    }
    if (m.elements[0] === m.elements[1]) fail(`material "${m.id}" lists "${m.elements[0]}" twice`);
  }

  if (!knownShapes.has(m.shape)) fail(`material "${m.id}" uses unknown shape "${m.shape}"`);
  if (!/^#[0-9a-fA-F]{6}$/.test(String(m.color))) fail(`material "${m.id}" has a malformed colour "${m.color}"`);
}

for (const e of elements) {
  if (!elementSources.has(e.id)) {
    fail(`element "${e.id}" is in no material - it can never enter the pool, so nothing needing it is craftable`);
  }
}

// ---------------------------------------------------------------- the gating

// Canon section 5.3, stated as the thing that makes travel matter. Asserted
// rather than assumed: an innocent-looking material edit could otherwise hand
// the player cold or concealment at the spawn point and silently remove every
// reason to walk anywhere.
const elementsOf = (biome) => new Set((byBiome.get(biome) ?? []).flatMap((id) => materials.find((m) => m.id === id).elements));

const spawnElements = elementsOf('plains_forest');
if (spawnElements.size !== 8) {
  fail(
    `Plains/Forest yields ${spawnElements.size} of the ten elements; canon fixes it at 8, ` +
      'with exactly Glacite and Umbrel withheld',
  );
}
// Canon contradicts itself here and the softer reading is the one encoded.
// Section 5.3 says "Glacite (cold) - Snowy Mountain only", but section 5.2 puts
// Coolant Residue (GLC.VSN) in the Data-Center. What section 5.3 is actually
// establishing is what the SPAWN withholds - you leave the centre for cold and
// for concealment - and that reading keeps both passages true. It also matches
// canon describing Umbrel as "one material, Dark Fiber" while never saying that
// of Glacite, and section 13 asking only whether Umbrel stays single-sourced.
// So: assert the gate at the spawn, and assert Umbrel's exclusivity, which
// canon does state unambiguously.
for (const element of ['glacite', 'umbrel']) {
  if ((elementSources.get(element) ?? []).some((id) => materials.find((m) => m.id === id).biome === 'plains_forest')) {
    fail(`"${element}" is obtainable at the spawn; canon withholds exactly Glacite and Umbrel from Plains/Forest, and that gate is the world's only reason to leave the centre`);
  }
}
const umbrelSources = elementSources.get('umbrel') ?? [];
if (umbrelSources.some((id) => materials.find((m) => m.id === id).biome !== 'data_center')) {
  fail('concealment exists only in the Data-Center, but Umbrel is carried outside it');
}
if (!(elementSources.get('glacite') ?? []).some((id) => materials.find((m) => m.id === id).biome === 'snowy_mountain')) {
  fail('the Snowy Mountain carries no Glacite, and canon names it as the source of cold');
}

if (umbrelSources.length !== 1) {
  warn('Umbrel has more than one source; canon single-sources it through Dark Fiber, though section 13 leaves that open');
}

// ---------------------------------------------------------------- crafting

/*
 * The stats the engine actually reads, taken from the list the runtime
 * iterates rather than from baseStats. A recipe pointing at a stat that only
 * exists in content raises a number nothing ever asks for.
 */
const statBlock = typeSourceFor('GAUNTLET_STATS');
const engineStats = new Set([...statBlock.matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]));
for (const stat of engineStats) {
  if (!(stat in (crafting.baseStats ?? {}))) {
    fail(`the engine reads gauntlet stat "${stat}", which crafting.baseStats does not define`);
  }
}
for (const stat of Object.keys(crafting.baseStats ?? {})) {
  if (stat.startsWith('$')) continue;
  if (!engineStats.has(stat)) fail(`crafting.baseStats defines "${stat}", which nothing in the engine reads`);
}

const statNames = new Set(Object.keys(crafting.baseStats ?? {}));
const recipeBiomes = new Set();
const craftIds = new Set();
for (const r of crafting.recipes) {
  if (craftIds.has(r.id)) fail(`duplicate crafting recipe id "${r.id}"`);
  craftIds.add(r.id);
  const cost = Object.entries(r.cost ?? {});
  if (!cost.length) fail(`crafting recipe "${r.id}" costs nothing`);
  let units = 0;
  for (const [id, qty] of cost) {
    if (!materialIds.has(id)) fail(`crafting recipe "${r.id}" needs unknown material "${id}"`);
    else recipeBiomes.add(materials.find((m) => m.id === id).biome);
    if (!Number.isInteger(qty) || qty <= 0) fail(`crafting recipe "${r.id}" asks for ${qty} x ${id}`);
    units += qty;
  }
  // One material is one unit of carry. A recipe costing more than a starting
  // gauntlet can hold cannot be made until some OTHER recipe has been made
  // first, which is a dependency nothing in the menu states.
  if (units > crafting.baseStats.carryCapacity) {
    fail(`crafting recipe "${r.id}" costs ${units} units against a base capacity of ${crafting.baseStats.carryCapacity}`);
  }
  if (!statNames.has(r.effect?.stat)) {
    fail(`crafting recipe "${r.id}" upgrades unknown stat "${r.effect?.stat}"`);
  }
  if (!(r.effect?.amount > 0)) fail(`crafting recipe "${r.id}" upgrades nothing`);
}

/*
 * Every region has to be worth walking to for crafting as well as for alchemy.
 *
 * The canon four recipes are all buildable from Plains/Forest material, which
 * meant crafting was finished inside the first twenty minutes and the four
 * outer regions - the whole reason the world is this shape - only ever paid
 * out in elements. A region with nothing to make in it is a region the player
 * visits once.
 */
for (const id of biomeIds) {
  if (!recipeBiomes.has(id)) fail(`no crafting recipe wants anything from "${id}", so there is nothing to make there`);
}

// ---------------------------------------------------------------- alchemy

/*
 * The shapes an ability can resolve in, read out of the type union rather than
 * listed again here. A combination naming a kind the engine does not implement
 * falls through every branch and resolves as "hits nobody, does nothing",
 * which ships perfectly happily.
 */
const kindBlock = typeSource.match(/export type AbilityKind =([^;]*);/);
if (!kindBlock) fail('could not find AbilityKind in web/src/core/types.ts');
const abilityKinds = new Set([...(kindBlock?.[1] ?? '').matchAll(/'([a-z]+)'/g)].map((m) => m[1]));

const elementsUsed = new Set();
const alchemyIds = new Set();
for (const c of alchemy) {
  if (alchemyIds.has(c.id)) fail(`duplicate alchemy combination id "${c.id}"`);
  alchemyIds.add(c.id);
  const required = Object.entries(c.elements ?? {});
  if (!required.length) fail(`alchemy combination "${c.id}" requires no elements`);
  for (const [el, qty] of required) {
    if (!elementIds.has(el)) fail(`alchemy combination "${c.id}" requires unknown element "${el}"`);
    else elementsUsed.add(el);
    if (!Number.isInteger(qty) || qty <= 0) fail(`alchemy combination "${c.id}" asks for ${qty} x ${el}`);
  }
  // Canon: the tutorial combinations are all craftable from Plains/Forest
  // material alone, "so the tutorial requires no travel". A tutorial that sends
  // the player to the mountain before they have been taught to fight is a
  // tutorial that cannot be completed.
  if (c.tutorial) {
    const unreachable = Object.keys(c.elements).filter((el) => !spawnElements.has(el));
    if (unreachable.length) {
      fail(
        `tutorial combination "${c.id}" needs ${unreachable.join(', ')}, which Plains/Forest does not yield - ` +
          'the tutorial must require no travel',
      );
    }
  }
  if (!(c.effect?.damage >= 0)) fail(`alchemy combination "${c.id}" has no effect damage`);

  /*
   * The shape, and whether it has been given what that shape needs to resolve.
   *
   * Every one of these is a silent nothing rather than a crash: a beam with no
   * range reaches zero units and catches nobody, a chain with no jumps is an
   * expensive single hit, and a self-cast with no self-effect spends the
   * elements, plays the sound, starts the cooldown and does not do anything.
   */
  const effect = c.effect ?? {};
  if (!abilityKinds.has(effect.kind)) {
    fail(`alchemy combination "${c.id}" has kind "${effect.kind}", which the engine does not resolve`);
  }
  if (effect.kind === 'beam' && !(effect.range > 0)) fail(`beam "${c.id}" has no range, so it reaches nothing`);
  if ((effect.kind === 'shove' || effect.kind === 'burst') && !(effect.radius > 0)) {
    fail(`${effect.kind} "${c.id}" has no radius, so it catches nothing`);
  }
  if (effect.kind === 'chain') {
    if (!(effect.range > 0)) fail(`chain "${c.id}" has no range, so it cannot find a first target`);
    if (!(effect.radius > 0)) fail(`chain "${c.id}" has no radius, so it can never leap`);
    if (!(effect.jumps >= 1)) fail(`chain "${c.id}" makes ${effect.jumps} jumps; that is a single hit with extra steps`);
  }

  const selfKeys = ['shieldAmount', 'healAmount', 'hideSeconds', 'revealSeconds'];
  const lands = selfKeys.filter((key) => effect[key] > 0);
  if (effect.kind === 'self') {
    if (!lands.length) fail(`self-cast "${c.id}" does nothing to the caster, so casting it is a cooldown and a bill`);
    if (effect.damage > 0) fail(`self-cast "${c.id}" has damage ${effect.damage}, which it can never deliver to anyone`);
  }
  if (effect.shieldAmount > 0 && !(effect.shieldSeconds > 0)) fail(`"${c.id}" raises a shield with no duration, which lapses on the same frame`);
  if (effect.healAmount > 0 && !(effect.healSeconds > 0)) fail(`"${c.id}" heals over no time at all`);
  if (effect.slowSeconds > 0 && !(effect.slowScale > 0 && effect.slowScale < 1)) {
    fail(`"${c.id}" slows to ${effect.slowScale} of pace; outside 0..1 that is a stop or a speed boost`);
  }
  if (effect.damage === 0 && !lands.length && !(effect.slowSeconds > 0) && !(effect.knockback > 0)) {
    fail(`alchemy combination "${c.id}" does no damage, no knockback and nothing to the caster`);
  }

  // Tutorial combinations are handed over at Level 1, so a minLevel on one is
  // two rules disagreeing about the same combination.
  if (c.tutorial && c.minLevel !== undefined) fail(`tutorial combination "${c.id}" also sets minLevel ${c.minLevel}`);
  if (c.minLevel !== undefined) {
    if (!Number.isInteger(c.minLevel) || c.minLevel < progression.alchemyUnlockLevel) {
      fail(`"${c.id}" opens at level ${c.minLevel}, before the workshop it lives in opens at ${progression.alchemyUnlockLevel}`);
    }
  }
}
if (![...alchemy].some((c) => c.tutorial)) fail('no alchemy combination is marked as a tutorial combination');

/*
 * Every element has to be reachable through something.
 *
 * Canon's gating rule - Glacite and Umbrel withheld from the spawn, "the
 * world's only reason to leave the centre" - is buying travel, and travel that
 * pays out in an element no combination wants is travel that pays out in
 * nothing. Seven of the ten sat in that state through several releases without
 * anything being obviously broken, which is exactly why this is a build error
 * and not a note in a design document.
 */
for (const e of elements) {
  if (!elementsUsed.has(e.id)) {
    fail(
      `element "${e.id}" is in no alchemy combination - it can be gathered, carried and read about, ` +
        'and then it does nothing, which makes every material carrying it and every walk to fetch one pointless',
    );
  }
}

// ---------------------------------------------------------------- enemies & waves

const enemyIds = new Set();
const tiersSeen = new Set();
for (const e of enemyTiers) {
  if (enemyIds.has(e.id)) fail(`duplicate enemy id "${e.id}"`);
  enemyIds.add(e.id);
  if (![1, 2, 3].includes(e.tier)) fail(`enemy "${e.id}" has tier ${e.tier}; canon defines exactly three`);
  tiersSeen.add(e.tier);
  /*
   * Several kinds may share a tier, and that is the point of having seven.
   *
   * This used to reject a second enemy on any tier, which was right when a
   * tier WAS a creature. The tier is the threat scale - canon's "seeing a
   * Minotaur tells the player the difficulty changed" - and the kind is what
   * it does, so the rule that matters is that all three scales exist, below.
   */
  if (!knownShapes.has(e.shape)) fail(`enemy "${e.id}" uses unknown shape "${e.shape}"`);
  if (!(e.hp > 0) || !(e.damage > 0)) fail(`enemy "${e.id}" has no health or no damage`);
  // Weight divides knockback; below 1 it would multiply it instead.
  if (!(e.weight >= 1)) fail(`enemy "${e.id}" has weight ${e.weight}; a shove cannot be amplified by being heavy`);
  /*
   * Reach against awareness, which means different things for the two kinds.
   *
   * A melee enemy that swings from beyond the distance it notices at can never
   * land a hit, and reads in play as broken rather than passive. A RANGED one
   * is supposed to outreach its own notice - that is the whole shape of it: it
   * has to bump into you to wake up, and then it can keep shooting while you
   * back off. What it must not outreach is the distance at which it forgets
   * you, or it would be firing at somebody it has stopped believing in.
   */
  const reachLimit = e.ranged ? e.loseRadius : e.noticeRadius;
  if (e.attackRange > reachLimit) {
    fail(
      e.ranged
        ? `ranged enemy "${e.id}" fires ${e.attackRange}uu but forgets the player at ${e.loseRadius}uu`
        : `enemy "${e.id}" attacks from beyond the range it notices at`,
    );
  }
  // Canon's asymmetry is the player knowing where the program is and not the
  // other way round. A notice radius that covers most of a screen is a
  // detection sweep, and turns every encounter into a lock-on.
  if (!(e.noticeRadius > 0) || e.noticeRadius > 200) {
    fail(`enemy "${e.id}" notices from ${e.noticeRadius}uu; that is a detection sweep, not an encounter`);
  }
  // Losing the player has to be easier than finding them, or backing off does
  // nothing and the pursuit is a tether by another name.
  if (!(e.loseRadius > e.noticeRadius)) fail(`enemy "${e.id}" forgets the player closer than it notices them`);
  if (!(e.forgetSeconds > 0)) fail(`enemy "${e.id}" never gives up the chase`);
  // A wander that is not slower than the chase makes the two indistinguishable.
  if (!(e.wanderSpeed > 0) || e.wanderSpeed >= e.speed) {
    fail(`enemy "${e.id}" wanders at ${e.wanderSpeed} against a chase of ${e.speed}; a chase has to look like one`);
  }
  if (!(e.roamRadius > 0)) fail(`enemy "${e.id}" has nowhere to wander, so it will stand where it spawned`);
  const pause = e.pauseSeconds;
  if (!Array.isArray(pause) || pause.length !== 2 || !(pause[0] >= 0) || !(pause[1] > pause[0])) {
    fail(`enemy "${e.id}" needs pauseSeconds as [min, max] with max above min`);
  }
  if ('drops' in e) fail(`enemy "${e.id}" has a drop table; materials come from the world, not from kills`);
}
if (tiersSeen.size !== 3) fail(`canon defines three enemy tiers; found ${tiersSeen.size}`);

/*
 * The behaviour fields, which are all optional and all silent when wrong.
 *
 * A ranged kind with no keepDistance closes to 85% of its attack range, which
 * for a 300-unit range means it walks into the player's fists and stops being
 * a ranged enemy - it still works, it just quietly is not the thing it was
 * written to be. Armour above what the basic attack can do would be a wall the
 * player has no way to read as a wall. A mender with no radius heals nobody.
 */
const basicDamage = progression.combat?.basicAttack?.damage ?? 0;
for (const e of enemyTiers) {
  if (e.attackCooldownSeconds !== undefined && !(e.attackCooldownSeconds > 0)) {
    fail(`enemy "${e.id}" attacks every ${e.attackCooldownSeconds}s`);
  }
  if (e.keepDistance !== undefined && !(e.keepDistance > 0)) fail(`enemy "${e.id}" keeps a distance of ${e.keepDistance}`);

  if (e.ranged) {
    if (!(e.ranged.speed > 0)) fail(`ranged enemy "${e.id}" fires a bolt that does not move`);
    if (!(e.ranged.radius > 0)) fail(`ranged enemy "${e.id}" fires a bolt with no size, which can never touch anybody`);
    if (!(e.ranged.windUpSeconds > 0)) {
      fail(`ranged enemy "${e.id}" fires with no wind-up; a bolt from across a clearing with no tell is damage nobody could avoid`);
    }
    if (!(e.keepDistance > 0)) {
      fail(`ranged enemy "${e.id}" has no keepDistance, so it walks into melee and stops being ranged`);
    }
    if (e.keepDistance >= e.attackRange) {
      fail(`ranged enemy "${e.id}" keeps ${e.keepDistance}uu but only reaches ${e.attackRange}uu, so it can never fire`);
    }
    // It has to be leavable on foot, or it is a tax rather than a decision.
    if (e.ranged.speed > (progression.player?.sprintSpeed ?? 0) * 4) {
      fail(`ranged enemy "${e.id}" fires at ${e.ranged.speed}uu/s against a player who moves at ${progression.player?.sprintSpeed}; that is a reflex check, not a thing to walk out of`);
    }
  }

  if (e.armour !== undefined) {
    if (!(e.armour > 0)) fail(`enemy "${e.id}" has armour ${e.armour}, which subtracts nothing`);
    else if (e.armour >= basicDamage) {
      warn(`"${e.id}" armour ${e.armour} against a basic attack of ${basicDamage}: only the floor gets through, so the basic attack is not weak here, it is useless`);
    }
  }

  if (e.mends) {
    if (!(e.mends.radius > 0)) fail(`mender "${e.id}" has no radius, so it repairs nobody`);
    if (!(e.mends.perSecond > 0)) fail(`mender "${e.id}" repairs ${e.mends.perSecond} a second`);
    if (e.mends.perSecond * 4 > basicDamage / (progression.combat?.basicAttack?.cooldownSeconds ?? 1)) {
      warn(`"${e.id}" mends ${e.mends.perSecond}/s, which is close to what a player can take off a single target; a crowd may be unkillable while it lives`);
    }
  }
}

// Each tier wants more than one kind, or the tier is still a creature.
for (const tier of [1, 2, 3]) {
  const kinds = enemyTiers.filter((e) => e.tier === tier).length;
  if (kinds < 2) warn(`tier ${tier} has only ${kinds} kind; the tier says how bad it is and the kind says what it does`);
}

// The asymmetry has a direction. If the player senses less far than an enemy
// notices, the informational advantage sits with the program, which is backwards.
const awareness = waves.awarenessRadius;
if (!(awareness > 0)) fail('waves.awarenessRadius is missing; the player would have no sense of what is nearby');
else {
  const sharpest = Math.max(...enemyTiers.map((e) => e.noticeRadius));
  if (awareness <= sharpest) {
    fail(`the player senses ${awareness}uu against an enemy noticing at ${sharpest}uu; the advantage is meant to be the player's`);
  }
}

const pacing = waves.pacing?.[waves.activePacing];
if (!pacing) fail(`waves.activePacing is "${waves.activePacing}", which has no entry in waves.pacing`);
else if (pacing.wavesPerBundle !== 3) fail('a bundle is three waves; that is what makes it the unit of pressure');
if (waves.maxLiveWaveGroups !== 3) {
  fail('maxLiveWaveGroups must be 3 - the cap is exactly one full bundle, which is the point of it');
}
for (const row of waves.composition) {
  for (const key of Object.keys(row)) {
    if (key === 'bundleIndex' || key.startsWith('$')) continue;
    if (!enemyIds.has(key)) fail(`wave composition references unknown enemy "${key}"`);
  }
}

/*
 * The escalation, which is what happens after the composition rows run out.
 *
 * Every one of these is a number that looks fine while quietly cancelling the
 * late game: growth of zero makes bundle 40 identical to bundle 4, a gap
 * multiplier of 1 means the cycle never tightens, and one above 1 means it
 * loosens forever - which is an escalation running backwards.
 */
const esc = waves.escalation;
if (!esc) fail('waves.escalation is missing, so every bundle past the last authored row is identical to it');
else {
  if (!(esc.growthPerBundle > 0)) fail(`escalation growthPerBundle is ${esc.growthPerBundle}; bundle 40 would be the same fight as bundle 4`);
  if (!(esc.maxMultiplier > 1)) fail(`escalation maxMultiplier is ${esc.maxMultiplier}, which caps growth at or below where it starts`);
  if (!(esc.gapShrink > 0) || esc.gapShrink >= 1) fail(`escalation gapShrink is ${esc.gapShrink}; at 1 or above the quiet never gets shorter`);
  const slowest = Math.max(...Object.values(waves.pacing).map((p) => p.secondsBetweenBundles?.[1] ?? 0));
  if (!(esc.minSecondsBetweenBundles > 0) || esc.minSecondsBetweenBundles >= slowest) {
    fail(`escalation minSecondsBetweenBundles is ${esc.minSecondsBetweenBundles} against a starting gap of ${slowest}; the floor has to be below the ceiling`);
  }
  // The gap between bundles IS the exploration. A floor short enough to run
  // bundles back to back deletes the half of the game the world exists for.
  if (esc.minSecondsBetweenBundles < 120) fail(`escalation minSecondsBetweenBundles is ${esc.minSecondsBetweenBundles}s, which is not a gap, it is a siege`);

  // A cap below one full bundle's worth would silently swallow waves the
  // director thinks it spawned, and the bundle would never clear.
  const heaviest = Math.max(
    ...waves.composition.map((row) =>
      Object.entries(row)
        .filter(([key]) => key !== 'bundleIndex' && !key.startsWith('$'))
        .reduce((sum, [, range]) => sum + (range[1] ?? 0), 0),
    ),
  );
  const perBundle = heaviest * esc.maxMultiplier * (pacing?.wavesPerBundle ?? 3);
  if (!(esc.maxLiveEnemies >= heaviest * esc.maxMultiplier)) {
    fail(
      `escalation maxLiveEnemies is ${esc.maxLiveEnemies} against a single scaled wave of up to ` +
        `${Math.round(heaviest * esc.maxMultiplier)}; a cap below one wave means waves that never finish arriving`,
    );
  }
  // Not an error - a cap below a whole bundle is the intended behaviour on a
  // phone - but worth saying out loud, because it is the number that decides
  // how much of a late bundle the player actually meets.
  if (esc.maxLiveEnemies < perBundle) {
    warn(`a fully escalated bundle rolls up to ${Math.round(perBundle)} enemies and maxLiveEnemies is ${esc.maxLiveEnemies}; the rest are dropped`);
  }
}

if (!(waves.ambientTopUpSeconds > 0)) {
  fail('waves.ambientTopUpSeconds is missing, so the ambient population spawns once and is then permanently thinned by every kill');
}

// ---------------------------------------------------------------- progression

if (progression.alchemyUnlockLevel !== 2) {
  fail(`alchemy unlocks at level ${progression.alchemyUnlockLevel}; canon moved it to 2 and says so explicitly`);
}
if (progression.xp?.gather !== undefined) {
  fail('progression.xp.gather exists - XP is novelty, not volume, and per-unit gathering rewards farming one node');
}

/*
 * The one that would have caught the hole.
 *
 * XP is novelty, so the total a run can earn is FINITE and computable: one
 * payment per material, per recipe, per combination, per region arrived in,
 * plus the waves of the one bundle that is not itself gated behind a level.
 * The content then gates things on levels - repeating bundles and the ambient
 * population at Level 5, a combination at Level 6 - and nothing was checking
 * that those levels were inside the ceiling.
 *
 * They were not. The curve put Level 5 at 1970 against a ceiling of 1400, so
 * the escalation the deck calls the point the game escalates could not happen,
 * in any run, ever. Nothing failed; the game simply stopped having a late
 * game, quietly, and looked fine doing it.
 *
 * Deliberately conservative: the spawn region pays nothing because waking in
 * it is not visiting it, and only the first bundle's waves count because every
 * later bundle is behind the very gate being checked. A ceiling computed
 * generously would have passed the build that was broken.
 */
const ceiling =
  notes.length * (progression.xp?.firstNote ?? 0) +
  materials.length * (progression.xp?.firstMaterial ?? 0) +
  crafting.recipes.length * (progression.xp?.firstCraft ?? 0) +
  alchemy.length * (progression.xp?.firstAlchemy ?? 0) +
  Math.max(0, biomes.length - 1) * (progression.xp?.firstBiome ?? 0) +
  (pacing?.wavesPerBundle ?? 0) * (progression.xp?.clearWave ?? 0);

const cumulative = [0];
for (const step of progression.levelCurve?.thresholds ?? []) {
  cumulative.push(cumulative[cumulative.length - 1] + step);
}

const gated = [
  ['progression.alchemyUnlockLevel', progression.alchemyUnlockLevel],
  ['progression.classLevel', progression.classLevel],
  ['ending.requires.level', ending?.requires?.level],
  ['waves.gates.firstBundleAtLevel', waves.gates?.firstBundleAtLevel],
  ['waves.gates.repeatingBundlesFromLevel', waves.gates?.repeatingBundlesFromLevel],
  ['waves.gates.ambientFromLevel', waves.gates?.ambientFromLevel],
  ...alchemy.filter((c) => c.minLevel !== undefined).map((c) => [`alchemy "${c.id}" minLevel`, c.minLevel]),
];

for (const [what, level] of gated) {
  if (typeof level !== 'number') continue;
  const needed = cumulative[level];
  if (needed === undefined) {
    fail(`${what} is ${level}, which the level curve does not go up to`);
  } else if (needed > ceiling) {
    fail(
      `${what} is ${level}, which needs ${needed} XP - but a run that does absolutely everything once ` +
        `earns ${ceiling}. That gate can never open, and nothing else would have said so`,
    );
  }
}

// ---------------------------------------------------------------- tutorial

// Each step is completed by a rule in web/src/core/tutorial.ts keyed by id. If
// a step has no rule it can never complete and the guide stalls forever.
const ruleSource = readFileSync(join(ROOT, 'web/src/core/tutorial.ts'), 'utf8');
const ruleBlock = ruleSource.match(/TUTORIAL_RULES[^{]*\{([\s\S]*?)\n\};/);
if (!ruleBlock) fail('could not find TUTORIAL_RULES in web/src/core/tutorial.ts');
const ruleIds = new Set([...(ruleBlock?.[1] ?? '').matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1]));

const stepIds = new Set();
for (const step of tutorial) {
  if (stepIds.has(step.id)) fail(`duplicate tutorial step id "${step.id}"`);
  stepIds.add(step.id);
  if (!step.title || !step.hint) fail(`tutorial step "${step.id}" is missing a title or hint`);
  if (!ruleIds.has(step.id)) fail(`tutorial step "${step.id}" has no rule in core/tutorial.ts, so it can never complete`);
}
for (const id of ruleIds) {
  if (!stepIds.has(id)) warn(`tutorial rule "${id}" has no step in content/tutorial.json and will never run`);
}

// The waking scene. It holds the game before the player has any control, so a
// missing or runaway duration is a soft lock rather than a cosmetic problem.
if (!opening) fail('content/tutorial.json has no opening scene');
else {
  if (!Array.isArray(opening.lines) || opening.lines.length === 0) fail('the opening scene has no lines');
  else if (opening.lines.some((line) => typeof line !== 'string' || line.trim() === '')) {
    fail('every opening line must be non-empty text');
  }
  for (const key of ['fadeSeconds', 'lineSeconds']) {
    const value = opening[key];
    if (typeof value !== 'number' || !(value > 0)) fail(`the opening scene needs a positive ${key}`);
    else if (value > 6) fail(`opening ${key} is ${value}s - long enough to read as a hang`);
  }
  // Canon opens slow, but the whole scene still has to be shorter than the
  // patience of someone who just pressed Begin.
  const total = (opening.lineSeconds ?? 0) * (opening.lines?.length ?? 0);
  if (total > 15) fail(`the opening scene runs ${total.toFixed(1)}s before the player may move`);
}

/*
 * The fragments, checked the same way the tutorial steps are.
 *
 * A fragment hung off a trigger the game never fires does not break anything.
 * It just never appears, which is exactly the kind of quiet nothing that
 * survives a release - so it is a build error instead.
 */
const triggerSource = readFileSync(join(ROOT, 'web/src/core/fragments.ts'), 'utf8');
const triggerBlock = triggerSource.match(/FRAGMENT_TRIGGERS = \[([\s\S]*?)\]/);
if (!triggerBlock) fail('could not find FRAGMENT_TRIGGERS in web/src/core/fragments.ts');
const triggers = new Set([...(triggerBlock?.[1] ?? '').matchAll(/'([a-zA-Z]+)'/g)].map((m) => m[1]));

const fragmentIds = new Set();
const usedTriggers = new Set();
for (const fragment of fragments) {
  if (fragmentIds.has(fragment.id)) fail(`duplicate fragment id "${fragment.id}"`);
  fragmentIds.add(fragment.id);
  if (!fragment.title || !fragment.text) fail(`fragment "${fragment.id}" is missing a title or text`);
  if (!triggers.has(fragment.on)) {
    fail(`fragment "${fragment.id}" fires on "${fragment.on}", which is not a trigger the game raises`);
  }
  // One per moment: two readings landing on the same action would stack on top
  // of each other and the player would see whichever drew last.
  if (usedTriggers.has(fragment.on)) fail(`two fragments both fire on "${fragment.on}"`);
  usedTriggers.add(fragment.on);
  // Long enough to say something, short enough to read while something is
  // walking towards you.
  if (fragment.text.length > 240) {
    fail(`fragment "${fragment.id}" runs ${fragment.text.length} characters - too long to read mid-run`);
  }
}
for (const trigger of triggers) {
  if (!usedTriggers.has(trigger)) warn(`no fragment fires on "${trigger}"`);
}

// ---------------------------------------------------------------- notes

/*
 * Information Integrity needs two channels that can disagree.
 *
 * Canon is specific: plentiful and unreliable against rare and accurate. Both
 * halves of that are checkable and neither is checkable by looking at the
 * game - a build where the rare channel outnumbers the bulletins, or where
 * nothing contradicts anything, plays exactly like a build where it works and
 * simply has no system in it.
 */
const noteIds = new Set();
const noteBiomes = new Map();
const byChannel = new Map([['bulletin', []], ['jakindur', []]]);
const contradicted = new Set();

for (const note of notes) {
  if (noteIds.has(note.id)) fail(`duplicate note id "${note.id}"`);
  noteIds.add(note.id);
  if (!note.title || !note.text) fail(`note "${note.id}" is missing a title or text`);
  if (!byChannel.has(note.channel)) fail(`note "${note.id}" is on unknown channel "${note.channel}"`);
  else byChannel.get(note.channel).push(note);
  if (!biomeIds.has(note.biome)) fail(`note "${note.id}" is in unknown region "${note.biome}"`);
  else noteBiomes.set(note.biome, (noteBiomes.get(note.biome) ?? 0) + 1);
  // Read standing up, with something walking towards you.
  if (note.text.length > 260) fail(`note "${note.id}" runs ${note.text.length} characters - too long to read mid-run`);
}

const bulletins = byChannel.get('bulletin') ?? [];
const found = byChannel.get('jakindur') ?? [];
if (!bulletins.length) fail('there is no unreliable channel, so nothing can be disagreed with');
if (!found.length) fail('there is no accurate channel, so Information Integrity is one voice and a rumour');
if (found.length >= bulletins.length) {
  fail(`the rare channel has ${found.length} notes against ${bulletins.length} bulletins; canon makes one plentiful and the other rare`);
}

for (const note of found) {
  if (!note.contradicts) {
    fail(`note "${note.id}" is on the accurate channel and disagrees with nothing, which is the only job that channel has`);
    continue;
  }
  const other = notes.find((n) => n.id === note.contradicts);
  if (!other) fail(`note "${note.id}" contradicts "${note.contradicts}", which does not exist`);
  else if (other.channel === note.channel) fail(`note "${note.id}" contradicts "${other.id}", which is on the same channel`);
  else contradicted.add(other.id);
}
for (const note of bulletins) {
  if (note.contradicts) fail(`bulletin "${note.id}" contradicts something; the unreliable channel does not get to be right on purpose`);
}

// Plentiful means everywhere. A region with no bulletin in it is a region the
// system has nothing to say about, which is the opposite of what it is.
for (const id of biomeIds) {
  if (!bulletins.some((n) => n.biome === id)) fail(`region "${id}" has no bulletin in it, and the unreliable channel is meant to be everywhere`);
}
// And the accurate channel has to be worth crossing the map for.
for (const id of biomeIds) {
  if (!found.some((n) => n.biome === id)) warn(`region "${id}" holds none of the rare channel`);
}

// ---------------------------------------------------------------- the ending

/*
 * The one thing the build did not have at all.
 *
 * Every failure here is a run that cannot be finished, discovered by whoever
 * walks all the way to the edge of the world holding the right gauntlet: a
 * recipe id that no longer exists, a reach so short the boundary can never be
 * stood next to, a meter that decays faster than it fills, or an epilogue
 * table with a hole in it that ends the game on a blank screen.
 */
if (!ending) fail('content/ending.json is missing, so there is no way to finish a run');
else {
  if (!craftIds.has(ending.requires?.recipe)) {
    fail(`the ending needs recipe "${ending.requires?.recipe}", which crafting does not define`);
  }
  const breach = ending.breach ?? {};
  if (!(breach.secondsOfPull > 0)) fail('the breach takes no time at all, so the ending fires on contact');
  if (breach.secondsOfPull > 180) fail(`the breach takes ${breach.secondsOfPull}s of held pull, which is a chore rather than a finale`);
  if (!(breach.reach > 0)) fail('the breach has no reach, so the boundary can never be stood close enough to');
  // The player has to be able to get inside it without leaving the world.
  if (breach.reach > biomesFile.boundaryRadius * 0.2) {
    fail(`the breach reach is ${breach.reach}uu of a ${biomesFile.boundaryRadius}uu world; that is not the edge, that is most of the map`);
  }
  if (!(breach.decayPerSecond >= 0)) fail('the breach meter gains progress while the pull is off');
  // Decay has to be slower than gain, or letting go to fight is a losing move
  // and the only viable play is standing still and tanking.
  if (breach.decayPerSecond >= 1 / breach.secondsOfPull) {
    fail(
      `the breach meter decays at ${breach.decayPerSecond}/s and fills at ${(1 / breach.secondsOfPull).toFixed(3)}/s - ` +
        'breaking off to fight would lose more than holding gains, so the only play is standing still',
    );
  }

  let last = -Infinity;
  for (const stage of ending.stages ?? []) {
    if (!(stage.at >= 0) || stage.at > 1) fail(`ending stage at ${stage.at} is outside the meter`);
    if (stage.at < last) fail('the ending stages are out of order, so they will fire out of order');
    last = stage.at;
    if (!stage.text) fail('an ending stage has no text');
  }

  const epilogues = ending.epilogues ?? [];
  if (!epilogues.length) fail('the ending has no epilogue, so finishing the game shows nothing');
  if (!epilogues.some((e) => e.minNotes === 0)) {
    fail('no epilogue covers a player holding none of the rare channel, and the game is winnable without it');
  }
  const rare = notes.filter((n) => n.channel === 'jakindur').length;
  for (const e of epilogues) {
    if (!e.title || !e.text) fail(`epilogue at minNotes ${e.minNotes} is missing a title or text`);
    if (e.minNotes > rare) fail(`an epilogue needs ${e.minNotes} rare notes and only ${rare} exist, so nobody can ever see it`);
  }
}

// ------------------------------------------------------------- archetypes

/*
 * The telemetry read, which grants the rune and the class.
 *
 * Canon names three archetypes and two levels and does not supply a single
 * number, so everything checkable here is structural - and all of it fails
 * quietly. A signal with no scale is counted in its own raw units and drowns
 * out every other signal; an archetype that leans on a signal that does not
 * exist is one the read can never pick; a grant of 1.0 is an archetype that
 * does nothing at all and is indistinguishable from one that works.
 */
if (!archetypes) fail('content/archetypes.json is missing, so nothing is ever read from the player');
else {
  const signals = new Set(archetypes.signals ?? []);
  if (signals.size !== 7) fail(`there are ${signals.size} signals; canon says the telemetry reads seven`);
  for (const signal of signals) {
    if (!(archetypes.scales?.[signal] > 0)) {
      fail(`signal "${signal}" has no scale, so it is compared in its own raw units and drowns out the rest`);
    }
  }
  for (const signal of Object.keys(archetypes.scales ?? {})) {
    if (!signal.startsWith('$') && !signals.has(signal)) fail(`a scale is given for "${signal}", which is not a signal`);
  }

  if (archetypes.runeLevel !== progression.alchemyUnlockLevel) {
    fail(`the rune lands at level ${archetypes.runeLevel} and canon puts it with the workshop at ${progression.alchemyUnlockLevel}`);
  }
  // Canon is explicit that the rune reads the tutorial period as roughly half
  // its evidence. At 0 or 1 the two reads are the same read.
  if (!(archetypes.tutorialWeight > 0) || archetypes.tutorialWeight >= 1) {
    fail(`tutorialWeight is ${archetypes.tutorialWeight}; canon weights the tutorial period at roughly half, and 0 or 1 collapses the two reads into one`);
  }

  const seen = new Set();
  const leanedOn = new Set();
  for (const a of archetypes.archetypes ?? []) {
    if (seen.has(a.id)) fail(`duplicate archetype id "${a.id}"`);
    seen.add(a.id);
    for (const field of ['name', 'rune', 'description', 'runeDescription']) {
      if (!a[field]) fail(`archetype "${a.id}" is missing "${field}"`);
    }
    const leans = Object.entries(a.leans ?? {});
    if (!leans.length) fail(`archetype "${a.id}" leans on nothing, so the read can only ever pick it by accident`);
    for (const [signal, weight] of leans) {
      if (!signals.has(signal)) fail(`archetype "${a.id}" leans on "${signal}", which is not a signal`);
      else if (weight > 0) leanedOn.add(signal);
      if (typeof weight !== 'number' || weight === 0) fail(`archetype "${a.id}" leans on "${signal}" by ${weight}`);
    }
    for (const which of ['runeGrants', 'classGrants']) {
      const grant = a[which] ?? {};
      const values = Object.entries(grant);
      if (!values.length) fail(`archetype "${a.id}" has empty ${which}, so being read as it changes nothing`);
      for (const [key, value] of values) {
        if (typeof value !== 'number') fail(`archetype "${a.id}" ${which}.${key} is not a number`);
        else if (key.endsWith('Scale') && !(value > 0)) fail(`archetype "${a.id}" ${which}.${key} is ${value}; a scale of zero deletes the thing it scales`);
      }
      if (grant.chargeBonus !== undefined && !(grant.chargeSeconds > 0)) {
        fail(`archetype "${a.id}" ${which} grants a charge bonus with no time to build it in`);
      }
    }
  }
  if (seen.size < 2) fail('there is nothing for the read to choose between');
  // A signal nothing leans towards is a counter the game keeps and never uses.
  for (const signal of signals) {
    if (!leanedOn.has(signal)) warn(`no archetype leans towards "${signal}", so that signal can only ever count against a player`);
  }
  for (const id of ['nahaste', 'amorratua', 'dotore']) {
    if (!seen.has(id)) fail(`archetype "${id}" is named in GDD section 9 and is not here`);
  }
}

// ---------------------------------------------------------------- emit

if (errors.length) {
  console.error(`\n  content build FAILED - ${errors.length} error(s):\n`);
  for (const e of errors) console.error(`   x ${e}`);
  console.error('');
  process.exit(1);
}

const xpTable = [0];
for (const step of progression.levelCurve.thresholds) xpTable.push(xpTable[xpTable.length - 1] + step);

const bundle = {
  generated: true,
  note: 'GENERATED FILE - do not edit. Source of truth is content/*.json; run npm run build:content.',
  version: 2,
  progression: { ...progression, xpTable },
  tutorial,
  fragments: fragments.map((f) => ({ id: f.id, on: f.on, title: f.title, text: f.text })),
  noteChannels: notesFile.channels,
  notes: notes.map((n) => ({
    id: n.id,
    channel: n.channel,
    biome: n.biome,
    title: n.title,
    text: n.text,
    ...(n.contradicts ? { contradicts: n.contradicts } : {}),
  })),
  opening: {
    fadeSeconds: opening.fadeSeconds,
    lineSeconds: opening.lineSeconds,
    lines: opening.lines,
  },
  elements,
  materials: materials.map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description,
    biome: m.biome,
    elements: m.elements,
    shape: m.shape,
    color: m.color,
  })),
  biomes: biomes.map((b) => ({ ...b, materials: byBiome.get(b.id) })),
  coliseum: { boundaryRadius: biomesFile.boundaryRadius, travelSeconds: biomesFile.travelSeconds },
  crafting,
  alchemy,
  enemies: enemyTiers,
  waves,
  ending,
  archetypes,
};

/**
 * Unity's JsonUtility cannot deserialize a dictionary-shaped object, so the
 * Unity copy flattens every id-to-quantity map into an array of pairs. Same
 * data, same build step, no second source of truth.
 */
const toPairs = (record, keyName) =>
  Object.entries(record ?? {}).map(([key, quantity]) => ({ [keyName]: key, quantity }));

const unityBundle = {
  ...bundle,
  note: bundle.note + ' Unity variant: id-to-quantity maps are flattened to arrays for JsonUtility.',
  crafting: {
    ...crafting,
    recipes: crafting.recipes.map(({ cost, ...rest }) => ({ ...rest, cost: toPairs(cost, 'material') })),
  },
  alchemy: alchemy.map(({ elements: required, ...rest }) => ({ ...rest, elements: toPairs(required, 'element') })),
};

const outputs = [
  ['content/generated/maelstrom-content.json', bundle],
  ['unity/Assets/Resources/maelstrom-content.json', unityBundle],
];
for (const [rel, payload] of outputs) {
  const abs = join(ROOT, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, JSON.stringify(payload, null, 2) + '\n');
}

for (const w of warnings) console.warn(`   ! ${w}`);
console.log(
  `\n  content OK - ${elements.length} elements, ${materials.length} materials across ${biomes.length} biomes, ` +
    `${crafting.recipes.length} crafting recipes, ${alchemy.length} alchemy combinations, ` +
    `${enemyTiers.length} enemy kinds over ${tiersSeen.size} tiers, ${bulletins.length}+${found.length} notes` +
    `${warnings.length ? ` (${warnings.length} warning(s))` : ''}`,
);
console.log(`  wrote:\n${outputs.map(([rel]) => `    ${rel}`).join('\n')}\n`);
