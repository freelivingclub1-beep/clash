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

/**
 * 4 aether = 4000 EPP. `damage_ramp` costs 2300 -> 1700, which is the whole
 * design: the audit can only see the printed 45 damage, and a card that bites
 * for seven times that after a long channel is worth far more than the printed
 * number. Paying most of the budget for the ramp is what forces the bodies
 * underneath it to be genuinely fragile.
 *
 * Melee, ground, fast, three bodies -> x1.6 swarm allowance.
 *
 * The armour is `shieldHealth`, not health: overkill absorption means a single
 * hit of any size strips exactly one hound's plate and nothing more, so a
 * Fireball costs the pack its armour but not its lives, and a swarm of cheap
 * hits eats through them. `prefersTroops` makes them hunt defenders first —
 * that is a genuine drawback as well as a strength, since a pack that keeps
 * turning to bite blockers is a pack that never gets its ramp onto the tower.
 */
export const ELITE_HOUNDS = defineCard({
  name: 'Elite Hounds',
  id: 'card_troop_elite_hounds',
  rarity: 'Epic',
  category: 'Troop',
  aetherCost: 4,
  unlockArena: 11,
  description: 'Three armoured hounds. Each bite on the same target hits harder.',
  tint: '#c2a06a',
  modelId: 'eliteHound',
  baseHealth: 200,
  // One hit of any size, per hound, independently tracked.
  shieldHealth: 40,
  spawnCount: 3,
  massWeight: 9,
  speedClass: 'Fast',
  bodyRadius: 0.28,
  // Ground-only: `canTarget('Ground')` admits towers and buildings but never
  // fliers, so the pack is helpless against air exactly as specified.
  targetPriority: 'Ground',
  prefersTroops: true,
  attackRange: 0.35,
  sightRange: 5.5,
  hitSpeed: 0.7,
  // Deliberately feeble on the first bite. The card is the ramp, not this.
  damage: 45,
  firstAttackDelay: 0.3,
  passiveId: 'damage_ramp',
  /*
   * Per-stack growth coefficient. A full ten-stack channel takes ~7.4 seconds
   * on one target and multiplies the bite about 4.6x — 45 damage climbing to
   * roughly 210.
   *
   * Tuned against the tower clock, not the EPP audit, which cannot see the
   * ramp at all. At 0.5 the pack solo-killed an undefended princess tower in
   * nine seconds while the Iron Charger and Hog Rider both died to the same
   * tower without finishing it; a four-cost that wins a lane unassisted is not
   * a card, it is a format. At 0.28 it leaves the tower around 30%, which sits
   * just ahead of those peers — right, given the pack cannot touch air and
   * breaks off for any ground defender.
   */
  passiveMagnitude: 0.28,
});

export const SHIELDED_CARDS = [SPEAR_GUARDS, IRON_CHARGER, ELITE_HOUNDS];
