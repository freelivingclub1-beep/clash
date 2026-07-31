/**
 * Attacks and damage application.
 *
 * Melee damage lands instantly; ranged attacks with `usesProjectile` spawn a
 * travelling projectile that the projectile system resolves. Splash is applied
 * at the point of impact in both cases, so a splash melee unit (Valkyrie)
 * and a splash ranged unit (Wizard) share one code path.
 */

import { type Fx, fx, fxLenSq, fxMul, fxRoundToInt, FX_ONE } from '../math/fixed';
import { TICK_HZ } from '../constants';
import { enemyOf } from '../nav/grid';
import {
  applyDamage,
  canTarget,
  findEntity,
  fireProjectileFrom,
  isTargetable,
  resolveStats,
} from '../entities';
import { evolutionHooks } from '../scripts/evolutions';
import type { CardDefinition } from '@cards/schema';
import { type Entity, type MatchState, NO_TARGET } from '../types';

const RAGE_HIT_SPEED: Fx = fx(0.7); // rage cuts the cooldown by 30%

/**
 * Apply a card's on-hit status to a victim.
 *
 * Towers are immune to displacement and hard crowd control — otherwise a
 * Fireball would slide a tower off its footprint — but still take the damage.
 */
export function applyStatus(card: CardDefinition, victim: Entity, ticks: number): void {
  const isStructure = victim.kind === 'tower' || victim.kind === 'building';

  switch (card.onHitStatus) {
    case 'Freeze':
      if (!isStructure) victim.freezeTicks = Math.max(victim.freezeTicks, ticks);
      break;
    case 'Stun':
      if (!isStructure) victim.stunTicks = Math.max(victim.stunTicks, ticks);
      break;
    case 'ElectroReset':
      // Zap-class effects stun briefly *and* wipe the victim's attack progress.
      if (!isStructure) victim.stunTicks = Math.max(victim.stunTicks, ticks);
      victim.attackCooldown = Math.max(victim.attackCooldown, ticks);
      victim.windupDone = false;
      break;
    case 'Slow':
      if (!isStructure) {
        victim.slowTicks = Math.max(victim.slowTicks, ticks);
        victim.slowFactor = fx(card.statusMagnitude);
      }
      break;
    case 'Knockback':
      if (!isStructure) {
        const away = victim.team === 0 ? -FX_ONE : FX_ONE;
        victim.pushY += fxMul(away, fx(card.statusMagnitude));
      }
      break;
    case 'Poison':
      victim.poisonTicks = Math.max(victim.poisonTicks, ticks);
      victim.poisonDamagePerTick = Math.max(
        victim.poisonDamagePerTick,
        Math.round(card.damage / TICK_HZ),
      );
      break;
    case 'Rage':
      if (!isStructure) victim.rageTicks = Math.max(victim.rageTicks, ticks);
      break;
    case 'Heal':
      victim.hp = Math.min(victim.maxHp, victim.hp + card.damage);
      break;
    case 'None':
      break;
  }
}

/**
 * Deal `damage` at a point, to every enemy of `team` inside `radius`.
 * A radius of 0 means the primary target only.
 */
export function applyDamageAtPoint(
  state: MatchState,
  team: Entity['team'],
  x: Fx,
  y: Fx,
  radius: Fx,
  damage: number,
  card: CardDefinition,
  statusTicks: number,
  primaryId: number,
): void {
  const foe = enemyOf(team);

  if (radius <= 0) {
    const primary = findEntity(state, primaryId);
    if (isTargetable(primary) && primary.team === foe) {
      applyDamage(state, primary, damage);
      if (card.onHitStatus !== 'None') applyStatus(card, primary, statusTicks);
      state.events.push({ type: 'hit', x, y, damage, splash: false });
    }
    return;
  }

  const radiusSq = Math.round((radius * radius) / FX_ONE);
  for (const entity of state.entities) {
    if (entity.team !== foe || !isTargetable(entity)) continue;
    // Splash respects the attacker's target filter: a ground-only splash
    // attack must not clip flying units caught in the blast.
    if (!canTarget(card.targetPriority, entity) && entity.id !== primaryId) continue;
    if (fxLenSq(entity.x - x, entity.y - y) > radiusSq) continue;
    applyDamage(state, entity, damage);
    if (card.onHitStatus !== 'None') applyStatus(card, entity, statusTicks);
  }
  state.events.push({ type: 'hit', x, y, damage, splash: true });
}

export function combat(state: MatchState): void {
  for (const entity of state.entities) {
    if (!entity.alive || entity.kind === 'projectile') continue;

    if (entity.attackCooldown > 0) entity.attackCooldown--;
    if (entity.deployTimer > 0) continue;
    if (entity.freezeTicks > 0 || entity.stunTicks > 0) continue;
    if (entity.kind === 'tower' && entity.dormant) continue;

    const target = findEntity(state, entity.targetId);
    if (!isTargetable(target) || target.team === entity.team) continue;

    const stats = resolveStats(entity.cardId, entity.level, entity.evolved);
    const card = stats.card;
    if (stats.damage <= 0) continue;

    const reach = stats.attackRange + entity.radius + target.radius;
    const reachSq = Math.round((reach * reach) / FX_ONE);
    if (fxLenSq(target.x - entity.x, target.y - entity.y) > reachSq) continue;

    // Face the victim so cone splash and the renderer agree on orientation.
    entity.faceX = target.x - entity.x;
    entity.faceY = target.y - entity.y;

    if (entity.attackCooldown > 0) continue;

    // The first swing against a new target costs the wind-up; subsequent
    // swings only pay the hit-speed cooldown.
    if (!entity.windupDone && stats.firstAttackDelay > 0) {
      entity.attackCooldown = stats.firstAttackDelay;
      entity.windupDone = true;
      continue;
    }

    let cooldown = stats.hitCooldown;
    if (entity.rageTicks > 0) {
      cooldown = Math.max(1, fxRoundToInt(fxMul(fx(cooldown), RAGE_HIT_SPEED)));
    }
    // Archer Queen's cloak doubles her rate of fire while it lasts.
    if (entity.invisibleTicks > 0) cooldown = Math.max(1, Math.round(cooldown / 2));
    entity.attackCooldown = cooldown;

    const hooks = entity.evolved ? evolutionHooks(card.evoBehaviorScriptId) : undefined;

    if (card.usesProjectile) {
      fireProjectileFrom(
        state,
        entity,
        target,
        stats.damage,
        stats.splashRadius,
        card.onHitStatus !== 'None',
      );
    } else {
      applyDamageAtPoint(
        state,
        entity.team,
        target.x,
        target.y,
        stats.splashRadius,
        stats.damage,
        card,
        stats.statusTicks,
        target.id,
      );
    }

    hooks?.onHit?.(state, entity, target);
    entity.windupDone = true;
  }
}

/** Clears a dead entity's lock from anything still pointed at it. */
export function releaseLocksOn(state: MatchState, deadId: number): void {
  for (const entity of state.entities) {
    if (entity.targetId === deadId) {
      entity.targetId = NO_TARGET;
      entity.windupDone = false;
    }
    if (entity.tauntSourceId === deadId) entity.tauntSourceId = NO_TARGET;
  }
}
