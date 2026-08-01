/**
 * Character model registry.
 *
 * A model is a *composition*, not a bespoke drawing routine: a body plan, a
 * head, a weapon and an accessory. Roughly forty distinct silhouettes come out
 * of one renderer rather than forty hand-written ones, and adding a new
 * creature is a data entry rather than a code change.
 *
 * This exists because the first version derived the figure from stats, which
 * meant every melee tank drew identically and a mixed board read as one
 * repeated unit. Cards now name their model explicitly and a test enforces
 * that no two playable cards share one.
 *
 * Still procedural geometry, not imported meshes: no third-party art is
 * bundled (licensing), and the large CC0 asset hosts are unreachable under
 * this environment's network policy. A card's `spriteKey` remains the runtime
 * seam for real assets.
 */

export type BodyPlan =
  | 'humanoid'
  | 'brute'
  | 'golem'
  | 'winged'
  | 'serpent'
  | 'mech'
  | 'orb'
  | 'insect'
  | 'shelled'
  | 'wraith'
  | 'quadruped'
  | 'structure'
  | 'cart'
  // --- silhouettes added to break up the humanoid crowd --------------------
  /** Human torso on a four-legged barrel. Reads as a rider without a mount. */
  | 'centaur'
  /** No legs at all: a hovering mass with a trailing hem. */
  | 'floating'
  /** Segmented column of stacked plates, taller than anything else. */
  | 'totem'
  /** Three splayed legs under a small pod. */
  | 'tripod'
  /** A soft, wide, limbless mound. */
  | 'blob'
  /** Angular faceted shards with a hollow core. */
  | 'crystal'
  /** A ring of small bodies rather than one — a card that *is* its swarm. */
  | 'swarm'
  /** Long counterweighted arm on a narrow base. */
  | 'siege'
  /** Bipedal but bent double, head below shoulder height. */
  | 'hunched'
  /** Twin torsos on one waist. */
  | 'twinned';

export type HeadKind =
  | 'helm'
  | 'hood'
  | 'wizardHat'
  | 'beak'
  | 'skull'
  | 'horned'
  | 'visor'
  | 'crest'
  | 'mask'
  /** A decorative circlet — deliberately unlike the gold champion crown that
   *  `drawFigure` overlays on any `isHero` card, so royalty and champion stay
   *  distinguishable at a glance. */
  | 'crown'
  | 'none';

/**
 * Proportion. The single biggest driver of whether two figures read as the
 * same character, and the dimension the registry did not have — every card on
 * a given body plan was drawn from identical hardcoded geometry, so forty-odd
 * humanoids were one figure in different colours.
 */
export type BuildKind =
  | 'normal'
  | 'lean'
  | 'gaunt'
  | 'stout'
  | 'hulking'
  | 'squat'
  | 'towering'
  | 'tiny'
  | 'broad';

/**
 * Where a unit wears its team colour.
 *
 * Every figure in the game carried the same horizontal band across the chest at
 * the same height, which made even genuinely different bodies rhyme.
 */
export type TrimKind = 'sash' | 'belt' | 'shoulders' | 'hem' | 'chevron' | 'collar' | 'none';

export type WeaponKind =
  | 'sword'
  | 'hammer'
  | 'axe'
  | 'bow'
  | 'staff'
  | 'spear'
  | 'claws'
  | 'cannon'
  | 'dagger'
  | 'drill'
  | 'bomb'
  | 'lantern'
  | 'scythe'
  | 'none';

export type AccessoryKind = 'shield' | 'cape' | 'wings' | 'banner' | 'backpack' | 'halo' | 'none';

export interface ModelSpec {
  body: BodyPlan;
  head: HeadKind;
  weapon: WeaponKind;
  accessory: AccessoryKind;
  /** Overall size multiplier. Big creatures should read as big. */
  scale: number;
  build: BuildKind;
  trim: TrimKind;
}

const model = (
  body: BodyPlan,
  head: HeadKind,
  weapon: WeaponKind,
  accessory: AccessoryKind = 'none',
  scale = 1,
  build: BuildKind = 'normal',
  trim: TrimKind = 'sash',
): ModelSpec => ({ body, head, weapon, accessory, scale, build, trim });

/**
 * Every model in the game, keyed by the id cards reference.
 *
 * Each entry is a distinct combination. Two cards sharing a key is a bug the
 * roster test catches.
 */
export const MODELS: Record<string, ModelSpec> = {
  // --- original roster -----------------------------------------------------
  knight: model('humanoid', 'helm', 'sword', 'shield', 1.0, 'broad', 'sash'),
  archer: model('centaur', 'hood', 'bow', 'none', 0.88, 'gaunt', 'shoulders'),
  giant: model('centaur', 'none', 'claws', 'none', 1.45, 'hulking', 'chevron'),
  musketeer: model('humanoid', 'crest', 'cannon', 'none', 0.95, 'normal', 'shoulders'),
  minion: model('insect', 'horned', 'claws', 'wings', 0.72, 'tiny', 'belt'),
  skeleton: model('totem', 'skull', 'dagger', 'none', 0.66, 'tiny', 'sash'),
  goblin: model('centaur', 'hood', 'dagger', 'none', 0.7, 'tiny', 'chevron'),
  spearGoblin: model('cart', 'hood', 'spear', 'none', 0.72, 'tiny', 'hem'),
  bomber: model('totem', 'skull', 'bomb', 'backpack', 0.8, 'gaunt', 'sash'),
  valkyrie: model('hunched', 'horned', 'axe', 'cape', 1.05, 'normal', 'chevron'),
  wizard: model('centaur', 'wizardHat', 'staff', 'cape', 0.95, 'normal', 'shoulders'),
  miniPekka: model('shelled', 'visor', 'sword', 'none', 1.0, 'normal', 'shoulders'),
  babyDragon: model('swarm', 'crest', 'claws', 'wings', 1.15, 'normal', 'shoulders'),
  hogRider: model('floating', 'crest', 'hammer', 'none', 1.1, 'squat', 'collar'),
  barbarian: model('brute', 'horned', 'axe', 'none', 0.95, 'tiny', 'collar'),
  goldenKnight: model('twinned', 'crown', 'sword', 'cape', 1.05, 'broad', 'collar'),
  archerQueen: model('hunched', 'crown', 'bow', 'cape', 1.0, 'towering', 'chevron'),

  // --- structures ----------------------------------------------------------
  cannonTower: model('totem', 'none', 'cannon', 'none', 1.0, 'broad', 'belt'),
  teslaCoil: model('tripod', 'none', 'staff', 'none', 1.0, 'lean', 'collar'),
  towerPrincess: model('siege', 'crown', 'bow', 'banner', 1.0, 'broad', 'collar'),
  towerCannoneer: model('crystal', 'visor', 'cannon', 'none', 1.0, 'broad', 'hem'),
  towerDuchess: model('tripod', 'crest', 'dagger', 'banner', 1.0, 'tiny', 'collar'),
  kingKeep: model('blob', 'crown', 'cannon', 'banner', 1.2, 'tiny', 'hem'),

  // --- first unique wave ---------------------------------------------------
  crystalGolem: model('serpent', 'none', 'claws', 'none', 1.2, 'lean', 'hem'),
  ronin: model('wraith', 'mask', 'sword', 'cape', 1.0, 'towering', 'belt'),
  bulwark: model('wraith', 'visor', 'hammer', 'shield', 1.05, 'hulking', 'belt'),
  ironhide: model('tripod', 'horned', 'hammer', 'none', 1.3, 'lean', 'hem'),
  arcWarden: model('golem', 'none', 'staff', 'halo', 0.95, 'tiny', 'chevron'),
  siegeDrill: model('swarm', 'visor', 'drill', 'none', 1.15, 'normal', 'collar'),
  galeMonk: model('twinned', 'none', 'staff', 'cape', 0.95, 'tiny', 'belt'),
  breacher: model('blob', 'visor', 'drill', 'backpack', 1.05, 'tiny', 'collar'),
  lanternBearer: model('golem', 'hood', 'lantern', 'halo', 0.9, 'squat', 'shoulders'),
  frostWisp: model('swarm', 'none', 'none', 'halo', 0.75, 'broad', 'shoulders'),
  hiveTitan: model('tripod', 'none', 'claws', 'backpack', 1.35, 'squat', 'collar'),
  plagueBearer: model('centaur', 'mask', 'scythe', 'none', 0.9, 'hulking', 'shoulders'),
  berserker: model('centaur', 'none', 'axe', 'none', 0.85, 'gaunt', 'shoulders'),

  // --- second unique wave --------------------------------------------------
  skyTalon: model('swarm', 'beak', 'dagger', 'wings', 0.95, 'tiny', 'shoulders'),
  sandBurrower: model('blob', 'none', 'claws', 'none', 0.95, 'lean', 'collar'),
  mirrorShade: model('blob', 'mask', 'dagger', 'cape', 0.95, 'stout', 'belt'),
  boundKeeper: model('twinned', 'helm', 'staff', 'halo', 0.95, 'gaunt', 'belt'),
  sapling: model('serpent', 'crest', 'claws', 'none', 0.9, 'towering', 'belt'),
  powderCart: model('siege', 'none', 'bomb', 'none', 0.9, 'normal', 'chevron'),
  bastionTurtle: model('brute', 'none', 'claws', 'none', 1.2, 'stout', 'collar'),
  warBanner: model('serpent', 'helm', 'spear', 'banner', 1.0, 'lean', 'collar'),
  voidStalker: model('orb', 'skull', 'claws', 'none', 1.0, 'gaunt', 'hem'),
  flakNest: model('crystal', 'visor', 'cannon', 'backpack', 1.0, 'lean', 'belt'),
  broodMother: model('totem', 'horned', 'claws', 'backpack', 1.1, 'stout', 'shoulders'),
  longshot: model('blob', 'visor', 'bow', 'backpack', 0.95, 'gaunt', 'belt'),
  aegisBreaker: model('quadruped', 'horned', 'hammer', 'none', 1.1, 'towering', 'sash'),
  marshWalker: model('golem', 'crest', 'spear', 'none', 1.0, 'hulking', 'sash'),
  packAlpha: model('crystal', 'horned', 'claws', 'none', 1.05, 'gaunt', 'sash'),

  // --- third unique wave ---------------------------------------------------
  cinderImp: model('totem', 'horned', 'dagger', 'none', 0.6, 'gaunt', 'sash'),
  dartAcolyte: model('swarm', 'mask', 'spear', 'none', 0.82, 'gaunt', 'collar'),
  obsidianColossus: model('cart', 'horned', 'hammer', 'cape', 1.5, 'broad', 'belt'),
  stormDrake: model('insect', 'horned', 'bomb', 'wings', 1.25, 'towering', 'collar'),
  tideCaller: model('siege', 'crest', 'staff', 'halo', 1.0, 'hulking', 'shoulders'),
  frostPylon: model('totem', 'crest', 'staff', 'none', 0.95, 'hulking', 'hem'),
  thornWarden: model('tripod', 'crest', 'spear', 'none', 0.8, 'tiny', 'belt'),
  stoneWarden: model('wraith', 'helm', 'hammer', 'shield', 1.15, 'broad', 'collar'),

  // --- shielded and charging archetypes ------------------------------------
  spearGuard: model('blob', 'skull', 'spear', 'shield', 0.78, 'tiny', 'collar'),
  ironCharger: model('serpent', 'visor', 'axe', 'shield', 1.2, 'gaunt', 'belt'),
  // Small and plated: the visor and shield read as the armour a single hit
  // strips, and the claws as the bite that keeps getting worse.
  eliteHound: model('centaur', 'visor', 'claws', 'shield', 0.68, 'tiny', 'sash'),

  // --- role wave: near-variants and new archetypes --------------------------
  sewerRat: model('crystal', 'none', 'dagger', 'none', 0.5, 'tiny', 'sash'),
  pikeSentry: model('orb', 'helm', 'spear', 'cape', 0.9, 'normal', 'belt'),
  hedgeKnight: model('serpent', 'crown', 'axe', 'cape', 0.95, 'normal', 'belt'),
  kiteRunner: model('quadruped', 'beak', 'bow', 'cape', 0.8, 'gaunt', 'sash'),
  warhornHerald: model('totem', 'crest', 'lantern', 'banner', 0.9, 'stout', 'shoulders'),
  bellTower: model('crystal', 'crown', 'none', 'banner', 1.0, 'stout', 'collar'),
  skySkiff: model('insect', 'hood', 'bomb', 'wings', 1.0, 'lean', 'belt'),
  ramRunner: model('cart', 'horned', 'hammer', 'backpack', 1.15, 'normal', 'hem'),
  sapper: model('blob', 'mask', 'bomb', 'backpack', 0.72, 'gaunt', 'chevron'),
  culverin: model('wraith', 'none', 'cannon', 'backpack', 1.05, 'gaunt', 'belt'),
  thornmail: model('orb', 'visor', 'sword', 'shield', 1.1, 'hulking', 'hem'),
  headsman: model('humanoid', 'hood', 'scythe', 'none', 1.05, 'lean', 'shoulders'),
  duelist: model('brute', 'mask', 'dagger', 'banner', 0.9, 'stout', 'collar'),

  // --- depth wave: support, structures, tanks, champions --------------------
  shieldChaplain: model('siege', 'hood', 'staff', 'shield', 0.95, 'lean', 'sash'),
  wardstone: model('crystal', 'none', 'lantern', 'halo', 0.95, 'broad', 'shoulders'),
  barbedFence: model('structure', 'none', 'spear', 'shield', 0.9, 'squat', 'sash'),
  rampartOx: model('cart', 'crest', 'hammer', 'shield', 1.35, 'broad', 'collar'),
  graveTitan: model('humanoid', 'skull', 'scythe', 'cape', 1.4, 'broad', 'sash'),
  halberdier: model('tripod', 'visor', 'spear', 'banner', 1.0, 'tiny', 'collar'),
  tunnelRat: model('tripod', 'visor', 'drill', 'none', 0.62, 'tiny', 'chevron'),
  wardenMatriarch: model('floating', 'crown', 'hammer', 'halo', 1.05, 'broad', 'hem'),
  rookmaster: model('siege', 'crown', 'scythe', 'backpack', 1.0, 'squat', 'shoulders'),

  // --- arsenal wave: tower troops, siege and shot variety ------------------
  towerBombardier: model('structure', 'hood', 'bomb', 'backpack', 1.0, 'gaunt', 'belt'),
  towerFrostwarden: model('siege', 'wizardHat', 'staff', 'cape', 1.0, 'towering', 'collar'),
  towerPikeGuard: model('structure', 'helm', 'spear', 'shield', 1.0, 'broad', 'shoulders'),
  glasscaster: model('crystal', 'wizardHat', 'lantern', 'none', 0.9, 'gaunt', 'hem'),
  scattergun: model('orb', 'hood', 'cannon', 'none', 0.95, 'hulking', 'hem'),
  hexWarden: model('floating', 'wizardHat', 'staff', 'banner', 0.98, 'tiny', 'belt'),
  ironbark: model('cart', 'crest', 'claws', 'backpack', 1.3, 'broad', 'hem'),
  siegeMantis: model('winged', 'visor', 'drill', 'wings', 1.1, 'normal', 'chevron'),
  mortarPit: model('structure', 'skull', 'bomb', 'none', 1.05, 'stout', 'collar'),
  beaconSpire: model('structure', 'crown', 'lantern', 'halo', 1.0, 'broad', 'sash'),
  standardBearer: model('swarm', 'helm', 'spear', 'banner', 1.15, 'broad', 'belt'),
  seraphOfDusk: model('winged', 'crown', 'bow', 'halo', 1.05, 'towering', 'shoulders'),

  // --- spectacle wave: cards built around what they look like --------------
  stormcaller: model('twinned', 'wizardHat', 'staff', 'halo', 0.95, 'normal', 'collar'),
  delver: model('floating', 'helm', 'drill', 'none', 0.85, 'hulking', 'hem'),
  arcLance: model('shelled', 'visor', 'staff', 'shield', 0.95, 'normal', 'sash'),
  emberJack: model('floating', 'crest', 'bomb', 'cape', 0.85, 'normal', 'belt'),
  skyLantern: model('swarm', 'skull', 'bomb', 'wings', 1.1, 'gaunt', 'shoulders'),
  pyreDrake: model('winged', 'visor', 'staff', 'halo', 1.0, 'towering', 'chevron'),
  gloomArcher: model('siege', 'skull', 'bow', 'cape', 0.92, 'normal', 'shoulders'),
  boltPair: model('shelled', 'crest', 'staff', 'backpack', 0.75, 'normal', 'chevron'),

  // --- the menagerie wave ---------------------------------------------------
  // Thirty figures for thirty mechanics. Each is a distinct
  // body|head|weapon|accessory tuple, which `tests/models.test.ts` enforces, so
  // no two cards in the game can ever be mistaken for each other on the board.
  blightFang: model('cart', 'horned', 'claws', 'none', 0.95, 'gaunt', 'hem'),
  miasmaAdept: model('floating', 'mask', 'staff', 'cape', 0.9, 'normal', 'belt'),
  concussor: model('hunched', 'visor', 'hammer', 'shield', 1.15, 'stout', 'chevron'),
  powderMule: model('floating', 'none', 'bomb', 'backpack', 0.95, 'gaunt', 'belt'),
  doomseed: model('floating', 'none', 'bomb', 'halo', 1.0, 'squat', 'belt'),
  railLance: model('quadruped', 'visor', 'cannon', 'backpack', 1.05, 'gaunt', 'chevron'),
  harpoonTurret: model('structure', 'visor', 'spear', 'none', 1.1, 'stout', 'shoulders'),
  cleaver: model('brute', 'mask', 'axe', 'none', 1.05, 'normal', 'hem'),
  gustPriest: model('brute', 'wizardHat', 'staff', 'wings', 0.92, 'tiny', 'hem'),
  bloodwing: model('winged', 'beak', 'claws', 'cape', 0.78, 'tiny', 'sash'),
  sanguineKnight: model('mech', 'visor', 'scythe', 'cape', 1.05, 'stout', 'shoulders'),
  spotter: model('mech', 'hood', 'bow', 'backpack', 0.8, 'lean', 'sash'),
  nightblade: model('twinned', 'visor', 'dagger', 'cape', 0.85, 'squat', 'belt'),
  undyingSentinel: model('hunched', 'crown', 'sword', 'halo', 1.15, 'stout', 'collar'),
  boneReaper: model('humanoid', 'skull', 'scythe', 'banner', 1.05, 'broad', 'chevron'),
  boulderRoller: model('humanoid', 'none', 'hammer', 'backpack', 1.2, 'squat', 'sash'),
  runeBearer: model('humanoid', 'crest', 'staff', 'shield', 0.95, 'hulking', 'sash'),
  rustbeak: model('swarm', 'beak', 'drill', 'none', 0.85, 'squat', 'chevron'),
  chainbinder: model('hunched', 'horned', 'claws', 'banner', 0.95, 'gaunt', 'sash'),
  aegisMatron: model('twinned', 'crown', 'staff', 'shield', 1.0, 'tiny', 'hem'),
  twinbow: model('brute', 'visor', 'bow', 'wings', 0.9, 'stout', 'hem'),
  aetherLeech: model('floating', 'mask', 'staff', 'halo', 0.8, 'gaunt', 'belt'),
  skyPiercer: model('brute', 'crest', 'spear', 'wings', 0.95, 'broad', 'chevron'),
  cloudLancer: model('swarm', 'helm', 'spear', 'cape', 0.85, 'stout', 'collar'),
  warmason: model('siege', 'crest', 'hammer', 'banner', 1.15, 'squat', 'collar'),
  titanshell: model('golem', 'horned', 'claws', 'shield', 1.4, 'hulking', 'collar'),
  dreadSerpent: model('hunched', 'crown', 'claws', 'wings', 1.35, 'broad', 'shoulders'),
  emberwing: model('insect', 'crest', 'bomb', 'wings', 0.9, 'gaunt', 'collar'),
  glassSentinel: model('golem', 'visor', 'dagger', 'none', 0.75, 'gaunt', 'collar'),
  thornCaller: model('twinned', 'crest', 'spear', 'backpack', 0.88, 'normal', 'collar'),
};

export function modelSpec(modelId: string, fallback: ModelSpec): ModelSpec {
  return MODELS[modelId] ?? fallback;
}

export function knownModelIds(): string[] {
  return Object.keys(MODELS).sort();
}
