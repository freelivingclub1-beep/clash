/**
 * Status effect ticking and expiry.
 *
 * Every effect is a plain countdown decremented here, in one place, so no
 * system has to remember to expire anything it applied.
 *
 * Poison accumulates a residue rather than rounding its per-tick damage: at
 * 30Hz a 300 DPS poison is 10 damage a tick, but a 100 DPS poison is 3.33, and
 * rounding that down every tick would silently lose a third of the effect.
 */

import { FX_ONE } from '../math/fixed';
import { applyDamage } from '../entities';
import type { MatchState } from '../types';

export function statusEffects(state: MatchState): void {
  for (const entity of state.entities) {
    if (!entity.alive || entity.kind === 'projectile') continue;

    if (entity.deployTimer > 0) entity.deployTimer--;
    if (entity.shieldBreakTicks > 0) entity.shieldBreakTicks--;
    // Crowd control breaks a charge outright, not merely pauses it.
    if ((entity.stunTicks > 0 || entity.freezeTicks > 0) && entity.charging) {
      entity.charging = false;
      entity.chargeDistance = 0;
    }
    if (entity.freezeTicks > 0) entity.freezeTicks--;
    if (entity.stunTicks > 0) entity.stunTicks--;
    if (entity.rageTicks > 0) entity.rageTicks--;
    if (entity.abilityTicks > 0) entity.abilityTicks--;
    if (entity.invisibleTicks > 0) entity.invisibleTicks--;
    if (entity.markedTicks > 0) entity.markedTicks--;

    if (entity.slowTicks > 0) {
      entity.slowTicks--;
      if (entity.slowTicks === 0) entity.slowFactor = FX_ONE;
    }

    if (entity.poisonTicks > 0) {
      entity.poisonTicks--;
      entity.poisonResidue += entity.poisonDamagePerTick;
      // Only whole points of damage are dealt; the remainder carries forward.
      const whole = Math.floor(entity.poisonResidue);
      if (whole > 0) {
        entity.poisonResidue -= whole;
        applyDamage(state, entity, whole);
      }
      if (entity.poisonTicks === 0) {
        entity.poisonDamagePerTick = 0;
        entity.poisonResidue = 0;
      }
    }
  }

  // Hero ability cooldowns tick down independently of any entity.
  for (const player of state.players) {
    if (player.heroAbilityCooldown > 0) player.heroAbilityCooldown--;
  }
}
