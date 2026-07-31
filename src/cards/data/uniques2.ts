/**
 * Second wave of unique cards.
 *
 * Same procedure as `uniques.ts`: pick an aether cost, pick one mechanic and
 * pay its EPP price, apply the reach/splash/flight/speed/swarm modifiers, then
 * spend what is left on health and damage. The arithmetic is in the comment
 * above each card and `tests/balance.test.ts` re-derives it.
 *
 * Two things this wave deliberately fixes about the roster:
 *
 *   1. **Targeting spread.** Nothing in the game targeted `AirOnly` — every
 *      card could hit ground, so air decks had no dedicated counter and the
 *      "what does this shoot at" axis was doing no design work. Two cards here
 *      are air-only and are genuinely useless against ground, which is the
 *      price of being a hard counter.
 *   2. **Silhouette.** Every card names its own `modelId`, so no two units on
 *      the board draw the same figure.
 *
 * Concepts avoid "another troop that shoots an arrow": the mechanics here are
 * burrowing, replication, damage sharing, growth, detonation, facing-dependent
 * armour, spawning, blinking, river-walking and pack behaviour.
 */

import { defineCard } from '../schema';

// ---------------------------------------------------------------------------
// Air-only specialists — no ground damage at all
// ---------------------------------------------------------------------------

/**
 * 4 aether = 4000 EPP. Air superiority costs 150 -> 3850.
 * Flying -> HP x0.8. Melee reach, air-only targeting.
 * Fast and fragile: it beats anything in the sky and cannot touch the ground,
 * so it is a pure answer card rather than a win condition.
 */
export const SKY_TALON = defineCard({
  name: 'Sky Talon',
  id: 'card_troop_sky_talon',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 8,
  description: 'Flying hunter. Attacks air only, with bonus damage to fliers.',
  tint: '#7fa8e0',
  modelId: 'skyTalon',
  baseHealth: 1050,
  massWeight: 25,
  speedClass: 'VeryFast',
  isFlying: true,
  bodyRadius: 0.44,
  targetPriority: 'AirOnly',
  attackRange: 1.2,
  sightRange: 6.0,
  hitSpeed: 1.1,
  damage: 200,
  firstAttackDelay: 0.3,
  passiveId: 'air_superiority',
  passiveMagnitude: 0.5,
});

/**
 * 4 aether = 4000 EPP building. Air superiority costs 150 -> 3850.
 * Buildings take HP share 70% and a x1.25 decay bonus (25s lifetime).
 * Long range 6.5 -> HP x0.35, which is the whole point: it out-ranges most
 * air but folds to any ground troop that walks up to it.
 */
export const FLAK_NEST = defineCard({
  name: 'Flak Nest',
  id: 'card_building_flak_nest',
  rarity: 'Rare',
  category: 'Building',
  aetherCost: 4,
  unlockArena: 9,
  description: 'Anti-air emplacement. Cannot hit ground troops at all.',
  tint: '#6f8f7f',
  modelId: 'flakNest',
  baseHealth: 700,
  massWeight: 100,
  bodyRadius: 0.85,
  lifetimeSeconds: 25,
  targetPriority: 'AirOnly',
  attackRange: 6.5,
  sightRange: 6.5,
  hitSpeed: 0.9,
  damage: 190,
  firstAttackDelay: 0.5,
  usesProjectile: true,
  passiveId: 'air_superiority',
  passiveMagnitude: 0.3,
});

// ---------------------------------------------------------------------------
// Building-targeting threats
// ---------------------------------------------------------------------------

/**
 * 3 aether = 3000 EPP. Suicide charge costs 280 -> 2720.
 * Buildings-only -> DPS x1.25. Very fast -> HP x0.85. Melee.
 * One enormous hit, then it is gone. Low health so a single defender kills it
 * before contact; the counterplay is intercepting, not out-tanking.
 */
export const POWDER_CART = defineCard({
  name: 'Powder Cart',
  id: 'card_troop_powder_cart',
  rarity: 'Rare',
  category: 'Troop',
  aetherCost: 3,
  unlockArena: 6,
  description: 'Rolls at buildings and detonates on contact, destroying itself.',
  tint: '#b06f4f',
  modelId: 'powderCart',
  baseHealth: 700,
  massWeight: 45,
  speedClass: 'VeryFast',
  bodyRadius: 0.48,
  targetPriority: 'Buildings',
  attackRange: 1.2,
  sightRange: 5.5,
  hitSpeed: 1.5,
  damage: 260,
  firstAttackDelay: 0.3,
  passiveId: 'suicide_charge',
  passiveMagnitude: 3.0,
});

/**
 * 5 aether = 5000 EPP. Terrain walk costs 260 -> 4740.
 * Buildings-only -> DPS x1.25. Melee, medium speed.
 * Crosses the river anywhere instead of funnelling to a bridge, so the usual
 * "hold both bridges" defence does not apply to it.
 */
export const MARSH_WALKER = defineCard({
  name: 'Marsh Walker',
  id: 'card_troop_marsh_walker',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 5,
  unlockArena: 11,
  description: 'Wades across the river anywhere. Targets buildings only.',
  tint: '#5f8f6f',
  modelId: 'marshWalker',
  baseHealth: 2050,
  massWeight: 70,
  speedClass: 'Medium',
  bodyRadius: 0.55,
  targetPriority: 'Buildings',
  attackRange: 1.2,
  sightRange: 5.5,
  hitSpeed: 1.4,
  damage: 300,
  firstAttackDelay: 0.5,
  passiveId: 'terrain_walk',
  passiveMagnitude: 1,
});

// ---------------------------------------------------------------------------
// Ground specialists
// ---------------------------------------------------------------------------

/**
 * 4 aether = 4000 EPP. Burrow costs 310 -> 3690.
 * Melee, ground, fast. Untargetable while travelling, so it reaches the fight
 * intact — but it surfaces to attack and can be answered normally from there.
 */
export const SAND_BURROWER = defineCard({
  name: 'Sand Burrower',
  id: 'card_troop_sand_burrower',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 10,
  description: 'Untargetable while moving. Surfaces to attack.',
  tint: '#c8a870',
  modelId: 'sandBurrower',
  baseHealth: 1220,
  massWeight: 50,
  speedClass: 'Fast',
  bodyRadius: 0.48,
  targetPriority: 'Ground',
  attackRange: 1.2,
  sightRange: 5.0,
  hitSpeed: 1.2,
  damage: 230,
  firstAttackDelay: 0.4,
  passiveId: 'burrow',
  passiveMagnitude: 1,
});

/**
 * 5 aether = 5000 EPP. Frontal armour costs 220 -> 4780.
 * Melee, ground, very slow. Enormous health from the front, ordinary from
 * behind — so the answer is to pull it with a cheap unit and hit its back.
 */
export const BASTION_TURTLE = defineCard({
  name: 'Bastion Turtle',
  id: 'card_troop_bastion_turtle',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 5,
  unlockArena: 9,
  description: 'Takes 45% less damage from whatever it is facing.',
  tint: '#6f9f8f',
  modelId: 'bastionTurtle',
  baseHealth: 2450,
  massWeight: 95,
  speedClass: 'VerySlow',
  bodyRadius: 0.7,
  targetPriority: 'Ground',
  attackRange: 1.2,
  sightRange: 5.0,
  hitSpeed: 1.7,
  damage: 240,
  firstAttackDelay: 0.6,
  passiveId: 'frontal_armor',
  passiveMagnitude: 0.45,
});

/**
 * 4 aether = 4000 EPP. Self replicate costs 290 -> 3710.
 * Melee, ground, fast. The first blow it takes produces a half-strength copy,
 * so trading one unit into it is always a losing trade — but splash hits both.
 */
export const MIRROR_SHADE = defineCard({
  name: 'Mirror Shade',
  id: 'card_troop_mirror_shade',
  rarity: 'Legendary',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 13,
  description: 'Splits off a half-strength copy the first time it is damaged.',
  tint: '#9f7fc0',
  modelId: 'mirrorShade',
  baseHealth: 1180,
  massWeight: 35,
  speedClass: 'Fast',
  bodyRadius: 0.45,
  targetPriority: 'Ground',
  attackRange: 1.2,
  sightRange: 5.5,
  hitSpeed: 1.2,
  damage: 195,
  firstAttackDelay: 0.4,
  passiveId: 'self_replicate',
  passiveMagnitude: 0.5,
});

/**
 * 4 aether = 4000 EPP. Blink strike costs 200 -> 3800.
 * Melee, ground, fast. Arrives already on top of the nearest defender, which
 * skips the walk entirely — the trade is that it cannot be placed safely.
 */
export const VOID_STALKER = defineCard({
  name: 'Void Stalker',
  id: 'card_troop_void_stalker',
  rarity: 'Legendary',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 14,
  description: 'Teleports to the nearest enemy troop on deployment.',
  tint: '#6f5f9f',
  modelId: 'voidStalker',
  baseHealth: 1080,
  massWeight: 40,
  speedClass: 'Fast',
  bodyRadius: 0.46,
  targetPriority: 'Ground',
  attackRange: 1.2,
  sightRange: 5.5,
  hitSpeed: 1.0,
  damage: 210,
  firstAttackDelay: 0.3,
  passiveId: 'blink_strike',
  passiveMagnitude: 9.0,
});

/**
 * 3 aether = 3000 EPP. Pack bond costs 170 -> 2830.
 * Melee, ground, fast, two bodies -> x1.3 swarm allowance.
 * Weak alone, rages with company — a card that rewards committing rather than
 * dribbling units in one at a time.
 */
export const PACK_ALPHA = defineCard({
  name: 'Pack Alphas',
  id: 'card_troop_pack_alphas',
  rarity: 'Rare',
  category: 'Troop',
  aetherCost: 3,
  unlockArena: 5,
  description: 'Two beasts that enrage while allies stand near them.',
  tint: '#a87f5f',
  modelId: 'packAlpha',
  baseHealth: 620,
  spawnCount: 2,
  massWeight: 35,
  speedClass: 'Fast',
  bodyRadius: 0.42,
  targetPriority: 'Ground',
  attackRange: 1.2,
  sightRange: 5.0,
  hitSpeed: 1.2,
  damage: 155,
  firstAttackDelay: 0.4,
  passiveId: 'pack_bond',
  passiveMagnitude: 1,
});

/**
 * 5 aether = 5000 EPP. Shield breaker costs 130 -> 4870.
 * Melee, ground, slow, small splash 1.2 -> DPS x0.65.
 * Ordinary against a bare troop, brutal against anything shielded — a
 * deliberate answer to the shield and evolution cards.
 */
export const AEGIS_BREAKER = defineCard({
  name: 'Aegis Breaker',
  id: 'card_troop_aegis_breaker',
  rarity: 'Rare',
  category: 'Troop',
  aetherCost: 5,
  unlockArena: 7,
  description: 'Deals 80% bonus damage to shielded enemies. Small splash.',
  tint: '#8f6f4f',
  modelId: 'aegisBreaker',
  baseHealth: 2000,
  massWeight: 75,
  speedClass: 'Slow',
  bodyRadius: 0.58,
  targetPriority: 'Ground',
  attackRange: 1.2,
  sightRange: 5.5,
  hitSpeed: 1.6,
  damage: 250,
  damageType: 'AreaSplash',
  splashRadius: 1.2,
  firstAttackDelay: 0.5,
  passiveId: 'shield_breaker',
  passiveMagnitude: 0.8,
});

// ---------------------------------------------------------------------------
// Air-and-ground support
// ---------------------------------------------------------------------------

/**
 * 4 aether = 4000 EPP. Damage aura costs 270 -> 3730.
 * Medium range 5.0 -> HP x0.6. Air and ground -> DPS x0.85.
 * The aura is the card: its own damage is poor, and it dies to a Fireball, so
 * it has to be protected to be worth playing.
 */
export const WAR_BANNER = defineCard({
  name: 'Banner Sergeant',
  id: 'card_troop_banner_sergeant',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 8,
  description: 'Enrages nearby allies, making them attack and move faster.',
  tint: '#c05f5f',
  modelId: 'warBanner',
  baseHealth: 700,
  massWeight: 30,
  speedClass: 'Medium',
  bodyRadius: 0.42,
  targetPriority: 'AirAndGround',
  attackRange: 5.0,
  sightRange: 5.5,
  hitSpeed: 1.5,
  damage: 105,
  firstAttackDelay: 0.5,
  usesProjectile: true,
  passiveId: 'aura_damage',
  passiveMagnitude: 3.5,
});

/**
 * 4 aether = 4000 EPP. Damage share costs 230 -> 3770.
 * Medium range 5.0 -> HP x0.6. Air and ground -> DPS x0.85.
 * Redistributes rather than reduces: it survives focus fire by bleeding half
 * of it into whatever ally is closest, so it is worse, not better, alone.
 */
export const BOUND_KEEPER = defineCard({
  name: 'Bound Keeper',
  id: 'card_troop_bound_keeper',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 12,
  description: 'Passes half of all damage it takes to the nearest ally.',
  tint: '#5f9fc0',
  modelId: 'boundKeeper',
  baseHealth: 780,
  massWeight: 28,
  speedClass: 'Medium',
  bodyRadius: 0.42,
  targetPriority: 'AirAndGround',
  attackRange: 5.0,
  sightRange: 5.5,
  hitSpeed: 1.3,
  damage: 135,
  firstAttackDelay: 0.5,
  usesProjectile: true,
  passiveId: 'damage_share',
  passiveMagnitude: 0.5,
});

/**
 * 3 aether = 3000 EPP. Growth costs 240 -> 2760.
 * Long range 6.5 -> HP x0.35. Air and ground -> DPS x0.85.
 * Starts in the one-shot band and climbs if left alone, so ignoring it is a
 * real mistake and killing it early is cheap.
 */
export const LONGSHOT = defineCard({
  name: 'Longshot',
  id: 'card_troop_longshot',
  rarity: 'Legendary',
  category: 'Troop',
  aetherCost: 3,
  unlockArena: 13,
  description: 'Very long range. Gains 40 maximum health every second alive.',
  tint: '#9fb05f',
  modelId: 'longshot',
  baseHealth: 340,
  massWeight: 12,
  speedClass: 'Slow',
  bodyRadius: 0.34,
  targetPriority: 'AirAndGround',
  attackRange: 7.5,
  sightRange: 8.0,
  hitSpeed: 1.8,
  damage: 150,
  firstAttackDelay: 0.8,
  usesProjectile: true,
  passiveId: 'growth',
  passiveMagnitude: 40,
});

// ---------------------------------------------------------------------------
// Structures
// ---------------------------------------------------------------------------

/**
 * 5 aether = 5000 EPP building. Spawner costs 330 -> 4670.
 * Building HP share 70%, decay bonus x1.25 (40s lifetime), ground-only.
 * Produces Skeletons on a timer. Value comes from being left alone, so the
 * counter is simply killing it, and it expires on its own regardless.
 */
export const BROOD_MOTHER = defineCard({
  name: 'Brood Nest',
  id: 'card_building_brood_nest',
  rarity: 'Epic',
  category: 'Building',
  aetherCost: 5,
  unlockArena: 11,
  description: 'Spawns a Skeleton every 4 seconds while it stands.',
  tint: '#7f6f8f',
  modelId: 'broodMother',
  baseHealth: 1250,
  massWeight: 100,
  bodyRadius: 0.9,
  lifetimeSeconds: 40,
  targetPriority: 'Ground',
  attackRange: 4.5,
  sightRange: 5.0,
  hitSpeed: 1.4,
  damage: 130,
  firstAttackDelay: 0.5,
  usesProjectile: true,
  deathEffectParam: 'card_troop_skeletons',
  passiveId: 'spawner',
  passiveMagnitude: 4,
});

/**
 * 3 aether = 3000 EPP. Growth costs 240 -> 2760.
 * Melee, ground, very slow, quadruped.
 * A cheap body that becomes a real tank if the opponent ignores it — the
 * inverse of a burst threat, and the reason to answer chip pushes early.
 */
export const SAPLING = defineCard({
  name: 'Sapling Guard',
  id: 'card_troop_sapling_guard',
  rarity: 'Common',
  category: 'Troop',
  aetherCost: 3,
  unlockArena: 4,
  description: 'Slow rooted guard. Gains 60 maximum health every second alive.',
  tint: '#6f9f4f',
  modelId: 'sapling',
  baseHealth: 1150,
  massWeight: 65,
  speedClass: 'VerySlow',
  bodyRadius: 0.52,
  targetPriority: 'Ground',
  attackRange: 1.2,
  sightRange: 5.0,
  hitSpeed: 1.5,
  damage: 170,
  firstAttackDelay: 0.5,
  passiveId: 'growth',
  passiveMagnitude: 60,
});

export const UNIQUE_CARDS_2 = [
  SKY_TALON,
  FLAK_NEST,
  POWDER_CART,
  MARSH_WALKER,
  SAND_BURROWER,
  BASTION_TURTLE,
  MIRROR_SHADE,
  VOID_STALKER,
  PACK_ALPHA,
  AEGIS_BREAKER,
  WAR_BANNER,
  BOUND_KEEPER,
  LONGSHOT,
  BROOD_MOTHER,
  SAPLING,
];
