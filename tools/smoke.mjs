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
// The GDD's safety rule, checked where a player would actually see it.
const symbols = await page.locator('.sheet .pcell .psym').allTextContents();
check('every element symbol is three letters, so the table cannot read as the periodic table',
  symbols.length === 9 && symbols.every((t) => /^[A-Z]{3}$/.test(t.trim())), symbols.join(' '));
check('no symbol fits inside its cell only by overflowing', await page.evaluate(() => {
  const cells = [...document.querySelectorAll('.sheet .pcell .psym')];
  return cells.every((c) => c.scrollWidth <= c.parentElement.clientWidth + 1);
}));
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

// Icon lighting. Reading the pixels is the only way to tell the composite
// actually ran: if `filter` or `source-atop` quietly no-ops, the icons still
// draw and every other check still passes.
const lighting = await page.evaluate(() => {
  let measured = 0;
  let withShadow = 0;
  let litBrighter = 0;
  let ratio = 0;

  for (const canvas of document.querySelectorAll('.sheet .cell canvas')) {
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    const { width: w, height: h } = canvas;
    const data = ctx.getImageData(0, 0, w, h).data;

    // Where the solid art ends. Every shape has a different footprint, so the
    // shadow has to be looked for just outside each one rather than at a fixed
    // distance from the centre.
    let left = w, right = -1, top = h, bottom = -1, ink = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] < 220) continue;
        ink++;
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
    if (ink < 50) continue;

    const gap = 3; // clears the art's own antialiased edge
    let litSum = 0, litN = 0, shadeSum = 0, shadeN = 0, cast = 0, against = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const a = data[i + 3];
        if (a < 12) continue;
        if (x > right + gap || y > bottom + gap) { cast++; continue; }
        if (x < left - gap || y < top - gap) { against++; continue; }
        if (a < 200) continue;
        const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        if (x / w + y / h < 0.85) { litSum += luma; litN++; }
        else if (x / w + y / h > 1.15) { shadeSum += luma; shadeN++; }
      }
    }

    measured++;
    // Cast away from the light and only away from it - a symmetric glow would
    // mean the shadow pass is drawing without the offset.
    if (cast > 10 && cast > against * 3) withShadow++;
    if (litN > 20 && shadeN > 20) {
      const lift = (litSum / litN) / (shadeSum / shadeN);
      ratio = ratio === 0 ? lift : Math.min(ratio, lift);
      if (lift > 1.05) litBrighter++;
    }
  }
  return { measured, withShadow, litBrighter, ratio: Math.round(ratio * 100) / 100 };
});

check('the codex actually rendered icons to measure', lighting.measured >= 4, JSON.stringify(lighting));
check('item icons cast a shadow down and to the right of their own art',
  lighting.withShadow === lighting.measured, JSON.stringify(lighting));
check('item icons are lit from the upper left',
  lighting.litBrighter === lighting.measured, JSON.stringify(lighting));
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

// ------------------------------------------------- bench pair highlighting

const bench = await page.evaluate(() => {
  const game = window.maelstrom;
  const orb = game.orb ?? Object.values(game).find((v) => v && typeof v.tryTransmute === 'function');
  // Carry a spread, then put one material in the right orb so the left-hand
  // pick has something to react against.
  orb.unloadOrb('left');
  orb.unloadOrb('right');
  for (const m of ['stick', 'stone', 'fiber', 'flint']) orb.gather(m);
  orb.unloadOrb('left');
  orb.unloadOrb('right');
  orb.replaceOrb('right', 'stone');
  return { right: orb.orb('right') };
});
check('a partner material is set in the right orb', bench.right === 'stone', JSON.stringify(bench));

await page.locator('.nav button', { hasText: 'Bench' }).click();
await page.waitForTimeout(250);
// Target the left slot, so the right orb is the partner.
await page.locator('.sheet .bslot').first().click();
await page.waitForTimeout(200);

const marks = await page.evaluate(() => {
  const cells = [...document.querySelectorAll('.sheet .cell')];
  return {
    total: cells.length,
    reacts: cells.filter((c) => c.classList.contains('reacts')).length,
    inert: cells.filter((c) => c.classList.contains('inert')).length,
    soon: cells.filter((c) => c.classList.contains('soon')).length,
    note: document.querySelector('.sheet .note')?.textContent ?? '',
    weaponMarks: document.querySelectorAll('.sheet .cell .wep').length,
    damage: document.querySelector('.sheet .dmgline b')?.textContent ?? '',
  };
});

check('the bench splits the pack into reacting and inert', marks.reacts > 0 && marks.inert > 0,
  JSON.stringify(marks));
check('every cell lands in exactly one state',
  marks.reacts + marks.inert + marks.soon === marks.total, JSON.stringify(marks));
check('the note counts what reacts', /reacts? with/i.test(marks.note), marks.note);
check('the bench states current damage', /^\d+ damage$/.test(marks.damage), marks.damage);
check('the carried weapon is marked, since there is no equip slot',
  marks.weaponMarks === 1, `${marks.weaponMarks} marks`);

await page.screenshot({ path: join(SHOTS, '15-bench-highlight.png') });

// ---- reacting materials sort to the top, and the filter hides the rest
const order = await page.evaluate(() => {
  const cells = [...document.querySelectorAll('.sheet .cell')];
  const state = (c) =>
    c.classList.contains('reacts') ? 0 : c.classList.contains('soon') ? 1 : 2;
  const ranks = cells.map(state);
  return {
    ranks,
    sorted: ranks.every((r, i) => i === 0 || ranks[i - 1] <= r),
    hasChip: !!document.querySelector('.sheet .filterchip'),
    chip: document.querySelector('.sheet .filterchip')?.textContent ?? '',
  };
});
check('reacting materials sort above the rest', order.sorted, JSON.stringify(order.ranks));
check('a filter toggle is offered when something would be hidden', order.hasChip, order.chip);

await page.locator('.sheet .filterchip').click();
await page.waitForTimeout(220);
const filtered = await page.evaluate(() => {
  const cells = [...document.querySelectorAll('.sheet .cell')];
  return {
    total: cells.length,
    nonReacting: cells.filter(
      (c) => !c.classList.contains('reacts') && !c.classList.contains('here'),
    ).length,
    chipOn: document.querySelector('.sheet .filterchip')?.classList.contains('on') ?? false,
  };
});
check('the filter hides everything that cannot react', filtered.nonReacting === 0,
  JSON.stringify(filtered));
check('the filter leaves the reacting materials in place', filtered.total > 0,
  JSON.stringify(filtered));
check('the toggle reads as on', filtered.chipOn);
await page.screenshot({ path: join(SHOTS, '17-bench-filtered.png') });

// Turning it off restores the full pack.
await page.locator('.sheet .filterchip').click();
await page.waitForTimeout(220);
const restored = await page.evaluate(() => document.querySelectorAll('.sheet .cell').length);
check('turning the filter off restores the whole pack', restored > filtered.total,
  `${filtered.total} -> ${restored}`);


// Now the zero case. Carrying other things that react with stick would mask it,
// so reduce the pack to stick alone - stick + stick has no recipe.
await page.evaluate(() => {
  const game = window.maelstrom;
  const orb = game.orb ?? Object.values(game).find((v) => v && typeof v.tryTransmute === 'function');
  // Swap FIRST: replaceOrb returns the displaced material to the pack, so
  // clearing beforehand just lets stone back in and masks the case under test.
  orb.state.inventory.stick = (orb.state.inventory.stick ?? 0) + 1;
  orb.replaceOrb('right', 'stick');
  for (const id of Object.keys(orb.state.inventory)) delete orb.state.inventory[id];
  orb.state.inventory.stick = 1;
  orb.events.emit('inventoryChanged', undefined);
});
await page.waitForTimeout(250);
const allInert = await page.evaluate(() => {
  const cells = [...document.querySelectorAll('.sheet .cell')];
  return {
    reacts: cells.filter((c) => c.classList.contains('reacts')).length,
    note: document.querySelector('.sheet .note')?.textContent ?? '',
  };
});
check('a partner nothing reacts with says so rather than lighting nothing up',
  allInert.reacts === 0 && /nothing you are carrying reacts/i.test(allInert.note),
  JSON.stringify(allInert));

await page.screenshot({ path: join(SHOTS, '16-bench-no-reaction.png') });
await page.locator('.sheet .close').click();
await page.waitForTimeout(200);

// ------------------------------------------------- real multi-touch (regression)
//
// This section drives CDP touch events rather than element.click(). That matters:
// a programmatic click always succeeds, so the earlier checks in this file could
// never have caught the bug they were supposed to cover. A browser does NOT
// synthesise a click for a touch that belongs to a multi-touch sequence, so with
// a thumb on the stick the click-bound action button did nothing at all - which
// is what "can't pick anything up while moving" actually was.

const cdp = await context.newCDPSession(page);
const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });

const pressAndHoldStick = async (x, y) => {
  await touch('touchStart', [{ x, y, id: 1 }]);
  await page.waitForTimeout(40);
  await touch('touchMove', [{ x: x + 40, y, id: 1 }]);
  await page.waitForTimeout(160);
};

const placeNodeAtPlayer = () => page.evaluate(() => {
  const game = window.maelstrom;
  const world = game.world ?? Object.values(game).find((v) => v && v.player && v.nodes);
  const orb = game.orb ?? Object.values(game).find((v) => v && typeof v.tryTransmute === 'function');
  orb.unloadOrb('left');
  orb.unloadOrb('right');
  // Move the enemies out of reach rather than deleting them - the attack check
  // below needs one to still exist.
  for (const e of world.enemies) { e.x = world.player.x + 5000; e.y = world.player.y + 5000; }
  for (const n of world.nodes) { n.x = world.player.x + 5000; n.y = world.player.y + 5000; }
  const node = world.nodes[0];
  node.available = true;
  node.material = 'stick';
  node.x = world.player.x + 10;
  node.y = world.player.y;
});

await placeNodeAtPlayer();
await page.waitForTimeout(220);

const btnBox = await page.locator('.action').boundingBox();
const bx = btnBox.x + btnBox.width / 2;
const by = btnBox.y + btnBox.height / 2;
const vp = page.viewportSize();

const startedAt = await page.evaluate(() => {
  const game = window.maelstrom;
  const world = game.world ?? Object.values(game).find((v) => v && v.player && v.nodes);
  return { x: world.player.x, y: world.player.y };
});

await pressAndHoldStick(vp.width * 0.25, vp.height * 0.55);
// Second thumb lands on the action button while the first still holds the stick.
await touch('touchStart', [
  { x: vp.width * 0.25 + 40, y: vp.height * 0.55, id: 1 },
  { x: bx, y: by, id: 2 },
]);
await page.waitForTimeout(70);
await touch('touchEnd', [{ x: vp.width * 0.25 + 40, y: vp.height * 0.55, id: 1 }]);
await page.waitForTimeout(140);
await touch('touchEnd', []);
await page.waitForTimeout(200);

const twoThumb = await page.evaluate((from) => {
  const game = window.maelstrom;
  const world = game.world ?? Object.values(game).find((v) => v && v.player && v.nodes);
  const orb = game.orb ?? Object.values(game).find((v) => v && typeof v.tryTransmute === 'function');
  return {
    moved: Math.hypot(world.player.x - from.x, world.player.y - from.y),
    carried: orb.orb('left') ?? orb.orb('right'),
  };
}, startedAt);

check('a real two-thumb touch both walks and gathers',
  twoThumb.moved > 5 && twoThumb.carried === 'stick', JSON.stringify(twoThumb));

// The same button must swing while moving, not just gather.
const twoThumbFight = await page.evaluate(() => {
  const game = window.maelstrom;
  const world = game.world ?? Object.values(game).find((v) => v && v.player && v.nodes);
  for (const n of world.nodes) { n.x = world.player.x + 5000; n.y = world.player.y + 5000; }
  const enemy = world.enemies[0] ?? null;
  if (!enemy) return null;
  enemy.dead = false;
  enemy.hp = enemy.def.hp;
  enemy.x = world.player.x + 26;
  enemy.y = world.player.y;
  return { hp: enemy.hp };
});

check('the zone still has an enemy to test the swing against', twoThumbFight !== null,
  twoThumbFight === null ? 'no enemies in zone' : `hp ${twoThumbFight.hp}`);

if (twoThumbFight) {
  await page.waitForTimeout(200);
  await pressAndHoldStick(vp.width * 0.25, vp.height * 0.55);
  await touch('touchStart', [
    { x: vp.width * 0.25 + 40, y: vp.height * 0.55, id: 1 },
    { x: bx, y: by, id: 2 },
  ]);
  await page.waitForTimeout(70);
  await touch('touchEnd', [{ x: vp.width * 0.25 + 40, y: vp.height * 0.55, id: 1 }]);
  await touch('touchEnd', []);
  await page.waitForTimeout(200);

  const hpNow = await page.evaluate(() => {
    const game = window.maelstrom;
    const world = game.world ?? Object.values(game).find((v) => v && v.player && v.nodes);
    return world.enemies[0]?.hp ?? null;
  });
  check('a real two-thumb touch also swings while moving', hpNow < twoThumbFight.hp,
    `${twoThumbFight.hp} -> ${hpNow}`);
}

// The transparent layers above the playfield must not swallow a touch meant for
// the stick. Press where .action-wrap spans, on the stick side of the screen.
const wrapBox = await page.locator('.action-wrap').boundingBox();
const beforeBand = await page.evaluate(() => {
  const game = window.maelstrom;
  const world = game.world ?? Object.values(game).find((v) => v && v.player && v.nodes);
  return { x: world.player.x, y: world.player.y };
});
await touch('touchStart', [{ x: vp.width * 0.18, y: wrapBox.y + wrapBox.height / 2, id: 1 }]);
await page.waitForTimeout(40);
await touch('touchMove', [{ x: vp.width * 0.18 + 45, y: wrapBox.y + wrapBox.height / 2, id: 1 }]);
await page.waitForTimeout(220);
await touch('touchEnd', []);
const bandMoved = await page.evaluate((from) => {
  const game = window.maelstrom;
  const world = game.world ?? Object.values(game).find((v) => v && v.player && v.nodes);
  return Math.hypot(world.player.x - from.x, world.player.y - from.y);
}, beforeBand);
check('the transparent HUD layers do not swallow a stick touch', bandMoved > 5,
  `${bandMoved.toFixed(1)}px`);

await page.screenshot({ path: join(SHOTS, '14-multitouch.png') });

check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
server.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\n  ${checks.length - failed.length}/${checks.length} checks passed`);
console.log(`  screenshots in .verify/\n`);
process.exit(failed.length === 0 ? 0 : 1);
