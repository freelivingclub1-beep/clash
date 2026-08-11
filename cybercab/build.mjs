/**
 * Bundles the configurator into one self-contained HTML file.
 *
 * `index.html` runs straight from disk with no build step at all -- an import
 * map points "three" at the vendored copy and the browser does the rest. This
 * script exists for the other case: handing someone a single file, or hosting
 * under a strict CSP that refuses separate script and style requests.
 *
 *   node build.mjs            -> dist/cybercab.html
 *   node build.mjs --fragment -> dist/cybercab.fragment.html
 *
 * The fragment output is the same page without the document wrapper, for hosts
 * that supply their own <head> and inject the body.
 */

import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, 'dist', 'cybercab.html');

const bundle = await build({
  entryPoints: [path.join(here, 'src', 'main.js')],
  bundle: true,
  format: 'esm',
  minify: true,
  legalComments: 'none',
  write: false,
  // The import map only exists in index.html, so the bundler needs the same
  // mapping spelled out.
  alias: { three: path.join(here, 'vendor', 'three', 'three.module.min.js') },
  target: ['es2022'],
});

const js = bundle.outputFiles[0].text;
const css = await fs.readFile(path.join(here, 'styles.css'), 'utf8');
const html = await fs.readFile(path.join(here, 'index.html'), 'utf8');

// Keep the markup as the single source of truth: lift the body out of
// index.html rather than maintaining a second copy of it here.
// Drop the dev entry point: the bundle inlines it below, and leaving the tag
// in makes every page load fire a 404 for a file that isn't shipped.
const body = html
  .slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
  .replace(/\s*<script\b[^>]*\bsrc=[^>]*><\/script>/g, '');
const title = (html.match(/<title>([^<]*)<\/title>/) ?? [, 'Cybercab'])[1];

const inner = `<title>${title}</title>
<style>${css}</style>
${body}
<script type="module">${js}</script>
`;

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
${inner}</html>
`;

const fragment = process.argv.includes('--fragment');
const target = fragment ? out.replace(/\.html$/, '.fragment.html') : out;
const contents = fragment ? inner : page;

await fs.mkdir(path.dirname(out), { recursive: true });
await fs.writeFile(target, contents);
console.log(`${target}  ${(contents.length / 1024).toFixed(0)} kB`);
