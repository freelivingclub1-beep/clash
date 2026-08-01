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
 * One atlas per model, not one per side. Team used to be a coloured sash baked
 * into the art, which doubled the payload for a detail three pixels wide; the
 * renderer now puts a coloured ring on the ground under the unit, which is both
 * the convention of the genre and readable at arm's length on a phone. The
 * sash stayed — it just varies per card now, as one more axis of variety.
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import '../../src/cards/data';
import { selectableCards } from '../../src/cards/registry';
import { MODELS } from '../../src/render/models';
import type { BodyPlan, BuildKind, ModelSpec, WeaponKind } from '../../src/render/models';
import { readSheet, listEntries, composeAtlas, encode, type Layer } from './compose.mjs';

const SRC = process.env.LPC_DIR ?? '/tmp/lpc/lpc-runtime-zips/zips';
const OUT = 'src/assets/characters';

/*
 * Fewer frames than LPC ships.
 *
 * The walk cycle is nine frames and the slash six; sampling six and four of
 * them across the full cycle costs very little, because the renderer samples
 * the phase continuously and interpolates position between ticks anyway. It
 * costs a third of the payload, which is the difference between a build that
 * can be published and one that cannot.
 */
const WALK_FRAMES = 6;
const STRIKE_FRAMES = 4;

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

/** Footwear by build, so a plated brute is not barefoot next to a scout. */
const FEET_BY_BUILD: Record<BuildKind, string> = {
  normal: 'boots/basic/male',
  lean: 'boots/revised/thin',
  gaunt: 'sandals/thin',
  stout: 'boots/fold/male',
  hulking: 'armour/plate/male',
  squat: 'boots/rimmed/male',
  towering: 'boots/revised/male',
  tiny: 'sandals/male',
  broad: 'accessory/plate_toe_thick/male',
};

/**
 * Weapons by kind — a pool per kind, not one entry.
 *
 * The pack holds thirty-odd weapons and the first build used ten of them, so
 * every card that swung a sword swung the same arming sword. Picking from a
 * pool by model id costs nothing and means a rank of swordsmen is a rank of
 * different swordsmen. `_off` variants (an unlit staff) are left out: they are
 * the same prop with its glow switched off, which is not variety.
 */
const WEAPONS_BY_KIND: Record<WeaponKind, readonly string[]> = {
  sword: [
    'sword/arming', 'sword/longsword', 'sword/katana', 'sword/saber',
    'sword/scimitar', 'sword/rapier', 'sword/glowsword',
  ],
  hammer: ['blunt/mace', 'blunt/club', 'blunt/flail'],
  axe: ['blunt/waraxe'],
  bow: ['ranged/bow', 'ranged/slingshot', 'ranged/boomerang'],
  staff: ['magic/gnarled', 'magic/wand', 'magic/diamond', 'magic/s', 'magic/simple'],
  spear: ['polearm/spear', 'polearm/longspear', 'polearm/halberd', 'polearm/dragonspear'],
  claws: [],
  cannon: ['ranged/crossbow'],
  dagger: ['sword/dagger'],
  drill: ['polearm/trident'],
  bomb: [],
  lantern: ['magic/crystal', 'magic/loop'],
  scythe: ['polearm/scythe', 'polearm/cane'],
  none: [],
};

/**
 * How each weapon is used, and therefore which animation the whole figure
 * plays when it attacks.
 *
 * This is not cosmetic bookkeeping. LPC authors a weapon only for the motion
 * it belongs to: a bow ships `shoot` and no `slash`, a spear ships `thrust`
 * and no `slash`. Composing every card's strike as a slash meant the body
 * swung while the weapon — having no slash frames — simply disappeared, so
 * every archer, mage and spearman attacked empty-handed. Choosing the motion
 * per weapon and applying it to every layer keeps the figure and its weapon in
 * the same animation, and makes an archer visibly draw a bow.
 */
const STRIKE_BY_KIND: Record<WeaponKind, string> = {
  sword: 'attack_slash',
  hammer: 'attack_slash',
  axe: 'attack_slash',
  bow: 'shoot',
  staff: 'thrust',
  spear: 'thrust',
  claws: 'slash',
  cannon: 'thrust',
  dagger: 'slash',
  drill: 'thrust',
  bomb: 'slash',
  lantern: 'thrust',
  scythe: 'attack_slash',
  none: 'slash',
};

/**
 * Short styles, for figures already wearing a helm or a hood.
 *
 * The alternative was no hair at all, which turned every plated unit into a
 * bare scalp — worse than the problem it solved.
 */
const SHORT_HAIR = [
  'balding', 'buzzcut', 'bangsshort', 'cornrows', 'curly_short', 'flat_top_fade',
  'flat_top_straight', 'high_and_tight', 'messy1', 'mop', 'page', 'pixie',
  'plain', 'relm_short', 'shorthawk', 'twists_fade', 'unkempt',
];

/**
 * Animations to try for a layer, in order, given the motion we want.
 *
 * Not every body has every animation — the muscular frame has no `shoot` and
 * the child frame has neither `thrust` nor `shoot` — so a strict lookup would
 * blank out exactly the layers that matter most. Falling back through the
 * other combat motions and finally to the walk pose guarantees every layer
 * contributes something, so a unit is never partly invisible mid-swing.
 */
function strikeChain(want: string): string[] {
  const base = want === 'attack_slash' ? ['attack_slash', 'slash'] : [want];
  return [...base, 'slash', 'thrust', 'shoot', 'walk'].filter(
    (a, i, all) => all.indexOf(a) === i,
  );
}

/**
 * Hair, ears, horns, wings and tails — the whole second half of the pack,
 * which the first build left untouched.
 *
 * These are what stop a roster of eighty humanoids reading as eighty copies of
 * one man. A style is picked by hashing the model id, so it is stable across
 * builds and spread evenly across the roster without anybody assigning it.
 */
const HAIR_STYLES = [
  'afro', 'balding', 'bangs', 'bangslong', 'bedhead', 'bob', 'braid', 'braid2',
  'bunches', 'buzzcut', 'cornrows', 'cowlick', 'curls_large',
  'curly_long', 'curly_short', 'curtains', 'dreadlocks_long', 'dreadlocks_short',
  'flat_top_straight', 'half_up', 'halfmessy', 'high_and_tight', 'high_ponytail',
  'jewfro', 'lob', 'long', 'long_messy', 'long_straight',
  'loose', 'messy1', 'messy2', 'messy3', 'mop', 'natural', 'page', 'parted',
  'parted2', 'pigtails', 'pixie', 'plain', 'ponytail', 'ponytail2',
  'relm_short', 'sara', 'shorthawk', 'shoulderl', 'single',
  'spiked', 'spiked2', 'swoop', 'twists_fade', 'unkempt', 'wavy',
];
/*
 * `spiked_liberty`, `spiked_beehive`, `cowlick_tall`, `longhawk`, `idol`,
 * `princess`, `xlong` and `relm_xlong` are deliberately absent. They are fine
 * styles, but each stands a head's height above the skull, and at the size a
 * unit is actually drawn the hair became the silhouette — a knight read as an
 * orange bonfire with legs. Silhouette is the thing telling you what you are
 * looking at in a scrum, so it belongs to the body, not the haircut.
 */

/** Heads that read as bald humanoids, and so want hair. */
const HAIRED_SPECIES = ['human', 'goblin', 'orc', 'vampire', 'zombie', 'frankenstein', 'elf'];

/** Builds whose garment is a helmet-and-plate set; long hair over it reads wrong. */
const HELMETED = new Set<BuildKind>(['hulking', 'broad']);

const EAR_STYLES = ['big', 'elven', 'long', 'medium', 'down', 'hang'];
const HORN_STYLES = ['backwards', 'curled'];
const WING_STYLES = ['bat', 'dragonfly', 'feathered', 'lizard', 'lunar', 'monarch', 'pixie'];
const TAIL_STYLES = ['cat', 'fluffy', 'lizard', 'wolf'];

/** Sash colours, now a per-card accent rather than a team marker. */
const SASH_COLOURS = [
  'forest', 'rose', 'sky', 'slate', 'red', 'teal', 'lavender', 'bluegray',
  'navy', 'yellow', 'orange', 'green', 'purple', 'maroon', 'tan', 'walnut',
  'pink', 'charcoal', 'white', 'brown', 'leather', 'gray', 'black', 'blue',
];

/** Body plans that trail something behind them. */
const TAILED_PLANS = new Set<BodyPlan>(['serpent', 'quadruped', 'insect', 'brute', 'shelled']);

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

/** A stable per-model index into a list, varied by `salt` so two accessories
 *  on the same model do not both land on entry zero. */
function pick<T>(list: readonly T[], id: string, salt: string): T {
  return list[hash(`${id}|${salt}`) % list.length];
}

/**
 * Find an animation sheet under a directory.
 *
 * LPC does not use one path shape. A layer may be `X/walk.png`, or
 * `X/walk/<colour>.png`, or `X/universal/walk/foreground/<metal>.png`, and
 * which of those applies varies per garment and per weapon. Rather than encode
 * every shape, search the zip for anything under the directory belonging to
 * this animation and take the first sensible match.
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

/** The halves LPC draws *behind* the body, by the several names it uses. */
const BEHIND = /(behind|background|\/bg\b|\/bg\/|_behind)/;

type Half = 'front' | 'behind';

/**
 * Sheets that are not part of the figure.
 *
 * A bow directory ships the arrow it fires as a sibling animation. Composited
 * into the character atlas it becomes a white bar standing beside the archer
 * in every strike frame — the projectile is the renderer's job, not the
 * portrait's.
 */
const NOT_WORN = /(\/arrow\/|\/bolt\/|\/ammo\/|\/projectile\/)/;

function findSheet(zip: string, dir: string, anim: string, seed: number, half: Half) {
  const all = entriesUnder(zip, dir).filter(
    (p) => (p.includes(`/${anim}`) || p.endsWith(`${anim}.png`)) && !NOT_WORN.test(p),
  );
  if (all.length === 0) return null;
  const wanted = all.filter((p) => (BEHIND.test(p) ? half === 'behind' : half === 'front'));
  if (wanted.length === 0) return null;
  return readSheet(SRC, zip, wanted[seed % wanted.length]);
}

/** True when a directory holds art for an animation at all. */
function supports(zip: string, dir: string, anim: string): boolean {
  return entriesUnder(zip, dir).some((p) => p.includes(`/${anim}`) || p.endsWith(`${anim}.png`));
}

function layerFor(
  zip: string,
  dirs: string[],
  strikeAnims: readonly string[],
  seed: number,
  half: Half = 'front',
): Layer | null {
  for (const dir of dirs) {
    const walk = findSheet(zip, dir, 'walk', seed, half);
    let slash = null;
    let slashAnim = 'slash';
    for (const anim of strikeAnims) {
      slash = findSheet(zip, dir, anim, seed, half);
      if (slash) {
        slashAnim = anim;
        break;
      }
    }
    if (walk || slash) return { walk, slash, slashAnim };
  }
  return null;
}

/**
 * The one motion a model attacks with.
 *
 * Picked once for the whole figure rather than per layer, because a per-layer
 * fallback lets the parts diverge: a skeleton body has no `shoot`, so an
 * archer built from one had its body fall back to a slash while its bow found
 * real shoot frames — the two played different animations on top of each
 * other and the result read as a glitch. Agreeing on a motion the body and the
 * weapon both have keeps the figure whole, even when that means a mage jabs
 * with a staff instead of casting.
 */
function agreedStrike(bodyDir: string, weapon: string | null, wanted: string): string[] {
  const bodyPath = `bodies/${bodyDir}/`;
  const order = strikeChain(wanted);
  for (const anim of order) {
    if (anim === 'walk') break;
    if (!supports('body', bodyPath, anim)) continue;
    if (weapon && !supports('weapon', `${weapon}/`, anim)) continue;
    return [anim, ...order.filter((a) => a !== anim)];
  }
  return order;
}

/**
 * Pick the sash sheet whose filename is the wanted colour.
 *
 * The generic search takes an arbitrary match under a directory, which for a
 * garment with twenty-four colour variants would hand out whichever one the
 * zip happens to list first — so every card would wear the same one.
 */
function colourIndex(zip: string, dir: string, anim: string, colour: string): number {
  const all = entriesUnder(zip, dir).filter((p) => p.includes(`/${anim}`));
  const want = all.findIndex((p) => p.endsWith(`/${colour}.png`));
  return want >= 0 ? want : 0;
}

/** Assemble the full stack for one model, ordered back to front. */
function layersFor(modelId: string, spec: ModelSpec): Layer[] {
  const layers: Layer[] = [];
  const seed = hash(modelId);
  const push = (l: Layer | null) => {
    if (l) layers.push(l);
  };

  const bodyDir = BODY_BY_BUILD[spec.build] ?? 'male';
  const bodyPlain = bodyDir === 'skeleton' || bodyDir === 'zombie';
  const head = HEAD_BY_PLAN[spec.body] ?? 'human/male';
  const species = head.split('/')[0];
  const torso = TORSO_BY_BUILD[spec.build] ?? 'clothes/longsleeve/longsleeve/male';
  const feet = FEET_BY_BUILD[spec.build] ?? 'boots/basic/male';
  const pool = WEAPONS_BY_KIND[spec.weapon] ?? [];
  const weapon = pool.length > 0 ? pick(pool, modelId, 'weapon') : null;
  const sexDir = bodyDir === 'child' ? 'child' : 'male';
  const strike = agreedStrike(bodyDir, weapon, STRIKE_BY_KIND[spec.weapon] ?? 'slash');

  // --- behind the body ---------------------------------------------------
  if (weapon) push(layerFor('weapon', [`${weapon}/`], strike, seed, 'behind'));
  if (TAILED_PLANS.has(spec.body)) {
    const tail = pick(TAIL_STYLES, modelId, 'tail');
    push(layerFor('body', [`tail/${tail}/`], strike, seed));
  }
  if (spec.accessory === 'wings') {
    const wing = pick(WING_STYLES, modelId, 'wings');
    push(layerFor('body', [`wings/${wing}/`], strike, seed, 'behind'));
  }

  // --- the figure --------------------------------------------------------
  push(
    layerFor(
      'body',
      bodyPlain ? [`bodies/${bodyDir}/`] : [`bodies/${bodyDir}/`, 'bodies/male/'],
      strike,
      seed,
    ),
  );
  push(layerFor('head', [`heads/${head}/`, 'heads/human/male/'], strike, seed));

  if (spec.head === 'horned') {
    push(layerFor('head', [`horns/${pick(HORN_STYLES, modelId, 'horns')}/`], strike, seed));
  } else if (HAIRED_SPECIES.includes(species)) {
    push(layerFor('head', [`ears/${pick(EAR_STYLES, modelId, 'ears')}/`], strike, seed));
  }
  if (HAIRED_SPECIES.includes(species)) {
    const styles = HELMETED.has(spec.build) ? SHORT_HAIR : HAIR_STYLES;
    const style = pick(styles, modelId, 'hair');
    push(layerFor('hair', [`${style}/adult/`, `${style}/`], strike, hash(`${modelId}|hue`)));
  }

  push(layerFor('legs', [`pantaloons/${sexDir}/`, 'pantaloons/male/'], strike, seed));
  push(layerFor('feet', [`${feet}/`, 'boots/basic/male/'], strike, seed));
  push(
    layerFor(
      'torso',
      [`${torso}/`, 'clothes/longsleeve/longsleeve/male/', 'chainmail/male/'],
      strike,
      seed,
    ),
  );

  // The sash goes over the torso so armour can never hide it.
  const sash = pick(SASH_COLOURS, modelId, 'sash');
  push(
    layerFor(
      'torso',
      [`waist/sash/${sexDir}/`, 'waist/sash/male/'],
      strike,
      colourIndex('torso', `waist/sash/${sexDir}/`, 'walk', sash),
    ),
  );

  // --- in front of the body ----------------------------------------------
  if (spec.accessory === 'wings') {
    const wing = pick(WING_STYLES, modelId, 'wings');
    push(layerFor('body', [`wings/${wing}/`], strike, seed, 'front'));
  }
  if (weapon) push(layerFor('weapon', [`${weapon}/`], strike, seed, 'front'));

  return layers;
}

function build(): void {
  mkdirSync(OUT, { recursive: true });
  const cards = selectableCards().filter((c) => c.category !== 'Spell' && c.modelId);
  const manifest: Record<string, string> = {};
  const done = new Set<string>();
  let made = 0;
  let missing = 0;

  for (const card of cards) {
    const spec = MODELS[card.modelId];
    if (!spec || done.has(card.modelId)) continue;
    done.add(card.modelId);

    const layers = layersFor(card.modelId, spec);
    if (layers.length === 0) {
      missing++;
      continue;
    }

    const atlas = composeAtlas({
      layers,
      walkFrames: WALK_FRAMES,
      strikeFrames: STRIKE_FRAMES,
    });
    const file = `${card.modelId}.png`;
    writeFileSync(`${OUT}/${file}`, encode(atlas));
    manifest[card.modelId] = file;
    made++;
  }

  writeFileSync(
    `${OUT}/manifest.json`,
    JSON.stringify({ walkFrames: WALK_FRAMES, strikeFrames: STRIKE_FRAMES, files: manifest }, null, 1),
  );
  console.log(`wrote ${made} atlases for ${cards.length} cards (${missing} skipped)`);
  if (!existsSync(`${OUT}/manifest.json`)) throw new Error('manifest not written');
}

build();
