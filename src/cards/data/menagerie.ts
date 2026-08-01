/**
 * The menagerie wave — thirty cards, thirty mechanics.
 *
 * The brief was "no similar ones", which is a harder constraint than it sounds:
 * a roster grows by variations, and variations are how a set of a hundred cards
 * ends up feeling like a set of twenty. So nothing here is another body with a
 * different number on it. Every card below is either the only card in the game
 * that does what it does, or the deliberate inverse of one that already exists.
 *
 * Three sources of novelty were available, and this wave uses all of them.
 *
 * The first is mechanics the simulation already supported and no card had ever
 * claimed. `Poison` as a card's own on-hit — the one status that keeps working
 * on buildings and towers. `Stun` on something other than a champion ability.
 * `DeathBomb` and `DeathSpell`, both implemented in the deaths system and both
 * unused. `PiercingLine` had exactly one card and `ConeSplash` three.
 *
 * The second is twelve new passives, registered and priced alongside the rest,
 * each written to be the *opposite* of something already in the set rather than
 * an increment on it: Momentum against Charge, Split Shot against Chain, Ambush
 * against Damage Ramp, Tether against every splash card in the game.
 *
 * The third is shape. The set had no seven-cost, two six-costs, two air-only
 * cards, and single occupants of the serpent and shelled body plans. Those gaps
 * were where the unfamiliar silhouettes were hiding.
 *
 * Stats are set the same way as the rest of the roster: an aether cost buys an
 * EPP allowance, the passive is deducted from it, and what remains is spent on
 * health and damage. The audit in `tests/balance.test.ts` is the arbiter.
 */

import { defineCard } from '../schema';

// ---------------------------------------------------------------------------
// Rot — the status nothing had claimed
// ---------------------------------------------------------------------------

/**
 * 3 aether. The only card whose attack poisons.
 *
 * Poison is the one status in the engine that structures are not immune to, so
 * this keeps working on a building that would shrug off a stun or a freeze —
 * and it keeps ticking after the Fang itself is dead. Against troops it is
 * mediocre; against a defensive building it is the cheapest answer in the set.
 */
export const BLIGHT_FANG = defineCard({
  name: 'Blight Fang',
  id: 'card_troop_blight_fang',
  rarity: 'Rare',
  category: 'Troop',
  aetherCost: 3,
  unlockArena: 6,
  description: 'Its bite rots on after the wound. Buildings are not immune.',
  tint: '#7fa85f',
  modelId: 'blightFang',
  baseHealth: 1080,
  massWeight: 16,
  speedClass: 'Fast',
  bodyRadius: 0.45,
  targetPriority: 'Ground',
  attackRange: 1.0,
  sightRange: 5.5,
  hitSpeed: 1.2,
  damage: 172,
  firstAttackDelay: 0.6,
  onHitStatus: 'Poison',
  statusDuration: 3.0,
});

/**
 * 3 aether. A spell that deals no damage on impact at all.
 *
 * Everything it does arrives over the following four seconds, which makes it
 * useless as a finisher and unusually good as an opener — thrown *before* a
 * push commits, it is already working when the fight starts. It is also the
 * only spell that keeps damaging a building after it lands.
 */
export const MIASMA = defineCard({
  name: 'Miasma',
  id: 'card_spell_miasma',
  rarity: 'Epic',
  category: 'Spell',
  aetherCost: 3,
  unlockArena: 9,
  description: 'No impact damage. A cloud that rots everything standing in it.',
  tint: '#6f8f4a',
  baseHealth: 0,
  damage: 260,
  damageType: 'AreaSplash',
  splashRadius: 3.2,
  targetPriority: 'AirAndGround',
  onHitStatus: 'Poison',
  statusDuration: 4.0,
});

// ---------------------------------------------------------------------------
// Concussion — Stun, off the champion bench
// ---------------------------------------------------------------------------

/**
 * 4 aether. Every swing stuns.
 *
 * Stun existed only on a champion's activated ability. On a body that swings
 * every 1.6 seconds for 0.4 seconds of stun, it becomes a lock: anything with a
 * slower reload than that never gets a blow off at all. The counter is numbers
 * — it can only hold one thing at a time — and its own damage is feeble.
 */
export const CONCUSSOR = defineCard({
  name: 'Concussor',
  id: 'card_troop_concussor',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 10,
  description: 'Every blow rattles. A slow-swinging enemy never swings at all.',
  tint: '#8f8f9f',
  modelId: 'concussor',
  baseHealth: 1900,
  massWeight: 34,
  speedClass: 'Medium',
  bodyRadius: 0.55,
  targetPriority: 'Ground',
  attackRange: 1.2,
  sightRange: 5.5,
  hitSpeed: 1.6,
  damage: 175,
  firstAttackDelay: 1.0,
  onHitStatus: 'Stun',
  statusDuration: 0.4,
});

// ---------------------------------------------------------------------------
// Death effects the deaths system had implemented and nobody used
// ---------------------------------------------------------------------------

/**
 * 4 aether. Walks at the nearest building and detonates when killed.
 *
 * `DeathBomb` was written, tested and claimed by no card. The trap it creates
 * is the point: the natural way to stop a building-targeting card is to put a
 * cheap swarm on it, and that is precisely the play that loses everything.
 * Kill it with one big body, or from range, or let it hit the building.
 */
export const POWDER_MULE = defineCard({
  name: 'Powder Mule',
  id: 'card_troop_powder_mule',
  rarity: 'Rare',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 8,
  description: 'Makes for the nearest building. Whatever kills it regrets it.',
  tint: '#b58f4a',
  modelId: 'powderMule',
  baseHealth: 1720,
  massWeight: 26,
  speedClass: 'Fast',
  bodyRadius: 0.5,
  targetPriority: 'Buildings',
  attackRange: 1.2,
  sightRange: 7.5,
  hitSpeed: 1.4,
  damage: 260,
  firstAttackDelay: 1.0,
  deathEffect: 'DeathBomb',
  deathEffectDamage: 420,
  // Blast radius in tiles, read from the param by the deaths system.
  deathEffectParam: '2.4',
});

/**
 * 5 aether. Dies into a full spell.
 *
 * `DeathSpell` resolves a real card at the corpse — this one leaves a Miasma
 * behind, so killing it hands the ground it died on to the attacker for the
 * next four seconds. Standing on the body to finish it is the mistake.
 */
export const DOOMSEED = defineCard({
  name: 'Doomseed',
  id: 'card_troop_doomseed',
  rarity: 'Legendary',
  category: 'Troop',
  aetherCost: 5,
  unlockArena: 13,
  description: 'Bursts into a rotting cloud when it dies. Do not stand on it.',
  tint: '#8a6f9f',
  modelId: 'doomseed',
  baseHealth: 1640,
  massWeight: 24,
  speedClass: 'Medium',
  bodyRadius: 0.5,
  isFlying: true,
  targetPriority: 'AirAndGround',
  attackRange: 3.0,
  sightRange: 5.5,
  hitSpeed: 1.5,
  damage: 210,
  firstAttackDelay: 1.0,
  usesProjectile: true,
  deathEffect: 'DeathSpell',
  deathEffectParam: 'card_spell_miasma',
});

// ---------------------------------------------------------------------------
// Shapes the set barely used: the line and the cone
// ---------------------------------------------------------------------------

/**
 * 5 aether. A beam down the whole lane.
 *
 * The second piercing card in the game and much the longer. Everything queued
 * behind the front body takes the shot too, so a push stacked in a column feeds
 * it and a push spread wide starves it. Its own health is nominal.
 */
export const RAIL_LANCE = defineCard({
  name: 'Rail Lance',
  id: 'card_troop_rail_lance',
  rarity: 'Legendary',
  category: 'Troop',
  aetherCost: 5,
  unlockArena: 14,
  description: 'A beam the length of the lane. Everything in the column is hit.',
  tint: '#9fd8e0',
  modelId: 'railLance',
  baseHealth: 600,
  massWeight: 22,
  speedClass: 'Slow',
  bodyRadius: 0.5,
  targetPriority: 'AirAndGround',
  attackRange: 8.5,
  sightRange: 9.0,
  hitSpeed: 2.4,
  damage: 330,
  damageType: 'PiercingLine',
  // Half-width of the beam, in tiles.
  splashRadius: 0.6,
  firstAttackDelay: 1.6,
  usesProjectile: true,
});

/**
 * 4 aether. A building that fires a piercing bolt.
 *
 * The defensive counterpart to the Lance: it cannot advance, so it only ever
 * punishes a push walking *into* its line. Against a lane fed one body at a
 * time it is an ordinary cannon; against a committed column it is not.
 */
export const HARPOON_TURRET = defineCard({
  name: 'Harpoon Turret',
  id: 'card_building_harpoon_turret',
  rarity: 'Epic',
  category: 'Building',
  aetherCost: 4,
  unlockArena: 9,
  description: 'Its bolt runs through the whole column walking into it.',
  tint: '#7f9fb5',
  modelId: 'harpoonTurret',
  baseHealth: 1050,
  massWeight: 100,
  speedClass: 'Medium',
  bodyRadius: 0.6,
  targetPriority: 'Ground',
  attackRange: 6.5,
  sightRange: 7.0,
  hitSpeed: 1.6,
  damage: 175,
  damageType: 'PiercingLine',
  splashRadius: 0.55,
  firstAttackDelay: 0.5,
  usesProjectile: true,
  lifetimeSeconds: 30,
});

/**
 * 3 aether. A wide forward arc, and nothing behind it.
 *
 * Cone damage had three cards and all of them were incidental to something
 * else. This is the card that is *only* the cone: it clears a rank standing in
 * front of it in one swing and is helpless to anything that gets around it,
 * which makes where it is facing the whole question.
 */
export const CLEAVER = defineCard({
  name: 'Cleaver',
  id: 'card_troop_cleaver',
  rarity: 'Rare',
  category: 'Troop',
  aetherCost: 3,
  unlockArena: 5,
  description: 'One wide swing forward. Anything that gets behind it is safe.',
  tint: '#b5674a',
  modelId: 'cleaver',
  baseHealth: 1080,
  massWeight: 28,
  speedClass: 'Medium',
  bodyRadius: 0.5,
  targetPriority: 'Ground',
  attackRange: 1.4,
  sightRange: 5.5,
  hitSpeed: 1.5,
  damage: 165,
  damageType: 'ConeSplash',
  splashRadius: 2.4,
  firstAttackDelay: 0.9,
});

/**
 * 4 aether. The cone, at range, in the air.
 *
 * Where the Cleaver has to walk into the rank it wants to clear, this one
 * sweeps it from four tiles away — and pays for that in being made of paper and
 * having to face the right way from further off, where a flank costs more.
 */
export const GUST_PRIEST = defineCard({
  name: 'Gust Priest',
  id: 'card_troop_gust_priest',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 10,
  description: 'Sweeps a wide arc from range. Blind to anything off its flank.',
  tint: '#a8c4d8',
  modelId: 'gustPriest',
  baseHealth: 960,
  massWeight: 18,
  speedClass: 'Medium',
  bodyRadius: 0.45,
  targetPriority: 'AirAndGround',
  attackRange: 4.5,
  sightRange: 5.5,
  hitSpeed: 1.4,
  damage: 196,
  damageType: 'ConeSplash',
  splashRadius: 2.6,
  firstAttackDelay: 1.0,
  usesProjectile: true,
});

// ---------------------------------------------------------------------------
// Sustain — Lifesteal
// ---------------------------------------------------------------------------

/**
 * 3 aether. Flying, and heals off everything it bites.
 *
 * A fight it is winning it wins by more; a fight it is losing it loses just as
 * fast. That asymmetry means it beats a slow grind and dies to a single spell,
 * which is a very different failure mode from any other flier in the set.
 */
export const BLOODWING = defineCard({
  name: 'Bloodwing',
  id: 'card_troop_bloodwing',
  rarity: 'Rare',
  category: 'Troop',
  aetherCost: 3,
  unlockArena: 7,
  description: 'Drinks what it deals. Wins long fights, dies to short ones.',
  tint: '#a84a5f',
  modelId: 'bloodwing',
  baseHealth: 680,
  massWeight: 14,
  speedClass: 'Fast',
  bodyRadius: 0.4,
  isFlying: true,
  targetPriority: 'AirAndGround',
  attackRange: 1.4,
  sightRange: 5.5,
  hitSpeed: 1.1,
  damage: 130,
  firstAttackDelay: 0.6,
  passiveId: 'lifesteal',
  // Share of each blow returned as health.
  passiveMagnitude: 0.5,
});

/**
 * 5 aether. The same mechanic on something that cannot be removed quickly.
 *
 * Bloodwing's opposite number: where the flier converts a won fight into a
 * runaway, this converts a *long* one, and it has the health to insist on the
 * fight being long. Splash beats it, because splash means the fight is short.
 */
export const SANGUINE_KNIGHT = defineCard({
  name: 'Sanguine Knight',
  id: 'card_troop_sanguine_knight',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 5,
  unlockArena: 11,
  description: 'Heals off every cut it lands. The longer it stands, the worse.',
  tint: '#8a3f52',
  modelId: 'sanguineKnight',
  baseHealth: 2300,
  massWeight: 40,
  speedClass: 'Medium',
  bodyRadius: 0.55,
  targetPriority: 'Ground',
  attackRange: 1.2,
  sightRange: 5.5,
  hitSpeed: 1.4,
  damage: 235,
  firstAttackDelay: 1.0,
  passiveId: 'lifesteal',
  passiveMagnitude: 0.35,
});

// ---------------------------------------------------------------------------
// Force multipliers
// ---------------------------------------------------------------------------

/**
 * 2 aether. Does almost nothing, and makes everything else hurt more.
 *
 * The only card in the set whose value is entirely in other cards. Played on
 * its own it is two aether of nothing. Played behind a committed push it is the
 * largest damage multiplier in the game — and it dies to a stiff breeze, so the
 * counter is simply to kill the cheapest thing on the board.
 */
export const SPOTTER = defineCard({
  name: 'Spotter',
  id: 'card_troop_spotter',
  rarity: 'Common',
  category: 'Troop',
  aetherCost: 2,
  unlockArena: 4,
  description: 'Paints a target. Everything your side has hits it harder.',
  tint: '#c4b45f',
  modelId: 'spotter',
  baseHealth: 500,
  massWeight: 10,
  speedClass: 'Fast',
  bodyRadius: 0.4,
  targetPriority: 'AirAndGround',
  attackRange: 5.5,
  sightRange: 6.0,
  hitSpeed: 1.3,
  damage: 68,
  firstAttackDelay: 0.8,
  usesProjectile: true,
  passiveId: 'mark_target',
  // Seconds the mark lasts.
  passiveMagnitude: 3.0,
});

/**
 * 4 aether. One enormous opening blow, then a weak body standing in the open.
 *
 * The mirror of Elite Hounds. That card wants to stay on one target forever and
 * is ruined by being pulled off; this one spends everything on the first swing
 * and has nothing afterwards. Against a tank it is the best four-cost opener in
 * the set; against three cheap bodies it hits one of them and then dies.
 */
export const NIGHTBLADE = defineCard({
  name: 'Nightblade',
  id: 'card_troop_nightblade',
  rarity: 'Legendary',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 12,
  description: 'Unseen until it strikes, and the first strike is the whole card.',
  tint: '#5f4a8a',
  modelId: 'nightblade',
  baseHealth: 1000,
  massWeight: 18,
  speedClass: 'VeryFast',
  bodyRadius: 0.42,
  targetPriority: 'Ground',
  attackRange: 1.0,
  sightRange: 6.5,
  hitSpeed: 1.3,
  damage: 205,
  firstAttackDelay: 0.5,
  passiveId: 'ambush',
  // Multiplier on the opening blow.
  passiveMagnitude: 4.0,
});

// ---------------------------------------------------------------------------
// Durability, expressed four different ways
// ---------------------------------------------------------------------------

/**
 * 5 aether. Gets back up once, where it fell.
 *
 * Not a shield and not extra health: a shield absorbs a blow before it lands
 * and health is spent smoothly, but this pays out only at the moment of death,
 * in full, once. Anything that trades evenly with it loses the rematch. The
 * counter is that it stands back up *where it died* rather than where the fight
 * has moved to, and it is stunned as it does.
 */
export const UNDYING_SENTINEL = defineCard({
  name: 'Undying Sentinel',
  id: 'card_troop_undying_sentinel',
  rarity: 'Legendary',
  category: 'Troop',
  aetherCost: 5,
  unlockArena: 13,
  description: 'Falls once and rises again on the spot, at half strength.',
  tint: '#c4c4a8',
  modelId: 'undyingSentinel',
  baseHealth: 2000,
  massWeight: 42,
  speedClass: 'Slow',
  bodyRadius: 0.6,
  targetPriority: 'Ground',
  attackRange: 1.2,
  sightRange: 5.5,
  hitSpeed: 1.5,
  damage: 245,
  firstAttackDelay: 1.1,
  passiveId: 'revive_once',
  // Fraction of its pool it returns with.
  passiveMagnitude: 0.5,
});

/**
 * 4 aether. Immune to the first spell that touches it, whatever it costs.
 *
 * The only card that punishes a Rocket rather than dying to it — and the only
 * one whose counter is to throw the *cheapest* spell you hold, because the ward
 * spends itself on whatever lands first. A two-aether Zap disarms it completely.
 */
export const RUNE_BEARER = defineCard({
  name: 'Rune Bearer',
  id: 'card_troop_rune_bearer',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 10,
  description: 'The first spell to hit it does nothing at all. Only the first.',
  tint: '#5f8fc4',
  modelId: 'runeBearer',
  baseHealth: 1150,
  massWeight: 26,
  speedClass: 'Medium',
  bodyRadius: 0.5,
  targetPriority: 'AirAndGround',
  attackRange: 5.0,
  sightRange: 5.5,
  hitSpeed: 1.4,
  damage: 145,
  firstAttackDelay: 0.9,
  usesProjectile: true,
  passiveId: 'spell_ward',
  passiveMagnitude: 1,
});

/**
 * 5 aether. Repairs everything around it, forever, a little at a time.
 *
 * Distinct from the Chaplain's shield aura, which hands out a pool that eats
 * one whole blow: this returns a fraction of what has already been lost, twice
 * a second. So it beats sustained chip damage and does nothing whatsoever
 * against a single heavy strike — the exact inverse trade.
 */
export const AEGIS_MATRON = defineCard({
  name: 'Aegis Matron',
  id: 'card_troop_aegis_matron',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 5,
  unlockArena: 11,
  description: 'Mends the push around her, endlessly, a little at a time.',
  tint: '#c4a8d8',
  modelId: 'aegisMatron',
  baseHealth: 1850,
  massWeight: 30,
  speedClass: 'Medium',
  bodyRadius: 0.5,
  targetPriority: 'AirAndGround',
  attackRange: 4.5,
  sightRange: 5.5,
  hitSpeed: 1.6,
  damage: 150,
  firstAttackDelay: 1.0,
  usesProjectile: true,
  passiveId: 'aura_guard',
  // Share of missing health returned to each ally, twice a second.
  passiveMagnitude: 0.05,
});

/**
 * 6 aether. An enormous shell that nothing gets through quickly.
 *
 * The set had two six-costs and one shelled body. This is both. It does almost
 * no damage — it is a wall you push behind, and a wall is only worth six aether
 * if what follows it is worth more.
 */
export const TITANSHELL = defineCard({
  name: 'Titanshell',
  id: 'card_troop_titanshell',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 6,
  unlockArena: 12,
  description: 'A slab of shell. Barely fights; simply refuses to be removed.',
  tint: '#7f8f6f',
  modelId: 'titanshell',
  baseHealth: 4500,
  massWeight: 70,
  speedClass: 'Slow',
  bodyRadius: 0.85,
  targetPriority: 'Buildings',
  attackRange: 1.2,
  sightRange: 7.5,
  hitSpeed: 1.8,
  damage: 205,
  firstAttackDelay: 1.4,
});

// ---------------------------------------------------------------------------
// Cards that grow, and cards that diminish what they touch
// ---------------------------------------------------------------------------

/**
 * 5 aether. Permanently stronger for every body it puts down.
 *
 * Fed by exactly the thing that answers most pushes — cheap chaff — so the
 * usual reflex is the wrong one. Answer it with one expensive body and it
 * gains nothing; answer it with five cheap ones and you have built it.
 */
export const BONE_REAPER = defineCard({
  name: 'Bone Reaper',
  id: 'card_troop_bone_reaper',
  rarity: 'Legendary',
  category: 'Troop',
  aetherCost: 5,
  unlockArena: 14,
  description: 'Grows with every kill. Feeding it chaff is how it wins.',
  tint: '#6f6f8f',
  modelId: 'boneReaper',
  baseHealth: 1820,
  massWeight: 34,
  speedClass: 'Medium',
  bodyRadius: 0.55,
  targetPriority: 'Ground',
  attackRange: 1.6,
  sightRange: 5.5,
  hitSpeed: 1.5,
  damage: 240,
  firstAttackDelay: 1.0,
  passiveId: 'harvest',
  // Health and heft gained per body felled, as a share of its own blow.
  passiveMagnitude: 0.55,
});

/**
 * 4 aether. Every blow permanently blunts what it hits.
 *
 * It wins fights it cannot win on stats, and it does precisely nothing to a
 * tower — the only card in the set with no offensive value at all against a
 * structure. Against a swarm it is close to useless: each body is blunted
 * separately, and they die before the blunting matters.
 */
export const RUSTBEAK = defineCard({
  name: 'Rustbeak',
  id: 'card_troop_rustbeak',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 9,
  description: 'Files down whatever it strikes. Useless against buildings.',
  tint: '#a8916f',
  modelId: 'rustbeak',
  baseHealth: 1120,
  massWeight: 18,
  speedClass: 'Fast',
  bodyRadius: 0.42,
  isFlying: true,
  targetPriority: 'AirAndGround',
  attackRange: 1.2,
  sightRange: 5.5,
  hitSpeed: 1.1,
  damage: 168,
  firstAttackDelay: 0.7,
  passiveId: 'sunder',
  // Share of the victim's damage stripped per blow.
  passiveMagnitude: 0.14,
});

// ---------------------------------------------------------------------------
// Cards about position
// ---------------------------------------------------------------------------

/**
 * 4 aether. Hits harder the further it has run unobstructed.
 *
 * Related to Charge and deliberately unlike it: a charge is a threshold that
 * fires once and resets, this is a continuous curve with no ceiling inside a
 * lane. Blocking it early is worth several times blocking it late, so a
 * one-aether body at the bridge genuinely answers it.
 */
export const BOULDER_ROLLER = defineCard({
  name: 'Boulder Roller',
  id: 'card_troop_boulder_roller',
  rarity: 'Rare',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 8,
  description: 'Builds force as it rolls. Stop it early or not at all.',
  tint: '#8f8f8f',
  modelId: 'boulderRoller',
  baseHealth: 1700,
  massWeight: 46,
  speedClass: 'Medium',
  bodyRadius: 0.6,
  targetPriority: 'Ground',
  attackRange: 1.2,
  sightRange: 5.5,
  hitSpeed: 1.6,
  damage: 175,
  firstAttackDelay: 1.0,
  passiveId: 'momentum',
  // Bonus per second of unobstructed travel, as a share of its blow.
  passiveMagnitude: 0.3,
});

/**
 * 4 aether. Echoes its damage onto whatever is standing next to its victim.
 *
 * The inverse of every splash card in the set. Splash rewards *you* for hitting
 * a clump; this punishes *them* for being one, and it does so through the
 * single target it has locked. A push spread wide takes almost nothing.
 */
export const CHAINBINDER = defineCard({
  name: 'Chainbinder',
  id: 'card_troop_chainbinder',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 11,
  description: 'What it hits, its neighbours feel. Spread out or suffer.',
  tint: '#9f7f5f',
  modelId: 'chainbinder',
  baseHealth: 1420,
  massWeight: 26,
  speedClass: 'Medium',
  bodyRadius: 0.5,
  targetPriority: 'Ground',
  attackRange: 1.4,
  sightRange: 5.5,
  hitSpeed: 1.5,
  damage: 180,
  firstAttackDelay: 0.9,
  passiveId: 'tether',
  // Share of the blow echoed onto each neighbour.
  passiveMagnitude: 0.45,
});

/**
 * 4 aether. Hits two things at once, at full weight.
 *
 * Not a chain and not splash: there is no falloff and no arc, the second victim
 * simply takes the same blow, and it has to be in the archer's own reach rather
 * than near the first. So it is a strictly single-target card against one enemy
 * and close to double value against two — the read is entirely on their side.
 */
export const TWINBOW = defineCard({
  name: 'Twinbow',
  id: 'card_troop_twinbow',
  rarity: 'Rare',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 7,
  description: 'Looses at two targets at once, both at full weight.',
  tint: '#7fa87f',
  modelId: 'twinbow',
  baseHealth: 900,
  massWeight: 16,
  speedClass: 'Medium',
  bodyRadius: 0.42,
  targetPriority: 'AirAndGround',
  attackRange: 5.5,
  sightRange: 6.0,
  hitSpeed: 1.5,
  damage: 158,
  firstAttackDelay: 0.9,
  usesProjectile: true,
  passiveId: 'split_shot',
  // Share of the blow the second target takes.
  passiveMagnitude: 1.0,
});

/**
 * 3 aether. Attacks the opponent's aether instead of their board.
 *
 * The only card in the set that touches the resource. Every second it spends
 * connected to a tower costs the defender tempo that never shows on a health
 * bar, which makes ignoring it a slow, invisible way to lose. It is otherwise
 * deliberately pathetic in a fight.
 */
export const AETHER_LEECH = defineCard({
  name: 'Aether Leech',
  id: 'card_troop_aether_leech',
  rarity: 'Legendary',
  category: 'Troop',
  aetherCost: 3,
  unlockArena: 12,
  description: 'Siphons their aether while it feeds. Ignore it and you pay.',
  tint: '#b45fc4',
  modelId: 'aetherLeech',
  baseHealth: 820,
  massWeight: 14,
  speedClass: 'Medium',
  bodyRadius: 0.4,
  isFlying: true,
  targetPriority: 'Buildings',
  attackRange: 2.0,
  sightRange: 7.5,
  hitSpeed: 1.2,
  damage: 125,
  firstAttackDelay: 0.8,
  passiveId: 'siphon',
  // Aether points drained from the defender per connected blow.
  passiveMagnitude: 34,
});

// ---------------------------------------------------------------------------
// The air-only bench, which had two cards on it
// ---------------------------------------------------------------------------

/**
 * 4 aether. Ground troops walk past it entirely.
 *
 * A true specialist: colossal against anything airborne and literally incapable
 * of touching anything else. The set had two of these, which was not enough for
 * "bring an anti-air card" to be a real deckbuilding decision.
 */
export const SKY_PIERCER = defineCard({
  name: 'Sky Piercer',
  id: 'card_troop_sky_piercer',
  rarity: 'Rare',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 8,
  description: 'Devastating to anything airborne. Cannot touch the ground.',
  tint: '#5fb5c4',
  modelId: 'skyPiercer',
  baseHealth: 1100,
  massWeight: 24,
  speedClass: 'Medium',
  bodyRadius: 0.5,
  targetPriority: 'AirOnly',
  attackRange: 6.0,
  sightRange: 6.5,
  hitSpeed: 1.1,
  damage: 285,
  firstAttackDelay: 0.8,
  usesProjectile: true,
});

/**
 * 3 aether. The cheap, fast half of the same specialism.
 *
 * Where the Piercer is a static gun that deletes a flier, this one chases —
 * fast enough to catch a Balloon-class card that has already slipped past, and
 * far too fragile to be left standing afterwards.
 */
export const CLOUD_LANCER = defineCard({
  name: 'Cloud Lancer',
  id: 'card_troop_cloud_lancer',
  rarity: 'Rare',
  category: 'Troop',
  aetherCost: 3,
  unlockArena: 8,
  description: 'Runs down anything in the sky. Blind to everything on foot.',
  tint: '#8fd8e0',
  modelId: 'cloudLancer',
  baseHealth: 700,
  massWeight: 14,
  speedClass: 'VeryFast',
  bodyRadius: 0.4,
  isFlying: true,
  targetPriority: 'AirOnly',
  attackRange: 2.2,
  sightRange: 6.5,
  hitSpeed: 1.0,
  damage: 190,
  firstAttackDelay: 0.6,
});

// ---------------------------------------------------------------------------
// The top of the curve
// ---------------------------------------------------------------------------

/**
 * 6 aether. A building that answers a lane rather than a card.
 *
 * Long-lived, heavily armoured and slow to fire, so it is never a reaction —
 * it is a commitment made a full rotation before the push it is meant to stop.
 * Six aether spent on the wrong lane is a lost match.
 */
export const WARMASON = defineCard({
  name: 'Warmason',
  id: 'card_building_warmason',
  rarity: 'Legendary',
  category: 'Building',
  aetherCost: 6,
  unlockArena: 13,
  description: 'A fortress, not a reaction. Commit it early or not at all.',
  tint: '#a8a08f',
  modelId: 'warmason',
  baseHealth: 2200,
  massWeight: 100,
  speedClass: 'Medium',
  bodyRadius: 0.8,
  targetPriority: 'AirAndGround',
  attackRange: 6.0,
  sightRange: 6.5,
  hitSpeed: 2.2,
  damage: 360,
  damageType: 'AreaSplash',
  splashRadius: 1.6,
  firstAttackDelay: 1.0,
  usesProjectile: true,
  lifetimeSeconds: 40,
});

/**
 * 7 aether. The heaviest card in the game, and the biggest mistake available.
 *
 * Nothing sat above six, which meant the top of the curve had no card that
 * genuinely cost a rotation to play. This one does: seven aether is most of a
 * bar, and being caught mid-deploy is how you lose a tower.
 *
 * What it buys is the swing rather than the body. Titanshell is the bigger
 * wall and costs less; this is the card that removes what the wall walks into,
 * clearing a whole rank per stroke. Buying both is fourteen aether, which is
 * the joke the top of the curve is allowed to make.
 */
export const DREAD_SERPENT = defineCard({
  name: 'Dread Serpent',
  id: 'card_troop_dread_serpent',
  rarity: 'Legendary',
  category: 'Troop',
  aetherCost: 7,
  unlockArena: 15,
  description: 'Seven aether of ruin. Being caught deploying it loses towers.',
  tint: '#4a8a6f',
  modelId: 'dreadSerpent',
  baseHealth: 3600,
  massWeight: 80,
  speedClass: 'Slow',
  bodyRadius: 0.9,
  targetPriority: 'Ground',
  attackRange: 1.8,
  sightRange: 6.5,
  hitSpeed: 1.5,
  damage: 330,
  damageType: 'ConeSplash',
  splashRadius: 1.5,
  firstAttackDelay: 1.4,
});

// ---------------------------------------------------------------------------
// The cheap end
// ---------------------------------------------------------------------------

/**
 * 2 aether. Lobbed fire from the air, and a body made of nothing.
 *
 * The cheapest flying splash in the set by two full aether. Anything that can
 * shoot up removes it instantly, which is the entire price — it exists to
 * punish a ground-only defence, and against anything else it is a donation.
 */
export const EMBERWING = defineCard({
  name: 'Emberwing',
  id: 'card_troop_emberwing',
  rarity: 'Common',
  category: 'Troop',
  aetherCost: 2,
  unlockArena: 6,
  description: 'Cheap fire from above. Anything that shoots up deletes it.',
  tint: '#d8834a',
  modelId: 'emberwing',
  baseHealth: 330,
  massWeight: 10,
  speedClass: 'Fast',
  bodyRadius: 0.38,
  isFlying: true,
  targetPriority: 'Ground',
  attackRange: 3.5,
  sightRange: 5.5,
  hitSpeed: 1.5,
  damage: 130,
  damageType: 'AreaSplash',
  splashRadius: 1.3,
  firstAttackDelay: 1.0,
  usesProjectile: true,
});

/**
 * 2 aether. Enormous damage on a body that dies to anything.
 *
 * The purest expression of a skilled trade in the set: placed where it gets one
 * free volley it is worth four aether, and placed carelessly it is worth none.
 * Nothing about it is forgiving.
 */
export const GLASS_SENTINEL = defineCard({
  name: 'Glass Sentinel',
  id: 'card_troop_glass_sentinel',
  rarity: 'Rare',
  category: 'Troop',
  aetherCost: 2,
  unlockArena: 5,
  description: 'Hits like a five-cost, dies like a one. Placement is everything.',
  tint: '#9fd8c4',
  modelId: 'glassSentinel',
  baseHealth: 260,
  massWeight: 8,
  speedClass: 'Medium',
  bodyRadius: 0.38,
  targetPriority: 'AirAndGround',
  attackRange: 5.0,
  sightRange: 5.5,
  hitSpeed: 1.0,
  damage: 165,
  firstAttackDelay: 0.7,
  usesProjectile: true,
});

/**
 * 3 aether. Two bodies that are stronger for standing together.
 *
 * Pack Bond exists on two cards and both are large; this is the cheap version,
 * where the bond is the entire point. Split them and they are worthless, which
 * makes any card that displaces or pulls a hard counter.
 */
export const THORN_CALLER = defineCard({
  name: 'Thorn Caller',
  id: 'card_troop_thorn_caller',
  rarity: 'Rare',
  category: 'Troop',
  aetherCost: 3,
  unlockArena: 6,
  description: 'A pair that fights hard together and badly apart.',
  tint: '#7f9f4a',
  modelId: 'thornCaller',
  baseHealth: 520,
  spawnCount: 2,
  massWeight: 14,
  speedClass: 'Fast',
  bodyRadius: 0.4,
  targetPriority: 'Ground',
  attackRange: 2.2,
  sightRange: 5.5,
  hitSpeed: 1.2,
  damage: 125,
  firstAttackDelay: 0.8,
  passiveId: 'pack_bond',
  // Allied troops nearby needed to rouse it.
  passiveMagnitude: 1,
});

export const MENAGERIE_CARDS = [
  BLIGHT_FANG,
  MIASMA,
  CONCUSSOR,
  POWDER_MULE,
  DOOMSEED,
  RAIL_LANCE,
  HARPOON_TURRET,
  CLEAVER,
  GUST_PRIEST,
  BLOODWING,
  SANGUINE_KNIGHT,
  SPOTTER,
  NIGHTBLADE,
  UNDYING_SENTINEL,
  RUNE_BEARER,
  AEGIS_MATRON,
  TITANSHELL,
  BONE_REAPER,
  RUSTBEAK,
  BOULDER_ROLLER,
  CHAINBINDER,
  TWINBOW,
  AETHER_LEECH,
  SKY_PIERCER,
  CLOUD_LANCER,
  WARMASON,
  DREAD_SERPENT,
  EMBERWING,
  GLASS_SENTINEL,
  THORN_CALLER,
];
