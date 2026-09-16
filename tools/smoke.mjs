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
/*
 * Everything below this line drives the game in an UPRIGHT box.
 *
 * The default is now to hold the game sideways, which on a portrait phone means
 * rotating the app box - and then "the left half of the screen" is no longer
 * the left half of the viewport. Rather than re-deriving every drag in this
 * file against a transform, the main pass turns the preference off and a
 * dedicated section at the end drives the rotated layout on its own, including
 * a check that leaving the preference alone is what rotates it.
 */
await context.addInitScript(() => {
  try {
    localStorage.setItem(
      'maelstrom.screen.v1',
      JSON.stringify({ landscape: false, turn: 'cw', view: 'normal' }),
    );
  } catch {
    /* a browser with storage blocked still gets the default, which is fine */
  }
});
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
// Canon puts everything the player works with in one place, so both
// disciplines have to be tabs of the same sheet rather than two screens. The
// third tab is where the game's own screen settings live, which belong here for
// the same reason: this is the only menu there is.
check(
  'it is one menu holding both disciplines',
  (await page.locator('.sheet .tabs button').allTextContents()).join(',') === 'Craft,Alchemy,Screen',
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

// ---------------------------------------------------------------- sound

// Browsers refuse audio before a gesture, so the context must not exist until
// the player presses something - and must exist afterwards.
const audio = await peek(() => {
  const g = window.maelstrom;
  return { state: g.sound?.ctx?.state ?? 'none', muted: g.sound?.isMuted };
});
check('audio starts only after a real press', audio.state === 'running', `context ${audio.state}`);
check('and it is not muted by default', audio.muted === false);
check('there is a mute control without opening a menu', await page.locator('.mute-btn').isVisible());

const muteRound = await peek(async () => {
  const g = window.maelstrom;
  const before = g.sound.isMuted;
  g.ui.hooks?.onToggleMute?.();
  return { before, after: g.sound.isMuted };
});
check(
  'the mute button actually mutes',
  muteRound.before === false && muteRound.after === true,
  `${muteRound.before} -> ${muteRound.after}`,
);
await page.locator('.mute-btn').click();
await page.waitForTimeout(150);
check('and unmutes again', (await peek(() => window.maelstrom.sound.isMuted)) === false);

// ---------------------------------------------------------------- funnel

// Local-first by design: this is the check that it stays that way. A funnel
// that quietly grew a third-party SDK would be a privacy decision made by
// accident rather than by the author.
const funnel = await peek(() => {
  const g = window.maelstrom;
  const report = g.funnelReport();
  const scripts = [...document.querySelectorAll('script[src]')].map((s) => s.src);
  return {
    hasReport: typeof report === 'string' && report.includes('sessions'),
    reached: /began|walked|gathered/.test(report),
    offsite: scripts.filter((src) => !src.startsWith(location.origin)),
    stored: Object.keys(localStorage).filter((k) => k.startsWith('maelstrom.funnel')),
  };
});
check('the funnel records where players stop', funnel.hasReport && funnel.reached);
check('it is kept on the device', funnel.stored.length === 1, funnel.stored.join(','));
check(
  'and nothing third-party is loaded',
  funnel.offsite.length === 0,
  funnel.offsite.join(', ') || 'no offsite scripts',
);

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

/*
 * And it is not a letterbox any more.
 *
 * The complaint that started this: 700 units across the long axis put 700x315
 * on a phone held sideways, which read as a slot rather than a playfield. The
 * floor is here rather than the exact number so the view setting stays free to
 * be retuned without rewriting the check.
 */
check(
  'the playfield is not a letterbox',
  spans.landscape.h >= 380,
  `${spans.landscape.w}x${spans.landscape.h} world units`,
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

// ---------------------------------------------------------------- fragments

/*
 * The world saying something about itself.
 *
 * The guide says what to do and canon withholds why; these are the six moments
 * in between. The failure worth catching is repetition - "fires every time"
 * looks exactly like "fires" until somebody plays for ten minutes.
 */
{
  await peek(() => {
    const g = window.maelstrom;
    g.ui.hideFragment();
    g.fragmentsSeen.clear();
    g.fragment('firstKill');
  });
  await page.waitForTimeout(150);
  const reading = await page.locator('.fragment b').textContent();
  check('killing something says something about it', reading === 'Deletion', reading ?? 'nothing');

  await page.locator('.fragment').click();
  await page.waitForTimeout(150);
  check('and it can be dismissed', await page.locator('.fragment').isHidden());

  await peek(() => window.maelstrom.fragment('firstKill'));
  await page.waitForTimeout(150);
  check('it never says the same thing twice', await page.locator('.fragment').isHidden());

  await peek(() => window.maelstrom.fragment('firstCraft'));
  await page.waitForTimeout(150);
  check(
    'but a different moment still has its own line',
    (await page.locator('.fragment b').textContent()) === 'Specification',
  );
  await page.locator('.fragment').click();
  await page.waitForTimeout(150);

  /*
   * It must not stop the game. One of the moments it fires on is a wave
   * clearing, and pausing to narrate that would take the beat away from the
   * thing being narrated.
   */
  /*
   * It has to fit alongside the HUD it appears over. Centred, it landed on the
   * objective banner in landscape - 187px of overlap, which no screenshot in
   * the suite happened to catch because the banner is usually gone by then.
   */
  await peek(() => {
    window.maelstrom.fragmentsSeen.clear();
    window.maelstrom.fragment('firstKill');
  });
  await page.waitForTimeout(200);
  const collides = await page.evaluate(() => {
    const reading = document.querySelector('.fragment')?.getBoundingClientRect();
    if (!reading) return 'no reading';
    const hits = [];
    for (const sel of ['.objective', '.place', '.level', '.action.attack', '.action.pull', '.orbwrap', '.nav-btn']) {
      const other = document.querySelector(sel)?.getBoundingClientRect();
      if (!other || other.width === 0) continue;
      const w = Math.min(reading.right, other.right) - Math.max(reading.left, other.left);
      const h = Math.min(reading.bottom, other.bottom) - Math.max(reading.top, other.top);
      if (w > 2 && h > 2) hits.push(`${sel} (${Math.round(w)}x${Math.round(h)})`);
    }
    return hits.join('; ');
  });
  check('a reading does not land on the HUD', collides === '', collides);
  await page.locator('.fragment').click();
  await page.waitForTimeout(150);

  await peek(() => window.maelstrom.fragment('firstCast'));
  const before = await peek(() => window.maelstrom.world.time);
  await page.waitForTimeout(400);
  const later = await peek(() => window.maelstrom.world.time);
  check('a reading does not stop the world', later > before, `${(later - before).toFixed(2)}s passed`);
  await page.locator('.fragment').click();
  await page.waitForTimeout(150);
}

// -------------------------------------------------------------------- menus

/*
 * The main menu, and the way out of a run.
 *
 * Before this there was no way to stop except closing the tab, and no way to
 * reach a setting without starting a run first.
 */
{
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(700);

  check(
    'the title screen is a menu rather than two buttons',
    (await page.locator('.tnavbtn').allTextContents()).join(',') === 'Settings,How to play,About',
  );

  /*
   * The bug this section exists for.
   *
   * Both overlays set `display: flex`, which outranks the user agent's
   * `[hidden] { display: none }` - so a CLOSED pause menu stayed laid out over
   * the whole screen and ate every touch meant for the game behind it. Nothing
   * threw; the game was simply unplayable.
   */
  const blocking = await page.evaluate(() => {
    const at = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
    return at?.closest('.pause') !== null;
  });
  check('a closed pause menu does not swallow touches', !blocking);

  for (const [label, marker] of [
    ['Settings', '.setrow'],
    ['How to play', '.howrow'],
    ['About', '.aboutfacts'],
  ]) {
    await page.locator('.tnavbtn', { hasText: label }).click();
    await page.waitForTimeout(200);
    check(`the title opens ${label}`, (await page.locator(marker).count()) > 0);
    await page.locator('.tback').click();
    await page.waitForTimeout(200);
  }
  check('and Back returns to the menu', await page.locator('.tnav').isVisible());

  await page.locator('.title .tbtn.primary').click();
  await page.waitForTimeout(500);
  await page.locator('.opening').dispatchEvent('pointerdown');
  await page.waitForTimeout(700);

  await page.locator('.topbar .pause-btn').click();
  await page.waitForTimeout(250);
  check('the HUD has a pause control that works', await page.locator('.pcard').isVisible());

  /*
   * Paused means paused. Driving the stick while it is open must move nothing,
   * or "pause" is just an overlay with the game still running under it.
   */
  const held = await peek(() => ({ x: window.maelstrom.world.player.x, y: window.maelstrom.world.player.y }));
  await page.keyboard.down('d');
  await page.waitForTimeout(500);
  await page.keyboard.up('d');
  const after = await peek(() => ({ x: window.maelstrom.world.player.x, y: window.maelstrom.world.player.y }));
  check(
    'the world does not move while it is paused',
    Math.hypot(after.x - held.x, after.y - held.y) < 0.5,
    `moved ${Math.hypot(after.x - held.x, after.y - held.y).toFixed(1)}uu`,
  );

  /*
   * One settings panel, three doors. Changing the view here has to be the same
   * setting the gauntlet menu's Screen tab shows, or there are two of it.
   */
  await page.locator('.pcard .tbtn', { hasText: 'Settings' }).click();
  await page.waitForTimeout(200);
  await page.locator('.pcard .setchip', { hasText: 'Wide' }).click();
  await page.waitForTimeout(250);
  const pausedView = await peek(() => window.maelstrom.screen.view);
  check('settings reached from the pause menu take effect', pausedView === 'wide', pausedView);

  await page.locator('.pcard .tback').click();
  await page.waitForTimeout(150);
  await page.locator('.pcard .tbtn', { hasText: 'Resume' }).click();
  await page.waitForTimeout(300);
  check('Resume hands the world back', (await page.locator('.pcard').count()) === 0);

  await page.locator('.nav-btn').click();
  await page.waitForTimeout(250);
  await page.locator('.tabs button[data-tab="screen"]').click();
  await page.waitForTimeout(200);
  const sheetShows = await page.locator('.sheet .setchip.on', { hasText: 'Wide' }).count();
  check('and the gauntlet menu shows the same setting, not its own copy', sheetShows === 1);
  await page.locator('.sheet .setchip', { hasText: 'Normal' }).click();
  await page.waitForTimeout(150);
  await page.locator('.sheet .close').click();
  await page.waitForTimeout(200);

  /*
   * Quitting is not starting over. The run has to survive it, because "I want
   * to stop" and "I want this erased" are different sentences.
   */
  await peek(() => {
    window.maelstrom.inventory.add('loamstone', 4);
  });
  await page.locator('.topbar .pause-btn').click();
  await page.waitForTimeout(250);
  await page.locator('.pcard .tbtn', { hasText: 'Quit to menu' }).click();
  await page.waitForTimeout(400);
  check('Quit goes back to the menu', await page.locator('.title').isVisible());
  check(
    'and offers to continue the run it saved',
    (await page.locator('.title .tbtn.primary').textContent())?.startsWith('Continue'),
  );

  await page.locator('.title .tbtn.primary').click();
  await page.waitForTimeout(400);
  const kept = await peek(() => window.maelstrom.inventory.used);
  check('the run is still there afterwards', kept > 0, `${kept} units carried`);
}

// ----------------------------------------------------------------- deletion

/*
 * Killing a rendering of hostile code.
 *
 * The failure worth guarding is silent: if the silhouette sampling comes back
 * empty - a tainted canvas, a creature that drew nothing, a getImageData that
 * threw - makeDeletion returns null and enemies simply vanish again, with no
 * error anywhere. So this asserts the glyphs exist and that there are enough of
 * them to be a shape.
 */
{
  const killed = await peek(async () => {
    const g = window.maelstrom;
    g.world.enemies.length = 0;
    const out = {};
    for (const id of ['goblin', 'minotaur', 'scythe_bearer']) {
      const enemy = g.world.spawn(JSON.parse(JSON.stringify(g.world.content.enemy(id))), 200, 200);
      enemy.hp = 0;
      enemy.dead = true;
      g.world.events.push({ kind: 'enemy-killed', enemy });
      g.drainEvents();
      const effect = g.renderer.deletions[g.renderer.deletions.length - 1];
      out[id] = effect ? effect.glyphs.length : 0;
    }
    return out;
  });
  check(
    'every tier comes apart into its own silhouette',
    Object.values(killed).every((n) => n > 20),
    JSON.stringify(killed),
  );

  const cleared = await peek(async () => {
    const g = window.maelstrom;
    // Age them past the end rather than waiting a second of real time.
    for (const effect of g.renderer.deletions) effect.age = 99;
    g.renderer.update(0.016);
    return g.renderer.deletions.length;
  });
  check('and the glyphs are cleaned up after', cleared === 0, `${cleared} left`);

  await peek(() => {
    window.maelstrom.world.enemies.length = 0;
  });
}

// --------------------------------------------------------------- installing

/*
 * The install offer, which is the entire distribution plan.
 *
 * There is no store account, so a player keeping the game means installing the
 * PWA, and that means finding an install nobody ever finds in a browser menu.
 * Headless Chromium does not fire `beforeinstallprompt` on its own, so the
 * event is synthesised - which is also the only way to drive the accept path.
 */
{
  const installCtx = await browser.newContext({ ...devices['Pixel 7'] });
  const page2 = await installCtx.newPage();
  await page2.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await page2.waitForTimeout(500);

  check(
    'no install offer before the browser makes one available',
    (await page2.locator('.tinstall').count()) === 0,
  );

  // The real event is fired by the browser and cannot be constructed with its
  // own interface, so this is the shape the code actually consumes.
  const raise = () =>
    page2.evaluate(() => {
      const event = new Event('beforeinstallprompt');
      window.__installPrompted = 0;
      Object.assign(event, {
        prompt: () => {
          window.__installPrompted += 1;
          return Promise.resolve();
        },
        userChoice: Promise.resolve({ outcome: 'accepted' }),
      });
      window.dispatchEvent(event);
    });

  await raise();
  await page2.waitForTimeout(200);
  check('an install offer appears once the browser allows one', await page2.locator('.tinstall .tbtn').isVisible());

  await page2.locator('.tinstall .tbtn').click();
  await page2.waitForTimeout(250);
  check(
    'tapping it raises the browser prompt',
    (await page2.evaluate(() => window.__installPrompted)) === 1,
  );
  check(
    'and the offer goes once it has been taken',
    (await page2.locator('.tinstall').count()) === 0,
  );

  // Not now has to mean not ever, or the prompt trains people to ignore it.
  const page3 = await installCtx.newPage();
  await page3.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await page3.waitForTimeout(400);
  await page3.evaluate(() => {
    const event = new Event('beforeinstallprompt');
    Object.assign(event, { prompt: () => Promise.resolve(), userChoice: Promise.resolve({ outcome: 'dismissed' }) });
    window.dispatchEvent(event);
  });
  await page3.waitForTimeout(200);
  await page3.locator('.tdismiss').click();
  await page3.waitForTimeout(150);
  check('"Not now" clears the offer', (await page3.locator('.tinstall').count()) === 0);

  await page3.reload({ waitUntil: 'networkidle' });
  await page3.waitForTimeout(400);
  await page3.evaluate(() => {
    const event = new Event('beforeinstallprompt');
    Object.assign(event, { prompt: () => Promise.resolve(), userChoice: Promise.resolve({ outcome: 'dismissed' }) });
    window.dispatchEvent(event);
  });
  await page3.waitForTimeout(200);
  check('and it stays cleared on the next launch', (await page3.locator('.tinstall').count()) === 0);

  /*
   * The settings row deliberately ignores that dismissal: somebody who opened a
   * settings tab is looking for the thing rather than being sold it, and it is
   * the only route back for a player who tapped Not now and changed their mind.
   */
  await page3.locator('.title .tbtn.primary').click();
  await page3.waitForTimeout(1100);
  await page3.locator('.opening').dispatchEvent('pointerdown');
  await page3.waitForTimeout(500);
  await page3.locator('.nav-btn').click();
  await page3.waitForTimeout(250);
  await page3.locator('.tabs button[data-tab="screen"]').click();
  await page3.waitForTimeout(200);
  check(
    'the settings tab still offers it after a dismissal',
    (await page3.locator('.setrow', { hasText: /^Keep a copy/ }).count()) === 1,
  );

  await installCtx.close();
}

/*
 * iOS has no install event and never will - Safari installs from the share
 * sheet only. Nothing in a page can open that, so the offer has to become a
 * sentence rather than a button that quietly does nothing.
 */
{
  const iosCtx = await browser.newContext({
    ...devices['iPhone 13'],
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  });
  const ios = await iosCtx.newPage();
  await ios.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await ios.waitForTimeout(600);

  const hint = await ios.locator('.tinstall .thint').textContent();
  check('iOS is told how to install it by hand', Boolean(hint && hint.includes('Add to Home Screen')), hint ?? 'no hint');
  check('and is not shown a button that cannot work', (await ios.locator('.tinstall .tbtn').count()) === 0);
  await iosCtx.close();
}

/*
 * Already installed. Running from a home screen icon means display-mode is
 * standalone, which Playwright can emulate - and the one thing that must never
 * happen is offering an install to somebody who has already done it.
 */
{
  const standaloneCtx = await browser.newContext({ ...devices['Pixel 7'] });
  const installed = await standaloneCtx.newPage();
  await installed.emulateMedia({ media: 'screen', forcedColors: null, reducedMotion: null });
  await installed.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (query) =>
      query.includes('display-mode: standalone')
        ? { matches: true, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }
        : real(query);
  });
  await installed.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await installed.waitForTimeout(500);
  check(
    'an installed copy is never asked to install again',
    (await installed.locator('.tinstall').count()) === 0,
  );
  check(
    'and the funnel records that it is installed',
    await installed.evaluate(() => window.maelstrom.funnel.toJSON().first.installed !== undefined),
  );
  await standaloneCtx.close();
}

// ------------------------------------------------------------ forced landscape

/*
 * The other half of the game: a portrait phone that will not rotate.
 *
 * A fresh context, so nothing has stored a preference and the default is what
 * is under test. Chromium grants neither the orientation lock nor a useful
 * fullscreen here, which is exactly the situation on an iPhone and on any
 * device whose owner has rotation lock switched on - so this drives the
 * transform fallback, which is the path that has to be right.
 */
{
  const rotatedContext = await browser.newContext({ ...devices['Pixel 7'] });
  /*
   * Say yes to the orientation lock and rotate nothing.
   *
   * Not a hypothetical: the Chromium this suite runs on in CI does exactly
   * that, and the first version of this feature believed it. The player
   * pressed Begin, the fallback switched itself off on the strength of a
   * resolved promise, and the game dropped back into portrait - stranded by
   * the call that was meant to help. Stubbed rather than left to the runner,
   * because a browser that grants the lock properly would hide the bug again.
   */
  await rotatedContext.addInitScript(() => {
    try {
      Object.defineProperty(screen.orientation, 'lock', {
        value: () => Promise.resolve(),
        configurable: true,
      });
    } catch {
      /* nothing to stub here, which is its own kind of pass */
    }
  });
  const rot = await rotatedContext.newPage();
  const rotErrors = [];
  rot.on('pageerror', (e) => rotErrors.push(String(e)));
  await rot.goto(`http://localhost:${PORT}/`, { waitUntil: 'networkidle' });
  await rot.waitForTimeout(700);

  const shape = await rot.evaluate(() => {
    const app = document.querySelector('#app');
    const canvas = document.querySelector('#stage');
    const view = window.maelstrom.renderer.view;
    return {
      rot: app.dataset.rot ?? null,
      app: [app.clientWidth, app.clientHeight],
      backing: [canvas.width, canvas.height],
      squat: 'squat' in document.documentElement.dataset,
      view: [Math.round(view.width), Math.round(view.height)],
    };
  });

  check('a portrait phone gets a landscape game by default', shape.rot === 'cw', String(shape.rot));
  check('the game box is landscape-shaped', shape.app[0] > shape.app[1], shape.app.join('x'));
  /*
   * The one that would be invisible in a screenshot and obvious on a phone.
   * The backing store is sized from the layout box, and a bounding rect reports
   * a rotated element's axis-aligned cover - so reading the wrong one leaves a
   * portrait canvas stretched across a landscape box, which is the original
   * "the art is set for vertical" bug wearing a new hat.
   */
  check('the canvas backing store is landscape too', shape.backing[0] > shape.backing[1], shape.backing.join('x'));
  check('the HUD is told the BOX is squat, not the viewport', shape.squat);
  check('the rotated view is as wide as the upright one', shape.view[0] >= 880, shape.view.join('x'));

  // No two controls may collide in the rotated layout either.
  const overlaps = await rot.evaluate((selectors) => {
    const boxes = [];
    for (const sel of selectors) {
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) boxes.push({ sel, r, el });
      }
    }
    const hits = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (w > 2 && h > 2) hits.push(`${a.sel} x ${b.sel}`);
      }
    }
    return hits;
  }, HUD);
  check('rotated: no two HUD controls overlap', overlaps.length === 0, overlaps.join('; '));

  await rot.locator('.title .tbtn.primary').click();
  // Long enough to cover the beat the lock is given to actually turn the
  // screen, so this reads the settled state rather than the middle of it.
  await rot.waitForTimeout(1200);
  await rot.locator('.opening').dispatchEvent('pointerdown');
  await rot.waitForTimeout(900);

  const held = await rot.evaluate(() => {
    const app = document.querySelector('#app');
    return { rot: app.dataset.rot ?? null, box: [app.clientWidth, app.clientHeight] };
  });
  check(
    'a lock that turns nothing does not strand the player in portrait',
    held.rot === 'cw' && held.box[0] > held.box[1],
    JSON.stringify(held),
  );

  /*
   * The steering, in the player's terms rather than the transform's.
   *
   * Turned clockwise the game's top edge runs along the phone's left, so a
   * thumb dragged toward the phone's left has to walk the player UP the world.
   * Get the inverse wrong and this is the symptom: the stick reads as if it
   * were mounted sideways, which no screenshot would ever show.
   */
  const rotCdp = await rotatedContext.newCDPSession(rot);
  const walk = async (from, to) => {
    const before = await rot.evaluate(() => ({ x: window.maelstrom.world.player.x, y: window.maelstrom.world.player.y }));
    await rotCdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from[0], y: from[1], id: 1 }] });
    await rotCdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: to[0], y: to[1], id: 1 }] });
    await rot.waitForTimeout(500);
    await rotCdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const after = await rot.evaluate(() => ({ x: window.maelstrom.world.player.x, y: window.maelstrom.world.player.y }));
    return { dx: after.x - before.x, dy: after.y - before.y };
  };

  const up = await walk([206, 700], [140, 700]);
  check(
    'rotated: dragging toward the phone left walks the player up the world',
    up.dy < -15 && Math.abs(up.dx) < Math.abs(up.dy),
    `dx ${up.dx.toFixed(0)} dy ${up.dy.toFixed(0)}`,
  );

  const left = await walk([206, 700], [206, 830]);
  check(
    'rotated: dragging toward the phone bottom walks the player left',
    left.dx < -15 && Math.abs(left.dy) < Math.abs(left.dx),
    `dx ${left.dx.toFixed(0)} dy ${left.dy.toFixed(0)}`,
  );

  // The action half has to stay the action half: a press over there must not
  // grab the stick, which is precisely what a swapped axis would cause.
  const stuck = await rot.evaluate(() => Boolean(window.maelstrom.input.origin));
  check('rotated: the stick lets go', !stuck);

  await rot.screenshot({ path: join(SHOTS, '09-rotated.png') });

  // ---- the Screen tab
  await rot.locator('.nav-btn').click();
  await rot.waitForTimeout(250);
  await rot.locator('.tabs button[data-tab="screen"]').click();
  await rot.waitForTimeout(200);

  const steps = [];
  for (const label of ['Close', 'Normal', 'Wide']) {
    await rot.locator('.setchip', { hasText: label }).first().click();
    await rot.waitForTimeout(150);
    steps.push(await rot.evaluate(() => Math.round(window.maelstrom.renderer.view.width)));
  }
  check(
    'every view setting shows a different amount of world',
    new Set(steps).size === 3 && steps[0] < steps[1] && steps[1] < steps[2],
    steps.join(' -> '),
  );

  /*
   * The turn-direction row only appears when we are the ones turning the box.
   * When the device rotates itself there is nothing to choose, and offering the
   * choice anyway would invite the player to break a layout that was correct.
   */
  // Anchored, because "Turn the phone" is also the caption on the row above and
  // a loose match would find both.
  const turnRow = await rot.locator('.setrow', { hasText: /^Turn/ }).count();
  check('the turn-direction choice is offered while we are rotating', turnRow === 1);

  await rot.locator('.setchip', { hasText: 'Left' }).first().click();
  await rot.waitForTimeout(250);
  const flipped = await rot.evaluate(() => document.querySelector('#app').dataset.rot);
  check('flipping the turn direction turns the box the other way', flipped === 'ccw', String(flipped));

  // And switching it off gives the phone back to the player.
  await rot.locator('.setchip', { hasText: 'Off' }).first().click();
  await rot.waitForTimeout(300);
  const released = await rot.evaluate(() => {
    const app = document.querySelector('#app');
    const canvas = document.querySelector('#stage');
    return { rot: app.dataset.rot ?? null, backing: [canvas.width, canvas.height] };
  });
  check(
    'turning the setting off hands the phone back',
    released.rot === null && released.backing[1] > released.backing[0],
    JSON.stringify(released),
  );

  check('no uncaught errors in the rotated layout', rotErrors.length === 0, rotErrors.slice(0, 3).join(' | '));
  await rotatedContext.close();
}

// ---------------------------------------------------------------- the end

check('no uncaught page errors', errors.length === 0, errors.slice(0, 3).join(' | '));

await browser.close();
server.close();

const failed = checks.filter((c) => !c.ok);
console.log(`\n  ${checks.length - failed.length}/${checks.length} checks passed`);
console.log(`  screenshots in .verify/\n`);
if (failed.length) process.exit(1);
