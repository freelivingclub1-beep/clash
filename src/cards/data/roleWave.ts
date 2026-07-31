/**
 * The role wave.
 *
 * Two kinds of card live here, and both are deliberate.
 *
 * **Near-variants.** A roster gets deep by offering *choices within a job*, not
 * by adding one card per job. Hedge Knight and Knight both stop a ground push
 * for three aether; one has more health, the other hits everything around it.
 * Thornmail Sentinel and Crystal Golem both punish attackers; one only ever
 * answers melee, the other only ever answers shooters. Neither pair has a
 * better half — which one is right depends on the deck across from you.
 *
 * **New archetypes.** Cards whose identity is a decision rather than a stat
 * line: Headsman, whose damage exists only against something already wounded;
 * Duelist, which wants to be pulled off its target constantly and is therefore
 * the exact inverse of Elite Hounds; Ram Runner, which needs a clear lane to
 * be worth its cost at all.
 *
 * Every card is priced through `@cards/balance` like anything else, and a
 * cheap card beating an expensive one is the system working. A one-aether
 * Skeletons pack kills a five-aether Mini PEKKA if it lands behind it; the
 * budget model prices what a card *can* do, not what it does when misplayed.
 */

import { defineCard } from '../schema';

// ---------------------------------------------------------------------------
// Swarm
// ---------------------------------------------------------------------------

/**
 * 2 aether = 2000 EPP. Five bodies -> x2.2 swarm allowance.
 * Very fast -> x0.85 health. Melee, ground.
 *
 * The Skeletons comparison is the whole card: two more aether buys two extra
 * bodies and genuinely quick legs, and the trade is that five tiny bodies in a
 * clump is the single best thing that can happen to a Fireball.
 */
export const SEWER_RATS = defineCard({
  name: 'Sewer Rats',
  id: 'card_troop_sewer_rats',
  rarity: 'Common',
  category: 'Troop',
  aetherCost: 2,
  unlockArena: 3,
  description: 'Five quick, flimsy bodies. Swarms anything that stands still.',
  tint: '#7d7466',
  modelId: 'sewerRat',
  baseHealth: 112,
  spawnCount: 5,
  massWeight: 5,
  speedClass: 'VeryFast',
  bodyRadius: 0.22,
  targetPriority: 'Ground',
  attackRange: 0.4,
  sightRange: 5.0,
  hitSpeed: 0.9,
  damage: 60,
  firstAttackDelay: 0.3,
});

// ---------------------------------------------------------------------------
// Melee
// ---------------------------------------------------------------------------

/**
 * 3 aether = 3000 EPP. Melee band, ground, medium.
 *
 * Reach is the card. At 2.2 tiles it connects from behind a friendly body, so
 * it fights over a tank instead of queuing behind one — and it is priced as
 * melee because it still has to walk into the fight to do it. Ground only, so
 * it answers nothing that flies.
 */
export const PIKE_SENTRY = defineCard({
  name: 'Pike Sentry',
  id: 'card_troop_pike_sentry',
  rarity: 'Common',
  category: 'Troop',
  aetherCost: 3,
  unlockArena: 4,
  description: 'Long reach — strikes over the unit in front of it.',
  tint: '#8f9bb0',
  modelId: 'pikeSentry',
  baseHealth: 960,
  massWeight: 30,
  speedClass: 'Medium',
  bodyRadius: 0.4,
  targetPriority: 'Ground',
  attackRange: 2.2,
  sightRange: 5.5,
  hitSpeed: 1.2,
  damage: 195,
  firstAttackDelay: 0.4,
});

/**
 * 3 aether = 3000 EPP. Small splash 1.0 -> DPS x0.65. Melee, ground.
 *
 * The Knight variant. Knight has half again the health and hits one thing;
 * this hits the whole clump for less. Against a lone Mini PEKKA the Knight is
 * plainly better, against Goblins it is plainly worse, and that is the choice.
 */
export const HEDGE_KNIGHT = defineCard({
  name: 'Hedge Knight',
  id: 'card_troop_hedge_knight',
  rarity: 'Rare',
  category: 'Troop',
  aetherCost: 3,
  unlockArena: 5,
  description: 'Sweeping blows. Less sturdy than a Knight, but hits the crowd.',
  tint: '#6d8a6f',
  modelId: 'hedgeKnight',
  baseHealth: 1180,
  massWeight: 42,
  speedClass: 'Medium',
  bodyRadius: 0.45,
  targetPriority: 'Ground',
  attackRange: 1.1,
  sightRange: 5.5,
  hitSpeed: 1.2,
  damage: 175,
  damageType: 'AreaSplash',
  splashRadius: 1.0,
  firstAttackDelay: 0.4,
});

/**
 * 4 aether = 4000 EPP. `reflect_melee` costs 290 -> 3710. Melee, ground.
 *
 * Crystal Golem's opposite number. Against a Musketeer this does nothing that
 * an ordinary body would not; against a Mini PEKKA it turns the trade around
 * entirely. Reading which of those your opponent leads with is the card.
 */
export const THORNMAIL_SENTINEL = defineCard({
  name: 'Thornmail Sentinel',
  id: 'card_troop_thornmail_sentinel',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 9,
  description: 'Returns part of every melee blow to whoever swung it.',
  tint: '#5f6d7e',
  modelId: 'thornmail',
  baseHealth: 1560,
  massWeight: 55,
  speedClass: 'Medium',
  bodyRadius: 0.5,
  targetPriority: 'Ground',
  attackRange: 1.2,
  sightRange: 5.5,
  hitSpeed: 1.3,
  damage: 165,
  firstAttackDelay: 0.4,
  passiveId: 'reflect_melee',
  // Share of each melee blow returned to the attacker.
  passiveMagnitude: 0.45,
});

/**
 * 4 aether = 4000 EPP. `execute_low_hp` costs 260 -> 3740. Melee, ground.
 *
 * A timing card. Dropped on a fresh push it is a slightly weak four-cost body;
 * dropped a beat later, once the tower has taken the front line below half,
 * it clears the whole thing. Playing it early is the mistake the card is built
 * to punish.
 */
export const HEADSMAN = defineCard({
  name: 'Headsman',
  id: 'card_troop_headsman',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 10,
  description: 'Hits far harder against anything already below half health.',
  tint: '#7a4650',
  modelId: 'headsman',
  baseHealth: 1300,
  massWeight: 52,
  speedClass: 'Medium',
  bodyRadius: 0.48,
  targetPriority: 'Ground',
  attackRange: 1.2,
  sightRange: 5.5,
  hitSpeed: 1.4,
  damage: 210,
  firstAttackDelay: 0.5,
  passiveId: 'execute_low_hp',
  // Extra damage, as a share of the base hit, against wounded targets.
  passiveMagnitude: 1.1,
});

/**
 * 3 aether = 3000 EPP. `first_strike` costs 300 -> 2700. Melee, ground.
 *
 * The inverse of Elite Hounds, on purpose. The hounds want one target for
 * seven seconds; this wants a new target every swing. Send it into a swarm and
 * it is excellent, send it into a lone tank and it is a three-cost body with a
 * mediocre stat line.
 */
export const DUELIST = defineCard({
  name: 'Duelist',
  id: 'card_troop_duelist',
  rarity: 'Rare',
  category: 'Troop',
  aetherCost: 3,
  unlockArena: 6,
  description: 'The opening blow on each new opponent lands twice as hard.',
  tint: '#a8577c',
  modelId: 'duelist',
  baseHealth: 880,
  massWeight: 34,
  speedClass: 'Fast',
  bodyRadius: 0.38,
  targetPriority: 'Ground',
  attackRange: 1.0,
  sightRange: 5.5,
  hitSpeed: 1.1,
  damage: 160,
  firstAttackDelay: 0.35,
  passiveId: 'first_strike',
  // Bonus on the opening blow, as a share of the base hit.
  passiveMagnitude: 1.0,
});

// ---------------------------------------------------------------------------
// Ranged
// ---------------------------------------------------------------------------

/**
 * 2 aether = 2000 EPP. Short band -> x0.85 health, very fast -> x0.85 again,
 * air-and-ground -> x0.85 DPS.
 *
 * Fast enough to reposition mid-fight and frail enough that being caught once
 * ends it. The skill is entirely in walking it away from what it is shooting.
 */
export const KITE_RUNNER = defineCard({
  name: 'Kite Runner',
  id: 'card_troop_kite_runner',
  rarity: 'Rare',
  category: 'Troop',
  aetherCost: 2,
  unlockArena: 4,
  description: 'Quick skirmisher. Shoots air and ground, folds if it is caught.',
  tint: '#b7a05e',
  modelId: 'kiteRunner',
  baseHealth: 245,
  massWeight: 14,
  speedClass: 'VeryFast',
  bodyRadius: 0.3,
  targetPriority: 'AirAndGround',
  attackRange: 4.5,
  sightRange: 5.5,
  hitSpeed: 1.0,
  damage: 104,
  firstAttackDelay: 0.5,
  usesProjectile: true,
});

/**
 * 5 aether = 5000 EPP. Long band -> x0.35 health. Ground only.
 *
 * Reach as an identity: it outranges every defensive building in the game and
 * can shell a tower from outside the tower's own range. The price is a body
 * that any spell kills and no answer whatsoever to air.
 */
export const CULVERIN = defineCard({
  name: 'Culverin',
  id: 'card_troop_culverin',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 5,
  unlockArena: 11,
  description: 'Shells targets from outside tower range. Helpless up close.',
  tint: '#6a6f78',
  modelId: 'culverin',
  baseHealth: 620,
  massWeight: 40,
  speedClass: 'Slow',
  bodyRadius: 0.45,
  targetPriority: 'Ground',
  attackRange: 8.0,
  sightRange: 9.0,
  hitSpeed: 2.4,
  damage: 460,
  damageType: 'AreaSplash',
  splashRadius: 1.2,
  firstAttackDelay: 1.0,
  usesProjectile: true,
});

// ---------------------------------------------------------------------------
// Support
// ---------------------------------------------------------------------------

/**
 * 3 aether = 3000 EPP. `aura_damage` costs 270 -> 2730. Medium band, ground.
 *
 * Banner Sergeant for one less aether: the same aura, a smaller radius, and a
 * body that dies to the spell that used to only strip the Sergeant's support.
 * Cheap enough to fit a deck that cannot spare four aether on a buff.
 */
export const WARHORN_HERALD = defineCard({
  name: 'Warhorn Herald',
  id: 'card_troop_warhorn_herald',
  rarity: 'Rare',
  category: 'Troop',
  aetherCost: 3,
  unlockArena: 7,
  description: 'Nearby allies hit harder while it lives. Frail on its own.',
  tint: '#c08a3e',
  modelId: 'warhornHerald',
  baseHealth: 560,
  massWeight: 24,
  speedClass: 'Medium',
  bodyRadius: 0.36,
  targetPriority: 'AirAndGround',
  attackRange: 5.0,
  sightRange: 5.5,
  hitSpeed: 1.4,
  damage: 88,
  firstAttackDelay: 0.6,
  usesProjectile: true,
  passiveId: 'aura_damage',
  // Radius of the buff, in tiles — a third less than the Sergeant's.
  passiveMagnitude: 2.6,
});

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

/**
 * 5 aether = 5000 EPP. `spawner` costs 2600 -> 2400, x1.25 decay bonus.
 *
 * Brood Nest trickles two bodies at a time and defends itself; this produces
 * one cheap body more often and cannot attack at all. Same job, opposite
 * shape: the Nest wants to be placed defensively, this wants to be placed
 * early and left alone to build a lane.
 */
export const BELL_TOWER = defineCard({
  name: 'Bell Tower',
  id: 'card_building_bell_tower',
  rarity: 'Epic',
  category: 'Building',
  aetherCost: 5,
  unlockArena: 8,
  description: 'Rings out a skeleton every few seconds. Cannot defend itself.',
  tint: '#9a8f7a',
  modelId: 'bellTower',
  baseHealth: 1450,
  massWeight: 100,
  speedClass: 'Medium',
  bodyRadius: 0.75,
  targetPriority: 'Ground',
  attackRange: 0,
  sightRange: 0,
  hitSpeed: 1,
  damage: 0,
  lifetimeSeconds: 40,
  passiveId: 'spawner',
  // Seconds between spawns.
  passiveMagnitude: 3.2,
  deathEffectParam: 'card_troop_skeletons',
});

// ---------------------------------------------------------------------------
// Win conditions
// ---------------------------------------------------------------------------

/**
 * 4 aether = 4000 EPP. `charge` costs 300 -> 3700, buildings-only -> x1.25 DPS.
 *
 * A win condition that has to be *placed*, not just played. Dropped at the
 * bridge it arrives at a walk and hits like an ordinary four-cost; dropped at
 * the back with a clear lane it arrives at speed and lands a doubled blow. Any
 * body in its path, anywhere along the run, takes both of those away.
 */
export const RAM_RUNNER = defineCard({
  name: 'Ram Runner',
  id: 'card_troop_ram_runner',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 10,
  description: 'Builds speed over open ground, then slams a building twice as hard.',
  tint: '#8a6b4a',
  modelId: 'ramRunner',
  baseHealth: 1450,
  massWeight: 62,
  speedClass: 'Medium',
  bodyRadius: 0.5,
  targetPriority: 'Buildings',
  attackRange: 1.2,
  sightRange: 5.5,
  hitSpeed: 1.5,
  damage: 300,
  firstAttackDelay: 0.5,
  passiveId: 'charge',
  // Tiles of uninterrupted travel before the charge triggers.
  passiveMagnitude: 5.0,
});

/**
 * 3 aether = 3000 EPP. `suicide_charge` costs 280 -> 2720. Two bodies -> x1.3.
 * Buildings-only -> x1.25 DPS.
 *
 * Powder Cart split in half. One cart is a single answerable object; two
 * sappers means a spell that kills one still leaves the other arriving, and
 * they can be split across two lanes. The trade is that each body alone does
 * far less than the cart did.
 */
export const SAPPER_CREW = defineCard({
  name: 'Sapper Crew',
  id: 'card_troop_sapper_crew',
  rarity: 'Rare',
  category: 'Troop',
  aetherCost: 3,
  unlockArena: 7,
  description: 'Two sappers that detonate on the first building they reach.',
  tint: '#9c6b4f',
  modelId: 'sapper',
  baseHealth: 260,
  spawnCount: 2,
  massWeight: 16,
  speedClass: 'Fast',
  bodyRadius: 0.28,
  targetPriority: 'Buildings',
  attackRange: 0.8,
  sightRange: 5.0,
  hitSpeed: 1.6,
  damage: 240,
  firstAttackDelay: 0.4,
  passiveId: 'suicide_charge',
  // Share of its damage dealt again as the blast, then it dies.
  passiveMagnitude: 1.5,
});

/**
 * 5 aether = 5000 EPP. Flying -> x0.8 health, buildings-only -> x1.25 DPS.
 * `death_split` costs 220 -> 4780.
 *
 * Storm Drake's slower, softer cousin. The Drake bullies a tower down; this
 * one is answered easily in the air and then leaves two ground bodies behind
 * when it dies, so killing it over their side of the river still costs them
 * something.
 */
export const SKY_SKIFF = defineCard({
  name: 'Sky Skiff',
  id: 'card_troop_sky_skiff',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 5,
  unlockArena: 12,
  description: 'Floats to the nearest building and drops its crew when it falls.',
  tint: '#7f93a8',
  modelId: 'skySkiff',
  baseHealth: 1500,
  massWeight: 44,
  speedClass: 'Slow',
  bodyRadius: 0.5,
  isFlying: true,
  targetPriority: 'Buildings',
  attackRange: 1.6,
  sightRange: 5.5,
  hitSpeed: 1.8,
  damage: 400,
  firstAttackDelay: 0.6,
  passiveId: 'death_split',
  // Bodies dropped on death.
  passiveMagnitude: 2,
  deathEffectParam: 'card_troop_goblins',
});

export const ROLE_WAVE_CARDS = [
  SEWER_RATS,
  PIKE_SENTRY,
  HEDGE_KNIGHT,
  THORNMAIL_SENTINEL,
  HEADSMAN,
  DUELIST,
  KITE_RUNNER,
  CULVERIN,
  WARHORN_HERALD,
  BELL_TOWER,
  RAM_RUNNER,
  SAPPER_CREW,
  SKY_SKIFF,
];
