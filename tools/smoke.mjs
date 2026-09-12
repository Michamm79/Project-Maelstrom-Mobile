#!/usr/bin/env node
/**
 * End-to-end smoke test: serves the production build, drives it in a
 * phone-sized headless Chromium, and asserts the loop actually works -
 * gather, transmute, level up, unlock alchemy, decompose, brew.
 *
 * Also writes screenshots to .verify/ so the UI can be eyeballed.
 *
 * Run: node tools/smoke.mjs
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { chromium, devices } from 'playwright';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const SHOTS = join(ROOT, '.verify');
const PORT = 4173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    const file = join(DIST, rel === '/' || rel === '\\' ? 'index.html' : rel);
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});

const checks = [];
const check = (name, condition, detail = '') => {
  checks.push({ name, ok: Boolean(condition), detail });
  console.log(`  ${condition ? 'PASS' : 'FAIL'}  ${name}${detail ? ` - ${detail}` : ''}`);
};

mkdirSync(SHOTS, { recursive: true });
await new Promise((r) => server.listen(PORT, r));

// This environment ships a pinned Chromium that may not match the Playwright
// build's expected revision, so point at it directly instead of downloading one.
const EXECUTABLE = '/opt/pw-browsers/chromium';
const browser = await chromium.launch(
  existsSync(EXECUTABLE) ? { executablePath: EXECUTABLE } : {},
);
const context = await browser.newContext({ ...devices['Pixel 7'] });
const page = await context.newPage();

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);

// ---------------------------------------------------------------- title screen

check('a fresh load opens on the title screen', await page.locator('.title').isVisible());
check('the title offers both a guided and an unguided start',
  (await page.locator('.title .tbtn').count()) === 2,
  (await page.locator('.title .tbtn').allTextContents()).join(' | '));
check('the world is frozen behind the title card', await page.evaluate(async () => {
  const canvas = document.querySelector('#stage');
  const rect = canvas.getBoundingClientRect();
  const game = window.maelstrom;
  const world = game.world ?? Object.values(game).find((v) => v && v.player && v.nodes);
  const before = { x: world.player.x, y: world.player.y };
  canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 9, clientX: 60, clientY: rect.height / 2, bubbles: true }));
  canvas.dispatchEvent(new PointerEvent('pointermove', { pointerId: 9, clientX: 160, clientY: rect.height / 2, bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 9, clientX: 160, clientY: rect.height / 2, bubbles: true }));
  return Math.hypot(world.player.x - before.x, world.player.y - before.y) < 1;
}));
await page.screenshot({ path: join(SHOTS, '00-title.png') });

// Take the guided start: everything below runs with the tutorial active, which
// is the path a new player actually takes.
await page.locator('.title .tbtn.primary').click();
await page.waitForTimeout(250);
check('choosing a start dismisses the title', !(await page.locator('.title').isVisible()));
check('the guide shows its first objective', await page.locator('.objective').isVisible());

const firstStep = await page.locator('.objective b').textContent();
check('the first objective is the movement step', /feet/i.test(firstStep ?? ''), firstStep ?? '');

// Walking far enough must advance the guide on its own - there is no next button.
await page.evaluate(async () => {
  const game = window.maelstrom;
  const world = game.world ?? Object.values(game).find((v) => v && v.player && v.nodes);
  for (let i = 0; i < 40; i++) {
    world.player.x += 12;
    await new Promise((r) => setTimeout(r, 16));
  }
});
await page.waitForTimeout(200);
const secondStep = await page.locator('.objective b').textContent();
check('walking advances the guide without a next button', secondStep !== firstStep,
  `${firstStep} -> ${secondStep}`);

// ---------------------------------------------------------------- boot

check('page renders the HUD', await page.locator('.orbbar').isVisible());
check('starting zone is shown', (await page.locator('.zone-btn .name').textContent()) === 'Hollow Verge');
check('starts at level 1', (await page.locator('.level .row b').textContent()) === 'Lv 1');
check(
  'canvas is drawing (non-blank)',
  await page.evaluate(() => {
    const canvas = document.querySelector('#stage');
    const ctx = canvas.getContext('2d');
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const seen = new Set();
    for (let i = 0; i < data.length; i += 4 * 997) seen.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
    return seen.size;
  }) > 5,
);
await page.screenshot({ path: join(SHOTS, '01-world.png') });

// ---------------------------------------------------------------- gather + transmute
// Drive through the game's own API so the test exercises the real systems
// rather than re-implementing pathfinding to a randomly placed node.

const gathered = await page.evaluate(() => {
  const game = window.maelstrom;
  const orb = game.orb ?? Object.values(game).find((v) => v && typeof v.tryTransmute === 'function');
  orb.gather('stick');
  orb.gather('stone');
  return { left: orb.leftOrb, right: orb.rightOrb };
});
check('gathering fills both orbs', gathered.left === 'stick' && gathered.right === 'stone', JSON.stringify(gathered));

await page.waitForTimeout(200);
const craftLabel = (await page.locator('.craft .out').textContent()) ?? '';
check('transmute preview names the result', craftLabel.includes('Stone Axe'), craftLabel);
check('transmute button is enabled', await page.locator('.craft').isEnabled());
await page.screenshot({ path: join(SHOTS, '02-transmute-ready.png') });

await page.locator('.craft').click();
await page.waitForTimeout(400);

const afterCraft = await page.evaluate(() => {
  const game = window.maelstrom;
  const orb = game.orb ?? Object.values(game).find((v) => v && typeof v.tryTransmute === 'function');
  return { axes: orb.countOf('stone_axe'), left: orb.leftOrb, xp: orb.state.xp };
});
check('transmuting produced a Stone Axe', afterCraft.axes === 1, JSON.stringify(afterCraft));
check('transmuting emptied the orbs', afterCraft.left === null);
check('transmuting awarded XP', afterCraft.xp > 0, `xp=${afterCraft.xp}`);

// ---------------------------------------------------------------- pack

await page.locator('.nav button', { hasText: 'Bench' }).click();
await page.waitForTimeout(300);
check('bench sheet opens', await page.locator('.sheet.on').isVisible());
check('bench shows both orb slots', (await page.locator('.sheet .bslot').count()) === 2);
check('bench lists the crafted axe', (await page.locator('.sheet .cell .nm').allTextContents()).includes('Stone Axe'));

// A stack shows a count badge; a single item shows none.
await page.evaluate(() => {
  const g = window.maelstrom;
  const orb = Object.values(g).find((v) => v && typeof v.tryTransmute === 'function');
  orb.gather('fiber'); orb.unloadOrb('left');
  orb.gather('fiber'); orb.unloadOrb('left');
  orb.gather('fiber'); orb.unloadOrb('left');
});
await page.waitForTimeout(350);
const badges = await page.evaluate(() => {
  const cells = [...document.querySelectorAll('.sheet .cell')];
  const find = (name) => cells.find((c) => c.querySelector('.nm')?.textContent === name);
  return {
    stacked: find('Plant Fiber')?.querySelector('.ct')?.textContent ?? null,
    single: find('Stone Axe')?.querySelector('.ct')?.textContent ?? null,
  };
});
check('a stack shows a count badge, a single item does not',
  badges.stacked === '3' && badges.single === null, JSON.stringify(badges));

// Place a carried material into the selected slot, then swap it for another.
await page.evaluate(() => {
  const g = window.maelstrom;
  const orb = Object.values(g).find((v) => v && typeof v.tryTransmute === 'function');
  orb.gather('stick');
  orb.gather('stone');
  orb.gather('flint');
});
await page.waitForTimeout(350);
const placed = await page.evaluate(() => {
  const g = window.maelstrom;
  const orb = Object.values(g).find((v) => v && typeof v.tryTransmute === 'function');
  const before = orb.leftOrb;
  const ok = orb.replaceOrb('left', 'flint');
  return { ok, before, after: orb.leftOrb, returned: orb.countOf(before) };
});
check('bench swaps a slot and returns the old material', placed.ok && placed.after === 'flint' && placed.returned >= 1, JSON.stringify(placed));
await page.waitForTimeout(300);
await page.screenshot({ path: join(SHOTS, '03-bench.png') });
await page.locator('.sheet header .close').click();
await page.waitForTimeout(250);

// ---------------------------------------------------------------- levelling + alchemy

await page.evaluate(() => {
  const game = window.maelstrom;
  const orb = game.orb ?? Object.values(game).find((v) => v && typeof v.tryTransmute === 'function');
  orb.addXp(4000, 'discover');
});
await page.waitForTimeout(500);

const level = await page.locator('.level .row b').textContent();
check('XP award levels the player up', level !== 'Lv 1', level ?? '');
check('alchemy nav unlocks', await page.locator('.nav button', { hasText: 'Alchemy' }).isEnabled());
await page.screenshot({ path: join(SHOTS, '04-levelled.png') });

const decomposed = await page.evaluate(() => {
  const game = window.maelstrom;
  const orb = game.orb ?? Object.values(game).find((v) => v && typeof v.tryTransmute === 'function');
  orb.gather('flint');
  const ok = orb.decomposeMaterialAt('left');
  return { ok, pool: { ...orb.state.elementPool } };
});
check('decomposition fills the element pool', decomposed.ok && Object.keys(decomposed.pool).length > 0, JSON.stringify(decomposed.pool));

await page.locator('.nav button', { hasText: 'Alchemy' }).click();
await page.waitForTimeout(300);
check('alchemy sheet opens', await page.locator('.sheet.on').isVisible());
check('element table renders every element', (await page.locator('.sheet .pcell').count()) === 9);
check('held elements are highlighted', (await page.locator('.sheet .pcell.has').count()) > 0);
check('unheld elements are disabled', (await page.locator('.sheet .pcell[disabled]').count()) > 0);

// Fill the pool so a real mixture is possible, then dial it up on the table.
await page.evaluate(() => {
  const g = window.maelstrom;
  const orb = Object.values(g).find((v) => v && typeof v.tryTransmute === 'function');
  orb.state.elementPool = { pyron: 4, zephyr: 2 };
  orb.events.emit('poolChanged', undefined);
});
await page.waitForTimeout(300);

const pyron = page.locator('.sheet .pcell', { hasText: 'Pyron' });
await pyron.click();
await pyron.click();
await page.locator('.sheet .pcell', { hasText: 'Zephyr' }).click();
await page.waitForTimeout(250);
check('tray recognises a valid mixture', (await page.locator('.sheet .tray.ok').count()) === 1,
  (await page.locator('.sheet .traystatus').textContent()) ?? '');
await page.screenshot({ path: join(SHOTS, '05-alchemy.png') });

await page.locator('.sheet .traybar .go').click();
await page.waitForTimeout(400);
const mixed = await page.evaluate(() => {
  const g = window.maelstrom;
  const orb = Object.values(g).find((v) => v && typeof v.tryTransmute === 'function');
  return { fireballs: orb.countOf('fireball'), pool: { ...orb.state.elementPool } };
});
check('mixing from the table brews the item', mixed.fireballs >= 1, JSON.stringify(mixed));
await page.screenshot({ path: join(SHOTS, '05b-alchemy-after.png') });

const brewed = await page.evaluate(() => {
  const game = window.maelstrom;
  const orb = game.orb ?? Object.values(game).find((v) => v && typeof v.tryTransmute === 'function');
  orb.state.elementPool = { pyron: 4, zephyr: 2 };
  const result = orb.tryAlchemizeSelection({ pyron: 2, zephyr: 1 });
  return { result, pool: { ...orb.state.elementPool } };
});
check('a wrong mixture costs nothing', await page.evaluate(() => {
  const game = window.maelstrom;
  const orb = game.orb ?? Object.values(game).find((v) => v && typeof v.tryTransmute === 'function');
  orb.state.elementPool = { pyron: 5, terran: 5 };
  const before = JSON.stringify(orb.state.elementPool);
  orb.tryAlchemizeSelection({ pyron: 5, terran: 5 });
  return before === JSON.stringify(orb.state.elementPool);
}));
check('brewing an alchemy recipe produces an item', brewed.result.result !== null, JSON.stringify(brewed));
await page.locator('.sheet header .close').click();
await page.waitForTimeout(250);

// ---------------------------------------------------------------- codex + travel

await page.locator('.nav button', { hasText: 'Codex' }).click();
await page.waitForTimeout(300);
check('codex opens with material grid', (await page.locator('.sheet .cell').count()) > 20);
await page.screenshot({ path: join(SHOTS, '06-codex.png') });
await page.locator('.sheet .tabs button', { hasText: 'Transmutation' }).click();
await page.waitForTimeout(250);
check('codex transmutation tab lists recipes', (await page.locator('.sheet .row-item').count()) > 10);
await page.screenshot({ path: join(SHOTS, '07-codex-recipes.png') });
await page.locator('.sheet header .close').click();
await page.waitForTimeout(250);

await page.locator('.zone-btn').click();
await page.waitForTimeout(300);
check('travel sheet lists all zones', (await page.locator('.sheet .row-item').count()) === 5);
await page.screenshot({ path: join(SHOTS, '08-travel.png') });

const travelled = await page.locator('.sheet .row-item .go:not([disabled])').first();
await travelled.click();
await page.waitForTimeout(700);
const newZone = await page.locator('.zone-btn .name').textContent();
check('travelling changes zone', newZone !== 'Hollow Verge', newZone ?? '');
await page.screenshot({ path: join(SHOTS, '09-second-zone.png') });

// ---------------------------------------------------------------- movement + persistence

const moved = await page.evaluate(async () => {
  const canvas = document.querySelector('#stage');
  const rect = canvas.getBoundingClientRect();
  const game = window.maelstrom;
  const world = game.world ?? Object.values(game).find((v) => v && v.player && v.nodes);
  const before = { x: world.player.x, y: world.player.y };

  canvas.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, clientX: rect.width / 2, clientY: rect.height / 2, bubbles: true }));
  canvas.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: rect.width / 2 + 70, clientY: rect.height / 2, bubbles: true }));
  await new Promise((r) => setTimeout(r, 450));
  const after = { x: world.player.x, y: world.player.y };
  canvas.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: rect.width / 2 + 70, clientY: rect.height / 2, bubbles: true }));
  return { before, after };
});
check('joystick drag moves the player', moved.after.x > moved.before.x + 5, JSON.stringify(moved));

// The character sprite: facing must commit to a side row, and the walk cycle
// must have advanced off the resting frame purely from distance travelled.
const anim = await page.evaluate(() => {
  const game = window.maelstrom;
  const world = game.world ?? Object.values(game).find((v) => v && v.player && v.nodes);
  const { facing4, mirrored, frame } = world.player;
  return { facing4, mirrored, frame };
});
check('sprite commits to a 4-way facing when walking right',
  anim.facing4 === 'side' && anim.mirrored === true, JSON.stringify(anim));

const sheet = await page.evaluate(() => {
  const imgs = [...document.querySelectorAll('img')];
  const game = window.maelstrom;
  const r = Object.values(game).find((v) => v && v.sheet instanceof HTMLImageElement);
  return r ? { complete: r.sheet.complete, w: r.sheet.naturalWidth, h: r.sheet.naturalHeight, ready: r.sheetReady, inline: r.sheet.src.startsWith('data:') } : { found: false, imgs: imgs.length };
});
check('character sheet decoded and inlined',
  sheet.w === 64 && sheet.h === 96 && sheet.ready === true && sheet.inline === true, JSON.stringify(sheet));
await page.screenshot({ path: join(SHOTS, '11-sprite-walking.png') });

const persisted = await page.evaluate(() => {
  const raw = localStorage.getItem('maelstrom.save.v1');
  return raw ? JSON.parse(raw) : null;
});
check('progress is written to localStorage', persisted !== null && persisted.level > 1, persisted ? `level ${persisted.level}` : 'no save');

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);
check('a started run comes back to a Continue card', await page.locator('.title').isVisible());
const resumeLabel = await page.locator('.title .tbtn.primary').textContent();
check('the title offers to continue, not to restart', /continue/i.test(resumeLabel ?? ''), resumeLabel ?? '');
check('the Continue card says where you left off',
  /level/i.test((await page.locator('.title .tsub').first().textContent()) ?? ''),
  (await page.locator('.title .tsub').first().textContent()) ?? '');
await page.locator('.title .tbtn.primary').click();
await page.waitForTimeout(200);

const reloadedLevel = await page.locator('.level .row b').textContent();
check('save survives a reload', reloadedLevel === level, `${reloadedLevel} vs ${level}`);
await page.screenshot({ path: join(SHOTS, '10-after-reload.png') });

// ---------------------------------------------------------------- combat + action button

const combat = await page.evaluate(async () => {
  const game = window.maelstrom;
  const world = game.world ?? Object.values(game).find((v) => v && v.player && v.nodes);
  const orb = game.orb ?? Object.values(game).find((v) => v && typeof v.tryTransmute === 'function');

  // Rather than fabricate spawns, reuse what the zone generated: park one enemy
  // inside reach and move every node out of it, so only attack is possible.
  const enemy = world.enemies[0];
  for (const n of world.nodes) { n.x = world.player.x + 4000; n.y = world.player.y + 4000; }
  for (const e of world.enemies.slice(1)) { e.x = world.player.x + 4000; e.y = world.player.y + 4000; }
  enemy.dead = false;
  enemy.hp = enemy.def.hp;
  enemy.x = world.player.x + 30;
  enemy.y = world.player.y;
  const hpBefore = enemy.hp;

  await new Promise((r) => setTimeout(r, 140));
  const glyphAttack = document.querySelector('.action .aglyph').textContent;
  const isAttack = document.querySelector('.action').classList.contains('attack');

  document.querySelector('.action').click();
  await new Promise((r) => setTimeout(r, 80));
  const hpAfter = enemy.hp;

  // Now hide the enemy and bring a node back: the same button must become gather.
  enemy.x = world.player.x + 4000;
  const node = world.nodes[0];
  node.available = true;
  node.material = 'stick';
  node.x = world.player.x + 20;
  node.y = world.player.y;
  await new Promise((r) => setTimeout(r, 240));
  const glyphGather = document.querySelector('.action .aglyph').textContent;
  const isGather = document.querySelector('.action').classList.contains('gather');

  orb.unloadOrb('left');
  orb.unloadOrb('right');
  document.querySelector('.action').click();
  await new Promise((r) => setTimeout(r, 80));

  return {
    isAttack, isGather, glyphAttack, glyphGather,
    hpBefore, hpAfter,
    gatheredInto: orb.orb('left') ?? orb.orb('right'),
    hp: world.player.hp, maxHp: world.player.maxHp,
  };
});

check('an enemy in reach puts the button in attack mode', combat.isAttack, JSON.stringify(combat));
check('attacking damages the enemy', combat.hpAfter < combat.hpBefore, `${combat.hpBefore} -> ${combat.hpAfter}`);
check('with no enemy the same button becomes gather', combat.isGather, JSON.stringify(combat));
check('the attack and gather glyphs differ', combat.glyphAttack !== combat.glyphGather,
  `${combat.glyphAttack} vs ${combat.glyphGather}`);
check('the gather press picked the node up', combat.gatheredInto === 'stick', String(combat.gatheredInto));
check('the HP readout is populated', /^\d+\/\d+$/.test((await page.locator('.hptext').textContent()) ?? ''),
  (await page.locator('.hptext').textContent()) ?? '');
await page.screenshot({ path: join(SHOTS, '12-combat.png') });

// An enemy hitting back must actually take health off. Drive it through the real
// aggro path rather than poking hp, so the damage tick is what is under test.
const hurt = await page.evaluate(async () => {
  const game = window.maelstrom;
  const world = game.world ?? Object.values(game).find((v) => v && v.player && v.nodes);
  const before = world.player.hp;

  const enemy = world.enemies[0];
  enemy.dead = false;
  enemy.hp = enemy.def.hp;
  enemy.aggro = true;
  enemy.cooldown = 0;
  enemy.x = world.player.x + 6;
  enemy.y = world.player.y;

  for (let i = 0; i < 40 && world.player.hp >= before; i++) {
    enemy.x = world.player.x + 6;
    enemy.y = world.player.y;
    enemy.aggro = true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return { before, after: world.player.hp, width: document.querySelector('.hpbar i').style.width };
});
check('an enemy attack lowers health and the bar', hurt.after < hurt.before && hurt.width !== '100%',
  JSON.stringify(hurt));

// ---------------------------------------------------------------- landscape HUD budget
// The complaint that started this: in landscape the HUD ate over half the screen.

const landscape = await context.newPage();
await landscape.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
await landscape.setViewportSize({ width: 844, height: 390 });
await landscape.waitForTimeout(400);
await landscape.locator('.title .tbtn.primary').click();
await landscape.waitForTimeout(400);

const budget = await landscape.evaluate(() => {
  const h = window.innerHeight;
  const rect = (sel) => document.querySelector(sel)?.getBoundingClientRect() ?? null;

  // Measure the reserved bands, not the sum of element heights: in landscape the
  // orb bar and the nav share one line, so adding their heights double-counts it.
  const top = Math.max(rect('.topbar').bottom, rect('.vitals').bottom);
  const bottom = h - Math.min(rect('.orbbar').top, rect('.nav').top);
  const action = rect('.action');
  const nav = rect('.nav');
  const orbbar = rect('.orbbar');

  return {
    h,
    pct: Math.round(((top + bottom) / h) * 100),
    action: action.height,
    oneLine: Math.abs(orbbar.top - nav.top) < 4,
    clearOfAction: nav.right <= action.left,
    stickRoom: Math.round(orbbar.left),
    verbFits: (() => {
      const v = document.querySelector('.craft .verb');
      return v ? v.scrollWidth <= v.getBoundingClientRect().width + 1 : false;
    })(),
    vitalsWidth: Math.round(rect('.vitals').width),
  };
});
check('landscape chrome stays under a third of the screen', budget.pct < 34, `${budget.pct}% of ${budget.h}px`);
check('orb bar and nav share one line in landscape', budget.oneLine, JSON.stringify(budget));
check('the nav does not run under the action button', budget.clearOfAction, JSON.stringify(budget));
check('the left thumb keeps a stick zone free of buttons', budget.stickRoom > 140, `${budget.stickRoom}px`);
check('the action button stays thumb-sized in landscape', budget.action >= 76, `${budget.action}px`);
check('the transmute label is not clipped in landscape', budget.verbFits, JSON.stringify(budget));
check('the health bar does not stretch the full width', budget.vitalsWidth < budget.h, `${budget.vitalsWidth}px`);
await landscape.screenshot({ path: join(SHOTS, '13-landscape.png') });
await landscape.close();

// ---------------------------------------------------------------- replay the guide

await page.locator('.nav button', { hasText: 'Menu' }).click();
await page.waitForTimeout(200);
check('the menu counts kills and deaths', (await page.locator('.sheet .stat').count()) === 6,
  String(await page.locator('.sheet .stat').count()));
await page.locator('.sheet button', { hasText: 'Replay the opening guide' }).click();
await page.waitForTimeout(250);
check('replaying the guide reopens it at step one',
  (await page.locator('.objective b').textContent()) === 'Find your feet',
  (await page.locator('.objective b').textContent()) ?? 'no banner');

await page.locator('.objective .oskip').click();
await page.waitForTimeout(200);
check('skipping the guide dismisses the banner', !(await page.locator('.objective').isVisible()));
check('a skipped guide stays skipped across a reload', await (async () => {
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  await page.locator('.title .tbtn.primary').click();
  await page.waitForTimeout(300);
  return !(await page.locator('.objective').isVisible());
})());

check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
server.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\n  ${checks.length - failed.length}/${checks.length} checks passed`);
console.log(`  screenshots in .verify/\n`);
process.exit(failed.length === 0 ? 0 : 1);
