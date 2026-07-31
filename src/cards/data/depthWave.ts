/**
 * The depth wave — the thin roles, filled out.
 *
 * The role split made it obvious where the roster was shallow: nine win
 * conditions and eighteen melee bodies against four support cards, five
 * spells, six buildings and three champions. A role you only have one real
 * option in is not a choice, so this wave goes almost entirely into those.
 *
 * Two of the spells here deal no damage at all. That is deliberate — a spell
 * slot that can only ever mean "delete something" flattens the decision, and
 * Snare and Warcry are both cards that do nothing on their own and everything
 * when the timing is right. They are also the clearest expression of the
 * placement-and-timing idea in the whole set: a two-aether Snare on a
 * five-aether push, thrown a beat before it reaches the bridge, is a trade a
 * stat line cannot describe.
 */

import { defineCard } from '../schema';

// ---------------------------------------------------------------------------
// Spells
// ---------------------------------------------------------------------------

/**
 * 2 aether. No damage whatsoever — this is a tempo card, not an answer.
 *
 * Spells are balanced by what they do rather than by EPP, and what this does
 * is buy four seconds. Thrown on a committed push it separates the tank from
 * its support; thrown on nothing it is two aether set on fire.
 */
export const SNARE = defineCard({
  name: 'Snare',
  id: 'card_spell_snare',
  rarity: 'Common',
  category: 'Spell',
  aetherCost: 2,
  unlockArena: 4,
  description: 'Wide net of grasping roots. No damage — everything caught crawls.',
  tint: '#6f7f52',
  baseHealth: 0,
  damage: 0,
  damageType: 'AreaSplash',
  splashRadius: 3.6,
  targetPriority: 'AirAndGround',
  onHitStatus: 'Slow',
  // Fraction of normal speed while snared.
  statusMagnitude: 0.4,
  statusDuration: 4.0,
});

/**
 * 3 aether. A precision spell: half the radius of Arrows, twice the damage.
 *
 * The breakpoint that matters is the Musketeer — this kills one outright, and
 * no other three-cost spell does. The price is that the blast is barely wider
 * than the unit itself, so being a tile off means killing nothing at all.
 */
export const SPLINTER_BOMB = defineCard({
  name: 'Splinter Bomb',
  id: 'card_spell_splinter_bomb',
  rarity: 'Rare',
  category: 'Spell',
  aetherCost: 3,
  unlockArena: 6,
  description: 'Tight, heavy blast. Kills a Musketeer if you land it exactly.',
  tint: '#b5563c',
  baseHealth: 0,
  damage: 740,
  damageType: 'AreaSplash',
  splashRadius: 1.1,
  targetPriority: 'AirAndGround',
});

/**
 * 3 aether. No damage: it makes what you already have hit and move faster.
 *
 * The counterpart to Snare — one slows theirs, one hurries yours, neither
 * removes anything from the board. Both are only ever as good as the moment
 * they are used in.
 */
export const WARCRY = defineCard({
  name: 'Warcry',
  id: 'card_spell_warcry',
  rarity: 'Rare',
  category: 'Spell',
  aetherCost: 3,
  unlockArena: 8,
  description: 'Your troops in the blast hit faster and move faster for a while.',
  tint: '#c4487a',
  baseHealth: 0,
  damage: 0,
  damageType: 'AreaSplash',
  splashRadius: 4.0,
  targetPriority: 'AirAndGround',
  onHitStatus: 'Rage',
  statusMagnitude: 1,
  statusDuration: 6.0,
});

// ---------------------------------------------------------------------------
// Support
// ---------------------------------------------------------------------------

/**
 * 4 aether = 4000 EPP. `aura_shield` costs 340 -> 3660. Medium band, ground.
 *
 * Plates the push instead of healing it. A point of shield is worth more than
 * a point of health because of overkill absorption — each plate eats one blow
 * of any size — so a swarm walking under this becomes immune to the *first*
 * hit from anything, which is exactly what beats a Fireball and exactly what
 * does nothing against a sustained beam.
 */
export const SHIELD_CHAPLAIN = defineCard({
  name: 'Shield Chaplain',
  id: 'card_troop_shield_chaplain',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 9,
  description: 'Plates nearby allies with armour that absorbs one hit of any size.',
  tint: '#8fa8c4',
  modelId: 'shieldChaplain',
  baseHealth: 980,
  massWeight: 28,
  speedClass: 'Medium',
  bodyRadius: 0.38,
  targetPriority: 'AirAndGround',
  attackRange: 5.0,
  sightRange: 5.5,
  hitSpeed: 1.5,
  damage: 118,
  firstAttackDelay: 0.6,
  usesProjectile: true,
  passiveId: 'aura_shield',
  // Armour granted to each ally in range, topped up every 2.5 seconds.
  passiveMagnitude: 90,
});

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

/**
 * 3 aether = 3000 EPP. `aura_heal` costs 260 -> 2740, x1.25 decay bonus.
 *
 * Lantern Bearer's stationary cousin. The Bearer walks with the push and dies
 * to whatever the push runs into; this cannot move at all, so it heals a
 * defence rather than an attack — and being a building, it also pulls a win
 * condition off its line, which the Bearer never does.
 */
export const WARDSTONE = defineCard({
  name: 'Wardstone',
  id: 'card_building_wardstone',
  rarity: 'Rare',
  category: 'Building',
  aetherCost: 3,
  unlockArena: 7,
  description: 'Mends nearby allies. Cannot attack, and pulls a push off its line.',
  tint: '#7fa88f',
  modelId: 'wardstone',
  baseHealth: 1950,
  massWeight: 100,
  speedClass: 'Medium',
  bodyRadius: 0.7,
  targetPriority: 'Ground',
  attackRange: 0,
  sightRange: 0,
  hitSpeed: 1,
  damage: 0,
  lifetimeSeconds: 35,
  passiveId: 'aura_heal',
  // Health restored to each ally in range, every second.
  passiveMagnitude: 46,
});

/**
 * 3 aether = 3000 EPP. `reflect_melee` costs 290 -> 2710, x1.25 decay bonus.
 *
 * A building that deals no damage and still kills things. Everything that
 * stops to chew on it bleeds for the privilege, so the more committed the push
 * is, the worse the trade — and a ranged unit shooting it from four tiles away
 * takes nothing at all.
 */
export const BARBED_FENCE = defineCard({
  name: 'Barbed Fence',
  id: 'card_building_barbed_fence',
  rarity: 'Rare',
  category: 'Building',
  aetherCost: 3,
  unlockArena: 6,
  description: 'Never attacks. Anything that hits it in melee cuts itself open.',
  tint: '#8c7d6b',
  modelId: 'barbedFence',
  baseHealth: 1950,
  massWeight: 100,
  speedClass: 'Medium',
  bodyRadius: 0.72,
  targetPriority: 'Ground',
  attackRange: 0,
  sightRange: 0,
  hitSpeed: 1,
  damage: 0,
  lifetimeSeconds: 30,
  passiveId: 'reflect_melee',
  // Share of each melee blow returned to whoever swung it.
  passiveMagnitude: 0.85,
});

// ---------------------------------------------------------------------------
// Tanks
// ---------------------------------------------------------------------------

/**
 * 5 aether = 5000 EPP. `displacement` costs 180 -> 4820. Melee, ground, slow.
 *
 * A wall that pushes back. Every swing shoves what it hits toward that side's
 * own half, which is worth more against a swarm walking into it than against a
 * single body, and worth nothing at all against anything shooting from range.
 */
export const RAMPART_OX = defineCard({
  name: 'Rampart Ox',
  id: 'card_troop_rampart_ox',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 5,
  unlockArena: 10,
  description: 'Shoves whatever it hits backward. Slow, heavy, and hard to move.',
  tint: '#9b8060',
  modelId: 'rampartOx',
  baseHealth: 3350,
  massWeight: 90,
  speedClass: 'Slow',
  bodyRadius: 0.62,
  targetPriority: 'Ground',
  attackRange: 1.2,
  sightRange: 5.5,
  hitSpeed: 1.5,
  damage: 235,
  firstAttackDelay: 0.5,
  passiveId: 'displacement',
  // Tiles the victim is shoved on each connecting blow.
  passiveMagnitude: 0.55,
});

/**
 * 6 aether = 6000 EPP. `death_split` costs 220 -> 5780. Melee, ground, slow.
 *
 * Obsidian Colossus walks past your defenders at a tower; this one stops and
 * fights them, then leaves two Barbarians standing when it falls. Killing it
 * is never the end of the exchange, which is what makes committing your whole
 * defence to it the mistake.
 */
export const GRAVE_TITAN = defineCard({
  name: 'Grave Titan',
  id: 'card_troop_grave_titan',
  rarity: 'Legendary',
  category: 'Troop',
  aetherCost: 6,
  unlockArena: 13,
  description: 'Enormous, and two Barbarians climb out of it when it dies.',
  tint: '#6b6478',
  modelId: 'graveTitan',
  baseHealth: 3200,
  massWeight: 95,
  speedClass: 'Slow',
  bodyRadius: 0.68,
  targetPriority: 'Ground',
  attackRange: 1.2,
  sightRange: 6.0,
  hitSpeed: 1.6,
  // Single-target, not a cleave. The first draft cleaved and audited at 1.61 —
  // splash costs 35% of the damage allowance, and paying that on top of a
  // death split left nothing to fund the health a six-cost body needs.
  damage: 290,
  firstAttackDelay: 0.6,
  passiveId: 'death_split',
  // Bodies that climb out on death.
  passiveMagnitude: 2,
  deathEffectParam: 'card_troop_barbarians',
});

// ---------------------------------------------------------------------------
// Melee and swarm
// ---------------------------------------------------------------------------

/**
 * 4 aether = 4000 EPP. Air-and-ground -> x0.85 DPS. Melee band, ground body.
 *
 * Pike Sentry with an answer to air. Same idea — reach far enough to fight
 * over the body in front of it — for one more aether and rather less health,
 * which is the whole trade: the cheaper pike is sturdier and blind to fliers.
 */
export const HALBERDIER = defineCard({
  name: 'Halberdier',
  id: 'card_troop_halberdier',
  rarity: 'Rare',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 8,
  description: 'Long reach, and it can bring down fliers as well as ground.',
  tint: '#7d8fa0',
  modelId: 'halberdier',
  baseHealth: 1080,
  massWeight: 34,
  speedClass: 'Medium',
  bodyRadius: 0.4,
  targetPriority: 'AirAndGround',
  attackRange: 2.4,
  sightRange: 6.0,
  hitSpeed: 1.3,
  damage: 205,
  firstAttackDelay: 0.45,
});

/**
 * 3 aether = 3000 EPP. `burrow` costs 310 -> 2690. Three bodies -> x1.6.
 *
 * Sand Burrower's cheap, plural version. One burrower is a body that appears
 * where you did not want it; three are a swarm that does, and each is
 * individually so flimsy that a single splash hit ends the whole card.
 */
export const TUNNEL_RATS = defineCard({
  name: 'Tunnel Rats',
  id: 'card_troop_tunnel_rats',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 3,
  unlockArena: 9,
  description: 'Three diggers, unseen while they travel. They surface to bite.',
  tint: '#8a7355',
  modelId: 'tunnelRat',
  baseHealth: 235,
  spawnCount: 3,
  massWeight: 10,
  speedClass: 'Fast',
  bodyRadius: 0.26,
  targetPriority: 'Ground',
  attackRange: 0.7,
  sightRange: 5.0,
  hitSpeed: 1.0,
  damage: 130,
  firstAttackDelay: 0.35,
  passiveId: 'burrow',
  // Unused by the mechanic itself; the schema requires a positive value for
  // any named passive, which is what stops a card claiming one for free.
  passiveMagnitude: 1,
});

// ---------------------------------------------------------------------------
// Champions
// ---------------------------------------------------------------------------

/**
 * 5 aether, Champion -> x1.25 budget. Melee, ground, medium.
 *
 * The ability is the card: everything nearby is forced to swing at her for two
 * seconds, whatever it was doing. That is a defensive button — it buys a tower
 * a breath — and an offensive one, because a push that has all turned around
 * to hit the Matriarch is a push that has stopped walking.
 */
export const WARDEN_MATRIARCH = defineCard({
  name: 'Warden Matriarch',
  id: 'card_troop_warden_matriarch',
  rarity: 'Champion',
  category: 'Troop',
  aetherCost: 5,
  unlockArena: 15,
  description: 'Roars, and every enemy nearby has to fight her instead.',
  tint: '#c9a24a',
  modelId: 'wardenMatriarch',
  baseHealth: 3000,
  massWeight: 70,
  speedClass: 'Medium',
  bodyRadius: 0.52,
  targetPriority: 'Ground',
  attackRange: 1.2,
  sightRange: 5.5,
  hitSpeed: 1.3,
  damage: 255,
  firstAttackDelay: 0.4,
  isHero: true,
  abilityAetherCost: 2,
  abilityCooldown: 12,
  abilityActionHook: 'AreaTaunt',
  abilityTargetFilter: 'BroadArea',
  abilityRadius: 4.5,
  abilityDurationSeconds: 2.0,
});

/**
 * 5 aether, Champion -> x1.25 budget. Medium band, air-and-ground.
 *
 * A champion that fights from the back. The escort is not damage so much as
 * three bodies of delay, dropped exactly where he is standing — which makes
 * him the one champion whose ability is best used when he is losing.
 */
export const ROOKMASTER = defineCard({
  name: 'Rookmaster',
  id: 'card_troop_rookmaster',
  rarity: 'Champion',
  category: 'Troop',
  aetherCost: 5,
  unlockArena: 15,
  description: 'Calls up a skeleton escort around himself, on demand.',
  tint: '#7a6ba8',
  modelId: 'rookmaster',
  baseHealth: 1650,
  massWeight: 26,
  speedClass: 'Medium',
  bodyRadius: 0.4,
  targetPriority: 'AirAndGround',
  attackRange: 5.5,
  sightRange: 6.0,
  hitSpeed: 1.2,
  damage: 210,
  firstAttackDelay: 0.6,
  usesProjectile: true,
  isHero: true,
  abilityAetherCost: 1,
  abilityCooldown: 9,
  abilityActionHook: 'SpawnMinions',
  abilityTargetFilter: 'Self',
  abilityRadius: 1.5,
  abilityDurationSeconds: 0.5,
});

export const DEPTH_WAVE_CARDS = [
  SNARE,
  SPLINTER_BOMB,
  WARCRY,
  SHIELD_CHAPLAIN,
  WARDSTONE,
  BARBED_FENCE,
  RAMPART_OX,
  GRAVE_TITAN,
  HALBERDIER,
  TUNNEL_RATS,
  WARDEN_MATRIARCH,
  ROOKMASTER,
];
