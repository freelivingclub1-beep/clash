/**
 * Download the Universal LPC asset release the character atlases are built
 * from. Run once before `npm run assets:characters`.
 *
 * Kept separate from the build so the 143MB download is not repeated, and so
 * the exact upstream release is recorded in one place — see
 * `src/assets/characters/CREDITS.md` for licensing, which is not optional.
 */

import { mkdirSync, createWriteStream, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const RELEASE =
  'https://github.com/ochowei/Universal-LPC-Spritesheet-Character-Generator/releases/download/assets-v2026.06.05-initial';
const DEST = process.env.LPC_ROOT ?? '/tmp/lpc';
const TARBALL = `${DEST}/lpc-runtime-zips.tar.gz`;

mkdirSync(DEST, { recursive: true });

if (existsSync(`${DEST}/lpc-runtime-zips/zips/body.zip`)) {
  console.log('assets already present at', DEST);
  process.exit(0);
}

console.log('downloading LPC assets (~143MB)…');
const response = await fetch(`${RELEASE}/lpc-runtime-zips.tar.gz`);
if (!response.ok) throw new Error(`download failed: ${response.status}`);
await pipeline(Readable.fromWeb(response.body), createWriteStream(TARBALL));

console.log('extracting…');
execFileSync('tar', ['-xzf', TARBALL, '-C', DEST], { stdio: 'inherit' });
console.log('ready at', `${DEST}/lpc-runtime-zips/zips`);
