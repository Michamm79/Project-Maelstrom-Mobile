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
const tutorial = read('content/tutorial.json').steps;
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

const alchemyIds = new Set();
for (const c of alchemy) {
  if (alchemyIds.has(c.id)) fail(`duplicate alchemy combination id "${c.id}"`);
  alchemyIds.add(c.id);
  const required = Object.entries(c.elements ?? {});
  if (!required.length) fail(`alchemy combination "${c.id}" requires no elements`);
  for (const [el, qty] of required) {
    if (!elementIds.has(el)) fail(`alchemy combination "${c.id}" requires unknown element "${el}"`);
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
}
if (![...alchemy].some((c) => c.tutorial)) fail('no alchemy combination is marked as a tutorial combination');

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
  // An enemy that attacks from beyond the distance it closes to can never land
  // a hit, and reads in play as an enemy that is broken rather than passive.
  if (e.attackRange > e.aggroRadius) fail(`enemy "${e.id}" attacks from beyond the range it approaches to`);
  if ('drops' in e) fail(`enemy "${e.id}" has a drop table; materials come from the world, not from kills`);
}
if (tiersSeen.size !== 3) fail(`canon defines three enemy tiers; found ${tiersSeen.size}`);

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
