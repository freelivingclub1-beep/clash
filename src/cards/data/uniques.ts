/**
 * Cards with unique mechanics, each built through the EPP budget system.
 *
 * Every card below follows the same procedure:
 *   1. Pick an aether cost, which sets the raw allowance (1000 EPP each).
 *   2. Pick one "spicy" mechanic and pay its registered EPP price.
 *   3. Apply the reach, splash, flight, speed and swarm modifiers.
 *   4. Spend what remains on health and damage.
 *
 * The comment above each card shows that arithmetic, and
 * `tests/balance.test.ts` re-derives it independently — so a card whose stats
 * drift away from its stated budget fails the build rather than quietly
 * becoming the best card in the game.
 *
 * Descriptions are short on purpose: they say what the card does, not lore.
 */

import { defineCard } from '../schema';

// ---------------------------------------------------------------------------
// Defensive mechanics
// ---------------------------------------------------------------------------

/**
 * 4 aether = 4000 EPP. Reflect costs 250 -> 3750 adjusted.
 * Melee (no range penalty), single target, ground, medium speed.
 * HP share 62% -> ~2325 EPP of health; damage share -> ~1425 EPP / 5s = 285 DPS.
 * Tuned down into the Fireball-survivable band: 1150 HP, 210 dmg / 1.4s = 150 DPS.
 */
export const CRYSTAL_GOLEM = defineCard({
  name: 'Crystal Golem',
  id: 'card_troop_crystal_golem',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 6,
  description: 'Reflects 30% of ranged damage back at the shooter.',
  tint: '#7fd4e0',
  modelId: 'crystalGolem',
  baseHealth: 1150,
  massWeight: 70,
  speedClass: 'Medium',
  bodyRadius: 0.6,
  targetPriority: 'Ground',
  attackRange: 1.2,
  sightRange: 5.5,
  hitSpeed: 1.4,
  damage: 210,
  firstAttackDelay: 0.5,
  passiveId: 'reflect_ranged',
  passiveMagnitude: 0.3,
});

/**
 * 5 aether = 5000 EPP. Parry costs 320 -> 4680.
 * Melee, single target, ground, medium. The parry is the whole card, so health
 * sits low for the cost and the damage is front-loaded into a heavy swing.
 */
export const RONIN = defineCard({
  name: 'Ronin',
  id: 'card_troop_ronin',
  rarity: 'Legendary',
  category: 'Troop',
  aetherCost: 5,
  unlockArena: 12,
  description: 'Negates a melee hit every 3.5s and counters for double damage.',
  tint: '#c9455e',
  modelId: 'ronin',
  baseHealth: 1480,
  massWeight: 50,
  speedClass: 'Fast',
  bodyRadius: 0.5,
  targetPriority: 'Ground',
  attackRange: 1.2,
  sightRange: 5.5,
  hitSpeed: 1.3,
  damage: 300,
  firstAttackDelay: 0.4,
  passiveId: 'parry_melee',
  passiveMagnitude: 2.0,
});

/**
 * 3 aether = 3000 EPP. Spawn shield costs 160 -> 2840.
 * Melee, ground, medium. Shield is 40% of health, so it eats a Zap and a half.
 */
export const BULWARK = defineCard({
  name: 'Bulwark',
  id: 'card_troop_bulwark',
  rarity: 'Rare',
  category: 'Troop',
  aetherCost: 3,
  unlockArena: 4,
  description: 'Enters with a shield worth 40% of its health.',
  tint: '#8a94a8',
  modelId: 'bulwark',
  baseHealth: 1080,
  massWeight: 60,
  speedClass: 'Medium',
  bodyRadius: 0.5,
  targetPriority: 'Ground',
  attackRange: 1.2,
  sightRange: 5.5,
  hitSpeed: 1.3,
  damage: 150,
  firstAttackDelay: 0.4,
  passiveId: 'spawn_shield',
  passiveMagnitude: 0.4,
});

/**
 * 4 aether = 4000 EPP. Immunity costs 300 -> 3700.
 * Melee, ground, slow. Immune to freeze, stun and slow, so the usual
 * "hold it still and shoot it" answer is off the table — but it is slow and
 * single-target, so a swarm still eats it.
 */
export const IRONHIDE = defineCard({
  name: 'Ironhide',
  id: 'card_troop_ironhide',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 8,
  description: 'Cannot be frozen, stunned or slowed.',
  tint: '#6b6f78',
  modelId: 'ironhide',
  baseHealth: 1900,
  massWeight: 85,
  speedClass: 'Slow',
  bodyRadius: 0.62,
  targetPriority: 'Ground',
  attackRange: 1.2,
  sightRange: 5.5,
  hitSpeed: 1.6,
  damage: 260,
  firstAttackDelay: 0.5,
  passiveId: 'damage_immunity',
  passiveMagnitude: 1,
});

// ---------------------------------------------------------------------------
// Offensive mechanics
// ---------------------------------------------------------------------------

/**
 * 4 aether = 4000 EPP. Chain costs 280 -> 3720.
 * Medium range 5.5 -> HP x0.6. Air and ground -> DPS x0.85.
 * Lands in the spell-killable band, which is the trade for hitting three
 * targets at once.
 */
export const ARC_WARDEN = defineCard({
  name: 'Arc Warden',
  id: 'card_troop_arc_warden',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 7,
  description: 'Attacks arc to two nearby enemies for half damage.',
  tint: '#5fd0e8',
  modelId: 'arcWarden',
  baseHealth: 620,
  massWeight: 16,
  speedClass: 'Medium',
  bodyRadius: 0.36,
  targetPriority: 'AirAndGround',
  attackRange: 5.5,
  sightRange: 6.0,
  hitSpeed: 1.3,
  damage: 148,
  firstAttackDelay: 0.5,
  usesProjectile: true,
  passiveId: 'chain_attack',
  passiveMagnitude: 0.5,
});

/**
 * 5 aether = 5000 EPP. Attack ramp costs 240 -> 4760.
 * Medium range 5.0 -> HP x0.6. Ground only, single target.
 * Rewards an uninterrupted channel; resetting its target resets the ramp,
 * so a cheap distraction unit is the counter.
 */
export const SIEGE_DRILL = defineCard({
  name: 'Siege Drill',
  id: 'card_troop_siege_drill',
  rarity: 'Rare',
  category: 'Troop',
  aetherCost: 5,
  unlockArena: 9,
  description: 'Fires faster the longer it holds one target. Resets on target change.',
  tint: '#c08a4f',
  modelId: 'siegeDrill',
  baseHealth: 980,
  massWeight: 65,
  speedClass: 'Slow',
  bodyRadius: 0.55,
  targetPriority: 'Ground',
  attackRange: 5.0,
  sightRange: 5.5,
  hitSpeed: 1.5,
  damage: 240,
  firstAttackDelay: 0.6,
  usesProjectile: true,
  passiveId: 'attack_ramp',
  passiveMagnitude: 8,
});

/**
 * 3 aether = 3000 EPP. Displacement costs 180 -> 2820.
 * Melee, ground, single target. Every hit shoves the victim back, which stalls
 * a push at the bridge — but it deals very little damage doing it.
 */
export const GALE_MONK = defineCard({
  name: 'Gale Monk',
  id: 'card_troop_gale_monk',
  rarity: 'Rare',
  category: 'Troop',
  aetherCost: 3,
  unlockArena: 5,
  description: 'Knocks enemies backward with every strike.',
  tint: '#9fe0c0',
  modelId: 'galeMonk',
  baseHealth: 1020,
  massWeight: 40,
  speedClass: 'Medium',
  bodyRadius: 0.45,
  targetPriority: 'Ground',
  attackRange: 1.2,
  sightRange: 5.5,
  hitSpeed: 1.1,
  damage: 110,
  firstAttackDelay: 0.4,
  passiveId: 'displacement',
  passiveMagnitude: 0.55,
});

/**
 * 4 aether = 4000 EPP. Siege bonus costs 210 -> 3790.
 * Melee, buildings-only -> DPS x1.25 (it ignores defenders entirely).
 * Very fast -> HP x0.85. A win condition that has to be answered with a
 * building or a swarm, not with a single tank.
 */
export const BREACHER = defineCard({
  name: 'Breacher',
  id: 'card_troop_breacher',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 10,
  description: 'Targets buildings only. Deals 60% bonus damage to structures.',
  tint: '#d4703f',
  modelId: 'breacher',
  baseHealth: 1420,
  massWeight: 55,
  speedClass: 'VeryFast',
  bodyRadius: 0.5,
  targetPriority: 'Buildings',
  attackRange: 1.2,
  sightRange: 5.5,
  hitSpeed: 1.5,
  damage: 300,
  firstAttackDelay: 0.4,
  passiveId: 'siege_bonus',
  passiveMagnitude: 0.6,
});

// ---------------------------------------------------------------------------
// Support and area control
// ---------------------------------------------------------------------------

/**
 * 4 aether = 4000 EPP. Heal aura costs 260 -> 3740.
 * Medium range 5.0 -> HP x0.6. Air and ground -> DPS x0.85.
 * Low damage by design: the aura is the card, and stacking two is the
 * obvious degenerate line, so it heals a flat amount rather than a percentage.
 */
export const LANTERN_BEARER = defineCard({
  name: 'Lantern Bearer',
  id: 'card_troop_lantern_bearer',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 8,
  description: 'Heals nearby allies 60 health every second.',
  tint: '#e8c86a',
  modelId: 'lanternBearer',
  baseHealth: 760,
  massWeight: 18,
  speedClass: 'Medium',
  bodyRadius: 0.38,
  targetPriority: 'AirAndGround',
  attackRange: 5.0,
  sightRange: 5.5,
  hitSpeed: 1.6,
  damage: 90,
  firstAttackDelay: 0.5,
  usesProjectile: true,
  passiveId: 'aura_heal',
  passiveMagnitude: 60,
});

/**
 * 4 aether = 4000 EPP. Slow aura costs 230 -> 3770.
 * Flying -> HP x0.8. Medium range 5.0 -> HP x0.6. Air and ground -> DPS x0.85.
 * Three stacked penalties, so the health is very low — it dies to Arrows,
 * which is the intended answer to a permanent slow field.
 */
export const FROST_WISP = defineCard({
  name: 'Frost Wisp',
  id: 'card_troop_frost_wisp',
  rarity: 'Legendary',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 11,
  description: 'Slows all nearby enemies to 60% speed while alive.',
  tint: '#a8dcf0',
  modelId: 'frostWisp',
  baseHealth: 500,
  massWeight: 10,
  speedClass: 'Medium',
  isFlying: true,
  bodyRadius: 0.34,
  targetPriority: 'AirAndGround',
  attackRange: 5.0,
  sightRange: 5.5,
  hitSpeed: 1.4,
  damage: 120,
  firstAttackDelay: 0.5,
  usesProjectile: true,
  passiveId: 'aura_slow',
  passiveMagnitude: 0.6,
});

/**
 * 5 aether = 5000 EPP. Death split costs 220 -> 4780.
 * Melee, ground, slow, single target. Splits into four Goblins on death, so
 * killing it is only half the job — but splash damage answers both halves.
 */
export const HIVE_TITAN = defineCard({
  name: 'Hive Titan',
  id: 'card_troop_hive_titan',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 5,
  unlockArena: 9,
  description: 'Splits into four Goblins when destroyed.',
  tint: '#8fa85f',
  modelId: 'hiveTitan',
  baseHealth: 2100,
  massWeight: 80,
  speedClass: 'Slow',
  bodyRadius: 0.65,
  targetPriority: 'Ground',
  attackRange: 1.2,
  sightRange: 5.5,
  hitSpeed: 1.6,
  damage: 250,
  firstAttackDelay: 0.5,
  deathEffect: 'SpawnDeathUnit',
  deathEffectParam: 'card_troop_goblins',
  deathEffectCount: 4,
  passiveId: 'death_split',
  passiveMagnitude: 4,
});

/**
 * 3 aether = 3000 EPP. Death zone costs 200 -> 2800.
 * Melee, ground, fast. Leaves a poison patch where it dies, so trading into
 * it with a swarm costs the swarm too.
 */
export const PLAGUE_BEARER = defineCard({
  name: 'Plague Bearer',
  id: 'card_troop_plague_bearer',
  rarity: 'Rare',
  category: 'Troop',
  aetherCost: 3,
  unlockArena: 6,
  description: 'Leaves a poison cloud on death, damaging enemies for 3s.',
  tint: '#8fb04f',
  modelId: 'plagueBearer',
  baseHealth: 890,
  massWeight: 35,
  speedClass: 'Fast',
  bodyRadius: 0.42,
  targetPriority: 'Ground',
  attackRange: 1.2,
  sightRange: 5.5,
  hitSpeed: 1.2,
  damage: 145,
  firstAttackDelay: 0.4,
  passiveId: 'death_zone',
  passiveMagnitude: 300,
});

/**
 * 2 aether = 2000 EPP. Enrage costs 190 -> 1810.
 * Melee, ground, fast, spawns 2 -> budget halved per unit. Each one is fragile
 * enough to die to Arrows, which is the required counter for any swarm.
 */
export const BERSERKER_PAIR = defineCard({
  name: 'Berserkers',
  id: 'card_troop_berserkers',
  rarity: 'Common',
  category: 'Troop',
  aetherCost: 2,
  unlockArena: 3,
  description: 'Two fighters that rage below 40% health.',
  tint: '#d08f6f',
  modelId: 'berserker',
  baseHealth: 300,
  spawnCount: 2,
  massWeight: 25,
  speedClass: 'Fast',
  bodyRadius: 0.36,
  targetPriority: 'Ground',
  attackRange: 1.2,
  sightRange: 5.5,
  hitSpeed: 1.2,
  damage: 130,
  firstAttackDelay: 0.4,
  passiveId: 'enrage_low_hp',
  passiveMagnitude: 0.4,
});

export const UNIQUE_CARDS = [
  CRYSTAL_GOLEM,
  RONIN,
  BULWARK,
  IRONHIDE,
  ARC_WARDEN,
  SIEGE_DRILL,
  GALE_MONK,
  BREACHER,
  LANTERN_BEARER,
  FROST_WISP,
  HIVE_TITAN,
  PLAGUE_BEARER,
  BERSERKER_PAIR,
];
