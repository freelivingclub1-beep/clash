/**
 * Champions (deck slot 2 / the wild slot) and Tower Troops (deck slot 9).
 *
 * A tower troop's `baseHealth` *is* the princess tower's health — equipping a
 * different tower troop changes how much the side towers can absorb, which is
 * how the 2026 tower-troop system differentiates them beyond raw DPS.
 */

import { defineCard } from '../schema';

// ---------------------------------------------------------------------------
// Champions
// ---------------------------------------------------------------------------

export const GOLDEN_KNIGHT = defineCard({
  name: 'Golden Knight',
  id: 'card_troop_golden_knight',
  rarity: 'Champion',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 15,
  description: 'Dashes through enemy ranks, striking each target he passes.',
  tint: '#e0c05f',
  modelId: 'goldenKnight',
  baseHealth: 3200,
  massWeight: 55,
  speedClass: 'Medium',
  bodyRadius: 0.5,
  targetPriority: 'Ground',
  attackRange: 0.8,
  sightRange: 5.5,
  hitSpeed: 1.1,
  damage: 240,
  firstAttackDelay: 0.4,
  isHero: true,
  abilityAetherCost: 1,
  abilityCooldown: 8,
  abilityActionHook: 'ChargeDash',
  abilityTargetFilter: 'NearestEnemy',
  abilityDamage: 180,
  abilityRadius: 5.0,
  abilityDurationSeconds: 1.2,
});

export const ARCHER_QUEEN = defineCard({
  name: 'Archer Queen',
  id: 'card_troop_archer_queen',
  rarity: 'Champion',
  category: 'Troop',
  aetherCost: 5,
  unlockArena: 15,
  description: 'Cloaks herself, becoming untargetable while her attack rate doubles.',
  tint: '#c05f9f',
  modelId: 'archerQueen',
  baseHealth: 1200,
  massWeight: 20,
  speedClass: 'Medium',
  bodyRadius: 0.38,
  targetPriority: 'AirAndGround',
  attackRange: 5.0,
  sightRange: 6.0,
  hitSpeed: 0.7,
  damage: 130,
  firstAttackDelay: 0.4,
  usesProjectile: true,
  isHero: true,
  abilityAetherCost: 1,
  abilityCooldown: 12,
  abilityActionHook: 'Invisibility',
  abilityTargetFilter: 'Self',
  abilityDurationSeconds: 3.5,
});

// ---------------------------------------------------------------------------
// Tower troops
// ---------------------------------------------------------------------------

export const TOWER_PRINCESS = defineCard({
  name: 'Tower Princess',
  id: 'card_towertroop_tower_princess',
  rarity: 'Common',
  category: 'TowerTroop',
  aetherCost: 1,
  unlockArena: 1,
  description: 'The default tower defender. Balanced range and hit speed.',
  tint: '#d09fc0',
  modelId: 'towerPrincess',
  baseHealth: 2534,
  massWeight: 100,
  bodyRadius: 1.5,
  targetPriority: 'AirAndGround',
  attackRange: 7.5,
  sightRange: 7.5,
  hitSpeed: 0.8,
  damage: 109,
  firstAttackDelay: 0.4,
  usesProjectile: true,
});

export const CANNONEER = defineCard({
  name: 'Cannoneer',
  id: 'card_towertroop_cannoneer',
  rarity: 'Rare',
  category: 'TowerTroop',
  aetherCost: 1,
  unlockArena: 7,
  description: 'Hits far harder than the Princess but cannot target air.',
  tint: '#a0906f',
  modelId: 'towerCannoneer',
  baseHealth: 2800,
  massWeight: 100,
  bodyRadius: 1.5,
  targetPriority: 'Ground',
  attackRange: 7.0,
  sightRange: 7.0,
  hitSpeed: 1.5,
  damage: 260,
  firstAttackDelay: 0.6,
  usesProjectile: true,
});

export const DAGGER_DUCHESS = defineCard({
  name: 'Dagger Duchess',
  id: 'card_towertroop_dagger_duchess',
  rarity: 'Legendary',
  category: 'TowerTroop',
  aetherCost: 1,
  unlockArena: 12,
  description: 'Long reach and a blistering hit speed, at the cost of tower health.',
  tint: '#8f6f9f',
  modelId: 'towerDuchess',
  baseHealth: 2200,
  massWeight: 100,
  bodyRadius: 1.5,
  targetPriority: 'AirAndGround',
  attackRange: 8.5,
  sightRange: 8.5,
  hitSpeed: 0.4,
  damage: 60,
  firstAttackDelay: 0.3,
  usesProjectile: true,
});

/**
 * The King Tower's stat block. Not a card anyone owns — it is marked
 * unselectable so it never surfaces in the collection — but modelling it as a
 * card definition lets towers, buildings and troops share one entity code path
 * instead of the King Tower needing a special case everywhere.
 */
export const KING_TOWER = defineCard({
  name: 'King Tower',
  id: 'card_towertroop_king_tower',
  rarity: 'Common',
  category: 'TowerTroop',
  selectable: false,
  aetherCost: 1,
  unlockArena: 1,
  description: 'Wakes up when damaged or when a princess tower falls.',
  tint: '#c0c8d8',
  modelId: 'kingKeep',
  baseHealth: 4824,
  massWeight: 100,
  bodyRadius: 2.0,
  targetPriority: 'AirAndGround',
  attackRange: 7.0,
  sightRange: 7.0,
  hitSpeed: 1.0,
  damage: 109,
  firstAttackDelay: 0.8,
  usesProjectile: true,
});

export const CHAMPION_CARDS = [GOLDEN_KNIGHT, ARCHER_QUEEN];
export const TOWER_TROOP_CARDS = [TOWER_PRINCESS, CANNONEER, DAGGER_DUCHESS, KING_TOWER];
