/**
 * Spells and buildings.
 *
 * Spells carry no health and resolve as an instant area effect at the target
 * point. Buildings are stationary entities with a decaying lifetime — they are
 * what pulls building-targeting win conditions like Hog Rider and Giant.
 */

import { defineCard } from '../schema';

export const FIREBALL = defineCard({
  name: 'Fireball',
  id: 'card_spell_fireball',
  rarity: 'Rare',
  category: 'Spell',
  aetherCost: 4,
  unlockArena: 1,
  description: 'Annnnnd... Fireball. Deals high area damage and knocks back survivors.',
  tint: '#e0703f',
  baseHealth: 0,
  damage: 730,
  damageType: 'AreaSplash',
  splashRadius: 2.5,
  attackRange: 0,
  sightRange: 0,
  hitSpeed: 1,
  firstAttackDelay: 0,
  onHitStatus: 'Knockback',
  statusDuration: 0.3,
  statusMagnitude: 1.2,
});

export const ZAP = defineCard({
  name: 'Zap',
  id: 'card_spell_zap',
  rarity: 'Common',
  category: 'Spell',
  aetherCost: 2,
  unlockArena: 5,
  description: 'Zaps enemies, briefly stunning them and resetting their attack.',
  tint: '#e0d43f',
  baseHealth: 0,
  damage: 215,
  damageType: 'AreaSplash',
  splashRadius: 2.5,
  attackRange: 0,
  sightRange: 0,
  hitSpeed: 1,
  firstAttackDelay: 0,
  onHitStatus: 'ElectroReset',
  statusDuration: 0.5,
});

export const ARROWS = defineCard({
  name: 'Arrows',
  id: 'card_spell_arrows',
  rarity: 'Common',
  category: 'Spell',
  aetherCost: 3,
  unlockArena: 1,
  description: 'Arrows pepper a large area, damaging everything hit.',
  tint: '#9fd05f',
  baseHealth: 0,
  damage: 310,
  damageType: 'AreaSplash',
  splashRadius: 4.0,
  attackRange: 0,
  sightRange: 0,
  hitSpeed: 1,
  firstAttackDelay: 0,
});

export const CANNON = defineCard({
  name: 'Cannon',
  id: 'card_building_cannon',
  rarity: 'Common',
  category: 'Building',
  aetherCost: 3,
  unlockArena: 3,
  description: 'Defensive building. Shoots cannonballs at ground troops.',
  tint: '#8f8f8f',
  modelId: 'cannonTower',
  baseHealth: 826,
  massWeight: 100,
  bodyRadius: 0.9,
  lifetimeSeconds: 30,
  targetPriority: 'Ground',
  attackRange: 5.5,
  sightRange: 5.5,
  hitSpeed: 0.8,
  damage: 212,
  firstAttackDelay: 0.5,
  usesProjectile: true,
});

export const TESLA = defineCard({
  name: 'Tesla',
  id: 'card_building_tesla',
  rarity: 'Common',
  category: 'Building',
  aetherCost: 4,
  unlockArena: 4,
  description: 'Defensive building that zaps both ground and air troops.',
  tint: '#7fa8d0',
  modelId: 'teslaCoil',
  baseHealth: 1000,
  massWeight: 100,
  bodyRadius: 0.85,
  lifetimeSeconds: 30,
  targetPriority: 'AirAndGround',
  attackRange: 5.5,
  sightRange: 5.5,
  hitSpeed: 0.8,
  damage: 174,
  firstAttackDelay: 0.5,
});

export const SPELL_AND_BUILDING_CARDS = [FIREBALL, ZAP, ARROWS, CANNON, TESLA];
