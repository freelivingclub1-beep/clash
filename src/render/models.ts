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
  | 'cart';

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
}

const model = (
  body: BodyPlan,
  head: HeadKind,
  weapon: WeaponKind,
  accessory: AccessoryKind = 'none',
  scale = 1,
): ModelSpec => ({ body, head, weapon, accessory, scale });

/**
 * Every model in the game, keyed by the id cards reference.
 *
 * Each entry is a distinct combination. Two cards sharing a key is a bug the
 * roster test catches.
 */
export const MODELS: Record<string, ModelSpec> = {
  // --- original roster -----------------------------------------------------
  knight: model('humanoid', 'helm', 'sword', 'shield', 1.0),
  archer: model('humanoid', 'hood', 'bow', 'none', 0.88),
  giant: model('brute', 'none', 'claws', 'none', 1.45),
  musketeer: model('humanoid', 'crest', 'cannon', 'none', 0.95),
  minion: model('winged', 'horned', 'claws', 'wings', 0.72),
  skeleton: model('humanoid', 'skull', 'dagger', 'none', 0.66),
  goblin: model('humanoid', 'hood', 'dagger', 'none', 0.7),
  spearGoblin: model('humanoid', 'hood', 'spear', 'none', 0.72),
  bomber: model('humanoid', 'skull', 'bomb', 'backpack', 0.8),
  valkyrie: model('humanoid', 'horned', 'axe', 'cape', 1.05),
  wizard: model('humanoid', 'wizardHat', 'staff', 'cape', 0.95),
  miniPekka: model('mech', 'visor', 'sword', 'none', 1.0),
  babyDragon: model('winged', 'crest', 'claws', 'wings', 1.15),
  hogRider: model('quadruped', 'crest', 'hammer', 'none', 1.1),
  barbarian: model('humanoid', 'horned', 'axe', 'none', 0.95),
  goldenKnight: model('humanoid', 'crown', 'sword', 'cape', 1.05),
  archerQueen: model('humanoid', 'crown', 'bow', 'cape', 1.0),

  // --- structures ----------------------------------------------------------
  cannonTower: model('structure', 'none', 'cannon', 'none', 1.0),
  teslaCoil: model('structure', 'none', 'staff', 'none', 1.0),
  towerPrincess: model('structure', 'crown', 'bow', 'banner', 1.0),
  towerCannoneer: model('structure', 'visor', 'cannon', 'none', 1.0),
  towerDuchess: model('structure', 'crest', 'dagger', 'banner', 1.0),
  kingKeep: model('structure', 'crown', 'cannon', 'banner', 1.2),

  // --- first unique wave ---------------------------------------------------
  crystalGolem: model('golem', 'none', 'claws', 'none', 1.2),
  ronin: model('humanoid', 'mask', 'sword', 'cape', 1.0),
  bulwark: model('humanoid', 'visor', 'hammer', 'shield', 1.05),
  ironhide: model('brute', 'horned', 'hammer', 'none', 1.3),
  arcWarden: model('orb', 'none', 'staff', 'halo', 0.95),
  siegeDrill: model('cart', 'visor', 'drill', 'none', 1.15),
  galeMonk: model('humanoid', 'none', 'staff', 'cape', 0.95),
  breacher: model('mech', 'visor', 'drill', 'backpack', 1.05),
  lanternBearer: model('humanoid', 'hood', 'lantern', 'halo', 0.9),
  frostWisp: model('orb', 'none', 'none', 'halo', 0.75),
  hiveTitan: model('brute', 'none', 'claws', 'backpack', 1.35),
  plagueBearer: model('humanoid', 'mask', 'scythe', 'none', 0.9),
  berserker: model('humanoid', 'none', 'axe', 'none', 0.85),

  // --- second unique wave --------------------------------------------------
  skyTalon: model('winged', 'beak', 'dagger', 'wings', 0.95),
  sandBurrower: model('insect', 'none', 'claws', 'none', 0.95),
  mirrorShade: model('wraith', 'mask', 'dagger', 'cape', 0.95),
  boundKeeper: model('humanoid', 'helm', 'staff', 'halo', 0.95),
  sapling: model('quadruped', 'crest', 'claws', 'none', 0.9),
  powderCart: model('cart', 'none', 'bomb', 'none', 0.9),
  bastionTurtle: model('shelled', 'none', 'claws', 'none', 1.2),
  warBanner: model('humanoid', 'helm', 'spear', 'banner', 1.0),
  voidStalker: model('wraith', 'skull', 'claws', 'none', 1.0),
  flakNest: model('structure', 'visor', 'cannon', 'backpack', 1.0),
  broodMother: model('insect', 'horned', 'claws', 'backpack', 1.1),
  longshot: model('humanoid', 'visor', 'bow', 'backpack', 0.95),
  aegisBreaker: model('mech', 'horned', 'hammer', 'none', 1.1),
  marshWalker: model('serpent', 'crest', 'spear', 'none', 1.0),
  packAlpha: model('quadruped', 'horned', 'claws', 'none', 1.05),

  // --- third unique wave ---------------------------------------------------
  cinderImp: model('humanoid', 'horned', 'dagger', 'none', 0.6),
  dartAcolyte: model('humanoid', 'mask', 'spear', 'none', 0.82),
  obsidianColossus: model('golem', 'horned', 'hammer', 'cape', 1.5),
  stormDrake: model('winged', 'horned', 'bomb', 'wings', 1.25),
  tideCaller: model('wraith', 'crest', 'staff', 'halo', 1.0),
  frostPylon: model('structure', 'crest', 'staff', 'none', 0.95),
  thornWarden: model('insect', 'crest', 'spear', 'none', 0.8),
  stoneWarden: model('golem', 'helm', 'hammer', 'shield', 1.15),

  // --- shielded and charging archetypes ------------------------------------
  spearGuard: model('humanoid', 'skull', 'spear', 'shield', 0.78),
  ironCharger: model('quadruped', 'visor', 'axe', 'shield', 1.2),
  // Small and plated: the visor and shield read as the armour a single hit
  // strips, and the claws as the bite that keeps getting worse.
  eliteHound: model('quadruped', 'visor', 'claws', 'shield', 0.68),

  // --- role wave: near-variants and new archetypes --------------------------
  sewerRat: model('quadruped', 'none', 'dagger', 'none', 0.5),
  pikeSentry: model('humanoid', 'helm', 'spear', 'cape', 0.9),
  hedgeKnight: model('humanoid', 'crown', 'axe', 'cape', 0.95),
  kiteRunner: model('humanoid', 'beak', 'bow', 'cape', 0.8),
  warhornHerald: model('humanoid', 'crest', 'lantern', 'banner', 0.9),
  bellTower: model('structure', 'crown', 'none', 'banner', 1.0),
  skySkiff: model('cart', 'hood', 'bomb', 'wings', 1.0),
  ramRunner: model('brute', 'horned', 'hammer', 'backpack', 1.15),
  sapper: model('humanoid', 'mask', 'bomb', 'backpack', 0.72),
  culverin: model('mech', 'none', 'cannon', 'backpack', 1.05),
  thornmail: model('golem', 'visor', 'sword', 'shield', 1.1),
  headsman: model('brute', 'hood', 'scythe', 'none', 1.05),
  duelist: model('humanoid', 'mask', 'dagger', 'banner', 0.9),

  // --- depth wave: support, structures, tanks, champions --------------------
  shieldChaplain: model('humanoid', 'hood', 'staff', 'shield', 0.95),
  wardstone: model('structure', 'none', 'lantern', 'halo', 0.95),
  barbedFence: model('structure', 'none', 'spear', 'shield', 0.9),
  rampartOx: model('brute', 'crest', 'hammer', 'shield', 1.35),
  graveTitan: model('golem', 'skull', 'scythe', 'cape', 1.4),
  halberdier: model('humanoid', 'visor', 'spear', 'banner', 1.0),
  tunnelRat: model('insect', 'visor', 'drill', 'none', 0.62),
  wardenMatriarch: model('humanoid', 'crown', 'hammer', 'halo', 1.05),
  rookmaster: model('humanoid', 'crown', 'scythe', 'backpack', 1.0),

  // --- arsenal wave: tower troops, siege and shot variety ------------------
  towerBombardier: model('structure', 'hood', 'bomb', 'backpack', 1.0),
  towerFrostwarden: model('structure', 'wizardHat', 'staff', 'cape', 1.0),
  towerPikeGuard: model('structure', 'helm', 'spear', 'shield', 1.0),
  glasscaster: model('humanoid', 'wizardHat', 'lantern', 'none', 0.9),
  scattergun: model('mech', 'hood', 'cannon', 'none', 0.95),
  hexWarden: model('wraith', 'wizardHat', 'staff', 'banner', 0.98),
  ironbark: model('golem', 'crest', 'claws', 'backpack', 1.3),
  siegeMantis: model('insect', 'visor', 'drill', 'wings', 1.1),
  mortarPit: model('structure', 'skull', 'bomb', 'none', 1.05),
  beaconSpire: model('structure', 'crown', 'lantern', 'halo', 1.0),
  standardBearer: model('brute', 'helm', 'spear', 'banner', 1.15),
  seraphOfDusk: model('winged', 'crown', 'bow', 'halo', 1.05),

  // --- spectacle wave: cards built around what they look like --------------
  stormcaller: model('humanoid', 'wizardHat', 'staff', 'halo', 0.95),
  delver: model('humanoid', 'helm', 'drill', 'none', 0.85),
  arcLance: model('humanoid', 'visor', 'staff', 'shield', 0.95),
  emberJack: model('humanoid', 'crest', 'bomb', 'cape', 0.85),
  skyLantern: model('orb', 'skull', 'bomb', 'wings', 1.1),
  pyreDrake: model('winged', 'visor', 'staff', 'halo', 1.0),
  gloomArcher: model('humanoid', 'skull', 'bow', 'cape', 0.92),
  boltPair: model('mech', 'crest', 'staff', 'backpack', 0.75),

  // --- the menagerie wave ---------------------------------------------------
  // Thirty figures for thirty mechanics. Each is a distinct
  // body|head|weapon|accessory tuple, which `tests/models.test.ts` enforces, so
  // no two cards in the game can ever be mistaken for each other on the board.
  blightFang: model('serpent', 'horned', 'claws', 'none', 0.95),
  miasmaAdept: model('humanoid', 'mask', 'staff', 'cape', 0.9),
  concussor: model('brute', 'visor', 'hammer', 'shield', 1.15),
  powderMule: model('quadruped', 'none', 'bomb', 'backpack', 0.95),
  doomseed: model('insect', 'none', 'bomb', 'halo', 1.0),
  railLance: model('mech', 'visor', 'cannon', 'backpack', 1.05),
  harpoonTurret: model('structure', 'visor', 'spear', 'none', 1.1),
  cleaver: model('brute', 'mask', 'axe', 'none', 1.05),
  gustPriest: model('humanoid', 'wizardHat', 'staff', 'wings', 0.92),
  bloodwing: model('winged', 'beak', 'claws', 'cape', 0.78),
  sanguineKnight: model('humanoid', 'visor', 'scythe', 'cape', 1.05),
  spotter: model('humanoid', 'hood', 'bow', 'backpack', 0.8),
  nightblade: model('wraith', 'visor', 'dagger', 'cape', 0.85),
  undyingSentinel: model('golem', 'crown', 'sword', 'halo', 1.15),
  boneReaper: model('wraith', 'skull', 'scythe', 'banner', 1.05),
  boulderRoller: model('golem', 'none', 'hammer', 'backpack', 1.2),
  runeBearer: model('humanoid', 'crest', 'staff', 'shield', 0.95),
  rustbeak: model('winged', 'beak', 'drill', 'none', 0.85),
  chainbinder: model('humanoid', 'horned', 'claws', 'banner', 0.95),
  aegisMatron: model('humanoid', 'crown', 'staff', 'shield', 1.0),
  twinbow: model('humanoid', 'visor', 'bow', 'wings', 0.9),
  aetherLeech: model('orb', 'mask', 'staff', 'halo', 0.8),
  skyPiercer: model('mech', 'crest', 'spear', 'wings', 0.95),
  cloudLancer: model('winged', 'helm', 'spear', 'cape', 0.85),
  warmason: model('structure', 'crest', 'hammer', 'banner', 1.15),
  titanshell: model('shelled', 'horned', 'claws', 'shield', 1.4),
  dreadSerpent: model('serpent', 'crown', 'claws', 'wings', 1.35),
  emberwing: model('winged', 'crest', 'bomb', 'wings', 0.9),
  glassSentinel: model('orb', 'visor', 'dagger', 'none', 0.75),
  thornCaller: model('insect', 'crest', 'spear', 'backpack', 0.88),
};

export function modelSpec(modelId: string, fallback: ModelSpec): ModelSpec {
  return MODELS[modelId] ?? fallback;
}

export function knownModelIds(): string[] {
  return Object.keys(MODELS).sort();
}
