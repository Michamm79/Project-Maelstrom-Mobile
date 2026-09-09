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

await page.locator('.nav button', { hasText: 'Pack' }).click();
await page.waitForTimeout(300);
check('pack sheet opens', await page.locator('.sheet.on').isVisible());
check('pack lists the crafted axe', (await page.locator('.sheet .cell .nm').allTextContents()).includes('Stone Axe'));
await page.screenshot({ path: join(SHOTS, '03-pack.png') });
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
check('alchemy lists recipes', (await page.locator('.sheet .row-item').count()) > 0);
await page.screenshot({ path: join(SHOTS, '05-alchemy.png') });

const brewed = await page.evaluate(() => {
  const game = window.maelstrom;
  const orb = game.orb ?? Object.values(game).find((v) => v && typeof v.tryTransmute === 'function');
  orb.state.elementPool = { pyron: 4, zephyr: 2 };
  const recipe = orb.getAvailableAlchemyRecipes()[0];
  const result = recipe ? orb.tryAlchemize(recipe) : null;
  return { result, pool: { ...orb.state.elementPool } };
});
check('brewing an alchemy recipe produces an item', brewed.result !== null, JSON.stringify(brewed));
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

const persisted = await page.evaluate(() => {
  const raw = localStorage.getItem('maelstrom.save.v1');
  return raw ? JSON.parse(raw) : null;
});
check('progress is written to localStorage', persisted !== null && persisted.level > 1, persisted ? `level ${persisted.level}` : 'no save');

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(600);
const reloadedLevel = await page.locator('.level .row b').textContent();
check('save survives a reload', reloadedLevel === level, `${reloadedLevel} vs ${level}`);
await page.screenshot({ path: join(SHOTS, '10-after-reload.png') });

check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
server.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\n  ${checks.length - failed.length}/${checks.length} checks passed`);
console.log(`  screenshots in .verify/\n`);
process.exit(failed.length === 0 ? 0 : 1);
