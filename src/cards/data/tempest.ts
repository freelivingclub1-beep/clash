/**
 * The tempest wave — twenty-four cards built on twelve mechanics the game
 * did not have.
 *
 * The set had a rich vocabulary for *doing damage* and a poor one for moving
 * things around. Everything defensive worked by occupying a tile; everything
 * disruptive worked by pushing away. So this wave is mostly about position and
 * permission: pull instead of push, leap over the line instead of walking into
 * it, force a target rather than take the one offered, and take away the
 * ability to swing rather than the health to survive.
 *
 * Each mechanic gets two cards, and the pair is always a contrast rather than
 * a big version and a small version of the same idea — a mobile hooker and a
 * static one, a leaper that lands on the support and a leaper that lands on
 * the tank, a taunt that walks and a taunt that cannot.
 *
 * Stats are set the way the rest of the roster is: an aether cost buys an EPP
 * allowance, the passive is deducted from it, and what remains goes on health
 * and damage. `tests/balance.test.ts` is the arbiter, and one card here is
 * priced by a mechanic that costs *less* than nothing.
 */

import { defineCard } from '../schema';

// ---------------------------------------------------------------------------
// Pull — the direction the board did not have
// ---------------------------------------------------------------------------

/**
 * 4 aether. Drags a spread-out defence into one heap.
 *
 * Deals almost no damage on its own, which is the point: it is the setup half
 * of a two-card play, and the payoff is whatever splash you throw next. Flying,
 * so the ground bodies it is gathering cannot answer it — but it only pulls
 * ground, so a defence that answers with air ignores the mechanic entirely.
 */
export const MAELSTROM_DJINN = defineCard({
  name: 'Maelstrom Djinn',
  id: 'card_troop_maelstrom_djinn',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 10,
  description: 'Hauls the ground beneath it into a heap. Bring something to drop on them.',
  tint: '#4a7fa8',
  modelId: 'maelstromDjinn',
  baseHealth: 1030,
  massWeight: 22,
  speedClass: 'Medium',
  bodyRadius: 0.5,
  isFlying: true,
  targetPriority: 'Ground',
  attackRange: 3.0,
  sightRange: 6.0,
  hitSpeed: 1.4,
  damage: 175,
  firstAttackDelay: 0.8,
  passiveId: 'vortex_pull',
  // Tiles per tick of inward drag, before mass is accounted for.
  passiveMagnitude: 0.035,
});

/**
 * 4 aether. The same pull, bolted to the floor.
 *
 * A building cannot chase, so this is purely defensive: it holds a push in
 * place in front of your tower for as long as it lives, instead of gathering
 * one for you to hit. Fliers walk past it without noticing.
 */
export const GRAVEWELL = defineCard({
  name: 'Gravewell',
  id: 'card_building_gravewell',
  rarity: 'Rare',
  category: 'Building',
  aetherCost: 4,
  unlockArena: 8,
  description: 'A sink in the ground. Nothing walking gets past it in a hurry.',
  tint: '#3d5f7a',
  modelId: 'gravewell',
  baseHealth: 1750,
  massWeight: 100,
  speedClass: 'Slow',
  bodyRadius: 0.75,
  targetPriority: 'Ground',
  attackRange: 3.4,
  sightRange: 5.5,
  hitSpeed: 1.8,
  damage: 240,
  firstAttackDelay: 1.0,
  lifetimeSeconds: 32,
  passiveId: 'vortex_pull',
  passiveMagnitude: 0.05,
});

/**
 * 4 aether. Rips one unit out of a formation and drops it at your feet.
 *
 * The answer to a support unit standing safely behind a tank — the one
 * arrangement nothing else in the set could break. Useless against a swarm,
 * because pulling one of six bodies out of line changes nothing.
 */
export const HARPOONER = defineCard({
  name: 'Harpooner',
  id: 'card_troop_harpooner',
  rarity: 'Rare',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 7,
  description: 'Hooks whoever it hits and hauls them in, stunned.',
  tint: '#5f8a7a',
  modelId: 'harpooner',
  baseHealth: 1250,
  massWeight: 22,
  speedClass: 'Medium',
  bodyRadius: 0.45,
  targetPriority: 'Ground',
  attackRange: 4.5,
  sightRange: 6.5,
  hitSpeed: 1.8,
  damage: 290,
  firstAttackDelay: 0.9,
  usesProjectile: true,
  passiveId: 'hook_pull',
  // Tiles of haul per hook.
  passiveMagnitude: 1.8,
});

/**
 * 3 aether. The hook at knife range.
 *
 * Reaches barely further than it can already hit, so it does not pull anything
 * *to* it — it stops whatever it has caught from backing off. Against a card
 * built to kite, that is close to a full answer; against anything that wanted
 * to be in melee anyway, it is three aether of nothing.
 */
export const CHAIN_FIEND = defineCard({
  name: 'Chain Fiend',
  id: 'card_troop_chain_fiend',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 3,
  unlockArena: 9,
  description: 'Short chain, no patience. Whatever it catches does not leave.',
  tint: '#7a5f3d',
  modelId: 'chainFiend',
  baseHealth: 780,
  massWeight: 18,
  speedClass: 'Fast',
  bodyRadius: 0.42,
  targetPriority: 'AirAndGround',
  attackRange: 2.0,
  sightRange: 5.5,
  hitSpeed: 1.1,
  damage: 130,
  firstAttackDelay: 0.6,
  passiveId: 'hook_pull',
  passiveMagnitude: 0.9,
});

// ---------------------------------------------------------------------------
// Leap — over the line rather than into it
// ---------------------------------------------------------------------------

/**
 * 7 aether. Lands on top of whatever the defence was protecting.
 *
 * Every cheap body in the game works by standing in the way. This does not
 * care: it vaults the front line on its own timer and lands on the support
 * behind it with splash. The cost is that the timer is not yours — you place
 * the threat, you do not aim it — and that seven aether spent badly is a lost
 * match on its own.
 */
export const COLOSSUS_KNIGHT = defineCard({
  name: 'Colossus Knight',
  id: 'card_troop_colossus_knight',
  rarity: 'Legendary',
  category: 'Troop',
  aetherCost: 7,
  unlockArena: 13,
  description: 'Vaults the front line and lands on what was hiding behind it.',
  tint: '#5f4a8a',
  modelId: 'colossusKnight',
  baseHealth: 2800,
  massWeight: 90,
  speedClass: 'Slow',
  bodyRadius: 0.72,
  targetPriority: 'Ground',
  attackRange: 1.2,
  sightRange: 6.0,
  hitSpeed: 1.7,
  damage: 260,
  firstAttackDelay: 1.1,
  damageType: 'AreaSplash',
  splashRadius: 1.6,
  passiveId: 'leap_strike',
  // Landing blow, as a share of its own hit.
  passiveMagnitude: 1.1,
});

/**
 * 4 aether. The leap without the mass behind it.
 *
 * Fragile enough that the leap is a liability as often as a weapon: it will
 * throw itself into the middle of a defence and die there. Played correctly it
 * skips a tank entirely and eats the archers; played hopefully it is four
 * aether donated to the opponent.
 */
export const POUNCE_STALKER = defineCard({
  name: 'Pounce Stalker',
  id: 'card_troop_pounce_stalker',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 10,
  description: 'Springs at the furthest thing it can see. Sometimes that is a mistake.',
  tint: '#7a8a4a',
  modelId: 'pounceStalker',
  baseHealth: 1050,
  massWeight: 18,
  speedClass: 'VeryFast',
  bodyRadius: 0.42,
  targetPriority: 'Ground',
  attackRange: 1.1,
  sightRange: 6.5,
  hitSpeed: 1.0,
  damage: 175,
  firstAttackDelay: 0.5,
  passiveId: 'leap_strike',
  passiveMagnitude: 0.8,
});

// ---------------------------------------------------------------------------
// Wreckage — killing it does not clear the tile
// ---------------------------------------------------------------------------

/**
 * 5 aether. Dies into a working gun.
 *
 * Trading with it takes two answers, not one, and the second has to be spent
 * where the first fight ended rather than where you would have chosen. The
 * discount for that is real: the wreck arrives exactly where things already
 * went badly for it.
 */
export const BOMBARD_CART = defineCard({
  name: 'Bombard Cart',
  id: 'card_troop_bombard_cart',
  rarity: 'Rare',
  category: 'Troop',
  aetherCost: 5,
  unlockArena: 8,
  description: 'Rolls forward shooting. What is left of it keeps shooting.',
  tint: '#8a6f3d',
  modelId: 'bombardCart',
  baseHealth: 1250,
  massWeight: 34,
  speedClass: 'Medium',
  bodyRadius: 0.5,
  targetPriority: 'Ground',
  attackRange: 5.0,
  sightRange: 6.5,
  hitSpeed: 1.6,
  damage: 230,
  firstAttackDelay: 0.9,
  usesProjectile: true,
  deathEffectParam: 'card_building_cannon',
  passiveId: 'wreckage',
  // Health of the wreck, as a share of the card it leaves behind.
  passiveMagnitude: 0.55,
});

/**
 * 6 aether. The same trick, played from the back.
 *
 * Outranges everything it leaves behind, so the wagon and its wreck cover
 * different ground — the wagon threatens the tower and the wreck threatens
 * whatever killed the wagon. Slow enough that a defence gets to choose which
 * of those problems to have.
 */
export const SIEGE_WAGON = defineCard({
  name: 'Siege Wagon',
  id: 'card_troop_siege_wagon',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 6,
  unlockArena: 11,
  description: 'Shells from range. Collapses into a turret that holds the ground.',
  tint: '#6f5a3d',
  modelId: 'siegeWagon',
  baseHealth: 1400,
  massWeight: 55,
  speedClass: 'Slow',
  bodyRadius: 0.6,
  targetPriority: 'Buildings',
  attackRange: 6.0,
  sightRange: 8.0,
  hitSpeed: 2.6,
  damage: 500,
  firstAttackDelay: 1.4,
  usesProjectile: true,
  damageType: 'AreaSplash',
  splashRadius: 1.4,
  deathEffectParam: 'card_building_tesla',
  passiveId: 'wreckage',
  passiveMagnitude: 0.7,
});

// ---------------------------------------------------------------------------
// Unstable — the only cards priced below zero
// ---------------------------------------------------------------------------

/**
 * 3 aether. Far too much health for the price, and every death funds the
 * opponent.
 *
 * The one card in the game with a drawback bought into its stat line rather
 * than a mechanic bought out of it. It changes how you are allowed to play it:
 * a body you cycle and throw away hands the defender the aether to answer the
 * next one, so this has to earn its cost every time or it is a loss engine.
 */
export const AETHER_GOLEM = defineCard({
  name: 'Aether Golem',
  id: 'card_troop_aether_golem',
  rarity: 'Rare',
  category: 'Troop',
  aetherCost: 3,
  unlockArena: 7,
  description: 'Enormous, and it pays your opponent when it falls.',
  tint: '#8a7fbf',
  modelId: 'aetherGolem',
  baseHealth: 2100,
  massWeight: 70,
  speedClass: 'Slow',
  bodyRadius: 0.62,
  targetPriority: 'Buildings',
  attackRange: 1.2,
  sightRange: 5.0,
  hitSpeed: 1.8,
  damage: 190,
  firstAttackDelay: 1.2,
  passiveId: 'gift_aether',
  // Aether points handed back. One aether is `AP_PER_AETHER`.
  passiveMagnitude: 168,
});

/**
 * 5 aether. The same bargain, larger, and correspondingly worse to lose.
 *
 * Refunds nearly two aether on death, which is a full defensive card handed
 * over. What that buys is a body big enough to survive a defence that was
 * built for a five-cost tank, so the question is whether you can convert
 * before it falls rather than whether it is worth playing.
 */
export const UNSTABLE_BEHEMOTH = defineCard({
  name: 'Unstable Behemoth',
  id: 'card_troop_unstable_behemoth',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 5,
  unlockArena: 10,
  description: 'A wall that refunds the defender when it comes down.',
  tint: '#7f6fa8',
  modelId: 'unstableBehemoth',
  baseHealth: 3200,
  massWeight: 95,
  speedClass: 'Slow',
  bodyRadius: 0.72,
  targetPriority: 'Buildings',
  attackRange: 1.3,
  sightRange: 5.0,
  hitSpeed: 1.9,
  damage: 330,
  firstAttackDelay: 1.3,
  passiveId: 'gift_aether',
  passiveMagnitude: 250,
});

// ---------------------------------------------------------------------------
// Refusal — a shot that does not land
// ---------------------------------------------------------------------------

/**
 * 5 aether. Refuses one shot in every window and sends it back.
 *
 * Not immunity: a fast shooter pays through the cooldown and barely notices.
 * A single heavy siege shot does not get a second try. So this is the card
 * that answers a Rocket and loses to Archers, which is close to the inverse of
 * every other defensive unit in the set.
 */
export const WARDEN_MONK = defineCard({
  name: 'Warden Monk',
  id: 'card_troop_warden_monk',
  rarity: 'Legendary',
  category: 'Troop',
  aetherCost: 5,
  unlockArena: 12,
  description: 'Catches one shot at a time and returns it to the sender.',
  tint: '#c9a84a',
  modelId: 'wardenMonk',
  baseHealth: 1850,
  massWeight: 32,
  speedClass: 'Medium',
  bodyRadius: 0.48,
  targetPriority: 'AirAndGround',
  attackRange: 1.4,
  sightRange: 5.5,
  hitSpeed: 1.3,
  damage: 215,
  firstAttackDelay: 0.9,
  passiveId: 'deflect',
  // Share of the caught shot returned to the shooter.
  passiveMagnitude: 1.0,
});

/**
 * 4 aether. Deflects further than it can reach.
 *
 * Frail and slow to swing, so it is not a fighter — it stands behind a push
 * and makes the defence's ranged answers cost something. Melee kills it
 * without ever triggering the mechanic, which is the whole counterplay.
 */
export const MIRROR_ADEPT = defineCard({
  name: 'Mirror Adept',
  id: 'card_troop_mirror_adept',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 10,
  description: 'Turns arrows around. Answers nothing that walks up to it.',
  tint: '#a8c9d4',
  modelId: 'mirrorAdept',
  baseHealth: 1250,
  massWeight: 20,
  speedClass: 'Medium',
  bodyRadius: 0.44,
  targetPriority: 'AirAndGround',
  attackRange: 4.5,
  sightRange: 6.5,
  hitSpeed: 1.7,
  damage: 240,
  firstAttackDelay: 1.0,
  usesProjectile: true,
  passiveId: 'deflect',
  passiveMagnitude: 1.35,
});

// ---------------------------------------------------------------------------
// Provoke — choosing what the enemy attacks
// ---------------------------------------------------------------------------

/**
 * 4 aether. Everything near it has to deal with it first.
 *
 * The only defensive card that protects things it is not standing in front of.
 * It pulls a push off your tower and onto itself wherever you put it, which
 * makes it a positional answer rather than a blocking one. It has been paid
 * for out of the health it would otherwise have, so killing it is the answer.
 */
export const IRON_PROVOCATEUR = defineCard({
  name: 'Iron Provocateur',
  id: 'card_troop_iron_provocateur',
  rarity: 'Rare',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 8,
  description: 'Loud enough that nothing nearby is allowed to ignore it.',
  tint: '#a86f4a',
  modelId: 'ironProvocateur',
  baseHealth: 1650,
  massWeight: 40,
  speedClass: 'Medium',
  bodyRadius: 0.52,
  targetPriority: 'Ground',
  attackRange: 1.2,
  sightRange: 5.5,
  hitSpeed: 1.4,
  damage: 175,
  firstAttackDelay: 1.0,
  passiveId: 'taunt',
  // Radius, in tiles, over which enemies are forced to retarget.
  passiveMagnitude: 3.6,
});

/**
 * 5 aether. A taunt that cannot follow the fight.
 *
 * Reaches much further than the Provocateur and never moves, so it decides
 * where a lane's fight happens for as long as it stands. Placed badly it drags
 * a push *toward* your tower, which is the mechanic working exactly as
 * designed and against you.
 */
export const BANNER_SENTINEL = defineCard({
  name: 'Banner Sentinel',
  id: 'card_building_banner_sentinel',
  rarity: 'Epic',
  category: 'Building',
  aetherCost: 5,
  unlockArena: 11,
  description: 'Plants a flag and decides where the fight is. Even if you would rather it were elsewhere.',
  tint: '#8a4a5f',
  modelId: 'bannerSentinel',
  baseHealth: 2300,
  massWeight: 100,
  speedClass: 'Slow',
  bodyRadius: 0.78,
  targetPriority: 'Ground',
  attackRange: 1.5,
  sightRange: 6.0,
  hitSpeed: 1.6,
  damage: 260,
  firstAttackDelay: 1.0,
  lifetimeSeconds: 30,
  passiveId: 'taunt',
  passiveMagnitude: 5.0,
});

// ---------------------------------------------------------------------------
// Disarm — taking the swing rather than the health
// ---------------------------------------------------------------------------

/**
 * 4 aether. What it hits cannot hit back.
 *
 * Against one large single-target threat this is close to a complete answer —
 * a P.E.K.K.A. that never swings is a very expensive statue. Against six small
 * bodies it does almost nothing, because each blow disarms exactly one of them
 * and the other five carry on.
 */
export const MANACLE_WARDEN = defineCard({
  name: 'Manacle Warden',
  id: 'card_troop_manacle_warden',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 10,
  description: 'Binds the arm, not the leg. It will keep walking. It will not swing.',
  tint: '#6f6f8a',
  modelId: 'manacleWarden',
  baseHealth: 1400,
  massWeight: 34,
  speedClass: 'Medium',
  bodyRadius: 0.5,
  targetPriority: 'Ground',
  attackRange: 1.4,
  sightRange: 5.5,
  hitSpeed: 1.5,
  damage: 170,
  firstAttackDelay: 0.9,
  passiveId: 'disarm',
  // Seconds the victim cannot attack for.
  passiveMagnitude: 1.2,
});

/**
 * 3 aether. Disarms faster than it hurts.
 *
 * Swings often and for very little, which suits the mechanic exactly: the
 * damage was never the point, and a short bind refreshed every second is
 * strictly better than a long one landed rarely. Dies to anything that looks
 * at it, including the thing it has disarmed once its allies arrive.
 */
export const SILENCER = defineCard({
  name: 'Silencer',
  id: 'card_troop_silencer',
  rarity: 'Rare',
  category: 'Troop',
  aetherCost: 3,
  unlockArena: 9,
  description: 'Hits for nothing, constantly, and nothing hits back.',
  tint: '#4a4a6f',
  modelId: 'silencer',
  baseHealth: 1080,
  massWeight: 16,
  speedClass: 'Fast',
  bodyRadius: 0.4,
  // Air as well as ground, unlike the Warden. Binding a flier's attack is the
  // one thing the Silencer can do that its heavier counterpart cannot, and it
  // is what stops the pair being the same card at two costs.
  targetPriority: 'AirAndGround',
  attackRange: 1.1,
  sightRange: 5.5,
  hitSpeed: 0.8,
  damage: 85,
  firstAttackDelay: 0.5,
  passiveId: 'disarm',
  passiveMagnitude: 0.7,
});

// ---------------------------------------------------------------------------
// Rally — worth nothing alone
// ---------------------------------------------------------------------------

/**
 * 3 aether. Makes everything around it swing faster.
 *
 * A multiplier, not an addition, so it is three aether of nothing on its own
 * and the largest single upgrade in the game behind a committed push. That
 * makes it a card you play *after* reading the defence, which is a different
 * decision from every other support card in the set.
 */
export const DRUM_MAJOR = defineCard({
  name: 'Drum Major',
  id: 'card_troop_drum_major',
  rarity: 'Rare',
  category: 'Troop',
  aetherCost: 3,
  unlockArena: 7,
  description: 'Keeps time for everyone nearby. Worth nothing on its own.',
  tint: '#bf8a3d',
  modelId: 'drumMajor',
  baseHealth: 1100,
  massWeight: 20,
  speedClass: 'Fast',
  bodyRadius: 0.42,
  targetPriority: 'Ground',
  attackRange: 1.1,
  sightRange: 5.0,
  hitSpeed: 1.3,
  damage: 130,
  firstAttackDelay: 0.8,
  passiveId: 'rally',
  // Fraction of a tick shaved off allied reloads.
  passiveMagnitude: 0.34,
});

/**
 * 5 aether. Rally on something that survives the fight it improves.
 *
 * The Drum Major's problem is that it dies to the first splash that lands near
 * the push it is buffing. This does not, so the buff is still running when the
 * fight is decided — and it costs enough that losing it is a real trade.
 */
export const MUSTER_HORN = defineCard({
  name: 'Muster Horn',
  id: 'card_troop_muster_horn',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 5,
  unlockArena: 11,
  description: 'Sounds the charge and lives long enough for it to matter.',
  tint: '#a8783d',
  modelId: 'hornOfMuster',
  baseHealth: 2400,
  massWeight: 52,
  speedClass: 'Medium',
  bodyRadius: 0.58,
  targetPriority: 'Ground',
  attackRange: 1.3,
  sightRange: 5.5,
  hitSpeed: 1.6,
  damage: 190,
  firstAttackDelay: 1.1,
  passiveId: 'rally',
  passiveMagnitude: 0.4,
});

// ---------------------------------------------------------------------------
// Mire — punishing the ground a defence wants to stand on
// ---------------------------------------------------------------------------

/**
 * 4 aether. Holds and hurts everything walking near it.
 *
 * A zone rather than a target, so it charges a defence for standing where it
 * wants to stand. Neither half works alone at this radius — a slow you can
 * walk out of and a trickle you can ignore — but together they force a
 * decision about whether the tile is worth holding.
 */
export const MIRE_WARDEN = defineCard({
  name: 'Mire Warden',
  id: 'card_building_mire_warden',
  rarity: 'Rare',
  category: 'Building',
  aetherCost: 4,
  unlockArena: 8,
  description: 'The ground around it grips. Standing there costs something.',
  tint: '#5f6f3d',
  modelId: 'mireWarden',
  baseHealth: 1800,
  massWeight: 100,
  speedClass: 'Slow',
  bodyRadius: 0.72,
  targetPriority: 'Ground',
  attackRange: 2.8,
  sightRange: 5.0,
  hitSpeed: 2.0,
  damage: 210,
  firstAttackDelay: 1.0,
  lifetimeSeconds: 34,
  passiveId: 'quicksand',
  // Damage per second in the zone, as a share of its own hit.
  passiveMagnitude: 0.4,
});

/**
 * 3 aether. The mire, walking.
 *
 * Slower and frailer than a body of its cost should be, because it carries the
 * zone with it — a defence that commits to killing it does so standing in the
 * thing that makes killing it slow.
 */
export const BOG_CRAWLER = defineCard({
  name: 'Bog Crawler',
  id: 'card_troop_bog_crawler',
  rarity: 'Common',
  category: 'Troop',
  aetherCost: 3,
  unlockArena: 5,
  description: 'Drags a patch of swamp along with it.',
  tint: '#4a5f3d',
  modelId: 'bogCrawler',
  baseHealth: 1050,
  massWeight: 26,
  speedClass: 'Slow',
  bodyRadius: 0.48,
  targetPriority: 'Ground',
  attackRange: 1.2,
  sightRange: 5.0,
  hitSpeed: 1.5,
  damage: 145,
  firstAttackDelay: 1.0,
  passiveId: 'quicksand',
  passiveMagnitude: 0.28,
});

// ---------------------------------------------------------------------------
// Overcharge — the inverse of ramping up
// ---------------------------------------------------------------------------

/**
 * 5 aether. Everything it did not do is in the next blow.
 *
 * `attack_ramp` rewards a card for chewing on one target for a long time; this
 * rewards it for waiting. A unit that walked the length of the board unopposed
 * arrives with a hit several times its size, and one that has been trading the
 * whole way arrives with an ordinary one — so the counter is to make it fight
 * early and often.
 */
export const STORM_ANVIL = defineCard({
  name: 'Storm Anvil',
  id: 'card_troop_storm_anvil',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 5,
  unlockArena: 11,
  description: 'Every second it waits goes into the next swing.',
  tint: '#4a6f8a',
  modelId: 'stormAnvil',
  baseHealth: 2050,
  massWeight: 58,
  speedClass: 'Slow',
  bodyRadius: 0.58,
  targetPriority: 'Ground',
  attackRange: 1.4,
  sightRange: 5.5,
  hitSpeed: 2.2,
  damage: 240,
  firstAttackDelay: 1.3,
  damageType: 'AreaSplash',
  splashRadius: 1.2,
  passiveId: 'overcharge',
  // Stored damage per idle second, as a share of its own hit.
  passiveMagnitude: 0.5,
});

/**
 * 4 aether. A building that punishes a lull.
 *
 * Overcharge suits a defensive structure better than it suits a troop: a
 * turret is idle by default, so the first thing that walks into its reach is
 * hit with everything it has been saving. Sustained pressure drains it to
 * nothing, which is exactly the right weakness for a defensive building.
 */
export const COIL_SENTINEL = defineCard({
  name: 'Coil Sentinel',
  id: 'card_building_coil_sentinel',
  rarity: 'Rare',
  category: 'Building',
  aetherCost: 4,
  unlockArena: 8,
  description: 'Idles, charging. The first thing through gets all of it.',
  tint: '#3d6f8a',
  modelId: 'coilSentinel',
  baseHealth: 1250,
  massWeight: 100,
  speedClass: 'Slow',
  bodyRadius: 0.7,
  targetPriority: 'AirAndGround',
  attackRange: 5.5,
  sightRange: 6.5,
  hitSpeed: 2.0,
  damage: 220,
  firstAttackDelay: 0.8,
  usesProjectile: true,
  lifetimeSeconds: 30,
  passiveId: 'overcharge',
  passiveMagnitude: 0.45,
});

// ---------------------------------------------------------------------------
// Blood pact — value realised by dying
// ---------------------------------------------------------------------------

/**
 * 3 aether. Killing it is the heal.
 *
 * Inverts the instinct to focus the support first. Leaving it alive and
 * killing what it stands behind is the correct play, and that is a much harder
 * read than "shoot the priest" — which is the whole reason the card exists.
 */
export const VITALIST = defineCard({
  name: 'Vitalist',
  id: 'card_troop_vitalist',
  rarity: 'Rare',
  category: 'Troop',
  aetherCost: 3,
  unlockArena: 7,
  description: 'Spends itself on whoever is still standing. Do not kill it first.',
  tint: '#4aa87f',
  modelId: 'vitalist',
  baseHealth: 1150,
  massWeight: 18,
  speedClass: 'Fast',
  bodyRadius: 0.4,
  targetPriority: 'Ground',
  attackRange: 1.1,
  sightRange: 5.0,
  hitSpeed: 1.4,
  damage: 115,
  firstAttackDelay: 0.9,
  passiveId: 'bloodpact',
  // Share of its own maximum health handed to each nearby ally.
  passiveMagnitude: 0.55,
});

/**
 * 4 aether. A larger pact on something that flies.
 *
 * Air means the ground defence that clears a push cannot clear the payout, so
 * this converts a lost fight into a second one far more reliably than the
 * Vitalist does. Anti-air answers it completely, which is the intended shape.
 */
export const MARTYR_SISTER = defineCard({
  name: 'Martyr Sister',
  id: 'card_troop_martyr_sister',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 10,
  description: 'Falls, and everything under her gets back up.',
  tint: '#d4c9a8',
  modelId: 'martyrSister',
  baseHealth: 1150,
  massWeight: 20,
  speedClass: 'Medium',
  bodyRadius: 0.44,
  isFlying: true,
  targetPriority: 'AirAndGround',
  attackRange: 3.2,
  sightRange: 6.0,
  hitSpeed: 1.6,
  damage: 150,
  firstAttackDelay: 1.0,
  usesProjectile: true,
  passiveId: 'bloodpact',
  passiveMagnitude: 0.7,
});

export const TEMPEST_CARDS = [
  MAELSTROM_DJINN,
  GRAVEWELL,
  HARPOONER,
  CHAIN_FIEND,
  COLOSSUS_KNIGHT,
  POUNCE_STALKER,
  BOMBARD_CART,
  SIEGE_WAGON,
  AETHER_GOLEM,
  UNSTABLE_BEHEMOTH,
  WARDEN_MONK,
  MIRROR_ADEPT,
  IRON_PROVOCATEUR,
  BANNER_SENTINEL,
  MANACLE_WARDEN,
  SILENCER,
  DRUM_MAJOR,
  MUSTER_HORN,
  MIRE_WARDEN,
  BOG_CRAWLER,
  STORM_ANVIL,
  COIL_SENTINEL,
  VITALIST,
  MARTYR_SISTER,
];
