/**
 * Download the quadruped animal sprites.
 *
 * From Stendhal, whose art the project distributes under the GNU GPL version 2
 * or later — the "or later" is what matters here, because it means these
 * combine cleanly with the GPL-3 subset of the LPC pack the rest of the
 * figures come from. Attribution and licensing are recorded in
 * `src/assets/characters/CREDITS.md`, which is not optional.
 *
 * A handful more sheets than the recipe currently uses, deliberately: they
 * cost a few kilobytes in a temp directory and having them on disk is the
 * difference between "add an animal card" being a one-line change and being
 * another round of hunting for art.
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';

const BASE = 'https://raw.githubusercontent.com/arianne/stendhal/master/data/sprites/monsters';
const DEST = process.env.BEAST_DIR ?? '/tmp/beasts';

const SHEETS = {
  wolf: 'animal/wolf.png',
  fox: 'animal/fox.png',
  bear: 'animal/bear.png',
  black_bear: 'animal/black_bear.png',
  boar: 'animal/boar.png',
  tiger: 'animal/tiger.png',
  lion: 'animal/lion.png',
  deer: 'animal/deer.png',
  ghosthound: 'undead/ghosthound.png',
};

mkdirSync(DEST, { recursive: true });

for (const [name, path] of Object.entries(SHEETS)) {
  const file = `${DEST}/${name}.png`;
  if (existsSync(file)) {
    console.log(`${name} already present`);
    continue;
  }
  const res = await fetch(`${BASE}/${path}`);
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  const body = Buffer.from(await res.arrayBuffer());
  writeFileSync(file, body);
  console.log(`${name} ${body.length}`);
}

console.log(`fetched ${Object.keys(SHEETS).length} animal sheets to ${DEST}`);
