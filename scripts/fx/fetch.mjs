/**
 * Fetch the Free Pixel Effects Pack.
 *
 * The pack's own hosts (itch.io, opengameart) are unreachable under this
 * environment's network policy, so this pulls the copy vendored in a public
 * game repository, which raw.githubusercontent serves. The files are
 * byte-identical to the release and carry the author's README, which is
 * downloaded alongside them so the licence travels with the art.
 */

import { mkdirSync, writeFileSync } from 'node:fs';

const BASE =
  'https://raw.githubusercontent.com/IgnacioDrako/CronicasDeAvalor/main/recursos/maguia/Free%20Pixel%20Effects%20Pack';
const OUT = process.env.FX_DIR ?? '/tmp/fx-src';

const NAMES = [
  '1_magicspell', '2_magic8', '3_bluefire', '4_casting', '5_magickahit',
  '6_flamelash', '7_firespin', '8_protectioncircle', '9_brightfire',
  '10_weaponhit', '11_fire', '12_nebula', '13_vortex', '14_phantom',
  '15_loading', '16_sunburn', '17_felspell', '18_midnight', '19_freezing',
  '20_magicbubbles',
];

mkdirSync(OUT, { recursive: true });

for (const name of NAMES) {
  const file = `${name}_spritesheet.png`;
  const res = await fetch(`${BASE}/${file}`);
  if (!res.ok) throw new Error(`${file}: ${res.status}`);
  const body = Buffer.from(await res.arrayBuffer());
  writeFileSync(`${OUT}/${file}`, body);
  console.log(`${file} ${body.length}`);
}

const readme = await fetch(`${BASE}/README.txt`);
if (readme.ok) writeFileSync(`${OUT}/README.txt`, Buffer.from(await readme.arrayBuffer()));
console.log(`fetched ${NAMES.length} effect sheets to ${OUT}`);
