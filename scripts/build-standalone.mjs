/**
 * Bundle the game into a single self-contained HTML file.
 *
 * `npm run dev` needs Node and a terminal. This produces one file you can
 * double-click, host anywhere, or drop into a page that forbids external
 * requests — every script, style and asset is inlined, and the game makes no
 * network requests at runtime anyway because all of its art is generated
 * procedurally.
 *
 * Two outputs, from the same bundle:
 *   dist/clash.html     a complete document, for opening directly
 *   dist/clash-body.html   the same content without <html>/<head>/<body>, for
 *                          embedding in a host that supplies its own shell
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');

console.log('Building…');
execFileSync('npx', ['vite', 'build'], { cwd: root, stdio: 'inherit' });

const assetDir = join(dist, 'assets');
if (!existsSync(assetDir)) throw new Error('No dist/assets directory — did the build run?');

const assets = readdirSync(assetDir);
const jsFile = assets.find((f) => f.endsWith('.js'));
const cssFile = assets.find((f) => f.endsWith('.css'));
if (!jsFile) throw new Error('No bundled JavaScript found in dist/assets');

const js = readFileSync(join(assetDir, jsFile), 'utf8');
const css = cssFile ? readFileSync(join(assetDir, cssFile), 'utf8') : '';

/**
 * `</script>` anywhere inside the bundle would close the tag early. Splitting
 * the sequence is the standard, and only reliable, way to inline arbitrary JS.
 */
const inlineSafe = (code) => code.replace(/<\/script>/gi, '<\\/script>');

const body = `<style>
${css}
</style>
<div id="root"></div>
<script type="module">
${inlineSafe(js)}
</script>
`;

const full = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover"
    />
    <meta name="theme-color" content="#12161f" />
    <title>Clash — Arena Battle</title>
  </head>
  <body>
${body}
  </body>
</html>
`;

writeFileSync(join(dist, 'clash.html'), full);
writeFileSync(join(dist, 'clash-body.html'), body);

const kb = (s) => `${Math.round(s.length / 1024)} kB`;
console.log(`\nWrote dist/clash.html       (${kb(full)}, self-contained)`);
console.log(`Wrote dist/clash-body.html  (${kb(body)}, no document shell)`);
