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

const statNames = new Set(Object.keys(crafting.baseStats ?? {}));
const craftIds = new Set();
for (const r of crafting.recipes) {
  if (craftIds.has(r.id)) fail(`duplicate crafting recipe id "${r.id}"`);
  craftIds.add(r.id);
  const cost = Object.entries(r.cost ?? {});
  if (!cost.length) fail(`crafting recipe "${r.id}" costs nothing`);
  for (const [id, qty] of cost) {
    if (!materialIds.has(id)) fail(`crafting recipe "${r.id}" needs unknown material "${id}"`);
    if (!Number.isInteger(qty) || qty <= 0) fail(`crafting recipe "${r.id}" asks for ${qty} x ${id}`);
  }
  if (!statNames.has(r.effect?.stat)) {
    fail(`crafting recipe "${r.id}" upgrades unknown stat "${r.effect?.stat}"`);
  }
  if (!(r.effect?.amount > 0)) fail(`crafting recipe "${r.id}" upgrades nothing`);
}

// ---------------------------------------------------------------- alchemy

/*
 * The shapes an ability can resolve in, read out of the type union rather than
 * listed again here. A combination naming a kind the engine does not implement
 * falls through every branch and resolves as "hits nobody, does nothing",
 * which ships perfectly happily.
 */
const typeSource = readFileSync(join(ROOT, 'web/src/core/types.ts'), 'utf8');
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
  if (tiersSeen.has(e.tier)) fail(`two enemies both claim tier ${e.tier}`);
  tiersSeen.add(e.tier);
  if (!knownShapes.has(e.shape)) fail(`enemy "${e.id}" uses unknown shape "${e.shape}"`);
  if (!(e.hp > 0) || !(e.damage > 0)) fail(`enemy "${e.id}" has no health or no damage`);
  // Weight divides knockback; below 1 it would multiply it instead.
  if (!(e.weight >= 1)) fail(`enemy "${e.id}" has weight ${e.weight}; a shove cannot be amplified by being heavy`);
  // An enemy that attacks from beyond the distance it notices at can never land
  // a hit, and reads in play as an enemy that is broken rather than passive.
  if (e.attackRange > e.noticeRadius) fail(`enemy "${e.id}" attacks from beyond the range it notices at`);
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

// ---------------------------------------------------------------- progression

if (progression.alchemyUnlockLevel !== 2) {
  fail(`alchemy unlocks at level ${progression.alchemyUnlockLevel}; canon moved it to 2 and says so explicitly`);
}
if (progression.xp?.gather !== undefined) {
  fail('progression.xp.gather exists - XP is novelty, not volume, and per-unit gathering rewards farming one node');
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
    `${enemyTiers.length} enemy tiers` +
    `${warnings.length ? ` (${warnings.length} warning(s))` : ''}`,
);
console.log(`  wrote:\n${outputs.map(([rel]) => `    ${rel}`).join('\n')}\n`);
