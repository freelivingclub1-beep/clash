/**
 * Third wave of unique cards.
 *
 * Same discipline as the previous two: an aether cost sets the allowance, one
 * mechanic is paid for out of it, the reach/splash/flight/speed/swarm
 * modifiers apply, and what remains buys stats. The comment above each card
 * shows the arithmetic; `tests/balance.test.ts` re-derives it and fails the
 * build if a card drifts.
 *
 * This wave fills gaps the first two left rather than adding more of what the
 * roster already had:
 *
 *   - a **1-aether** card, since nothing but Skeletons occupied that slot and
 *     cheap cycle cards are what make a deck's rotation work;
 *   - a **Champion**, because two was thin for a slot every deck must fill;
 *   - two **spells**, which had been untouched since the original three;
 *   - the first **air-only building-targeting** threat, a combination no
 *     existing card covered.
 */

import { defineCard } from '../schema';

// ---------------------------------------------------------------------------
// Cycle
// ---------------------------------------------------------------------------

/**
 * 1 aether = 1000 EPP. No passive.
 * Melee, ground, very fast -> HP x0.85. Two bodies -> x1.3 swarm allowance.
 * The cheapest body in the game: it exists to rotate a deck back to its win
 * condition, and dies to literally any splash.
 */
export const CINDER_IMPS = defineCard({
  name: 'Cinder Imps',
  id: 'card_troop_cinder_imps',
  rarity: 'Common',
  category: 'Troop',
  aetherCost: 1,
  unlockArena: 2,
  description: 'Two tiny fast attackers. The cheapest way to cycle a deck.',
  tint: '#e08a5f',
  modelId: 'cinderImp',
  baseHealth: 140,
  spawnCount: 2,
  massWeight: 6,
  speedClass: 'VeryFast',
  bodyRadius: 0.28,
  targetPriority: 'Ground',
  attackRange: 0.8,
  sightRange: 4.5,
  hitSpeed: 1.1,
  damage: 78,
  firstAttackDelay: 0.3,
});

/**
 * 2 aether = 2000 EPP. Blink strike costs 200 -> 1800.
 * Medium range 5.0 -> HP x0.6. Air and ground -> DPS x0.85.
 * A cheap ranged body that arrives already in position. Fragile enough that
 * arriving next to the fight is frequently a mistake.
 */
export const DART_ACOLYTE = defineCard({
  name: 'Dart Acolyte',
  id: 'card_troop_dart_acolyte',
  rarity: 'Common',
  category: 'Troop',
  aetherCost: 2,
  unlockArena: 3,
  description: 'Cheap ranged attacker that blinks to the nearest enemy on drop.',
  tint: '#9fc0e0',
  modelId: 'dartAcolyte',
  baseHealth: 300,
  massWeight: 10,
  speedClass: 'Fast',
  bodyRadius: 0.32,
  targetPriority: 'AirAndGround',
  attackRange: 5.0,
  sightRange: 5.5,
  hitSpeed: 1.4,
  damage: 105,
  firstAttackDelay: 0.4,
  usesProjectile: true,
  passiveId: 'blink_strike',
  passiveMagnitude: 6.0,
});

// ---------------------------------------------------------------------------
// Heavy threats
// ---------------------------------------------------------------------------

/**
 * 6 aether = 6000 EPP. Death split costs 220 -> 5780.
 * Melee, buildings-only -> DPS x1.25. Very slow.
 * The biggest body in the game, and it leaves two Bulwarks behind. Answering
 * it once is not answering it — but it is slow enough to be answered twice.
 */
export const OBSIDIAN_COLOSSUS = defineCard({
  name: 'Obsidian Colossus',
  id: 'card_troop_obsidian_colossus',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 6,
  unlockArena: 12,
  description: 'Huge, slow, targets buildings. Leaves two Bulwarks when destroyed.',
  tint: '#4f4a5f',
  modelId: 'obsidianColossus',
  baseHealth: 3900,
  massWeight: 100,
  speedClass: 'VerySlow',
  bodyRadius: 0.8,
  targetPriority: 'Buildings',
  attackRange: 1.2,
  sightRange: 5.5,
  hitSpeed: 1.7,
  damage: 340,
  firstAttackDelay: 0.6,
  deathEffect: 'SpawnDeathUnit',
  deathEffectParam: 'card_troop_bulwark',
  deathEffectCount: 2,
  passiveId: 'death_split',
  passiveMagnitude: 2,
});

/**
 * 5 aether = 5000 EPP. Siege bonus costs 210 -> 4790.
 * Flying -> HP x0.8. Buildings-only -> DPS x1.25. Melee reach.
 * A flying win condition: it ignores the river and every ground blocker, so
 * the only answers are air-capable defenders — which is exactly what the
 * anti-air cards added in the last wave exist for.
 */
export const STORM_DRAKE = defineCard({
  name: 'Storm Drake',
  id: 'card_troop_storm_drake',
  rarity: 'Legendary',
  category: 'Troop',
  aetherCost: 5,
  unlockArena: 14,
  description: 'Flying siege beast. Ignores ground defenders and hits buildings only.',
  tint: '#6f7fc0',
  modelId: 'stormDrake',
  baseHealth: 1900,
  massWeight: 60,
  speedClass: 'Medium',
  isFlying: true,
  bodyRadius: 0.62,
  targetPriority: 'Buildings',
  attackRange: 1.2,
  sightRange: 5.5,
  hitSpeed: 1.5,
  damage: 310,
  firstAttackDelay: 0.5,
  passiveId: 'siege_bonus',
  passiveMagnitude: 0.5,
});

// ---------------------------------------------------------------------------
// Control
// ---------------------------------------------------------------------------

/**
 * 4 aether = 4000 EPP. Displacement costs 180 -> 3820.
 * Medium range 5.5 -> HP x0.6. Air and ground -> DPS x0.85, wide splash 1.8
 * -> DPS x0.45. Two heavy DPS penalties, so it deals almost nothing and
 * exists purely to shove a push back off the bridge.
 */
export const TIDE_CALLER = defineCard({
  name: 'Tide Caller',
  id: 'card_troop_tide_caller',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 10,
  description: 'Washes groups of enemies backward. Wide splash, very low damage.',
  tint: '#4fa0b0',
  modelId: 'tideCaller',
  baseHealth: 800,
  massWeight: 25,
  speedClass: 'Medium',
  bodyRadius: 0.42,
  targetPriority: 'AirAndGround',
  attackRange: 5.5,
  sightRange: 6.0,
  hitSpeed: 1.6,
  damage: 70,
  damageType: 'AreaSplash',
  splashRadius: 1.8,
  firstAttackDelay: 0.5,
  usesProjectile: true,
  passiveId: 'displacement',
  passiveMagnitude: 0.7,
});

/**
 * 3 aether = 3000 EPP. Aura slow costs 230 -> 2770.
 * Building HP share 70%, decay bonus x1.25 (20s life). Ground-only, no attack
 * range worth the name — it does not shoot, it just makes everything near it
 * crawl. The cheapest way to stall a push.
 */
export const FROST_PYLON = defineCard({
  name: 'Frost Pylon',
  id: 'card_building_frost_pylon',
  rarity: 'Rare',
  category: 'Building',
  aetherCost: 3,
  unlockArena: 7,
  description: 'Chills a wide area, slowing every enemy near it. Barely attacks.',
  tint: '#8fc0d8',
  modelId: 'frostPylon',
  baseHealth: 1750,
  massWeight: 100,
  bodyRadius: 0.8,
  lifetimeSeconds: 20,
  targetPriority: 'Ground',
  attackRange: 3.5,
  sightRange: 4.0,
  hitSpeed: 2.0,
  damage: 122,
  firstAttackDelay: 0.6,
  usesProjectile: true,
  passiveId: 'aura_slow',
  passiveMagnitude: 0.55,
});

/**
 * 4 aether = 4000 EPP. Pack bond costs 170 -> 3830.
 * Melee, ground, medium, four bodies -> x1.9 swarm allowance.
 * Individually weak enough to die to Arrows; together, with the pack bonus
 * active, they shred a lone tank. The counter is splash, as it should be.
 */
export const THORN_WARDENS = defineCard({
  name: 'Thorn Wardens',
  id: 'card_troop_thorn_wardens',
  rarity: 'Rare',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 6,
  description: 'Four fighters that grow stronger while the pack stays together.',
  tint: '#7f9f5f',
  modelId: 'thornWarden',
  baseHealth: 500,
  spawnCount: 4,
  massWeight: 30,
  speedClass: 'Medium',
  bodyRadius: 0.38,
  targetPriority: 'Ground',
  attackRange: 0.8,
  sightRange: 5.0,
  hitSpeed: 1.3,
  damage: 140,
  firstAttackDelay: 0.4,
  passiveId: 'pack_bond',
  passiveMagnitude: 2,
});

// ---------------------------------------------------------------------------
// Champion
// ---------------------------------------------------------------------------

/**
 * 5 aether = 5000 EPP. Champion bonus x1.25, spawn shield costs 160 -> 4840.
 * Melee, ground, medium. Ability is a Heavy Slam: area damage plus a stun,
 * which is the crowd-control answer no existing champion provided.
 */
export const STONE_WARDEN = defineCard({
  name: 'Stone Warden',
  id: 'card_troop_stone_warden',
  rarity: 'Champion',
  category: 'Troop',
  aetherCost: 5,
  unlockArena: 15,
  description: 'Champion. Slams the ground, damaging and stunning everything nearby.',
  tint: '#a09070',
  modelId: 'stoneWarden',
  baseHealth: 3000,
  massWeight: 90,
  speedClass: 'Medium',
  bodyRadius: 0.58,
  targetPriority: 'Ground',
  attackRange: 1.2,
  sightRange: 5.5,
  hitSpeed: 1.4,
  damage: 290,
  firstAttackDelay: 0.5,
  passiveId: 'spawn_shield',
  passiveMagnitude: 0.25,
  isHero: true,
  abilityAetherCost: 2,
  abilityCooldown: 14,
  abilityActionHook: 'HeavySlam',
  abilityTargetFilter: 'BroadArea',
  abilityDamage: 320,
  abilityRadius: 4.0,
  abilityDurationSeconds: 1.5,
});

// ---------------------------------------------------------------------------
// Spells
// ---------------------------------------------------------------------------

/**
 * Balanced by breakpoint, not by EPP (see `SPELL_BREAKPOINTS`).
 *
 * 3 aether. Damage is low for the cost because the value is the freeze: it
 * buys time rather than trading. Deliberately does not kill Archers, so it
 * cannot double as a cheap Arrows.
 */
export const GLACIER = defineCard({
  name: 'Glacier',
  id: 'card_spell_glacier',
  rarity: 'Epic',
  category: 'Spell',
  aetherCost: 3,
  unlockArena: 9,
  description: 'Freezes everything in a wide area for 2 seconds. Light damage.',
  tint: '#a8d8f0',
  baseHealth: 0,
  damage: 120,
  damageType: 'AreaSplash',
  splashRadius: 3.5,
  attackRange: 0,
  sightRange: 0,
  hitSpeed: 1,
  firstAttackDelay: 0,
  onHitStatus: 'Freeze',
  statusDuration: 2.0,
});

/**
 * 3 aether. A narrow, hard-hitting line rather than a circle — it clears a
 * bridge lane without touching anything to either side, which is a different
 * tool from Arrows despite the similar cost.
 */
export const SUNBEAM = defineCard({
  name: 'Sunbeam',
  id: 'card_spell_sunbeam',
  rarity: 'Rare',
  category: 'Spell',
  aetherCost: 3,
  unlockArena: 8,
  description: 'A tight, high-damage burst. Small radius, hits hard.',
  tint: '#f0d060',
  baseHealth: 0,
  damage: 420,
  damageType: 'AreaSplash',
  splashRadius: 1.6,
  attackRange: 0,
  sightRange: 0,
  hitSpeed: 1,
  firstAttackDelay: 0,
});

export const UNIQUE_CARDS_3 = [
  CINDER_IMPS,
  DART_ACOLYTE,
  OBSIDIAN_COLOSSUS,
  STORM_DRAKE,
  TIDE_CALLER,
  FROST_PYLON,
  THORN_WARDENS,
  STONE_WARDEN,
  GLACIER,
  SUNBEAM,
];
