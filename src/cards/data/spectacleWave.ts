/**
 * The spectacle wave — cards chosen for what they *look* like doing their job.
 *
 * The complaint that prompted this was fair: nearly every card shot a dot or
 * made a splash ring, so a board full of different mechanics all read the same.
 * These are picked so that the mechanic and the picture are the same thing.
 *
 *   Stormcaller  arcs of lightning jumping between victims
 *   Delver       nothing at all, until earth erupts where you put it
 *   Arc Lance    a bolt that punches through a whole rank in a line
 *   Ember Jack   a lobbed bomb that arcs, casts a shadow and shows its ring
 *   Sky Lantern  drifts over everything and detonates when it dies
 *   Pyre Drake   a beam that visibly winds up the longer it holds
 *
 * Several take their shape from cards in the reference game — a tunneller, a
 * chain-lightning caster, a piercing archer, a flying bomb — with our own names,
 * art and numbers. Stats start from the reference game's tables where a
 * counterpart exists and are then pulled into our own budget, which is not the
 * same curve; the audit is the arbiter, not the source.
 */

import { defineCard } from '../schema';

// ---------------------------------------------------------------------------
// Lightning
// ---------------------------------------------------------------------------

/**
 * 4 aether = 4000 EPP. `chain_attack` costs 280 -> 3720. Medium band.
 *
 * Every shot forks to two more targets and resets what it touches. Against a
 * single tank it is a mediocre four-cost with a slow gun; against three bodies
 * it hits all three and stops every one of them mid-swing. The arcs make that
 * legible — before them, the second and third victims simply lost health with
 * nothing on screen connecting them to the shot.
 */
export const STORMCALLER = defineCard({
  name: 'Stormcaller',
  id: 'card_troop_stormcaller',
  rarity: 'Legendary',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 11,
  description: 'Every bolt forks to two more targets and resets their attacks.',
  tint: '#5fa8d8',
  modelId: 'stormcaller',
  baseHealth: 1120,
  massWeight: 22,
  speedClass: 'Fast',
  bodyRadius: 0.5,
  targetPriority: 'AirAndGround',
  attackRange: 5.0,
  sightRange: 5.5,
  hitSpeed: 1.8,
  damage: 232,
  firstAttackDelay: 1.2,
  usesProjectile: true,
  onHitStatus: 'ElectroReset',
  statusMagnitude: 1,
  statusDuration: 0.5,
  passiveId: 'chain_attack',
  // Share of the base hit dealt to each forked target.
  passiveMagnitude: 0.6,
});

/**
 * 3 aether = 3000 EPP. Two bodies -> x1.3. `chain_attack` costs 280 -> 2720.
 *
 * Stormcaller split in two and stripped of the reset. Half the shot, twice the
 * bodies, and a Fireball answers the pair where it only inconveniences the
 * single. Which of the two you want depends entirely on whether the thing you
 * fear most is a swarm or a spell.
 */
export const BOLT_PAIR = defineCard({
  name: 'Bolt Pair',
  id: 'card_troop_bolt_pair',
  rarity: 'Rare',
  category: 'Troop',
  aetherCost: 3,
  unlockArena: 8,
  description: 'Two small casters whose shots fork to nearby targets.',
  tint: '#6fc0d8',
  modelId: 'boltPair',
  baseHealth: 540,
  spawnCount: 2,
  massWeight: 14,
  speedClass: 'Medium',
  bodyRadius: 0.4,
  targetPriority: 'AirAndGround',
  attackRange: 4.5,
  sightRange: 5.5,
  hitSpeed: 1.6,
  damage: 140,
  firstAttackDelay: 0.9,
  usesProjectile: true,
  passiveId: 'chain_attack',
  // Share of the base hit dealt to each forked target.
  passiveMagnitude: 0.5,
});

// ---------------------------------------------------------------------------
// The tunneller
// ---------------------------------------------------------------------------

/**
 * 4 aether = 4000 EPP. `tunnel` costs 900 -> 3100. Melee, ground, fast.
 *
 * Drops on *any* tile on the board and digs there. Nothing is drawn, nothing is
 * targetable, and nothing tells the defender where it went — only that you
 * spent four aether. The dig time scales with how far across the board you put
 * it, so a Delver behind their king tower gives them several seconds to work it
 * out, and one just over the river gives them almost none.
 *
 * Deliberately fragile once it is up: the card is paying for position, and it
 * cannot also be paid for in stats.
 */
export const DELVER = defineCard({
  name: 'Delver',
  id: 'card_troop_delver',
  rarity: 'Legendary',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 12,
  description: 'Dropped anywhere. Digs there unseen, then bursts out of the ground.',
  tint: '#9a7b52',
  modelId: 'delver',
  baseHealth: 1450,
  massWeight: 26,
  speedClass: 'Fast',
  bodyRadius: 0.5,
  targetPriority: 'Ground',
  attackRange: 1.2,
  sightRange: 5.5,
  hitSpeed: 1.2,
  damage: 290,
  firstAttackDelay: 0.7,
  deployAnywhere: true,
  passiveId: 'tunnel',
  // Seconds of digging per ten tiles travelled from your own back line.
  passiveMagnitude: 2.4,
});

// ---------------------------------------------------------------------------
// The piercing line
// ---------------------------------------------------------------------------

/**
 * 4 aether = 4000 EPP. Long band -> x0.35 health, piercing -> x0.45 DPS.
 *
 * The bolt does not stop at the first body. It runs the whole way to its target
 * and damages everything standing on that line, so a defence queued up behind
 * a tank takes the shot the tank was meant to absorb — and a defence spread
 * wide takes almost nothing. It is the clearest "placement matters" card in the
 * set, in both directions.
 */
export const ARC_LANCE = defineCard({
  name: 'Arc Lance',
  id: 'card_troop_arc_lance',
  rarity: 'Legendary',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 13,
  description: 'Its bolt punches through everything in a line, not just the front.',
  tint: '#c0a85f',
  modelId: 'arcLance',
  baseHealth: 520,
  massWeight: 20,
  speedClass: 'Medium',
  bodyRadius: 0.5,
  targetPriority: 'AirAndGround',
  attackRange: 7.0,
  sightRange: 7.5,
  hitSpeed: 1.6,
  damage: 210,
  damageType: 'PiercingLine',
  // Half-width of the beam, in tiles.
  splashRadius: 0.7,
  firstAttackDelay: 1.0,
  usesProjectile: true,
});

/**
 * 4 aether = 4000 EPP. Long band -> x0.35 health, wide splash -> x0.45 DPS.
 *
 * Outranges every tower in the game and lobs into a wide blast, which makes it
 * the card that punishes a defence standing still. Any body that reaches it
 * removes it — 520 health at four aether is not a mistake, it is the rent.
 */
export const GLOOM_ARCHER = defineCard({
  name: 'Gloom Archer',
  id: 'card_troop_gloom_archer',
  rarity: 'Legendary',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 12,
  description: 'Shoots further than any tower, into a wide blast. Made of paper.',
  tint: '#8f7fa8',
  modelId: 'gloomArcher',
  baseHealth: 552,
  massWeight: 18,
  speedClass: 'Medium',
  bodyRadius: 0.5,
  targetPriority: 'AirAndGround',
  attackRange: 9.0,
  sightRange: 9.5,
  hitSpeed: 3.0,
  damage: 300,
  damageType: 'AreaSplash',
  splashRadius: 2.5,
  firstAttackDelay: 2.5,
  usesProjectile: true,
});

// ---------------------------------------------------------------------------
// Things that explode
// ---------------------------------------------------------------------------

/**
 * 3 aether = 3000 EPP. `death_zone` costs 200 -> 2800. Short band, ground.
 *
 * Lobs bombs that arc, cast a shadow and show their landing ring — and leaves a
 * burning patch where it dies. Standing on top of the corpse is the mistake the
 * card is waiting for.
 */
export const EMBER_JACK = defineCard({
  name: 'Ember Jack',
  id: 'card_troop_ember_jack',
  rarity: 'Rare',
  category: 'Troop',
  aetherCost: 3,
  unlockArena: 7,
  description: 'Lobs firebombs, and leaves the ground burning where it falls.',
  tint: '#c46f3f',
  modelId: 'emberJack',
  baseHealth: 760,
  massWeight: 20,
  speedClass: 'Fast',
  bodyRadius: 0.45,
  targetPriority: 'Ground',
  attackRange: 4.5,
  sightRange: 5.5,
  hitSpeed: 1.5,
  damage: 225,
  damageType: 'AreaSplash',
  splashRadius: 1.4,
  firstAttackDelay: 0.9,
  usesProjectile: true,
  passiveId: 'death_zone',
  // Damage per second left burning where it died.
  passiveMagnitude: 90,
});

/**
 * 5 aether = 5000 EPP. Flying, buildings-only -> x1.25 DPS.
 * `death_split` costs 220 -> 4780.
 *
 * Drifts over every defender straight at the nearest building, hits it
 * enormously hard, and drops burning wreckage when it finally comes down. Any
 * air defence answers it outright; nothing on the ground does.
 */
export const SKY_LANTERN = defineCard({
  name: 'Sky Lantern',
  id: 'card_troop_sky_lantern',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 5,
  unlockArena: 11,
  description: 'Floats over everything to the nearest building. Falls burning.',
  tint: '#c05f5f',
  modelId: 'skyLantern',
  baseHealth: 2100,
  massWeight: 36,
  speedClass: 'Slow',
  bodyRadius: 0.5,
  isFlying: true,
  targetPriority: 'Buildings',
  attackRange: 1.2,
  sightRange: 7.5,
  hitSpeed: 2.0,
  damage: 520,
  firstAttackDelay: 1.8,
  passiveId: 'death_split',
  // Bodies left in the wreckage.
  passiveMagnitude: 2,
  deathEffectParam: 'card_troop_cinder_imps',
});

// ---------------------------------------------------------------------------
// The beam
// ---------------------------------------------------------------------------

/**
 * 5 aether = 5000 EPP. `attack_ramp` costs 240 -> 4760. Short band, flying.
 *
 * A beam that visibly winds up: feeble for the first second, unstoppable by the
 * fourth, and back to nothing the instant it is interrupted. Every reset card
 * in the game is a hard counter, which is exactly the deal — it deletes a tank
 * and loses to a two-aether spell.
 */
export const PYRE_DRAKE = defineCard({
  name: 'Pyre Drake',
  id: 'card_troop_pyre_drake',
  rarity: 'Legendary',
  category: 'Troop',
  aetherCost: 5,
  unlockArena: 14,
  description: 'Its beam builds the longer it holds — and any reset kills it dead.',
  tint: '#d87f4a',
  modelId: 'pyreDrake',
  baseHealth: 1450,
  massWeight: 30,
  speedClass: 'Medium',
  bodyRadius: 0.5,
  isFlying: true,
  targetPriority: 'AirAndGround',
  attackRange: 3.5,
  sightRange: 5.5,
  hitSpeed: 0.4,
  damage: 76,
  firstAttackDelay: 1.2,
  usesProjectile: true,
  passiveId: 'attack_ramp',
  // Ceiling on the accelerating stacks.
  passiveMagnitude: 8,
});

export const SPECTACLE_WAVE_CARDS = [
  STORMCALLER,
  BOLT_PAIR,
  DELVER,
  ARC_LANCE,
  GLOOM_ARCHER,
  EMBER_JACK,
  SKY_LANTERN,
  PYRE_DRAKE,
];
