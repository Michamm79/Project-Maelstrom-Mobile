#!/usr/bin/env node
/**
 * Portfolio screenshots.
 *
 * Distinct from the smoke suite's `.verify/` output, which is diagnostic and
 * gitignored: those are full of toasts, debug state and whatever the check
 * before them left behind. These are staged clean, committed, and meant to be
 * looked at by someone deciding whether to click through.
 *
 * Run: npm run screenshots (after a build, which it serves).
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';

const DIST = resolve(import.meta.dirname, '../dist');
const OUT = resolve(import.meta.dirname, '../docs/screenshots');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json' };

const server = createServer(async (req, res) => {
  const path = join(DIST, req.url === '/' ? 'index.html' : decodeURIComponent(req.url.split('?')[0]));
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
await new Promise((r) => server.listen(0, r));
const url = `http://localhost:${server.address().port}/`;

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

/**
 * A phone, held the way the game is meant to be held.
 *
 * Landscape by default, because that is now what a player gets: the game asks
 * the device to turn, and turns its own box when the device will not. Passing
 * `portrait` switches the preference off first, which is the other thing a
 * player can choose - and is also the only way to get an upright shot, since a
 * portrait viewport with the setting on produces a sideways picture.
 */
async function phone(portrait = false) {
  const page = await browser.newPage({
    viewport: portrait ? { width: 412, height: 915 } : { width: 915, height: 412 },
    deviceScaleFactor: 2,
    hasTouch: true,
  });
  if (portrait) {
    await page.addInitScript(() => {
      try {
        localStorage.setItem(
          'maelstrom.screen.v1',
          JSON.stringify({ landscape: false, turn: 'cw', view: 'normal' }),
        );
      } catch {
        /* storage blocked; the shot comes out rotated and the run says so */
      }
    });
  }
  await page.goto(url);
  return page;
}

/** Clear anything transient so a shot is the game, not a moment in a test. */
const settle = (page) =>
  page.evaluate(() => {
    document.querySelectorAll('.toasts > *').forEach((n) => n.remove());
    const objective = document.querySelector('.objective');
    if (objective) objective.hidden = true;
  });

const shots = [];

// 1. Title
{
  const page = await phone();
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(OUT, '01-title.png') });
  shots.push('01-title.png — the title screen');
  await page.close();
}

// 2. The waking scene, caught on its first line
{
  const page = await phone();
  await page.locator('.title .tbtn.primary').click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: join(OUT, '02-waking.png') });
  shots.push('02-waking.png — the run opens on black and fades up');
  await page.close();
}

// 3. Gathering in the spawn
{
  const page = await phone();
  await page.locator('.title .tbtn.primary').click();
  await page.waitForTimeout(300);
  await page.locator('.opening').dispatchEvent('pointerdown');
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const g = window.maelstrom;
    g.inventory.add('heartwood_burl', 7);
    g.inventory.add('riverglass', 5);
    g.inventory.add('stormpetal', 4);
    g.ui.refresh(g.hudState());
  });
  await settle(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, '03-gathering.png') });
  shots.push('03-gathering.png — the pull, working at walking pace in Plains/Forest');
  await page.close();
}

// 4. Combat, mid-swing, with all three tiers on screen
{
  const page = await phone();
  await page.locator('.title .tbtn.primary').click();
  await page.waitForTimeout(300);
  await page.locator('.opening').dispatchEvent('pointerdown');
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const g = window.maelstrom;
    g.world.enemies.length = 0;
    g.world.player.x = 0;
    g.world.player.y = 0;
    for (const [id, x, y] of [['goblin', 40, -6], ['goblin', -34, 26], ['minotaur', -6, -96], ['scythe_bearer', 96, 62]]) {
      const e = g.world.spawn(JSON.parse(JSON.stringify(g.world.content.enemy(id))), x, y);
      e.aggro = true;
    }
    g.world.player.attackCooldown = 0;
    g.attack();
    g.world.player.attackAnim = 0.17;
  });
  await settle(page);
  await page.waitForTimeout(60);
  await page.screenshot({ path: join(OUT, '04-combat.png') });
  shots.push('04-combat.png — the swing arc, and the three enemy tiers');
  await page.close();
}

// 5. The one menu holding both disciplines
{
  const page = await phone();
  await page.locator('.title .tbtn.primary').click();
  await page.waitForTimeout(300);
  await page.locator('.opening').dispatchEvent('pointerdown');
  await page.waitForTimeout(700);
  await page.evaluate(() => {
    const g = window.maelstrom;
    g.inventory.add('heartwood_burl', 6);
    g.inventory.add('ironvine', 5);
    g.inventory.add('riverglass', 5);
    g.inventory.add('stormpetal', 4);
    g.ui.refresh(g.hudState());
  });
  await page.locator('.nav-btn').click();
  await settle(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, '05-crafting.png') });
  shots.push('05-crafting.png — crafting and alchemy in one menu');
  await page.close();
}

// 6, 7 & 8. Three regions that play differently, not just look different.
// The mountain and the ruin are the two with a floor of their own, and they are
// the two the spawn withholds - so they are what a player travels for, and what
// a screenshot of this game should be showing.
for (const [file, biome, note] of [
  ['06-snowy-mountain.png', 'snowy_mountain', 'the Snowy Mountain: packed snow, rock shelves, blowing drift'],
  ['07-wetland.png', 'wetland', 'the Wetland: slow going, cover, low visibility'],
  ['08-data-center.png', 'data_center', 'the Abandoned Data-Center: a raised server floor, still being scanned'],
]) {
  const page = await phone();
  await page.locator('.title .tbtn.primary').click();
  await page.waitForTimeout(300);
  await page.locator('.opening').dispatchEvent('pointerdown');
  await page.waitForTimeout(700);
  await page.evaluate((id) => {
    const g = window.maelstrom;
    const d = g.world.disc(id);
    g.world.player.x = d.x;
    g.world.player.y = d.y;
    g.world.enemies.length = 0;
  }, biome);
  await page.waitForTimeout(1400);
  await settle(page);
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, file) });
  shots.push(`${file} — ${note}`);
  await page.close();
}

// 8. Upright, for a player who turns the sideways setting off
{
  const page = await phone(true);
  await page.locator('.title .tbtn.primary').click();
  await page.waitForTimeout(300);
  await page.locator('.opening').dispatchEvent('pointerdown');
  await page.waitForTimeout(900);
  await page.evaluate(() => {
    const g = window.maelstrom;
    g.inventory.add('riverglass', 5);
    g.inventory.add('loamstone', 4);
    g.ui.refresh(g.hudState());
    g.world.enemies.length = 0;
    const e = g.world.spawn(JSON.parse(JSON.stringify(g.world.content.enemy('minotaur'))), 150, -30);
    e.aggro = true;
  });
  await settle(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, '09-portrait.png') });
  shots.push('09-portrait.png — upright, with the sideways setting turned off');
  await page.close();
}

await browser.close();
server.close();

console.log('\n  portfolio screenshots -> docs/screenshots/');
for (const s of shots) console.log(`    ${s}`);
console.log('');
