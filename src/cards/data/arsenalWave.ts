/**
 * The arsenal wave.
 *
 * Mostly aimed at the two roles a player *must* fill and had almost no choice
 * in: the Tower Troop slot had three options for a mandatory deck slot, and
 * every deck therefore ran one of the same three. Three more, each changing
 * what your own towers are good at rather than what you put on the board.
 *
 * The rest lean into shot variety, now that a projectile actually looks like
 * the weapon that threw it. A lobbed shot arcs, casts a shadow and shows its
 * landing ring; a flat one points where it is going. That makes the difference
 * between a mortar and a marksman something you can read from the board rather
 * than something buried in a stat line — so it is worth having both.
 */

import { defineCard } from '../schema';

// ---------------------------------------------------------------------------
// Tower troops — the mandatory slot, finally a choice
// ---------------------------------------------------------------------------

/**
 * A tower troop's `baseHealth` *is* the princess tower's health, so picking one
 * is a trade between how much your towers absorb and what they do about it.
 *
 * The Bombardier is the splash option: less health than the Princess and a slow,
 * lobbed shell that hits a whole clump. It is the answer to being swarmed and
 * the worst possible pick against a single tank.
 */
export const BOMBARDIER = defineCard({
  name: 'Bombardier',
  id: 'card_towertroop_bombardier',
  rarity: 'Epic',
  category: 'TowerTroop',
  aetherCost: 1,
  unlockArena: 9,
  description: 'Lobs shells that splash. Slow, and helpless against a lone tank.',
  tint: '#9a7f5f',
  modelId: 'towerBombardier',
  baseHealth: 2400,
  massWeight: 100,
  bodyRadius: 1.5,
  targetPriority: 'Ground',
  attackRange: 7.0,
  sightRange: 7.0,
  hitSpeed: 1.9,
  damage: 190,
  damageType: 'AreaSplash',
  splashRadius: 1.6,
  firstAttackDelay: 0.8,
  usesProjectile: true,
});

/**
 * Chip damage traded for control: everything the Frostwarden hits crawls, which
 * buys the rest of your defence the seconds it needs to arrive. Almost no
 * damage of its own — this tower kills nothing by itself.
 */
export const FROSTWARDEN = defineCard({
  name: 'Frostwarden',
  id: 'card_towertroop_frostwarden',
  rarity: 'Legendary',
  category: 'TowerTroop',
  aetherCost: 1,
  unlockArena: 13,
  description: 'Slows everything it hits. Trades damage for time.',
  tint: '#6f9fc0',
  modelId: 'towerFrostwarden',
  baseHealth: 2450,
  massWeight: 100,
  bodyRadius: 1.5,
  targetPriority: 'AirAndGround',
  attackRange: 7.5,
  sightRange: 7.5,
  hitSpeed: 1.1,
  damage: 74,
  firstAttackDelay: 0.5,
  usesProjectile: true,
  onHitStatus: 'Slow',
  statusMagnitude: 0.55,
  statusDuration: 1.6,
});

/**
 * The opposite trade to the Duchess: the sturdiest tower in the game and the
 * shortest reach on it. Anything that gets close is in trouble; anything that
 * outranges it is completely safe.
 */
export const PIKE_GUARD = defineCard({
  name: 'Pike Guard',
  id: 'card_towertroop_pike_guard',
  rarity: 'Rare',
  category: 'TowerTroop',
  aetherCost: 1,
  unlockArena: 6,
  description: 'The toughest tower, with the shortest reach to go with it.',
  tint: '#7f8f9f',
  modelId: 'towerPikeGuard',
  baseHealth: 3100,
  massWeight: 100,
  bodyRadius: 1.5,
  targetPriority: 'Ground',
  attackRange: 5.0,
  sightRange: 5.0,
  hitSpeed: 0.9,
  damage: 140,
  firstAttackDelay: 0.4,
});

// ---------------------------------------------------------------------------
// Ranged
// ---------------------------------------------------------------------------

/**
 * 3 aether = 3000 EPP. Long band -> x0.35 health. Air and ground.
 *
 * The name is the whole card: enormous damage per shot, a body that any spell
 * removes, and a wind-up long enough that a fast unit reaches it first. Its
 * bolt is a glowing orb rather than an arrow, which at a glance is the tell
 * that something heavy is in the air.
 */
export const GLASSCASTER = defineCard({
  name: 'Glasscaster',
  id: 'card_troop_glasscaster',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 3,
  unlockArena: 8,
  description: 'One enormous bolt at a time, from a body made of glass.',
  tint: '#9a6fc0',
  modelId: 'glasscaster',
  baseHealth: 330,
  massWeight: 18,
  speedClass: 'Slow',
  bodyRadius: 0.5,
  targetPriority: 'AirAndGround',
  attackRange: 6.5,
  sightRange: 7.0,
  hitSpeed: 2.2,
  damage: 420,
  firstAttackDelay: 1.4,
  usesProjectile: true,
});

/**
 * 4 aether = 4000 EPP. Short band, ground only, wide splash -> x0.45 DPS.
 *
 * A shotgun, not a rifle: it has to be close to fire at all, and at that range
 * it clears a whole clump. Being ground-only and short-ranged is what stops it
 * simply being a better Bomber.
 */
export const SCATTERGUN = defineCard({
  name: 'Scattergun',
  id: 'card_troop_scattergun',
  rarity: 'Rare',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 9,
  description: 'Short-range blast that tears through a whole clump at once.',
  tint: '#8a7a6a',
  modelId: 'scattergun',
  baseHealth: 900,
  massWeight: 32,
  speedClass: 'Medium',
  bodyRadius: 0.5,
  targetPriority: 'Ground',
  attackRange: 3.2,
  sightRange: 5.5,
  hitSpeed: 1.4,
  damage: 230,
  damageType: 'ConeSplash',
  splashRadius: 2.0,
  firstAttackDelay: 0.7,
  usesProjectile: true,
});

// ---------------------------------------------------------------------------
// Support
// ---------------------------------------------------------------------------

/**
 * 4 aether = 4000 EPP. `aura_slow` costs 230 -> 3770. Medium band.
 *
 * Frost Wisp walks with the push and slows what the push is walking into; this
 * one is tougher, grounded, and slows harder. The Wisp flies over a blocker,
 * this has to walk around one — which is most of the difference.
 */
export const HEX_WARDEN = defineCard({
  name: 'Hex Warden',
  id: 'card_troop_hex_warden',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 10,
  description: 'Everything hostile nearby moves at a crawl while it lives.',
  tint: '#7a5f9a',
  modelId: 'hexWarden',
  baseHealth: 1150,
  massWeight: 30,
  speedClass: 'Medium',
  bodyRadius: 0.45,
  targetPriority: 'AirAndGround',
  attackRange: 5.0,
  sightRange: 5.5,
  hitSpeed: 1.5,
  damage: 150,
  firstAttackDelay: 0.7,
  usesProjectile: true,
  passiveId: 'aura_slow',
  // Fraction of normal speed inside the aura.
  passiveMagnitude: 0.5,
});

/**
 * 5 aether = 5000 EPP. `aura_damage` costs 270 -> 4730. Melee, ground.
 *
 * Warhorn Herald with a body. The Herald buffs from behind and dies to a
 * sneeze; this walks at the front of its own push, which means the buff
 * survives as long as the push does — and costs you a card slot that could
 * have been a tank.
 */
export const STANDARD_BEARER = defineCard({
  name: 'Standard Bearer',
  id: 'card_troop_standard_bearer',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 5,
  unlockArena: 11,
  description: 'Leads from the front, and everything around it hits harder.',
  tint: '#b08040',
  modelId: 'standardBearer',
  baseHealth: 2650,
  massWeight: 65,
  speedClass: 'Medium',
  bodyRadius: 0.55,
  targetPriority: 'Ground',
  attackRange: 1.2,
  sightRange: 5.5,
  hitSpeed: 1.4,
  damage: 230,
  firstAttackDelay: 0.5,
  passiveId: 'aura_damage',
  // Radius of the buff, in tiles.
  passiveMagnitude: 3.4,
});

// ---------------------------------------------------------------------------
// Tanks
// ---------------------------------------------------------------------------

/**
 * 5 aether = 5000 EPP. `reflect_ranged` costs 250 -> 4750. Melee, ground, slow.
 *
 * Crystal Golem's big brother, and the reason both exist: this is a wall that
 * punishes shooters, where Thornmail Sentinel is a wall that punishes tanks.
 * A push led by this one has to be answered in melee, which is exactly the
 * decision the card is selling.
 */
export const IRONBARK = defineCard({
  name: 'Ironbark',
  id: 'card_troop_ironbark',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 5,
  unlockArena: 11,
  description: 'Shrugs off arrows and sends a share of them straight back.',
  tint: '#6f7f5f',
  modelId: 'ironbark',
  baseHealth: 3400,
  massWeight: 80,
  speedClass: 'Slow',
  bodyRadius: 0.6,
  targetPriority: 'Ground',
  attackRange: 1.2,
  sightRange: 5.5,
  hitSpeed: 1.6,
  damage: 245,
  firstAttackDelay: 0.6,
  passiveId: 'reflect_ranged',
  // Share of each incoming shot returned to the shooter.
  passiveMagnitude: 0.5,
});

/**
 * 5 aether = 5000 EPP. `siege_bonus` costs 210 -> 4790. Flying, buildings-only.
 *
 * Flies, ignores every defender, and hits buildings far harder than its printed
 * damage suggests — but it is slow enough that any air defence in hand is a
 * complete answer, and it does nothing at all to a troop.
 */
export const SIEGE_MANTIS = defineCard({
  name: 'Siege Mantis',
  id: 'card_troop_siege_mantis',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 5,
  unlockArena: 12,
  description: 'Flies straight at buildings and chews through them.',
  tint: '#7f9a5f',
  modelId: 'siegeMantis',
  baseHealth: 2000,
  massWeight: 40,
  speedClass: 'Slow',
  bodyRadius: 0.5,
  isFlying: true,
  targetPriority: 'Buildings',
  attackRange: 1.2,
  sightRange: 7.0,
  hitSpeed: 1.4,
  damage: 260,
  firstAttackDelay: 0.6,
  passiveId: 'siege_bonus',
  // Extra damage against buildings, as a share of the base hit.
  passiveMagnitude: 0.7,
});

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

/**
 * 4 aether = 4000 EPP, x1.25 decay bonus. Long band, ground only.
 *
 * The one card that can hit a tower from your own side of the river. Its shell
 * arcs the whole way and shows its landing ring in flight, so the defender can
 * see it coming and step out of it — which is the counterplay, along with the
 * fact that it cannot defend itself at close range at all.
 */
export const MORTAR_PIT = defineCard({
  name: 'Mortar Pit',
  id: 'card_building_mortar_pit',
  rarity: 'Rare',
  category: 'Building',
  aetherCost: 4,
  unlockArena: 8,
  description: 'Shells the far side of the river. Blind to anything close by.',
  tint: '#6f6a60',
  modelId: 'mortarPit',
  baseHealth: 900,
  massWeight: 100,
  bodyRadius: 0.75,
  targetPriority: 'Ground',
  attackRange: 11.0,
  sightRange: 11.5,
  hitSpeed: 4.0,
  damage: 320,
  damageType: 'AreaSplash',
  splashRadius: 1.5,
  firstAttackDelay: 2.5,
  usesProjectile: true,
  lifetimeSeconds: 30,
});

/**
 * 4 aether = 4000 EPP. `aura_shield` costs 340 -> 3660, x1.25 decay bonus.
 *
 * Shield Chaplain that cannot move. Plates whatever walks past it, which makes
 * it a defensive anchor rather than escort — and, being a building, it drags a
 * win condition off its line while it does so.
 */
export const BEACON_SPIRE = defineCard({
  name: 'Beacon Spire',
  id: 'card_building_beacon_spire',
  rarity: 'Epic',
  category: 'Building',
  aetherCost: 4,
  unlockArena: 10,
  description: 'Plates everything that passes it with one-hit armour.',
  tint: '#8f9fb8',
  modelId: 'beaconSpire',
  baseHealth: 3050,
  massWeight: 100,
  bodyRadius: 0.7,
  targetPriority: 'Ground',
  attackRange: 0,
  sightRange: 0,
  hitSpeed: 1,
  damage: 0,
  lifetimeSeconds: 32,
  passiveId: 'aura_shield',
  // Armour granted to each ally in range, topped up every 2.5 seconds.
  passiveMagnitude: 120,
});

// ---------------------------------------------------------------------------
// Champion
// ---------------------------------------------------------------------------

/**
 * 5 aether, Champion -> x1.25 budget. Long band, air and ground, flying.
 *
 * A champion that fights from above and out of reach. The ability throws the
 * heaviest thing near her back toward its own side and stuns it — which is
 * less about the damage than about buying the four seconds it takes to walk
 * back, and works best on the tank a whole push is queued behind.
 */
export const SERAPH_OF_DUSK = defineCard({
  name: 'Seraph of Dusk',
  id: 'card_troop_seraph_of_dusk',
  rarity: 'Champion',
  category: 'Troop',
  aetherCost: 5,
  unlockArena: 15,
  description: 'Hurls the heaviest enemy near her back the way it came.',
  tint: '#b06fa0',
  modelId: 'seraphOfDusk',
  baseHealth: 1500,
  massWeight: 24,
  speedClass: 'Medium',
  bodyRadius: 0.42,
  isFlying: true,
  targetPriority: 'AirAndGround',
  attackRange: 5.5,
  sightRange: 6.0,
  hitSpeed: 1.1,
  damage: 205,
  firstAttackDelay: 0.5,
  usesProjectile: true,
  isHero: true,
  abilityAetherCost: 2,
  abilityCooldown: 11,
  abilityActionHook: 'ThrowUnit',
  abilityTargetFilter: 'HighestHpUnit',
  abilityDamage: 220,
  abilityRadius: 4.0,
  abilityDurationSeconds: 0.5,
});

export const ARSENAL_WAVE_CARDS = [
  BOMBARDIER,
  FROSTWARDEN,
  PIKE_GUARD,
  GLASSCASTER,
  SCATTERGUN,
  HEX_WARDEN,
  STANDARD_BEARER,
  IRONBARK,
  SIEGE_MANTIS,
  MORTAR_PIT,
  BEACON_SPIRE,
  SERAPH_OF_DUSK,
];
