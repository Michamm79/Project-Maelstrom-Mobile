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

const cdp = await context.newCDPSession(page);
const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points });

/** Read something out of the running game. */
const peek = (fn) => page.evaluate(fn);

const box = async (selector) => {
  const b = await page.locator(selector).boundingBox();
  if (!b) throw new Error(`no box for ${selector}`);
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

// ---------------------------------------------------------------- title

check('a fresh load opens on the title screen', await page.locator('.title').isVisible());
check(
  'the title offers both a guided and an unguided start',
  (await page.locator('.title .tbtn').count()) === 2,
  (await page.locator('.title .tbtn').allTextContents()).join(' | '),
);
check(
  'the opening withholds why, as canon requires',
  /no memory|nobody explains/i.test((await page.locator('.title .tblurb').textContent()) ?? ''),
);

await page.locator('.title .tbtn.primary').click();
await page.waitForTimeout(400);
check('choosing a start dismisses the title', !(await page.locator('.title').isVisible()));

// ------------------------------------------------------------ waking scene

check('a new run wakes up before it starts', await page.locator('.opening').isVisible());
check(
  'it opens on a line, not on instructions',
  ((await page.locator('.oline').textContent()) ?? '').trim().length > 0,
  (await page.locator('.oline').textContent()) ?? '',
);
// Wait for the fade to settle rather than sampling it mid-flight. Read at a
// fixed delay this caught the HUD at 0.04 locally and 0.075 on a CI runner -
// a check that fails on machine speed rather than on behaviour. The transition
// ends at exactly 0 (measured: settled by ~800ms of its 600ms), so the settled
// value is what to assert, and the wait is what makes it deterministic.
const hudHid = await page
  .waitForFunction(
    () => {
      const hud = document.querySelector('#ui > .action-wrap');
      if (!hud) return false;
      const style = getComputedStyle(hud);
      return style.opacity === '0' && style.pointerEvents === 'none';
    },
    null,
    { timeout: 4000 },
  )
  .then(() => true)
  .catch(() => false);
const hudOpacity = await peek(() => {
  const hud = document.querySelector('#ui > .action-wrap');
  return getComputedStyle(hud).opacity;
});
check('the HUD is not there to greet you', hudHid, `settled at opacity ${hudOpacity}`);

// The scene holds the world: a wave timer running under a fade would be the
// opposite of coming round somewhere before anything asks anything of you.
const heldDuring = await peek(async () => {
  const g = window.maelstrom;
  const before = g.world.time;
  await new Promise((r) => setTimeout(r, 400));
  return g.world.time - before;
});
check('the world is held while it plays', heldDuring === 0, `${heldDuring.toFixed(2)}s advanced`);
await page.screenshot({ path: join(SHOTS, '00b-waking.png') });

// Skippable, because it is the one layer that can strand a player.
await page.locator('.opening').dispatchEvent('pointerdown');
await page.waitForTimeout(400);
check('a tap skips it', !(await page.locator('.opening').isVisible()));
check('the world runs once it is over', await peek(async () => {
  const g = window.maelstrom;
  const before = g.world.time;
  await new Promise((r) => setTimeout(r, 300));
  return g.world.time - before > 0.1;
}));
check('the HUD comes back', await peek(() => {
  const hud = document.querySelector('#ui > .action-wrap');
  return hud ? getComputedStyle(hud).opacity !== '0' : false;
}));
check('the guide shows its first objective', await page.locator('.objective').isVisible());
check(
  'and it is the first card, not a later one',
  /find your feet/i.test((await page.locator('.objective').textContent()) ?? ''),
  (await page.locator('.objective b').textContent()) ?? '',
);

// ---------------------------------------------------------------- the world

const world = await peek(() => {
  const g = window.maelstrom;
  return {
    x: g.world.player.x,
    y: g.world.player.y,
    biome: g.world.biomeAt(g.world.player.x, g.world.player.y)?.id ?? null,
    discs: g.world.discs.length,
    nodes: g.world.nodes.length,
    boundary: Math.round(g.world.boundaryRadius),
  };
});
check('the player starts at the spawn', world.x === 0 && world.y === 0, JSON.stringify(world));
check('the spawn is Plains/Forest', world.biome === 'plains_forest', String(world.biome));
check('the Coliseum is one world of five regions', world.discs === 5, `${world.discs} regions`);
check('the world is scattered with nodes', world.nodes > 200, `${world.nodes} nodes`);

check(
  'there is no travel menu - walking is how you get anywhere',
  (await page.locator('.zone-btn').count()) === 0,
);

const strays = await peek(() => {
  const g = window.maelstrom;
  const content = g.world.content ?? null;
  return g.world.nodes.filter((n) => {
    const disc = g.world.biomeAt(n.x, n.y);
    return disc ? disc.id !== n.biome : n.biome !== 'plains_forest';
  }).length;
});
check('no material is scattered outside its own biome', strays === 0, `${strays} strays`);

check(
  'cold and concealment are out of reach of the spawn',
  await peek(() => {
    const g = window.maelstrom;
    const spawn = g.world.disc('plains_forest');
    const mats = new Map(window.__materials ?? []);
    return g.world.nodes.every((n) => {
      const inside = Math.hypot(n.x - spawn.x, n.y - spawn.y) <= spawn.radius;
      if (!inside) return true;
      return n.biome === 'plains_forest';
    });
  }),
);

await page.screenshot({ path: join(SHOTS, '01-coliseum.png') });

// ---------------------------------------------------------------- the pull

// Put a node right next to the player so the pull has something to take.
await peek(() => {
  const g = window.maelstrom;
  const p = g.world.player;
  g.world.nodes.forEach((n) => {
    n.available = false;
    n.respawnAt = g.world.time + 9999;
  });
  const node = g.world.nodes[0];
  node.material = 'loamstone';
  node.biome = 'plains_forest';
  node.x = p.x + 18;
  node.y = p.y;
  node.available = true;
  node.pull = 0;
});

const stick = { x: 70, y: 520 };

// Gathering is on by default, so walking alone should bring things in. Canon
// wants the pull working at a run with nothing to think about.
await page.waitForTimeout(900);
check(
  'gathering happens without pressing anything',
  await peek(() => window.maelstrom.inventory.count('loamstone') > 0),
  await peek(() => `carrying ${window.maelstrom.inventory.used}`),
);

// The one that matters: a real two-finger touch, walking and attacking at once.
// A browser does not synthesise a click for a touch inside a multi-touch
// sequence, so this is the only shape of test that can catch a click-bound
// control - and both thumbs are genuinely in use during a wave.
await peek(() => {
  const g = window.maelstrom;
  const p = g.world.player;
  g.world.nodes.forEach((n) => {
    n.available = false;
    n.respawnAt = g.world.time + 9999;
  });
  for (let i = 0; i < 8; i++) {
    const node = g.world.nodes[i + 1];
    node.material = 'riverglass';
    node.biome = 'plains_forest';
    node.x = p.x + 60 + i * 30;
    node.y = p.y;
    node.available = true;
    node.pull = 0;
  }
  window.__startX = p.x;
  window.__startCount = g.inventory.count('riverglass');
  const def = { ...window.maelstrom.world.content.enemy('goblin'), hp: 999, damage: 0, speed: 0, wanderSpeed: 0, noticeRadius: 12, attackRange: 4 };
  window.__walkTarget = g.world.spawn(JSON.parse(JSON.stringify(def)), p.x + 24, p.y);
  window.__walkHp = window.__walkTarget.hp;
});

const attackBtn = await box('.action.attack');
await touch('touchStart', [{ x: stick.x, y: stick.y, id: 1 }]);
await touch('touchMove', [{ x: stick.x + 46, y: stick.y, id: 1 }]);
await touch('touchStart', [
  { x: stick.x + 46, y: stick.y, id: 1 },
  { x: attackBtn.x, y: attackBtn.y, id: 2 },
]);
for (let i = 0; i < 14; i++) {
  await touch('touchMove', [
    { x: stick.x + 46, y: stick.y, id: 1 },
    { x: attackBtn.x, y: attackBtn.y, id: 2 },
  ]);
  await page.waitForTimeout(120);
}
await touch('touchEnd', []);
await page.waitForTimeout(200);

const moving = await peek(() => ({
  moved: window.maelstrom.world.player.x - window.__startX,
  gained: window.maelstrom.inventory.count('riverglass') - window.__startCount,
  struck: window.__walkHp - window.__walkTarget.hp,
}));
check('a real two-thumb touch walks', moving.moved > 40, `${Math.round(moving.moved)}px`);
check(
  'and gathers at the same time - the rule the world shape depends on',
  moving.gained > 0,
  `${moving.gained} gathered while walking`,
);
check('and the attack button works under a second thumb', moving.struck > 0, `${moving.struck} damage`);

await page.screenshot({ path: join(SHOTS, '02-pulling.png') });

// ---------------------------------------------------------------- the orbs

const orbs = await peek(() => {
  const g = window.maelstrom;
  return {
    used: g.inventory.used,
    capacity: g.inventory.capacity,
    shown: document.querySelectorAll('.orb .mote').length,
    carry: document.querySelector('.carry')?.textContent ?? '',
  };
});
check('the gauntlets start at the canon capacity of 60', orbs.capacity === 60, JSON.stringify(orbs));
check('the orbs display what is carried', orbs.shown > 0, `${orbs.shown} motes`);
check('the carry readout matches the inventory', orbs.carry.startsWith(`${orbs.used} /`), orbs.carry);

check(
  'nothing can be loaded into an orb - they are a readout, not a slot',
  await peek(() => typeof window.maelstrom.inventory.loadOrb === 'undefined'),
);

// ---------------------------------------------------------------- the menu

await page.locator('.nav-btn').click();
await page.waitForTimeout(300);
check('the menu opens', await page.locator('.sheet.on').isVisible());
check(
  'it is one menu holding both disciplines',
  (await page.locator('.sheet .tabs button').allTextContents()).join(',') === 'Craft,Alchemy',
);
// GDD 6.1 has the world keep running here; the author asked for a pause, so the
// flag in content decides and this checks whichever is configured rather than
// asserting one of them behind the other's back.
const pauses = await peek(() => window.maelstrom.world.content.progression.pauseWithMenu === true);
const note = (await page.locator('.sheet .note').textContent()) ?? '';
check(
  'the note matches what the menu actually does',
  pauses ? /paused/i.test(note) : /does not stop/i.test(note),
  note,
);
const movedWhileOpen = await peek(async () => {
  const g = window.maelstrom;
  const before = g.world.time;
  await new Promise((r) => setTimeout(r, 350));
  return g.world.time - before;
});
check(
  pauses ? 'the menu pauses the world' : 'the world keeps running while the menu is open',
  pauses ? movedWhileOpen === 0 : movedWhileOpen > 0.1,
  `${movedWhileOpen.toFixed(2)}s advanced`,
);

check('crafting lists the four gauntlet upgrades', (await page.locator('.sheet .row-item').count()) === 4);
check(
  'the menu button says what it opens',
  /transmute/i.test((await page.locator('.nav-btn').textContent()) ?? ''),
);
await page.screenshot({ path: join(SHOTS, '03-craft.png') });

// Hand over exactly what one recipe costs and check it lands.
await peek(() => {
  const g = window.maelstrom;
  g.inventory.add('heartwood_burl', 4);
  g.inventory.add('ironvine', 3);
  g.ui.refresh(g.hudState());
});
await page.waitForTimeout(250);

const craftRow = page.locator('.sheet .row-item', { hasText: 'Reinforced Weave' });
check('an affordable recipe enables its button', await craftRow.locator('button.go').isEnabled());
await craftRow.locator('button.go').click();
await page.waitForTimeout(300);

check(
  'crafting raises carry capacity permanently',
  await peek(() => window.maelstrom.inventory.capacity === 100),
  await peek(() => `capacity ${window.maelstrom.inventory.capacity}`),
);
check(
  'and the recipe cannot be taken twice',
  await page.locator('.sheet .row-item.done', { hasText: 'Reinforced Weave' }).isVisible(),
);

// ---------------------------------------------------------------- alchemy

await page.locator('.sheet .tabs button', { hasText: 'Alchemy' }).click();
await page.waitForTimeout(250);

const level = await peek(() => window.maelstrom.progression.level);
check(
  'the alchemy menu is visible before it is usable',
  await page.locator('.sheet .locked-note').isVisible(),
  `level ${level}`,
);
check(
  'it names the level that opens it',
  /level 2/i.test((await page.locator('.sheet .locked-note').textContent()) ?? ''),
);
check('the element pool is shown', (await page.locator('.sheet .pool .chip').count()) === 10);
check(
  'the three handed-over combinations are listed',
  (await page.locator('.sheet .row-item').count()) === 3,
);
await page.screenshot({ path: join(SHOTS, '04-alchemy.png') });

await page.locator('.sheet header .close').click();
await page.waitForTimeout(200);

// ---------------------------------------------------------------- casting

await peek(() => {
  const g = window.maelstrom;
  g.inventory.add('stormpetal', 6);
  g.ui.refresh(g.hudState());
});
await page.waitForTimeout(200);

// Gathering is a toggle that starts on: canon wants the pull working at a run
// with nothing to think about, and holding a button for a whole expedition is
// the opposite of that.
check('gathering is on without pressing anything', await peek(() => window.maelstrom.pulling === true));
check(
  'and the pull button says so',
  /on/i.test((await page.locator('.action.pull .sub').textContent()) ?? ''),
);

// A basic attack. Canon has no weapon items but plainly implies one: Nahaste's
// cost is "near-zero unarmed capability", and Amorratua scales with consecutive
// hits.
const melee = await peek(async () => {
  const g = window.maelstrom;
  const def = { ...window.maelstrom.world.content.enemy('goblin'), hp: 60, damage: 0, speed: 0, wanderSpeed: 0, noticeRadius: 12, attackRange: 5 };
  const e = g.world.spawn(JSON.parse(JSON.stringify(def)), g.world.player.x + 24, g.world.player.y);
  const first = e.hp;
  g.attack();
  const afterOne = e.hp;
  const steps = [];
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 500));
    // Put it back in reach first. A hit now shoves, and a fixture with speed 0
    // cannot walk back in - so without this the check measured the spacing
    // rather than the combo it is named for. Spacing has its own tests.
    e.x = g.world.player.x + 24;
    e.y = g.world.player.y;
    e.knockX = 0;
    e.knockY = 0;
    const before = e.hp;
    g.attack();
    steps.push(before - e.hp);
  }
  return { landed: first - afterOne, steps, combo: g.world.player.combo };
});
check('a single tap lands a melee hit', melee.landed > 0, `${melee.landed} damage`);

// attackAnim was set on every swing since combat went in and nothing ever read
// it, so the attack dealt damage with no picture attached. The renderer draws
// the arc against it now, and this is the cheap proof it is actually running.
const swing = await peek(() => {
  const g = window.maelstrom;
  // Off cooldown: a swing during one correctly does nothing at all, animation
  // included, and the melee block above just spent three.
  g.world.player.attackCooldown = 0;
  g.world.player.attackAnim = 0;
  g.attack();
  return g.world.player.attackAnim;
});
check('a swing has an animation to draw', swing > 0, `attackAnim ${swing.toFixed(2)}s`);

// The player's half of the asymmetry. Enemies notice only at an encounter
// distance now, so without this the player would be exactly as blind as they are.
const sensing = await peek(() => {
  const g = window.maelstrom;
  const notice = Math.max(...g.world.content.enemies.map((e) => e.noticeRadius));
  return { sense: g.world.content.waves.awarenessRadius, notice };
});
check(
  'the player senses further than the program notices',
  sensing.sense > sensing.notice,
  `${sensing.sense}uu against ${sensing.notice}uu`,
);
check(
  'staying on a target builds the combo',
  melee.combo > 0 && melee.steps[melee.steps.length - 1] > melee.steps[0],
  `${melee.steps.join(' -> ')} at combo ${melee.combo}`,
);
// Alchemy opens at a level, so reach it on purpose rather than on whatever XP
// the run happened to accumulate - which is how this check quietly depended on
// the spawn biome wrongly paying out 80 XP at the start of every run.
const unlocked = await peek(() => {
  const g = window.maelstrom;
  const want = g.world.content.progression.alchemyUnlockLevel;
  // Distinct keys, because novelty XP is paid once per key by design.
  for (let i = 0; g.progression.level < want && i < 200; i++) {
    g.progression.award('firstMaterial', `probe-${i}`);
  }
  g.ui.refresh(g.hudState());
  return { level: g.progression.level, want };
});
await page.waitForTimeout(200);
check(
  'reaching the alchemy level opens the skills',
  unlocked.level >= unlocked.want,
  `level ${unlocked.level} of ${unlocked.want}`,
);
check('the skills sit as buttons beside the attack', (await page.locator('.skillarc .skill').count()) > 0);

const enemyBefore = await peek(() => {
  const g = window.maelstrom;
  const def = g.world.content?.enemy?.('goblin') ?? null;
  window.__enemy = g.world.spawn(
    JSON.parse(JSON.stringify({ ...window.maelstrom.world.content.enemy('goblin'), hp: 16, damage: 4, speed: 0, wanderSpeed: 0, noticeRadius: 12, attackRange: 5 })),
    g.world.player.x + 30,
    g.world.player.y,
  );
  void def;
  return window.__enemy.hp;
});
await page.locator('.skillarc .skill').first().dispatchEvent('pointerdown');
await page.waitForTimeout(350);
const enemyAfter = await peek(() => window.__enemy.hp);
check('tapping a skill fires it without arming it first', enemyAfter < enemyBefore, `${enemyBefore} -> ${enemyAfter}`);
check(
  'and spends the elements that carried it',
  await peek(() => window.maelstrom.inventory.count('stormpetal') < 6),
);

// ---------------------------------------------------------------- progression

const farmed = await peek(() => {
  const g = window.maelstrom;
  // Pay for it once first, so what is measured is the repeats and not the
  // legitimate first award.
  g.progression.award('firstMaterial', 'loamstone');
  const before = g.progression.xp;
  for (let i = 0; i < 200; i++) g.progression.award('firstMaterial', 'loamstone');
  return g.progression.xp - before;
});
check('the same material cannot be farmed for XP', farmed === 0, `${farmed} xp from 200 repeats`);

// ---------------------------------------------------------------- orientation

/*
 * Both orientations, measured rather than eyeballed. Two separate faults
 * reached a phone before this ran: the readout and the menu button overlapped
 * the skill arc, and the camera drew one world unit per CSS pixel, so turning
 * the phone kept the same span across the short side while the HUD's fixed
 * height ate half of it.
 */
const HUD = [
  '.place',
  '.vitals',
  '.level',
  '.objective',
  '.orbwrap',
  '.orb',
  '.carry',
  '.nav-btn',
  '.action.pull',
  '.action.attack',
  '.skillarc .skill',
];
const spans = {};

for (const [label, width, height] of [
  ['portrait', 412, 915],
  ['landscape', 915, 412],
]) {
  await page.setViewportSize({ width, height });
  await page.waitForTimeout(400);
  const seen = await page.evaluate((selectors) => {
    const boxes = [];
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) boxes.push({ sel, r, el });
      }
    }

    const overlaps = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        // Nesting is not collision: an orb inside its own wrapper is fine.
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w > 2 && h > 2) overlaps.push(`${a.sel} x ${b.sel} (${Math.round(w)}x${Math.round(h)})`);
      }
    }

    let strip = 0;
    for (const sel of ['.topbar', '.orbwrap', '.skillarc']) {
      const el = document.querySelector(sel);
      if (el) strip = Math.max(strip, el.getBoundingClientRect().height / window.innerHeight);
    }

    const view = window.maelstrom.renderer.view;
    return { overlaps, strip, view: { w: Math.round(view.width), h: Math.round(view.height) } };
  }, HUD);

  check(`${label}: no two HUD controls overlap`, seen.overlaps.length === 0, seen.overlaps.join('; '));
  check(
    `${label}: no HUD strip eats a third of the screen`,
    seen.strip < 0.34,
    `${Math.round(seen.strip * 100)}%`,
  );
  spans[label] = seen.view;
  await page.screenshot({ path: join(SHOTS, `05-${label}.png`) });
}

// The point of the long-axis zoom: turning the phone is a rotation, not a
// different game. The two views should be each other transposed.
check(
  'turning the phone shows the same view rotated',
  Math.abs(spans.portrait.w - spans.landscape.h) <= 2 && Math.abs(spans.portrait.h - spans.landscape.w) <= 2,
  `portrait ${spans.portrait.w}x${spans.portrait.h}, landscape ${spans.landscape.w}x${spans.landscape.h}`,
);

await page.setViewportSize({ width: 412, height: 915 });
await page.waitForTimeout(300);

// ---------------------------------------------------------------- icon lighting

// Reading the pixels is the only way to tell the composite actually ran: if
// `filter` or `source-atop` quietly no-ops, the icons still draw and every
// other check still passes.
await page.locator('.nav-btn').click();
await page.waitForTimeout(300);
const lighting = await peek(() => {
  let measured = 0;
  let withShadow = 0;
  let litBrighter = 0;
  let ratio = 0;

  for (const canvas of document.querySelectorAll('.sheet canvas, .orb canvas')) {
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;
    const { width: w, height: h } = canvas;
    if (w < 8) continue;
    const data = ctx.getImageData(0, 0, w, h).data;

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

    const gap = 2;
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
    if (cast > 6 && cast > against * 3) withShadow++;
    if (litN > 10 && shadeN > 10) {
      const lift = (litSum / litN) / (shadeSum / shadeN);
      ratio = ratio === 0 ? lift : Math.min(ratio, lift);
      if (lift > 1.03) litBrighter++;
    }
  }
  return { measured, withShadow, litBrighter, ratio: Math.round(ratio * 100) / 100 };
});
check('there are icons to measure', lighting.measured >= 1, JSON.stringify(lighting));
check('item icons cast a shadow away from the light', lighting.withShadow > 0, JSON.stringify(lighting));
check('item icons are lit from the upper left', lighting.litBrighter > 0, JSON.stringify(lighting));
await page.locator('.sheet header .close').click();

// ---------------------------------------------------------------- persistence

const beforeReload = await peek(() => {
  const g = window.maelstrom;
  g.persist();
  return { capacity: g.inventory.capacity, xp: g.progression.xp, used: g.inventory.used };
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(700);

const afterReload = await peek(() => {
  const g = window.maelstrom;
  return { capacity: g.inventory.capacity, xp: g.progression.xp, used: g.inventory.used };
});
check(
  'a run survives a reload',
  afterReload.capacity === beforeReload.capacity && afterReload.xp === beforeReload.xp,
  `${JSON.stringify(beforeReload)} -> ${JSON.stringify(afterReload)}`,
);
check('the gauntlet upgrades come back with it', afterReload.capacity === 100, `capacity ${afterReload.capacity}`);

await page.screenshot({ path: join(SHOTS, '06-after-reload.png') });

// ---------------------------------------------------------------- starting over

/*
 * "Start over" used to call clearSave() and nothing else. localStorage emptied,
 * but every live system kept the old run and the next autosave wrote it back
 * five seconds later: same level, same upgrades, same pack, same standing
 * position. Because XP is novelty-only, the new run could then never earn most
 * of it again. So this walks the real buttons rather than calling a method.
 */
const beforeRestart = await peek(() => {
  const g = window.maelstrom;
  g.world.player.x = 900;
  g.world.player.y = -450;
  return {
    xp: g.progression.xp,
    capacity: g.inventory.capacity,
    pullRadius: g.inventory.pullRadius,
    built: g.crafting.toJSON().length,
    used: g.inventory.used,
  };
});
check(
  'there is a run worth erasing',
  beforeRestart.xp > 0 && beforeRestart.built > 0 && beforeRestart.used > 0,
  JSON.stringify(beforeRestart),
);

await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(700);
await page.locator('.title .tbtn', { hasText: 'Start over' }).click();
await page.waitForTimeout(250);
await page.locator('.title .tbtn.danger').click();
await page.waitForTimeout(600);

const afterRestart = await peek(() => {
  const g = window.maelstrom;
  return {
    xp: g.progression.xp,
    capacity: g.inventory.capacity,
    pullRadius: g.inventory.pullRadius,
    built: g.crafting.toJSON().length,
    used: g.inventory.used,
    seen: g.progression.toJSON().seen.length,
    at: `${Math.round(g.world.player.x)},${Math.round(g.world.player.y)}`,
    taken: g.world.nodes.filter((n) => !n.available).length,
    playtimeMs: Math.round(g.playtimeMs),
    base: g.world.content.crafting.baseStats,
  };
});
check('starting over clears the XP', afterRestart.xp === 0, `${beforeRestart.xp} -> ${afterRestart.xp}`);
check('starting over empties the pack', afterRestart.used === 0, `${beforeRestart.used} -> ${afterRestart.used}`);
check(
  'starting over takes back the gauntlet upgrades',
  afterRestart.built === 0 &&
    afterRestart.capacity === afterRestart.base.carryCapacity &&
    afterRestart.pullRadius === afterRestart.base.pullRadius,
  JSON.stringify(afterRestart),
);
check('starting over puts you back where you woke', afterRestart.at === '0,0', afterRestart.at);
check('starting over restocks the world', afterRestart.taken === 0, `${afterRestart.taken} nodes still taken`);
check('starting over resets the clock', afterRestart.playtimeMs < 10000, `${afterRestart.playtimeMs}ms`);
// One marker survives by design: the spawn biome, recorded as seen so waking
// there never pays out as a visit. It carries no XP, which the first check above
// is what proves.
check('only the spawn marker survives', afterRestart.seen === 1, `${afterRestart.seen} novelty keys`);
check('and it wakes up again', await page.locator('.opening').isVisible());
await page.locator('.opening').dispatchEvent('pointerdown');
await page.waitForTimeout(300);

// ---------------------------------------------------------------- the end

check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
server.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\n  ${checks.length - failed.length}/${checks.length} checks passed`);
console.log(`  screenshots in .verify/\n`);
if (failed.length) process.exit(1);
