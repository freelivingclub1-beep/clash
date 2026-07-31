/**
 * Shielded and charging archetypes.
 *
 * Two mechanics that only work because of engine rules rather than stat lines:
 *
 *   - **Shield layer.** A separate durability pool with overkill absorption, so
 *     a single huge hit strips the shield and the entire excess is discarded.
 *     That is what makes these units immune to burst spells and forces the
 *     answer to be multi-hit or sustained area damage.
 *   - **Charge.** Uninterrupted travel accelerates the unit and doubles its
 *     next hit. Any interruption — a blocker, a stun, a knockback, or simply
 *     stopping to swing — resets it.
 *
 * Both are priced in `@cards/balance` and deducted from the stat budget, so
 * neither is free.
 */

import { defineCard } from '../schema';

/**
 * 3 aether = 3000 EPP. Melee, ground, fast, three bodies -> x1.6 swarm
 * allowance. The shield is not a passive — it is `shieldHealth`, and the audit
 * weights each point of it above a point of health because overkill absorption
 * buys burst immunity that raw health cannot.
 *
 * Extended reach is the second half of the design: `attackRange` is set well
 * beyond the body radius, so a spear connects over a tank's hitbox instead of
 * needing to touch its edge. Each of the three tracks its own shield, health,
 * pathing and target independently.
 */
export const SPEAR_GUARDS = defineCard({
  name: 'Spear Guards',
  id: 'card_troop_spear_guards',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 3,
  unlockArena: 7,
  description: 'Three shielded spearmen. Shields absorb one hit of any size.',
  tint: '#b8b0a0',
  modelId: 'spearGuard',
  baseHealth: 145,
  shieldHealth: 90,
  spawnCount: 3,
  massWeight: 12,
  speedClass: 'Fast',
  bodyRadius: 0.3,
  targetPriority: 'Ground',
  // Reach deliberately far beyond bodyRadius: that is what "spears" means here.
  attackRange: 1.2,
  sightRange: 5.0,
  hitSpeed: 1.1,
  damage: 110,
  firstAttackDelay: 0.4,
});

/**
 * 4 aether = 4000 EPP. Charge costs 300 -> 3700.
 * Melee, ground, medium, cone splash 1.5 -> DPS x0.65.
 *
 * Builds speed over open ground and lands one doubled cleave, then drops back
 * to a walk. A cheap blocker placed in its path is a complete answer, which is
 * the counterplay the mechanic is built around.
 */
export const IRON_CHARGER = defineCard({
  name: 'Iron Charger',
  id: 'card_troop_iron_charger',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 9,
  description: 'Builds speed over distance, then lands a doubled cleaving hit.',
  tint: '#6f6480',
  modelId: 'ironCharger',
  baseHealth: 1300,
  shieldHealth: 220,
  massWeight: 60,
  speedClass: 'Medium',
  bodyRadius: 0.52,
  targetPriority: 'Ground',
  attackRange: 1.2,
  sightRange: 5.5,
  hitSpeed: 1.3,
  damage: 190,
  damageType: 'ConeSplash',
  splashRadius: 1.5,
  firstAttackDelay: 0.4,
  passiveId: 'charge',
  // Tiles of uninterrupted travel before the charge triggers.
  passiveMagnitude: 4.5,
});

export const SHIELDED_CARDS = [SPEAR_GUARDS, IRON_CHARGER];
