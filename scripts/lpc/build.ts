/**
 * Build a Universal LPC character atlas for every card.
 *
 * Run with `npm run assets:characters` after `npm run assets:fetch`.
 *
 * The recipe for each card is derived from the model it already had, so the
 * identity established by the procedural figures survives the swap: a card
 * whose silhouette was `brute` becomes a troll, a `wraith` becomes a skeleton,
 * a `hulking` build gets plate and a `gaunt` one gets bandages. Nothing is
 * hand-assigned per card, which means a card added tomorrow gets art for free.
 *
 * Two atlases per card, one per side. Team colour is a sash the unit actually
 * wears rather than a tint applied over the top — LPC ships the waist sash in
 * both blue and red, and a garment reads as belonging to the figure in a way
 * that a colour wash never does.
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import '../../src/cards/data';
import { selectableCards } from '../../src/cards/registry';
import { MODELS } from '../../src/render/models';
import type { BodyPlan, BuildKind, WeaponKind } from '../../src/render/models';
import { readSheet, listEntries, composeAtlas, encode, type Layer } from './compose.mjs';

const SRC = process.env.LPC_DIR ?? '/tmp/lpc/lpc-runtime-zips/zips';
const OUT = 'src/assets/characters';

/*
 * Fewer frames than LPC ships.
 *
 * The walk cycle is nine frames and the slash six; taking every other walk
 * frame and two thirds of the slash costs very little, because the renderer
 * samples the phase continuously and interpolates position between ticks
 * anyway. It costs a third of the payload, which is the difference between a
 * build that can be published and one that cannot.
 */
const WALK_FRAMES = 6;
const STRIKE_FRAMES = 4;
const WALK_STRIDE = 9 / WALK_FRAMES;
const STRIKE_STRIDE = 6 / STRIKE_FRAMES;

// --- recipe --------------------------------------------------------------

/** Body frame. LPC has no "huge" body, so heft comes from muscular + armour. */
const BODY_BY_BUILD: Record<BuildKind, string> = {
  normal: 'male',
  lean: 'male',
  gaunt: 'skeleton',
  stout: 'muscular',
  hulking: 'muscular',
  squat: 'child',
  towering: 'male',
  tiny: 'child',
  broad: 'muscular',
};

/**
 * Species by body plan.
 *
 * This is where most of the visible variety comes from, so it follows the
 * silhouette the card already had rather than its name — the plan was chosen
 * to make cards distinguishable and that work should not be thrown away.
 */
const HEAD_BY_PLAN: Record<BodyPlan, string> = {
  humanoid: 'human/male',
  brute: 'troll/adult',
  golem: 'frankenstein/adult',
  winged: 'jack/adult',
  serpent: 'lizard/male',
  mech: 'alien/adult',
  orb: 'alien/adult',
  insect: 'mouse/adult',
  shelled: 'boarman/adult',
  wraith: 'skeleton/adult',
  quadruped: 'wolf/male',
  structure: 'human/male',
  cart: 'goblin/adult',
  centaur: 'wartotaur/adult',
  floating: 'vampire/adult',
  totem: 'sheep/adult',
  tripod: 'rat/adult',
  blob: 'pig/adult',
  crystal: 'zombie/adult',
  swarm: 'goblin/adult',
  siege: 'orc/male',
  hunched: 'minotaur/male',
  twinned: 'rabbit/adult',
};

/**
 * Garment by build. These are real directories in the pack — LPC nests
 * clothing two levels deep (`clothes/longsleeve/longsleeve/male/`) rather than
 * one, and naming the category alone silently resolves to nothing, which is
 * how the first run produced a roster of bare-chested units.
 */
const TORSO_BY_BUILD: Record<BuildKind, string> = {
  normal: 'clothes/longsleeve/longsleeve/male',
  lean: 'clothes/shortsleeve/tshirt/male',
  gaunt: 'bandage/male',
  stout: 'armour/leather/male',
  hulking: 'armour/plate/male',
  squat: 'clothes/sleeveless/sleeveless/male',
  towering: 'clothes/longsleeve/formal/male',
  tiny: 'clothes/shortsleeve/shortsleeve/male',
  broad: 'armour/legion/male',
};

const WEAPON_BY_KIND: Record<WeaponKind, string | null> = {
  sword: 'sword/arming',
  hammer: 'blunt/mace',
  axe: 'blunt/waraxe',
  bow: 'ranged/bow',
  staff: 'magic/gnarled',
  spear: 'polearm/spear',
  claws: null,
  cannon: 'ranged/crossbow',
  dagger: 'sword/dagger',
  drill: 'polearm/trident',
  bomb: null,
  lantern: 'magic/crystal',
  scythe: 'polearm/scythe',
  none: null,
};

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/**
 * Find an animation sheet under a directory.
 *
 * LPC does not use one path shape. A layer may be `X/walk.png`, or
 * `X/walk/<colour>.png`, or `X/universal/walk/foreground/<metal>.png`, and
 * which of those applies varies per garment and per weapon. Rather than encode
 * every shape, search the zip for anything under the directory belonging to
 * this animation and take the first sensible match.
 *
 * `behind` and `background` variants are the halves LPC draws *under* the
 * body for certain facings; taking one of those on its own yields a weapon
 * with no blade, so they are skipped in favour of the foreground sheet.
 */
const entryCache = new Map<string, string[]>();

function entriesUnder(zip: string, dir: string): string[] {
  const key = `${zip}|${dir}`;
  let list = entryCache.get(key);
  if (!list) {
    list = listEntries(SRC, zip, dir);
    entryCache.set(key, list);
  }
  return list;
}

function findSheet(zip: string, dir: string, anim: string, seed: number) {
  const all = entriesUnder(zip, dir).filter((p) => p.includes(`/${anim}`) || p.endsWith(`${anim}.png`));
  if (all.length === 0) return null;
  const front = all.filter((p) => !p.includes('behind') && !p.includes('background'));
  const pool = front.length > 0 ? front : all;
  return readSheet(SRC, zip, pool[seed % pool.length]);
}

function layerFor(
  zip: string,
  dirs: string[],
  strikeAnims: string[],
  seed: number,
): Layer | null {
  for (const dir of dirs) {
    const walk = findSheet(zip, dir, 'walk', seed);
    let slash = null;
    for (const anim of strikeAnims) {
      slash = findSheet(zip, dir, anim, seed);
      if (slash) break;
    }
    if (walk || slash) return { walk, slash };
  }
  return null;
}

/**
 * Pick the sash sheet whose filename is the team colour.
 *
 * The generic search takes the first match under a directory, which for a
 * garment with twenty-four colour variants would hand out an arbitrary one —
 * and the sash is the only thing on the figure telling you whose side it is.
 */
function sashIndex(zip: string, dir: string, anim: string, colour: string): number {
  const all = entriesUnder(zip, dir).filter((p) => p.includes(`/${anim}`));
  const want = all.findIndex((p) => p.endsWith(`/${colour}.png`));
  return want >= 0 ? want : 0;
}

function build(): void {
  mkdirSync(OUT, { recursive: true });
  const cards = selectableCards().filter((c) => c.category !== 'Spell' && c.modelId);
  const manifest: Record<string, string> = {};
  let made = 0;
  let missing = 0;

  for (const card of cards) {
    const spec = MODELS[card.modelId];
    if (!spec) continue;

    const bodyDir = BODY_BY_BUILD[spec.build] ?? 'male';
    // Skeleton and zombie bodies keep their own single-file naming.
    const bodyPlain = bodyDir === 'skeleton' || bodyDir === 'zombie';
    const head = HEAD_BY_PLAN[spec.body] ?? 'human/male';
    const torso = TORSO_BY_BUILD[spec.build] ?? 'clothes/longsleeve';
    const weapon = WEAPON_BY_KIND[spec.weapon];
    const sexDir = bodyDir === 'child' ? 'child' : 'male';

    for (const [team, sash] of [
      [0, 'blue'],
      [1, 'red'],
    ] as const) {
      const layers: Layer[] = [];
      const seed = hash(card.id);
      const push = (l: Layer | null) => {
        if (l) layers.push(l);
      };

      push(
        layerFor(
          'body',
          bodyPlain ? [`bodies/${bodyDir}/`] : [`bodies/${bodyDir}/`, 'bodies/male/'],
          ['slash'],
          seed,
        ),
      );
      push(layerFor('head', [`heads/${head}/`, 'heads/human/male/'], ['slash'], seed));
      push(layerFor('legs', [`pantaloons/${sexDir}/`, 'pantaloons/male/'], ['slash'], seed));
      push(
        layerFor(
          'torso',
          [`${torso}/`, 'clothes/longsleeve/longsleeve/male/', 'chainmail/male/'],
          ['slash'],
          seed,
        ),
      );
      // The team sash goes over the torso so armour can never hide it, and it
      // is resolved by colour rather than by the generic search — it is the
      // only thing on the figure that says whose side this unit is on.
      push(
        layerFor(
          'torso',
          [`waist/sash/${sexDir}/`, 'waist/sash/male/'],
          ['slash'],
          sashIndex('torso', `waist/sash/${sexDir}/`, 'walk', sash),
        ),
      );
      if (weapon) {
        push(layerFor('weapon', [`${weapon}/`], ['attack_slash', 'slash'], seed));
      }

      if (layers.length === 0) {
        missing++;
        continue;
      }

      const atlas = composeAtlas({
        layers,
        walkFrames: WALK_FRAMES,
        strikeFrames: STRIKE_FRAMES,
        strikeAnim: 'slash',
        walkStride: WALK_STRIDE,
        strikeStride: STRIKE_STRIDE,
      });
      const file = `${card.modelId}_${team}.png`;
      writeFileSync(`${OUT}/${file}`, encode(atlas));
      manifest[`${card.modelId}|${team}`] = file;
      made++;
    }
  }

  writeFileSync(
    `${OUT}/manifest.json`,
    JSON.stringify({ walkFrames: WALK_FRAMES, strikeFrames: STRIKE_FRAMES, files: manifest }, null, 1),
  );
  console.log(`wrote ${made} atlases for ${cards.length} cards (${missing} skipped)`);
  if (!existsSync(`${OUT}/manifest.json`)) throw new Error('manifest not written');
}

build();
