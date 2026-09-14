#!/usr/bin/env node
/**
 * Bundles the production build into ONE self-contained HTML file, for hosts
 * that serve a single page rather than a directory (a Claude Artifact, an email
 * attachment, a USB stick, a phone's Files app).
 *
 * The game has no runtime dependencies and no binary assets in its critical
 * path, so everything genuinely fits inline: CSS in a <style>, the ES module in
 * a <script type="module">, the favicon as a data: URI.
 *
 * Emits body-level markup only - no <!doctype>, <html>, <head> or <body> - so
 * the output can be dropped straight into a host that supplies its own shell.
 *
 * Run: npm run build:single   (expects `npm run build` to have run first)
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const OUT = join(DIST, 'maelstrom-single.html');

const assets = readdirSync(join(DIST, 'assets'));
const cssFile = assets.find((f) => f.endsWith('.css'));
const jsFile = assets.find((f) => f.endsWith('.js'));

if (!cssFile || !jsFile) {
  console.error('  No built assets in dist/assets. Run `npm run build` first.');
  process.exit(1);
}

const css = readFileSync(join(DIST, 'assets', cssFile), 'utf8');
const js = readFileSync(join(DIST, 'assets', jsFile), 'utf8');

// A literal </script> anywhere in the bundle would close the tag early. Vite's
// output shouldn't contain one, but a string literal in future content could.
const guard = (code) => code.replace(/<\/script>/gi, '<\\/script>');

const html = `<title>Project Maelstrom</title>
<style>
${css}
</style>

<div id="app">
  <canvas id="stage"></canvas>
  <div id="ui"></div>
</div>

<script type="module">
${guard(js)}
</script>
`;

writeFileSync(OUT, html);

const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
console.log(`\n  single-file build -> dist/maelstrom-single.html`);
console.log(`    css ${kb(css.length)}  +  js ${kb(js.length)}  =  ${kb(html.length)} total\n`);
