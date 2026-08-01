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
import {
  readSheet,
  listEntries,
  composeAtlas,
  encode,
  recolour,
  CELL,
  type Layer,
} from './compose.mjs';
import { BEASTS } from '../beasts/recipe.mjs';

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
/**
 * Species by body plan — at least five each.
 *
 * The count is not decoration. A card's figure varies along the species, the
 * body frame, the weapon and the hair; a weaponless card on a plan whose
 * species have no hair varies along *one* axis, so the entire space of
 * distinguishable figures is the length of this list. Three cards on that
 * shape with a three-entry pool is a build failure, and was.
 *
 * The plan still sets the character of the list — a brute reads as heavy
 * whichever of its heads it draws — it just no longer determines the figure.
 */
const HEADS_BY_PLAN: Record<BodyPlan, readonly string[]> = {
  humanoid: ['human/male', 'orc/male', 'vampire/adult', 'goblin/adult', 'zombie/adult'],
  brute: ['troll/adult', 'minotaur/male', 'boarman/adult', 'wartotaur/adult', 'orc/male'],
  golem: ['frankenstein/adult', 'zombie/adult', 'orc/male', 'troll/adult', 'skeleton/adult'],
  winged: ['jack/adult', 'vampire/adult', 'alien/adult', 'rabbit/adult', 'mouse/adult'],
  serpent: ['lizard/male', 'boarman/adult', 'rat/adult', 'wolf/male', 'pig/adult'],
  mech: ['alien/adult', 'frankenstein/adult', 'skeleton/adult', 'zombie/adult', 'orc/male'],
  orb: ['alien/adult', 'jack/adult', 'zombie/adult', 'sheep/adult', 'rabbit/adult'],
  insect: ['mouse/adult', 'rat/adult', 'rabbit/adult', 'goblin/adult', 'lizard/male'],
  shelled: ['boarman/adult', 'pig/adult', 'lizard/male', 'sheep/adult', 'troll/adult'],
  wraith: ['skeleton/adult', 'zombie/adult', 'jack/adult', 'vampire/adult', 'alien/adult'],
  quadruped: ['wolf/male', 'mouse/adult', 'boarman/adult', 'rat/adult', 'lizard/male'],
  structure: ['human/male', 'orc/male', 'skeleton/adult', 'goblin/adult', 'zombie/adult'],
  cart: ['goblin/adult', 'rat/adult', 'mouse/adult', 'pig/adult', 'rabbit/adult'],
  centaur: ['wartotaur/adult', 'minotaur/male', 'troll/adult', 'boarman/adult', 'orc/male', 'wolf/male'],
  floating: ['vampire/adult', 'jack/adult', 'skeleton/adult', 'alien/adult', 'zombie/adult'],
  totem: ['sheep/adult', 'troll/adult', 'pig/adult', 'boarman/adult', 'minotaur/male'],
  tripod: ['rat/adult', 'mouse/adult', 'alien/adult', 'goblin/adult', 'lizard/male'],
  blob: ['pig/adult', 'sheep/adult', 'boarman/adult', 'rabbit/adult', 'troll/adult'],
  crystal: ['zombie/adult', 'alien/adult', 'frankenstein/adult', 'skeleton/adult', 'jack/adult'],
  swarm: ['goblin/adult', 'rabbit/adult', 'mouse/adult', 'rat/adult', 'human/male'],
  siege: ['orc/male', 'troll/adult', 'minotaur/male', 'wartotaur/adult', 'boarman/adult'],
  hunched: ['minotaur/male', 'boarman/adult', 'wolf/male', 'troll/adult', 'lizard/male'],
  twinned: ['rabbit/adult', 'human/male', 'sheep/adult', 'goblin/adult', 'mouse/adult'],
};

/**
 * Garment, trousers and footwear — pools, not single entries.
 *
 * This is where a hundred and fifty figures were quietly collapsing into a
 * few dozen. Only three things in a card's model reached the composed figure:
 * its body plan chose the species, its build chose *one* torso, *one* pair of
 * legs and *one* pair of boots, and its weapon kind chose a weapon. Two cards
 * on the same plan and build with the same kind of weapon therefore came out
 * pixel-for-pixel alike however different their entries looked in the
 * registry — Halberdier and Thorn Warden matched at a shape score of 1.000.
 *
 * A pool per build, picked by hashing the model id, turns one combination into
 * several hundred. The build still decides what *kind* of thing the figure
 * wears, which is what made the mapping worth having; it no longer decides the
 * exact garment.
 *
 * Every pool ends in an entry known to exist, because `layerFor` walks the
 * list and takes the first hit — and a pool where nothing resolves produces a
 * figure with no shirt rather than an error.
 */
const TORSOS_BY_BUILD: Record<BuildKind, readonly string[]> = {
  normal: [
    'clothes/longsleeve/longsleeve/male', 'clothes/longsleeve/longsleeve2/male',
    'clothes/longsleeve/laced/male', 'clothes/longsleeve/scoop/male',
    'jacket/collared/male', 'clothes/longsleeve/longsleeves_cuffed/male',
  ],
  lean: [
    'clothes/shortsleeve/tshirt/male', 'clothes/shortsleeve/tshirt_vneck/male',
    'clothes/shortsleeve/shortsleeve/male', 'clothes/vest/male',
    'clothes/shortsleeve/shortsleeves2/male',
  ],
  gaunt: [
    'bandage/male', 'clothes/sleeveless/laced/male', 'clothes/vest_open/male',
    'jacket/trench/male', 'clothes/sleeveless/striped/male',
  ],
  stout: [
    'armour/leather/male', 'chainmail/male', 'jacket/tabard/male',
    'aprons/overalls/male', 'clothes/longsleeve/longsleeves/male',
  ],
  hulking: [
    'armour/plate/male', 'armour/legion/male', 'chainmail/male',
    'jacket/tabard/male',
  ],
  squat: [
    'clothes/sleeveless/sleeveless/male', 'aprons/suspenders/male',
    'clothes/vest/male', 'clothes/sleeveless/sleeveless2_polo/male',
  ],
  towering: [
    'clothes/longsleeve/formal/male', 'jacket/frock/male', 'jacket/iverness/male',
    'jacket/trench/male', 'clothes/longsleeve/formal_striped/male',
  ],
  tiny: [
    'clothes/shortsleeve/shortsleeve/male', 'clothes/shirt/child',
    'aprons/apron/male', 'clothes/shortsleeve/tshirt_scoop/male',
  ],
  broad: [
    'armour/legion/male', 'armour/leather/male', 'jacket/tabard/male',
    'chainmail/male',
  ],
};

const LEGS_BY_BUILD: Record<BuildKind, readonly string[]> = {
  normal: ['pantaloons/male', 'pants/male', 'hose/male'],
  lean: ['leggings/thin', 'hose/thin', 'pants2/thin', 'pantaloons/thin'],
  gaunt: ['leggings2/thin', 'hose/thin', 'cuffed/thin', 'pantaloons/thin'],
  stout: ['pants/male', 'cuffed/male', 'fur/male', 'pantaloons/male'],
  hulking: ['armour/plate/male', 'fur/male', 'pants2/male', 'pantaloons/male'],
  squat: ['pants/child', 'pantaloons/male', 'leggings/male'],
  towering: ['formal/male', 'formal_striped/male', 'cuffed/male', 'pantaloons/male'],
  tiny: ['pants/child', 'leggings/thin', 'pantaloons/thin', 'pantaloons/male'],
  broad: ['armour/plate/male', 'pants2/male', 'fur/male', 'pantaloons/male'],
};

const FEET_BY_BUILD: Record<BuildKind, readonly string[]> = {
  normal: ['boots/basic/male', 'boots/fold/male', 'shoes/male', 'boots/rimmed/male'],
  lean: ['boots/revised/thin', 'boots/basic/thin', 'sandals/thin', 'boots/basic/male'],
  gaunt: ['sandals/thin', 'boots/fold/thin', 'slippers/thin', 'boots/basic/male'],
  stout: ['boots/fold/male', 'boots/rimmed/male', 'boots/basic/male'],
  hulking: ['armour/plate/male', 'accessory/plate_toe_thick/male', 'boots/rimmed/male'],
  squat: ['boots/rimmed/male', 'shoes/male', 'boots/basic/male'],
  towering: ['boots/revised/male', 'shoes/male', 'boots/fold/male', 'boots/basic/male'],
  tiny: ['sandals/male', 'slippers/male', 'shoes/male', 'boots/basic/male'],
  broad: ['accessory/plate_toe_thick/male', 'accessory/plate_toe/male', 'armour/plate/male', 'boots/basic/male'],
};

/**
 * A belt, obi or over-jacket worn over the garment.
 *
 * One more independent axis, and the cheapest one available: it is a layer the
 * pack already has, it sits where the eye goes, and it multiplies the number
 * of distinguishable figures by itself.
 */
const OVERLAYS: readonly string[] = [
  'waist/belt_leather/male', 'waist/belt_double/male', 'waist/belt_loose/male',
  'waist/obi/male', 'waist/belt_belly/male', 'waist/belt_robe/male',
  'clothes/vest_open/male', 'jacket/tabard/male', 'waist/sash_narrow/male',
];

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

/**
 * Hair colours.
 *
 * The pack ships one sheet per style in a single base colour and recolours it
 * from a palette at runtime, which this build does at compose time instead.
 * Mostly plausible human shades, with a few that are not — a goblin or a
 * frankenstein wearing moss green reads as the creature it is rather than as a
 * man who happens to be green.
 */
const HAIR_COLOURS: ReadonlyArray<{ hue: number; sat: number; light: number }> = [
  { hue: 28, sat: 0.16, light: 0.42 },  // black
  { hue: 24, sat: 0.34, light: 0.62 },  // dark brown
  { hue: 30, sat: 0.44, light: 0.9 },   // chestnut
  { hue: 42, sat: 0.55, light: 1.25 },  // blond
  { hue: 46, sat: 0.28, light: 1.45 },  // ash blond
  { hue: 18, sat: 0.62, light: 0.95 },  // auburn
  { hue: 12, sat: 0.7, light: 1.05 },   // ginger
  { hue: 0, sat: 0.06, light: 1.5 },    // white
  { hue: 210, sat: 0.1, light: 1.15 },  // grey
  { hue: 200, sat: 0.5, light: 1.0 },   // steel blue
  { hue: 285, sat: 0.42, light: 0.95 }, // violet
  { hue: 110, sat: 0.4, light: 0.85 },  // moss
  { hue: 165, sat: 0.45, light: 1.0 },  // sea green
  { hue: 330, sat: 0.45, light: 1.05 }, // rose
];

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
function pick<T>(list: readonly T[], id: string, salt: string, attempt = 0): T {
  return list[hash(attempt === 0 ? `${id}|${salt}` : `${id}|${salt}|${attempt}`) % list.length];
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

/** Recolour both sheets of a layer, or pass a missing layer straight through. */
function tinted(
  layer: Layer | null,
  palette: { hue: number; sat: number; light: number },
): Layer | null {
  if (!layer) return null;
  return {
    ...layer,
    walk: layer.walk ? recolour(layer.walk, palette) : layer.walk,
    slash: layer.slash ? recolour(layer.slash, palette) : layer.slash,
  };
}

/**
 * Assemble the full stack for one model, ordered back to front.
 *
 * `attempt` re-rolls every choice. Pools make a collision unlikely rather than
 * impossible — two cards on the same plan, build and weapon kind can still
 * land on the same entry in each pool — and "unlikely" is not a property worth
 * relying on when the failure mode is two cards a player cannot tell apart.
 * The caller retries with a higher attempt until the recipe is one no other
 * card already has.
 */
function layersFor(
  modelId: string,
  spec: ModelSpec,
  attempt = 0,
): { layers: Layer[]; recipe: string } {
  const layers: Layer[] = [];
  const seed = hash(modelId);
  let hairStyle: string | null = null;
  let hairColour: { hue: number; sat: number; light: number } | null = null;
  let overlay: string | null = null;
  const push = (l: Layer | null) => {
    if (l) layers.push(l);
  };

  const bodyDir = BODY_BY_BUILD[spec.build] ?? 'male';
  const bodyPlain = bodyDir === 'skeleton' || bodyDir === 'zombie';
  /*
   * Every axis is now picked per model, and each is salted differently so two
   * cards agreeing on one do not agree on all of them. `spec.head` salts the
   * species: it had been dead input — the composer read it only to decide
   * whether to add horns — so a card's declared head did nothing to
   * distinguish it from another on the same body plan.
   */
  const heads = HEADS_BY_PLAN[spec.body] ?? ['human/male'];
  const head = pick(heads, modelId, `species|${spec.head}`, attempt);
  const species = head.split('/')[0];
  const torso = pick(TORSOS_BY_BUILD[spec.build] ?? ['clothes/longsleeve/longsleeve/male'], modelId, 'torso', attempt);
  const legs = pick(LEGS_BY_BUILD[spec.build] ?? ['pantaloons/male'], modelId, 'legs', attempt);
  const feet = pick(FEET_BY_BUILD[spec.build] ?? ['boots/basic/male'], modelId, 'feet', attempt);
  const pool = WEAPONS_BY_KIND[spec.weapon] ?? [];
  const weapon = pool.length > 0 ? pick(pool, modelId, 'weapon', attempt) : null;
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
    hairStyle = pick(styles, modelId, 'hair', attempt);
    hairColour = pick(HAIR_COLOURS, modelId, 'haircolour', attempt);
    const hair = layerFor('hair', [`${hairStyle}/adult/`, `${hairStyle}/`], strike, hash(`${modelId}|hue`));
    push(tinted(hair, hairColour));
  }

  push(layerFor('legs', [`${legs}/`, `pantaloons/${sexDir}/`, 'pantaloons/male/'], strike, seed));
  push(layerFor('feet', [`${feet}/`, 'boots/basic/male/'], strike, seed));
  push(
    layerFor(
      'torso',
      [`${torso}/`, 'clothes/longsleeve/longsleeve/male/', 'chainmail/male/'],
      strike,
      seed,
    ),
  );

  /*
   * A belt or over-jacket, and only on some figures.
   *
   * Applying it to everything would be a uniform, which is the problem this is
   * meant to solve rather than another instance of it. Two thirds is enough to
   * break up a rank without becoming the rank's defining feature.
   */
  if (hash(`${modelId}|overlay?|${attempt}`) % 3 !== 0) {
    overlay = pick(OVERLAYS, modelId, 'overlay', attempt);
    push(layerFor('torso', [`${overlay}/`], strike, seed));
  }

  // The sash goes over the torso so armour can never hide it.
  const sash = pick(SASH_COLOURS, modelId, 'sash', attempt);
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

  /*
   * The recipe, as a string, and deliberately only the parts that change the
   * *picture* rather than its palette.
   *
   * Only four axes, arrived at by measuring rather than by taste. The first
   * version listed everything and reported every card distinct while two pairs
   * still matched at a shape similarity of 1.000; the second dropped the two
   * colour axes and they still matched. Garment, trousers, boots and belt turn
   * out to be almost pure colour at this size — a chainmail shirt and a
   * leather one have the same outline. What actually moves the silhouette is
   * the species, the body frame, the weapon and the hair, so those are what
   * the guarantee is made of. The rest still vary; they are just not evidence
   * that two cards can be told apart.
   */
  const recipe = [head, bodyDir, weapon ?? '-', hairStyle ?? '-'].join('|');
  void torso;
  void legs;
  void feet;
  void overlay;
  void hairColour;
  void sash;

  return { layers, recipe };
}

/**
 * The composed figure's outline, as a coarse coverage grid.
 *
 * The recipe fingerprint is a proxy for "these two will look different", and a
 * proxy is exactly as good as its assumptions. It said garment and boots were
 * distinguishing axes; measurement said they are almost pure colour, and pairs
 * kept coming out with identical outlines anyway. So the build now compares
 * the thing the eye compares. Front-facing standing pose, which is what a card
 * face shows and what a player sees marching toward them.
 */
const SIGNATURE_N = 16;

interface Signature {
  /** Coverage per cell: the outline, independent of palette. */
  mask: number[];
  /** Mean colour per cell, alpha-weighted. */
  rgb: number[];
}

function outline(atlas: { width: number; data: Buffer }): Signature {
  const step = CELL / SIGNATURE_N;
  const mask: number[] = [];
  const rgb: number[] = [];
  for (let y = 0; y < SIGNATURE_N; y++) {
    for (let x = 0; x < SIGNATURE_N; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let yy = 0; yy < step; yy++) {
        for (let xx = 0; xx < step; xx++) {
          const sx = Math.floor(x * step + xx);
          const sy = CELL + Math.floor(y * step + yy);
          const i = (sy * atlas.width + sx) << 2;
          const alpha = atlas.data[i + 3] / 255;
          r += atlas.data[i] * alpha;
          g += atlas.data[i + 1] * alpha;
          b += atlas.data[i + 2] * alpha;
          a += alpha;
          n++;
        }
      }
      mask.push(a / n);
      rgb.push(a > 0 ? r / a : 0, a > 0 ? g / a : 0, a > 0 ? b / a : 0);
    }
  }
  return { mask, rgb };
}

/**
 * Whether two figures read as the same unit.
 *
 * Two thresholds, because they catch different failures. An identical outline
 * is the one a player notices in a fight, whatever the palette. A high
 * combined score is the one they notice on a card face, where the figure is
 * still and colour carries. The build checked only the first and shipped a
 * pair scoring 0.9906 on the second.
 */
function tooAlike(a: Signature, b: Signature): boolean {
  const shape = similarity(a.mask, b.mask);
  if (shape >= SAME_OUTLINE) return true;
  return shape * 0.5 + similarity(a.rgb, b.rgb) * 0.5 >= SAME_FIGURE;
}

function similarity(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

/** An outline this close is the same silhouette, whatever it is painted. */
const SAME_OUTLINE = 0.999;
/** Shape and colour together. Kept in step with `tests/artDistinctness`. */
const SAME_FIGURE = 0.99;

function build(): void {
  mkdirSync(OUT, { recursive: true });
  const cards = selectableCards().filter((c) => c.category !== 'Spell' && c.modelId);
  const manifest: Record<string, string> = {};
  const done = new Set<string>();
  const recipes = new Set<string>();
  const outlines: Array<{ id: string; grid: Signature }> = [];
  let made = 0;
  let skipped = 0;
  let rerolled = 0;

  for (const card of cards) {
    const spec = MODELS[card.modelId];
    if (!spec || done.has(card.modelId)) continue;
    done.add(card.modelId);

    /*
     * Some cards are animals, and this pack has none.
     *
     * LPC is entirely bipedal — its wolf is a wolf's head on a man's body —
     * so a card whose identity is that it is a pack of dogs is drawn from the
     * quadruped sheets by `scripts/beasts` instead. Both write into the same
     * directory under the model's own name, so without this the humanoid
     * build would silently paint a small armoured man over every hound.
     */
    if (card.modelId in BEASTS) {
      skipped++;
      continue;
    }

    /*
     * Re-roll until this card's recipe is one no other card already has.
     *
     * Seven pairs of cards were composing to visually identical figures before
     * the pools went in, and two still collided afterwards. Retrying is the
     * only version of this that is a guarantee rather than a hope.
     */
    /*
     * Re-roll until this card looks like no card already built.
     *
     * Checked twice, cheap first: a recipe already taken cannot produce a
     * different picture, so that is rejected without composing anything. Then
     * the composed outline is compared against every figure accepted so far,
     * because a distinct recipe is not the same claim as a distinct figure and
     * the difference is where the duplicates were hiding.
     */
    let atlas: ReturnType<typeof composeAtlas> | null = null;
    let accepted = '';
    let shape: Signature = { mask: [], rgb: [] };
    for (let attempt = 0; attempt < 24; attempt++) {
      const built = layersFor(card.modelId, spec, attempt);
      if (built.layers.length === 0) break;
      if (recipes.has(built.recipe)) {
        rerolled++;
        continue;
      }
      const composed = composeAtlas({
        layers: built.layers,
        walkFrames: WALK_FRAMES,
        strikeFrames: STRIKE_FRAMES,
      });
      const grid = outline(composed as { width: number; data: Buffer });
      const clash = outlines.find((o) => tooAlike(o.grid, grid));
      if (clash) {
        rerolled++;
        recipes.add(built.recipe);
        continue;
      }
      atlas = composed;
      accepted = built.recipe;
      shape = grid;
      break;
    }

    /*
     * No art is worse than similar art.
     *
     * A card that exhausts its re-rolls used to fall through to `missing`,
     * which meant it silently shipped with the crude procedural fallback while
     * the build reported success. Two cards did exactly that — both weaponless
     * and hairless species whose plan offered only two heads, so the whole
     * shape space was two figures and both were taken. Failing here is what
     * makes that a build error rather than something to notice in a screenshot
     * three weeks later.
     */
    if (!atlas) {
      throw new Error(
        `${card.modelId}: no distinct figure available — ` +
          `plan ${spec.body} / build ${spec.build} / weapon ${spec.weapon} ` +
          'has too few shape combinations. Widen a pool in this file.',
      );
    }
    recipes.add(accepted);
    outlines.push({ id: card.modelId, grid: shape });
    const file = `${card.modelId}.png`;
    writeFileSync(`${OUT}/${file}`, encode(atlas));
    manifest[card.modelId] = file;
    made++;
  }

  writeFileSync(
    `${OUT}/manifest.json`,
    JSON.stringify({ walkFrames: WALK_FRAMES, strikeFrames: STRIKE_FRAMES, files: manifest }, null, 1),
  );
  console.log(
    `wrote ${made} atlases for ${cards.length} cards ` +
      `(${skipped} drawn as animals, ${rerolled} re-rolled for distinctness)`,
  );
  if (!existsSync(`${OUT}/manifest.json`)) throw new Error('manifest not written');
}

build();
