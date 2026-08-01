/**
 * The artifice wave — eighteen cards that do something other than damage.
 *
 * This one came from a measurement rather than an idea. A survey of the
 * roster found a hundred and thirty-one of a hundred and sixty-five cards
 * dealing plain single-target damage, a hundred and fifty-five carrying no
 * on-hit status at all, and a hundred and sixty-one leaving nothing behind
 * when they died. Three cards pierced. The engine supported freezing, slowing,
 * stunning, knocking back, poisoning, resetting an attack, dropping a bomb,
 * casting a spell on death and leaving bodies behind — and almost nothing
 * used any of it.
 *
 * So the board read exactly as it was: a great many differently coloured
 * projectiles that all did the same thing when they landed.
 *
 * Every card here is chosen to put an unused behaviour into play, and the
 * behaviours are now priced — on-hit statuses and death effects were free
 * until this wave, which is why a card carrying one had been getting it for
 * nothing. Where two cards share a behaviour they differ in what carrying it
 * costs them: the Frost Sage barely scratches, the Rimeblade hits properly and
 * chills for a moment.
 */

import { defineCard } from '../schema';

// ---------------------------------------------------------------------------
// Cold — the status that takes a fraction of everything
// ---------------------------------------------------------------------------

/**
 * 4 aether. Hits for almost nothing and slows everything it touches.
 *
 * The damage is not the point and is not meant to be. A defence chilled by a
 * third takes a third longer to kill the thing it was sent to stop, which
 * every other card in your push converts into damage — so this is the support
 * card whose value never appears on its own health bar.
 */
export const FROST_SAGE = defineCard({
  name: 'Frost Sage',
  id: 'card_troop_frost_sage',
  rarity: 'Legendary',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 12,
  description: 'Barely scratches. Everything it touches moves and swings slower.',
  tint: '#8fd4e8',
  modelId: 'frostSage',
  baseHealth: 1000,
  massWeight: 20,
  speedClass: 'Medium',
  bodyRadius: 0.44,
  targetPriority: 'AirAndGround',
  attackRange: 5.0,
  sightRange: 6.5,
  hitSpeed: 1.7,
  damage: 90,
  firstAttackDelay: 1.0,
  usesProjectile: true,
  damageType: 'AreaSplash',
  splashRadius: 1.1,
  onHitStatus: 'Slow',
  statusDuration: 2.5,
});

/**
 * 4 aether. The same chill on something that can actually fight.
 *
 * Half the Sage's reach and none of its splash, but it hits like a card its
 * cost and the slow rides on top. Where the Sage wants to stand behind a push,
 * this wants to be in the fight — so the pair are not a small version and a
 * big version, they are opposite ends of a lane.
 */
export const RIMEBLADE = defineCard({
  name: 'Rimeblade',
  id: 'card_troop_rimeblade',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 10,
  description: 'Every cut leaves frost in it.',
  tint: '#6fa8c9',
  modelId: 'rimeblade',
  baseHealth: 1450,
  massWeight: 32,
  speedClass: 'Medium',
  bodyRadius: 0.48,
  targetPriority: 'Ground',
  attackRange: 1.3,
  sightRange: 5.5,
  hitSpeed: 1.3,
  damage: 190,
  firstAttackDelay: 0.9,
  onHitStatus: 'Slow',
  statusDuration: 1.6,
});

/**
 * 5 aether. Stops a unit outright, briefly, on every blow.
 *
 * Freeze is the most complete status in the game and the reload is set to
 * match: slow enough that a fast swarm walks through the gaps between blows,
 * and decisive against exactly one large thing.
 */
export const GLACIER_WARDEN = defineCard({
  name: 'Glacier Warden',
  id: 'card_troop_glacier_warden',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 5,
  unlockArena: 11,
  description: 'Slow to swing. Whatever it hits stops dead for a moment.',
  tint: '#a8d8f0',
  modelId: 'glacierWarden',
  baseHealth: 1750,
  massWeight: 44,
  speedClass: 'Slow',
  bodyRadius: 0.55,
  targetPriority: 'AirAndGround',
  attackRange: 3.6,
  sightRange: 6.0,
  hitSpeed: 2.4,
  damage: 200,
  firstAttackDelay: 1.2,
  usesProjectile: true,
  onHitStatus: 'Freeze',
  statusDuration: 0.9,
});

// ---------------------------------------------------------------------------
// Piercing — one shot through a line
// ---------------------------------------------------------------------------

/**
 * 4 aether. One bolt through everything standing in the lane.
 *
 * The set had three piercing cards and a hundred and thirty-one that hit one
 * thing. A shot that does not stop at the first body inverts the usual
 * defensive instinct: putting a tank in front makes the problem worse, because
 * the tank is now the thing lining everything else up.
 */
export const LANCE_SENTINEL = defineCard({
  name: 'Lance Sentinel',
  id: 'card_building_lance_sentinel',
  rarity: 'Epic',
  category: 'Building',
  aetherCost: 4,
  unlockArena: 10,
  description: 'Fires straight through. A queue is the worst thing you can bring.',
  tint: '#c9a86f',
  modelId: 'lanceSentinel',
  baseHealth: 1150,
  massWeight: 100,
  speedClass: 'Slow',
  bodyRadius: 0.7,
  targetPriority: 'Ground',
  attackRange: 6.0,
  sightRange: 7.0,
  hitSpeed: 2.2,
  damage: 260,
  firstAttackDelay: 1.0,
  usesProjectile: true,
  damageType: 'PiercingLine',
  // How far off the shot line a body can stand and still be hit — the beam's
  // width, not a blast radius. Wide enough to catch a rank walking abreast.
  splashRadius: 0.75,
  lifetimeSeconds: 30,
});

/**
 * 3 aether. A piercing shot that has to walk into range to use it.
 *
 * Fragile and short-reaching, so the line it threads is the one directly in
 * front of it rather than a lane it commands from the back. Wants to be
 * dropped behind a push, and dies to anything that reaches it.
 */
export const JAVELIN_RIDER = defineCard({
  name: 'Javelin Rider',
  id: 'card_troop_javelin_rider',
  rarity: 'Rare',
  category: 'Troop',
  aetherCost: 3,
  unlockArena: 8,
  description: 'Throws through the first body into whatever was behind it.',
  tint: '#a89a6f',
  modelId: 'javelinRider',
  baseHealth: 820,
  massWeight: 20,
  speedClass: 'Fast',
  bodyRadius: 0.42,
  targetPriority: 'Ground',
  attackRange: 4.0,
  sightRange: 6.0,
  hitSpeed: 1.5,
  damage: 185,
  firstAttackDelay: 0.8,
  usesProjectile: true,
  damageType: 'PiercingLine',
  splashRadius: 0.55,
});

// ---------------------------------------------------------------------------
// What it leaves behind
// ---------------------------------------------------------------------------

/**
 * 5 aether. A building whose last act is the largest one.
 *
 * Guaranteed value, because dying is not optional — the question is only
 * whether it goes off in your opponent's push or in an empty lane after its
 * timer runs out. That makes placing it a real decision rather than a reflex.
 */
export const BOMB_TOWER = defineCard({
  name: 'Bomb Tower',
  id: 'card_building_bomb_tower',
  rarity: 'Rare',
  category: 'Building',
  aetherCost: 5,
  unlockArena: 7,
  description: 'Lobs shells while it stands. Takes the ground with it when it falls.',
  tint: '#8a6f5f',
  modelId: 'bombTower',
  baseHealth: 1500,
  massWeight: 100,
  speedClass: 'Slow',
  bodyRadius: 0.72,
  targetPriority: 'Ground',
  attackRange: 5.5,
  sightRange: 6.5,
  hitSpeed: 2.0,
  damage: 190,
  firstAttackDelay: 1.0,
  usesProjectile: true,
  damageType: 'AreaSplash',
  splashRadius: 1.5,
  lifetimeSeconds: 32,
  deathEffect: 'DeathBomb',
  deathEffectDamage: 480,
  deathEffectParam: '2.6',
});

/**
 * 3 aether. Dies into a spell, and the spell is a trap rather than a blast.
 *
 * The other card in the set that casts on death drops damage. This drops a
 * Snare, so killing it does not clear the ground it was standing on — whatever
 * killed it is now slowed, in front of your tower, with your answer already
 * on the way. Deliberately not another poison cloud: Plague Bearer already
 * leaves one, and two cards that die into damage are one card.
 */
export const FROSTFALL_BEARER = defineCard({
  name: 'Frostfall Bearer',
  id: 'card_troop_frostfall_bearer',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 3,
  unlockArena: 9,
  description: 'Kill it and the ground it stood on turns against you.',
  tint: '#7f9ac9',
  modelId: 'frostfallBearer',
  baseHealth: 900,
  massWeight: 22,
  speedClass: 'Medium',
  bodyRadius: 0.44,
  targetPriority: 'Ground',
  attackRange: 1.2,
  sightRange: 5.0,
  hitSpeed: 1.4,
  damage: 120,
  firstAttackDelay: 0.9,
  deathEffect: 'DeathSpell',
  deathEffectParam: 'card_spell_snare',
});

/**
 * 4 aether. Leaves four bodies where it fell.
 *
 * The value arrives at the moment the opponent thinks they have dealt with
 * it, which is what makes it awkward to trade into rather than merely durable.
 * Splash answers it completely — the bodies die to the same blow that would
 * have cleared them anyway.
 */
export const GRAVE_WARDEN = defineCard({
  name: 'Grave Warden',
  id: 'card_troop_grave_warden',
  rarity: 'Rare',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 8,
  description: 'Falls, and four more get up.',
  tint: '#6f6f8f',
  modelId: 'graveWarden',
  baseHealth: 1250,
  massWeight: 34,
  speedClass: 'Medium',
  bodyRadius: 0.48,
  targetPriority: 'Ground',
  attackRange: 1.2,
  sightRange: 5.0,
  hitSpeed: 1.3,
  damage: 140,
  firstAttackDelay: 0.9,
  deathEffect: 'SpawnDeathUnit',
  deathEffectParam: 'card_troop_skeletons',
  deathEffectCount: 4,
});

// ---------------------------------------------------------------------------
// Buildings that make bodies, and run out
// ---------------------------------------------------------------------------

/**
 * 5 aether. A stream of skeletons for as long as it lasts.
 *
 * Produces nothing on its own worth fearing and everything together worth
 * answering. Its own timer is the counter the opponent gets for free: ignore
 * it long enough and it stops.
 */
export const BONE_SPIRE = defineCard({
  name: 'Bone Spire',
  id: 'card_building_bone_spire',
  rarity: 'Epic',
  category: 'Building',
  aetherCost: 5,
  unlockArena: 9,
  description: 'A body every few seconds, until the spire crumbles.',
  tint: '#9a9ab0',
  modelId: 'boneSpire',
  baseHealth: 1150,
  massWeight: 100,
  speedClass: 'Slow',
  bodyRadius: 0.7,
  targetPriority: 'Ground',
  attackRange: 0.1,
  sightRange: 0.1,
  hitSpeed: 3.0,
  damage: 1,
  firstAttackDelay: 1.0,
  lifetimeSeconds: 36,
  passiveId: 'spawner',
  // Seconds between bodies.
  passiveMagnitude: 3.4,
  deathEffectParam: 'card_troop_skeletons',
});

/**
 * 5 aether. The same idea in the air.
 *
 * What it emits cannot be blocked by anything standing in a lane, so it
 * pressures a defence that has committed to the ground — and it is answered
 * completely by one card that shoots upward, which is a cleaner counter than
 * the Spire gets.
 */
export const WASP_HIVE = defineCard({
  name: 'Wasp Hive',
  id: 'card_building_wasp_hive',
  rarity: 'Epic',
  category: 'Building',
  aetherCost: 5,
  unlockArena: 11,
  description: 'Sends one out every few seconds. They do not use the bridge.',
  tint: '#c9a83f',
  modelId: 'waspHive',
  baseHealth: 2050,
  massWeight: 100,
  speedClass: 'Slow',
  bodyRadius: 0.68,
  targetPriority: 'Ground',
  attackRange: 0.1,
  sightRange: 0.1,
  hitSpeed: 3.0,
  damage: 1,
  firstAttackDelay: 1.0,
  lifetimeSeconds: 30,
  passiveId: 'spawner',
  passiveMagnitude: 4.2,
  deathEffectParam: 'card_troop_minions',
});

// ---------------------------------------------------------------------------
// Interruption, displacement, rot
// ---------------------------------------------------------------------------

/**
 * 4 aether. Every hit resets what it hits.
 *
 * Against a fast attacker a reset costs almost nothing; against a slow heavy
 * one it means the blow never lands at all. So this is a card that is nearly
 * blank into a swarm and close to a full answer to one big single-target
 * threat, which is the inverse of most defensive cards in the set.
 */
export const THUNDER_ADEPT = defineCard({
  name: 'Thunder Adept',
  id: 'card_troop_thunder_adept',
  rarity: 'Legendary',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 12,
  description: 'Interrupts the wind-up. Slow swingers never finish one.',
  tint: '#b0a8ff',
  modelId: 'thunderAdept',
  baseHealth: 1000,
  massWeight: 22,
  speedClass: 'Medium',
  bodyRadius: 0.44,
  targetPriority: 'AirAndGround',
  attackRange: 4.5,
  sightRange: 6.0,
  hitSpeed: 1.6,
  damage: 130,
  firstAttackDelay: 0.9,
  usesProjectile: true,
  onHitStatus: 'ElectroReset',
  statusDuration: 0.5,
});

/**
 * 3 aether. Blows things backwards.
 *
 * Buys distance rather than time, which is a different currency: a push shoved
 * back from a tower has to walk the ground again while your own answer lands.
 * Worth nothing at all against a building, and everything against a swarm at
 * the bridge.
 */
export const GALE_PRIEST = defineCard({
  name: 'Gale Priest',
  id: 'card_troop_gale_priest',
  rarity: 'Rare',
  category: 'Troop',
  aetherCost: 3,
  unlockArena: 7,
  description: 'Does little. Puts everything back where it came from.',
  tint: '#9fd4c9',
  modelId: 'galePriest',
  baseHealth: 880,
  massWeight: 18,
  speedClass: 'Fast',
  bodyRadius: 0.42,
  targetPriority: 'AirAndGround',
  attackRange: 4.0,
  sightRange: 5.5,
  hitSpeed: 1.5,
  damage: 105,
  firstAttackDelay: 0.8,
  usesProjectile: true,
  onHitStatus: 'Knockback',
  statusDuration: 0.4,
});

/**
 * 5 aether. Concussive, and heavy enough to survive using it.
 *
 * A stun stops the swing without stopping the walk, so a stunned tank keeps
 * arriving — this does not save a tower on its own, it buys the seconds your
 * defence needs to finish something. Bought out of its own health, which is
 * why it is not also a wall.
 */
export const CONCUSSION_GUARD = defineCard({
  name: 'Concussion Guard',
  id: 'card_troop_concussion_guard',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 5,
  unlockArena: 10,
  description: 'Rings the helmet. It keeps walking; it does not keep swinging.',
  tint: '#8f8f7f',
  modelId: 'concussionGuard',
  baseHealth: 1900,
  massWeight: 48,
  speedClass: 'Medium',
  bodyRadius: 0.55,
  targetPriority: 'Ground',
  attackRange: 1.3,
  sightRange: 5.5,
  hitSpeed: 1.6,
  damage: 200,
  firstAttackDelay: 1.0,
  onHitStatus: 'Stun',
  statusDuration: 0.7,
});

/**
 * 3 aether. Rot that keeps working after the fight.
 *
 * Poison is the one status a building or a tower cannot shrug off, and it
 * outlives the thing that applied it — so a Sporeling that gets four seconds
 * on a tower is still doing damage after the defence has cleared it.
 */
export const SPORELING = defineCard({
  name: 'Sporeling',
  id: 'card_troop_sporeling',
  rarity: 'Common',
  category: 'Troop',
  aetherCost: 3,
  unlockArena: 5,
  description: 'The wound keeps going after it has gone.',
  tint: '#8fa85f',
  modelId: 'sporeling',
  baseHealth: 950,
  massWeight: 20,
  speedClass: 'Fast',
  bodyRadius: 0.42,
  targetPriority: 'Ground',
  attackRange: 1.1,
  sightRange: 5.0,
  hitSpeed: 1.2,
  damage: 105,
  firstAttackDelay: 0.7,
  onHitStatus: 'Poison',
  statusDuration: 3.5,
});

// ---------------------------------------------------------------------------
// Turning their losses into your gains
// ---------------------------------------------------------------------------

/**
 * 5 aether. Everything it kills gets back up on your side.
 *
 * Nothing else in the set converts an opponent's losses into your own board.
 * Every other mechanic works on what is already yours or takes something from
 * theirs; this makes trading into it actively bad rather than merely
 * inefficient. It cannot raise a building or a tower, so it is a card for
 * fights rather than a win condition that funds itself.
 */
export const SOUL_CRONE = defineCard({
  name: 'Soul Crone',
  id: 'card_troop_soul_crone',
  rarity: 'Legendary',
  category: 'Troop',
  aetherCost: 5,
  unlockArena: 13,
  description: 'What it kills comes back wearing your colours.',
  tint: '#a86fc9',
  modelId: 'soulCrone',
  baseHealth: 1050,
  massWeight: 24,
  speedClass: 'Medium',
  bodyRadius: 0.46,
  targetPriority: 'Ground',
  attackRange: 4.2,
  sightRange: 6.0,
  hitSpeed: 1.5,
  damage: 145,
  firstAttackDelay: 1.0,
  usesProjectile: true,
  passiveId: 'soul_bind',
  // Bodies raised per kill.
  passiveMagnitude: 1,
  deathEffectParam: 'card_troop_skeletons',
});

// ---------------------------------------------------------------------------
// Cone and knock — the shapes that were not being used
// ---------------------------------------------------------------------------

/**
 * 4 aether. A wall of flame in the direction it is facing.
 *
 * Cone splash had six cards. It is the shape that rewards a defender for
 * placing rather than for reacting: everything in the arc is hit and anything
 * behind the caster is not, so where it stands decides what it answers.
 */
export const PYRE_MONK = defineCard({
  name: 'Pyre Monk',
  id: 'card_troop_pyre_monk',
  rarity: 'Rare',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 8,
  description: 'Everything in front burns. Everything behind is fine.',
  tint: '#d4763f',
  modelId: 'pyreMonk',
  baseHealth: 1250,
  massWeight: 28,
  speedClass: 'Medium',
  bodyRadius: 0.46,
  targetPriority: 'Ground',
  attackRange: 2.6,
  sightRange: 5.5,
  hitSpeed: 1.5,
  damage: 165,
  firstAttackDelay: 0.9,
  damageType: 'ConeSplash',
  splashRadius: 2.4,
});

/**
 * 6 aether. A cone that also shoves.
 *
 * The two effects compound in a way neither does alone: everything in the arc
 * is hit *and* pushed out of the arc, so a swarm that walks into it arrives
 * scattered and behind schedule. Expensive, slow, and useless against one
 * heavy body.
 */
export const TEMPEST_HERALD = defineCard({
  name: 'Tempest Herald',
  id: 'card_troop_tempest_herald',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 6,
  unlockArena: 11,
  description: 'Sweeps the lane in front of it and puts the lane back.',
  tint: '#6f9fd4',
  modelId: 'tempestHerald',
  baseHealth: 2100,
  massWeight: 55,
  speedClass: 'Slow',
  bodyRadius: 0.58,
  targetPriority: 'AirAndGround',
  attackRange: 3.0,
  sightRange: 6.0,
  hitSpeed: 2.0,
  damage: 210,
  firstAttackDelay: 1.2,
  damageType: 'ConeSplash',
  splashRadius: 2.6,
  onHitStatus: 'Knockback',
  statusDuration: 0.4,
});

/**
 * 2 aether. A rally that costs almost nothing and does almost nothing.
 *
 * Rage existed on exactly one card, a spell. On a body it is a different card:
 * it has to survive to keep working, so the opponent can answer the buff by
 * killing the cheapest thing on the board — which is a decision, where a spell
 * is simply a fact.
 */
export const WARCHANTER = defineCard({
  name: 'Warchanter',
  id: 'card_troop_warchanter',
  rarity: 'Rare',
  category: 'Troop',
  aetherCost: 2,
  unlockArena: 6,
  description: 'Whips up whatever it touches. Dies to a stiff breeze.',
  tint: '#c95f8f',
  modelId: 'warchanter',
  baseHealth: 620,
  massWeight: 14,
  speedClass: 'Fast',
  bodyRadius: 0.38,
  targetPriority: 'Ground',
  attackRange: 1.1,
  sightRange: 4.5,
  hitSpeed: 1.2,
  damage: 70,
  firstAttackDelay: 0.7,
  onHitStatus: 'Rage',
  statusDuration: 2.0,
});

export const ARTIFICE_CARDS = [
  FROST_SAGE,
  RIMEBLADE,
  GLACIER_WARDEN,
  LANCE_SENTINEL,
  JAVELIN_RIDER,
  BOMB_TOWER,
  FROSTFALL_BEARER,
  GRAVE_WARDEN,
  BONE_SPIRE,
  WASP_HIVE,
  THUNDER_ADEPT,
  GALE_PRIEST,
  CONCUSSION_GUARD,
  SPORELING,
  SOUL_CRONE,
  PYRE_MONK,
  TEMPEST_HERALD,
  WARCHANTER,
];
