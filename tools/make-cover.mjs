#!/usr/bin/env node
/**
 * Cover art generator.
 *
 * Runs `tools/cover/cover.ts` in a real browser and saves what it draws. A
 * browser rather than a node canvas because the art it reuses - drawIcon,
 * drawCreature, the sprite sheet - is written against a DOM canvas and is the
 * same code the game runs; reimplementing it for a second renderer is how the
 * cover would quietly stop matching the game.
 *
 * Nothing here ships. The page lives under tools/ rather than web/, so the Vite
 * build (root: web) never sees it and the service worker never precaches it.
 *
 * Run: npm run cover
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'docs', 'cover');
/*
 * 1024 is the committed size: every square use this is for - an itch cover, a
 * store icon, a social card, a portfolio tile - is at or below it, and the
 * art is gradient-heavy enough that 2048 costs 6MB a file to sit in a
 * repository and be downscaled by whatever displays it. Set COVER_SIZE for a
 * bigger master when something actually needs one; it is the same drawing at
 * any size, because none of it is a bitmap.
 */
const SIZE = Number(process.env.COVER_SIZE ?? 1024);

mkdirSync(OUT, { recursive: true });

const server = await createServer({
  root: ROOT,
  logLevel: 'error',
  resolve: { alias: { '@content': join(ROOT, 'content/generated') } },
  server: { port: 0, fs: { allow: [ROOT] } },
});
await server.listen();
const port = server.config.server.port ?? server.httpServer.address().port;
const url = `http://localhost:${port}/tools/cover/cover.html`;

const EXECUTABLE = '/opt/pw-browsers/chromium';
const browser = await chromium.launch(
  statSync(EXECUTABLE, { throwIfNoEntry: false }) ? { executablePath: EXECUTABLE } : {},
);
const page = await browser.newPage({ viewport: { width: 900, height: 900 } });

const problems = [];
page.on('pageerror', (e) => problems.push(String(e)));
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(m.text());
});
page.on('response', (r) => {
  if (r.status() >= 400) problems.push(`${r.status()} ${r.url()}`);
});

await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => typeof window.__drawCover === 'function', null, { timeout: 20000 });

const variants = [
  ['cover.png', true],
  ['cover-clean.png', false],
];

for (const [file, withTitle] of variants) {
  const dataUrl = await page.evaluate(
    async ([size, title]) => {
      const canvas = document.querySelector('#cover');
      await window.__drawCover(canvas, size, title);
      return canvas.toDataURL('image/png');
    },
    [SIZE, withTitle],
  );
  const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
  writeFileSync(join(OUT, file), bytes);
  console.log(`  ${file.padEnd(16)} ${SIZE}x${SIZE}  ${(bytes.length / 1024).toFixed(0)}KB`);
}

await browser.close();
await server.close();

if (problems.length) {
  console.error(`\n  cover FAILED - the page reported errors:\n    ${problems.slice(0, 5).join('\n    ')}\n`);
  process.exit(1);
}

console.log(`\n  cover art -> docs/cover/\n`);
