#!/usr/bin/env node
/**
 * Service worker generator.
 *
 * The asset filenames are content-hashed by Vite, so a hand-written precache
 * list goes stale the moment anything changes - and a stale precache list is
 * the worst kind, because the worker installs happily and then serves a page
 * whose script 404s. This reads the real build output instead.
 *
 * Written by hand rather than with a plugin because the whole thing is five
 * files and about 220KB: Workbox would be several times the size of the game
 * it was caching.
 *
 * Run: npm run build:sw (after the Vite build, which is what it reads).
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';

const DIST = resolve(import.meta.dirname, '../dist');

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const files = walk(DIST)
  .map((f) => relative(DIST, f).split('\\').join('/'))
  // The worker must never cache itself: a cached worker cannot be replaced,
  // and the app would be frozen at this version forever.
  .filter((f) => f !== 'sw.js')
  .sort();

if (!files.includes('index.html')) {
  console.error('\n  service worker FAILED - no index.html in dist/; run the Vite build first\n');
  process.exit(1);
}

/*
 * The cache name is a hash of the contents, not a version number anybody has to
 * remember to bump. Same bytes, same cache, no redownload; one byte different
 * and every client picks up the new one on its next visit.
 */
const digest = createHash('sha256');
for (const f of files) {
  digest.update(f);
  digest.update(readFileSync(join(DIST, f)));
}
const version = digest.digest('hex').slice(0, 12);

const sw = `/*
 * GENERATED FILE - do not edit. Source is tools/make-sw.mjs; it is rewritten on
 * every build from the real contents of dist/.
 */
const CACHE = 'maelstrom-${version}';
const ASSETS = ${JSON.stringify(files.map((f) => './' + f), null, 2)};

self.addEventListener('install', (event) => {
  // Take over immediately rather than waiting for every tab to close: this is
  // a single-page game, and "reload twice to get the update" is a bug report.
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  /*
   * Navigations fall back to the cached shell.
   *
   * Without this an installed app opened with no network shows the browser's
   * offline page, which is the single most common way a PWA that "has a
   * service worker" still fails the only test that matters.
   */
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('./index.html', { ignoreSearch: true })),
    );
    return;
  }

  // Everything else is cache-first with a quiet background refresh: the build
  // is content-hashed, so a cache hit is never the wrong version of anything.
  event.respondWith(
    caches.match(request, { ignoreSearch: true }).then((hit) => {
      const live = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => hit);
      return hit || live;
    }),
  );
});
`;

writeFileSync(join(DIST, 'sw.js'), sw);

const bytes = files.reduce((n, f) => n + statSync(join(DIST, f)).size, 0);
console.log(`  service worker written - ${files.length} files, ${(bytes / 1024).toFixed(0)}KB, cache maelstrom-${version}`);
