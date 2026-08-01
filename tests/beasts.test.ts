/**
 * Cards that are animals.
 *
 * The character pack the rest of the roster is drawn from is entirely
 * bipedal — its "wolf" is a wolf's head on a man's body, which is a werewolf.
 * So Elite Hounds, a card whose entire identity is that it is a pack of dogs,
 * shipped as a small armoured humanoid in a visor. Those cards are drawn from
 * quadruped sheets instead, by a second build.
 *
 * Two builds writing into one directory under the same names is the hazard
 * these tests exist for. If the humanoid build stops honouring the animal
 * list, it overwrites the hounds with people, every existing test still
 * passes, and the only way to find out is to look at the game.
 */

import { readFileSync, existsSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import '@cards/data';
import { selectableCards, getCard } from '@cards/registry';
import { MODELS } from '@render/models';
import { BEASTS } from '../scripts/beasts/recipe.mjs';

const ATLAS_DIR = new URL('../src/assets/characters/', import.meta.url);

/** Width and height straight out of a PNG header. */
function pngSize(path: URL): { width: number; height: number } {
  const buf = readFileSync(path);
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

describe('animal art', () => {
  it('draws Elite Hounds as an animal rather than as a person', () => {
    // The card that started this. Named explicitly, because "some card is an
    // animal" would still pass if this one quietly went back to a humanoid.
    expect(getCard('card_troop_elite_hounds').modelId).toBe('eliteHound');
    expect(Object.keys(BEASTS)).toContain('eliteHound');
  });

  it('names only models that exist', () => {
    for (const modelId of Object.keys(BEASTS)) {
      expect(MODELS[modelId], modelId).toBeDefined();
    }
  });

  it('is referenced by at least one selectable card each', () => {
    // An animal recipe for a model no card uses is art nobody will ever see,
    // and a build step nobody will notice breaking.
    const used = new Set(selectableCards().map((card) => card.modelId));
    for (const modelId of Object.keys(BEASTS)) {
      expect(used.has(modelId), modelId).toBe(true);
    }
  });

  it('ships an atlas in the same shape as the humanoid ones', () => {
    /*
     * The renderer reads one cell size and one frame count for every card. An
     * animal atlas built to a different grid would not fail to load — it would
     * load and be sliced wrongly, which looks like a rendering bug rather than
     * a build one.
     */
    const reference = new URL('knight.png', ATLAS_DIR);
    if (!existsSync(reference)) return; // atlases not built in this checkout
    const expected = pngSize(reference);
    for (const modelId of Object.keys(BEASTS)) {
      const path = new URL(`${modelId}.png`, ATLAS_DIR);
      expect(existsSync(path), `${modelId}.png missing`).toBe(true);
      expect(pngSize(path), modelId).toEqual(expected);
    }
  });

  it('keeps the humanoid build away from them', () => {
    /*
     * Both builds write `src/assets/characters/<modelId>.png`. The humanoid
     * one runs over the whole roster, so it has to consult this list and skip
     * — and the only durable way to check that is to read the source, since a
     * built atlas looks the same either way until you open it.
     */
    const source = readFileSync(new URL('../scripts/lpc/build.ts', import.meta.url), 'utf8');
    expect(source).toContain("from '../beasts/recipe.mjs'");
    expect(source).toMatch(/card\.modelId in BEASTS/);
  });
});
