#!/usr/bin/env node
/**
 * Content build step for Project Maelstrom Mobile.
 *
 * Reads the hand-authored JSON in content/, validates the whole graph, derives
 * everything that can be derived, and emits one bundle consumed by BOTH runtimes:
 *
 *   content/generated/maelstrom-content.json   -> imported by the web game
 *   unity/Assets/Resources/maelstrom-content.json -> loaded by ContentDatabase.cs
 *
 * Deriving here (rather than in each runtime) is the whole point: the web build
 * and the Unity build cannot disagree about what a Void Blade is made of.
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
const gathered = read('content/materials.gathered.json').materials;
const crafted = read('content/materials.crafted.json').materials;
const alchemized = read('content/materials.alchemized.json').materials;
const transmutation = read('content/transmutation.json').recipes;
const alchemy = read('content/alchemy.json').recipes;
const zones = read('content/zones.json').zones;
const enemies = read('content/enemies.json').enemies;
const tutorial = read('content/tutorial.json').steps;
const progression = read('content/progression.json');

const elementIds = new Set(elements.map((e) => e.id));

// The alchemy table is laid out from this data, so a duplicate symbol or an
// overlapping cell would silently hide an element behind another one.
const seenSymbols = new Map();
const seenNumbers = new Map();
const seenCells = new Map();
for (const e of elements) {
  for (const field of ['symbol', 'number', 'group', 'row', 'col']) {
    if (e[field] === undefined) fail(`element "${e.id}" is missing "${field}"`);
  }
  // SAFETY RULE from the GDD, stated there as non-negotiable: the alchemy table
  // must never be mistakable for the periodic table, and must never read as a
  // lookup for combining real substances. Every real element symbol is one or
  // two letters, so requiring exactly three is what enforces it - the format
  // makes a collision impossible rather than relying on a blocklist anyone can
  // forget to update. This check exists because the table shipped with two
  // letter symbols including "Fe", which is iron.
  if (!/^[A-Z]{3}$/.test(String(e.symbol))) {
    fail(
      `element "${e.id}" has symbol "${e.symbol}" - symbols must be exactly three ` +
        'uppercase letters, so the table cannot be mistaken for the periodic table',
    );
  }
  if (seenSymbols.has(e.symbol)) fail(`elements "${seenSymbols.get(e.symbol)}" and "${e.id}" share the symbol "${e.symbol}"`);
  seenSymbols.set(e.symbol, e.id);

  if (seenNumbers.has(e.number)) fail(`elements "${seenNumbers.get(e.number)}" and "${e.id}" share number ${e.number}`);
  seenNumbers.set(e.number, e.id);

  const cell = `${e.row},${e.col}`;
  if (seenCells.has(cell)) fail(`elements "${seenCells.get(cell)}" and "${e.id}" both sit at row ${e.row} col ${e.col}`);
  seenCells.set(cell, e.id);
}

// ---------------------------------------------------------------- index materials

const materials = new Map();
const addMaterials = (list, source) => {
  for (const m of list) {
    if (materials.has(m.id)) fail(`duplicate material id "${m.id}"`);
    materials.set(m.id, { ...m, source, tags: m.tags ?? [] });
  }
};
addMaterials(gathered, 'gathered');
addMaterials(crafted, 'transmuted');
addMaterials(alchemized, 'alchemized');

const requireMaterial = (id, where) => {
  if (!materials.has(id)) fail(`${where} references unknown material "${id}"`);
  return materials.get(id);
};

// ---------------------------------------------------------------- validate references

for (const m of gathered) {
  const total = Object.entries(m.composition ?? {});
  if (total.length === 0) fail(`gathered material "${m.id}" has no elementComposition`);
  for (const [el, qty] of total) {
    if (!elementIds.has(el)) fail(`material "${m.id}" references unknown element "${el}"`);
    if (!Number.isInteger(qty) || qty <= 0) fail(`material "${m.id}" has bad quantity for "${el}": ${qty}`);
  }
}

const producedBy = new Map(); // materialId -> recipe that makes it

for (const r of transmutation) {
  requireMaterial(r.a, `transmutation "${r.id}".a`);
  requireMaterial(r.b, `transmutation "${r.id}".b`);
  requireMaterial(r.result, `transmutation "${r.id}".result`);
  if (producedBy.has(r.result)) fail(`material "${r.result}" is produced by two recipes (${producedBy.get(r.result).id}, ${r.id})`);
  producedBy.set(r.result, { kind: 'transmutation', ...r });
}

for (const r of alchemy) {
  requireMaterial(r.result, `alchemy "${r.id}".result`);
  for (const [el, qty] of Object.entries(r.requires)) {
    if (!elementIds.has(el)) fail(`alchemy "${r.id}" requires unknown element "${el}"`);
    if (!Number.isInteger(qty) || qty <= 0) fail(`alchemy "${r.id}" has bad quantity for "${el}": ${qty}`);
  }
  if (producedBy.has(r.result)) fail(`material "${r.result}" is produced by two recipes (${producedBy.get(r.result).id}, ${r.id})`);
  producedBy.set(r.result, { kind: 'alchemy', ...r });
}

// Every non-gathered material must actually be obtainable, or it is dead content.
for (const m of materials.values()) {
  if (m.source !== 'gathered' && !producedBy.has(m.id)) fail(`material "${m.id}" has no recipe that produces it`);
}

// A recipe pair must be unique regardless of order - FindRecipe returns the first match,
// so a duplicate pair would silently shadow the later recipe.
const seenPairs = new Map();
for (const r of transmutation) {
  const key = [r.a, r.b].sort().join('+');
  if (seenPairs.has(key)) fail(`transmutation pair ${key} is claimed by both "${seenPairs.get(key)}" and "${r.id}" - the second is unreachable`);
  seenPairs.set(key, r.id);
}

// ---------------------------------------------------------------- derive composition + tier

const YIELD = progression.decompositionYield ?? 1;
const composition = new Map();
const tier = new Map();
const resolving = new Set();

const applyYield = (sum) => {
  const out = {};
  for (const [el, qty] of Object.entries(sum)) {
    const scaled = Math.max(1, Math.round(qty * YIELD));
    if (scaled > 0) out[el] = scaled;
  }
  return out;
};

function resolve_(id) {
  if (composition.has(id)) return composition.get(id);
  if (resolving.has(id)) {
    fail(`recipe cycle detected at material "${id}" - it is (transitively) an ingredient of itself`);
    composition.set(id, {});
    tier.set(id, 0);
    return {};
  }
  resolving.add(id);

  const mat = materials.get(id);
  let comp;
  let t;

  if (!mat) {
    comp = {};
    t = 0;
  } else if (mat.source === 'gathered') {
    comp = { ...mat.composition };
    t = 0;
  } else {
    const recipe = producedBy.get(id);
    if (recipe.kind === 'alchemy') {
      comp = applyYield(recipe.requires);
      t = 1;
    } else {
      const sum = {};
      let maxTier = 0;
      for (const input of [recipe.a, recipe.b]) {
        const inputComp = resolve_(input);
        maxTier = Math.max(maxTier, tier.get(input) ?? 0);
        for (const [el, qty] of Object.entries(inputComp)) sum[el] = (sum[el] ?? 0) + qty;
      }
      comp = applyYield(sum);
      t = maxTier + 1;
    }
  }

  resolving.delete(id);
  composition.set(id, comp);
  tier.set(id, t);
  return comp;
}

for (const id of materials.keys()) resolve_(id);

// ---------------------------------------------------------------- enemies

const enemyIds = new Set();
for (const e of enemies) {
  if (enemyIds.has(e.id)) fail(`duplicate enemy id "${e.id}"`);
  enemyIds.add(e.id);

  if (!(e.hp > 0)) fail(`enemy "${e.id}" has non-positive hp`);
  if (!(e.damage > 0)) fail(`enemy "${e.id}" has non-positive damage`);
  if (!(e.attackRange > 0)) fail(`enemy "${e.id}" has non-positive attackRange`);
  // An enemy that can hit from beyond the distance it will approach to would be
  // unfightable: it attacks from outside its own chase behaviour.
  if (e.attackRange > e.aggroRadius) fail(`enemy "${e.id}" attacks from beyond its aggro radius`);

  for (const drop of e.drops ?? []) {
    requireMaterial(drop.material, `enemy "${e.id}" drop`);
    if (!(drop.chance > 0 && drop.chance <= 1)) fail(`enemy "${e.id}" drop "${drop.material}" has chance outside (0,1]`);
  }
}

// ---------------------------------------------------------------- tutorial

// Each step is completed by a rule in web/src/core/tutorial.ts keyed by id. If
// the two drift apart the guide silently stalls on a step nothing can finish,
// so read the rule names back out of the source and require an exact match.
const ruleSource = readFileSync(join(ROOT, 'web/src/core/tutorial.ts'), 'utf8');
const ruleBlock = ruleSource.match(/TUTORIAL_RULES[^{]*\{([\s\S]*?)\n\};/);
if (!ruleBlock) fail('could not find TUTORIAL_RULES in web/src/core/tutorial.ts');
const ruleIds = new Set([...ruleBlock[1].matchAll(/^\s*(\w+):/gm)].map((m) => m[1]));

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

// Weapons need a damage value or they are decoration; anything with a damage
// value that is not a weapon is a content mistake.
for (const m of crafted) {
  const isWeapon = (m.tags ?? []).includes('Weapon');
  if (isWeapon && m.damage === undefined && !(m.tags ?? []).includes('Consumable')) {
    warn(`weapon "${m.id}" has no damage value, so carrying it does nothing`);
  }
  if (m.damage !== undefined && !isWeapon) fail(`material "${m.id}" has damage but is not tagged Weapon`);
}

// ---------------------------------------------------------------- zone / gating sanity

const gatherableIds = new Set();
const firstZoneFor = new Map(); // materialId -> lowest zone level that spawns it

for (const z of zones) {
  if (!z.spawns?.length) fail(`zone "${z.id}" spawns nothing`);
  let weightTotal = 0;
  for (const s of z.spawns) {
    const m = requireMaterial(s.material, `zone "${z.id}"`);
    if (m && m.source !== 'gathered') fail(`zone "${z.id}" spawns "${s.material}", which is craft-only - only gathered materials can appear in the world`);
    if (!(s.weight > 0)) fail(`zone "${z.id}" spawn "${s.material}" has non-positive weight`);
    weightTotal += s.weight;
    gatherableIds.add(s.material);
    const prev = firstZoneFor.get(s.material);
    if (prev === undefined || z.requiredLevel < prev) firstZoneFor.set(s.material, z.requiredLevel);
  }
  if (weightTotal <= 0) fail(`zone "${z.id}" has zero total spawn weight`);

  for (const id of z.enemies ?? []) {
    if (!enemyIds.has(id)) fail(`zone "${z.id}" spawns unknown enemy "${id}"`);
  }
  if (z.enemies?.length && !(z.enemyCount > 0)) fail(`zone "${z.id}" lists enemies but spawns none`);
}

for (const m of gathered) {
  if (!gatherableIds.has(m.id)) warn(`gathered material "${m.id}" never spawns in any zone - it is unobtainable`);
}

// Earliest level at which a material can actually be held.
const availableAt = new Map();
function earliest(id) {
  if (availableAt.has(id)) return availableAt.get(id);
  availableAt.set(id, Infinity); // cycle guard; cycles are already reported above
  const mat = materials.get(id);
  let lvl;
  if (!mat) lvl = Infinity;
  else if (mat.source === 'gathered') lvl = firstZoneFor.get(id) ?? Infinity;
  else {
    const r = producedBy.get(id);
    lvl = r.kind === 'alchemy'
      ? Math.max(r.requiredLevel, progression.alchemyUnlockLevel)
      : Math.max(r.requiredLevel, earliest(r.a), earliest(r.b));
  }
  availableAt.set(id, lvl);
  return lvl;
}
for (const id of materials.keys()) earliest(id);

for (const r of transmutation) {
  const gate = Math.max(earliest(r.a), earliest(r.b));
  if (gate > r.requiredLevel) {
    warn(`transmutation "${r.id}" unlocks at level ${r.requiredLevel} but its inputs are not obtainable until level ${gate} - the recipe will look available before it is`);
  }
}

// Every element an alchemy recipe wants must be reachable by decomposing something.
const elementSources = new Map();
for (const id of materials.keys()) {
  for (const el of Object.keys(composition.get(id) ?? {})) {
    if (!elementSources.has(el)) elementSources.set(el, []);
    elementSources.get(el).push(id);
  }
}
for (const e of elements) {
  if (!elementSources.has(e.id)) warn(`element "${e.id}" is in no material's composition - it can never enter the pool`);
}
for (const r of alchemy) {
  for (const el of Object.keys(r.requires)) {
    if (!elementSources.has(el)) fail(`alchemy "${r.id}" requires "${el}", which no material decomposes into`);
  }
}

// ---------------------------------------------------------------- level curve

const { base, exponent } = progression.levelCurve;
const xpTable = [0];
let cumulative = 0;
for (let lvl = 1; lvl < progression.maxLevel; lvl++) {
  cumulative += Math.round((base * Math.pow(lvl, exponent)) / 5) * 5;
  xpTable.push(cumulative);
}

// ---------------------------------------------------------------- emit

if (errors.length) {
  console.error(`\n  content build FAILED - ${errors.length} error(s):\n`);
  for (const e of errors) console.error(`   x ${e}`);
  console.error('');
  process.exit(1);
}

const bundle = {
  generated: true,
  note: 'GENERATED FILE - do not edit. Source of truth is content/*.json; run npm run build:content.',
  version: 1,
  progression: { ...progression, xpTable },
  tutorial,
  elements,
  materials: [...materials.values()].map((m) => ({
    id: m.id,
    name: m.name,
    description: m.description,
    tags: m.tags,
    shape: m.shape,
    color: m.color,
    source: m.source,
    tier: tier.get(m.id),
    availableAtLevel: Number.isFinite(availableAt.get(m.id)) ? availableAt.get(m.id) : null,
    composition: composition.get(m.id),
    // Weapons only. Omitted entirely rather than defaulted, so "not a weapon"
    // and "a weapon that does nothing" stay distinguishable.
    ...(m.damage !== undefined ? { damage: m.damage } : {}),
  })),
  transmutation,
  alchemy,
  zones,
  enemies,
};

/**
 * Unity's JsonUtility cannot deserialize a dictionary-shaped object, so the
 * Unity copy of the bundle flattens every element map into an array of
 * {element, quantity} pairs - which is exactly the shape of ElementQuantity in
 * MaterialSO.cs. Same data, same build step, no second source of truth.
 */
const toPairs = (record) =>
  Object.entries(record ?? {}).map(([element, quantity]) => ({ element, quantity }));

const unityBundle = {
  ...bundle,
  note: bundle.note + ' Unity variant: element maps are flattened to {element,quantity} arrays for JsonUtility.',
  materials: bundle.materials.map((m) => ({
    ...m,
    // JsonUtility has no nullable int; unreachable reads as 0 rather than null.
    availableAtLevel: m.availableAtLevel ?? 0,
    composition: toPairs(m.composition),
  })),
  alchemy: bundle.alchemy.map(({ requires, ...rest }) => ({ ...rest, requiredElements: toPairs(requires) })),
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
  `\n  content OK - ${elements.length} elements, ${materials.size} materials, ` +
    `${transmutation.length} transmutations, ${alchemy.length} alchemy recipes, ` +
    `${zones.length} zones, ${enemies.length} enemies` +
    `${warnings.length ? ` (${warnings.length} warning(s))` : ''}`,
);
console.log(`  wrote:\n${outputs.map(([rel]) => `    ${rel}`).join('\n')}\n`);
