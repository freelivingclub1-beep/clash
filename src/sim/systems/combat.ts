/**
 * Attacks and damage application.
 *
 * Melee damage lands instantly; ranged attacks with `usesProjectile` spawn a
 * travelling projectile that the projectile system resolves. Splash is applied
 * at the point of impact in both cases, so a splash melee unit (Valkyrie)
 * and a splash ranged unit (Wizard) share one code path.
 */

import { type Fx, fx, fxLenSq, fxMul, fxRoundToInt, FX_ONE } from '../math/fixed';
import { TICK_HZ, CHARGE_DAMAGE_MULTIPLIER, DAMAGE_RAMP_STACK_CAP } from '../constants';
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
import { passiveHooks } from '../scripts/passives';
import { crownTowerDamage } from '@cards/balance';
import type { CardDefinition } from '@cards/schema';
import { type Entity, type MatchState, NO_TARGET } from '../types';

const RAGE_HIT_SPEED: Fx = fx(0.7); // rage cuts the cooldown by 30%

/**
 * Wipe a damage ramp back to its first, weakest bite.
 *
 * Called from three places — a reset spell, the victim dying, and the attacker
 * switching victims — because all three are the same idea: the channel that was
 * being rewarded has ended.
 */
export function resetDamageRamp(entity: Entity): void {
  /*
   * Scoped to the two ramp passives on purpose.
   *
   * `passiveCharges` is shared storage: `parry_melee` and `self_replicate` use
   * it as a one-shot ready flag, so blindly zeroing it here would let a Zap
   * quietly delete their ability instead of resetting a ramp.
   */
  const { passiveId } = resolveStats(entity.cardId, entity.level, entity.evolved).card;
  if (passiveId !== 'damage_ramp' && passiveId !== 'attack_ramp') return;
  entity.passiveCharges = 0;
  entity.passiveTargetId = NO_TARGET;
}

/**
 * Multiplier on a swing from `stacks` consecutive hits on the same victim.
 *
 * Growth is `stacks * (stacks + 3)`, i.e. 0, 4, 10, 18, 28... — superlinear, so
 * the damage climbs *quicker and quicker* the longer the channel holds, rather
 * than adding a flat step each time. Deliberately not `Math.pow`: exponentiation
 * is implementation-approximated and would drift between engines, and the sim
 * has to hash identically everywhere.
 */
function rampMultiplier(stacks: number, magnitude: number): number {
  const growth = stacks * (stacks + 3);
  return 1 + (magnitude * growth) / 10;
}

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
      // "Attack progress" includes a ramp mid-channel: a reset spell is the
      // intended counter to a unit that has been chewing on one target long
      // enough for its damage to have multiplied.
      resetDamageRamp(victim);
      break;
    case 'Slow':
      if (!isStructure) {
        victim.slowTicks = Math.max(victim.slowTicks, ticks);
        victim.slowFactor = fx(card.statusMagnitude);
      }
      break;
    case 'Knockback':
      // Displacement immunity right after a shield breaks, so stripping the
      // shield does not also shove the unit out of position.
      if (!isStructure && victim.shieldBreakTicks <= 0) {
        const away = victim.team === 0 ? -FX_ONE : FX_ONE;
        victim.pushY += fxMul(away, fx(card.statusMagnitude));
        // Being displaced interrupts a charge, per the charge reset rules.
        victim.charging = false;
        victim.chargeDistance = 0;
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
/**
 * Damage a tower actually takes from this source.
 *
 * Direct spell damage against Crown Towers is capped at a third of its troop
 * damage. Without that cap the strongest deck in the game is four damage
 * spells cycled at the tower, which needs no board play and cannot be
 * interacted with.
 */
function damageAgainst(target: Entity, damage: number, card: CardDefinition): number {
  if (target.kind !== 'tower') return damage;
  if (card.category !== 'Spell') return damage;
  return crownTowerDamage(damage);
}

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
  attacker?: Entity,
): void {
  const foe = enemyOf(team);
  const passive = passiveHooks(card.passiveId);
  // Spell-sourced damage is flagged so `spell_ward` can negate one outright.
  const damageOpts = { spell: card.category === 'Spell' };

  if (radius <= 0) {
    const primary = findEntity(state, primaryId);
    if (isTargetable(primary) && primary.team === foe) {
      applyDamage(state, primary, damageAgainst(primary, damage, card), attacker, damageOpts);
      if (card.onHitStatus !== 'None') applyStatus(card, primary, statusTicks);
      if (attacker) passive?.onHit?.(state, attacker, primary, card.passiveMagnitude);
      state.events.push({ type: 'hit', cardId: card.id, x, y, damage, splash: false });
    }
    return;
  }

  const radiusSq = Math.round((radius * radius) / FX_ONE);

  /*
   * A piercing line strikes everything between the attacker and the impact
   * point, not a disc around it.
   *
   * `PiercingLine` was declared in the schema and implemented nowhere, exactly
   * as `ConeSplash` used to be — cards could name it and the Card Maker would
   * offer it, and in play it behaved as an ordinary blast. It is the shape that
   * makes a shot punch through a whole rank rather than clip the front of one,
   * and it is the reason lining a defence up behind a tank is a mistake.
   */
  if (card.damageType === 'PiercingLine' && attacker) {
    const lineX = x - attacker.x;
    const lineY = y - attacker.y;
    const lineLenSq = fxLenSq(lineX, lineY);
    /*
     * The beam does not stop at whatever it was aiming at — it carries on to
     * the card's full reach.
     *
     * Stopping at the target made "piercing" mean "hits the things queued in
     * front of the thing I shot", which is backwards: a defence stacked
     * *behind* the front body is exactly what a piercing shot is supposed to
     * punish. The limit is expressed in squared terms so no square root is
     * needed to compare a fraction of the line against a distance in tiles.
     */
    const alongLimitSq =
      lineLenSq > 0 ? (card.attackRange * card.attackRange * FX_ONE) / lineLenSq : 0;
    for (const entity of state.entities) {
      if (entity.team !== foe || !isTargetable(entity)) continue;
      if (!canTarget(card.targetPriority, entity) && entity.id !== primaryId) continue;

      // Project onto the shot line, clamped to the segment, then measure how
      // far off it the body sits.
      const toX = entity.x - attacker.x;
      const toY = entity.y - attacker.y;
      /*
       * Both sides of this ratio have to be in the same units.
       *
       * `fxLenSq` returns an Fx-*scaled* square, while a raw product of two Fx
       * values is scaled by FX_ONE twice. Dividing one by the other without
       * correcting for that put `along` at 65536 instead of 1, so every body
       * failed the 0..1 segment test and the beam hit nothing at all.
       */
      const dot = (toX * lineX + toY * lineY) / FX_ONE;
      const along = lineLenSq > 0 ? dot / lineLenSq : 0;
      /*
       * The intended victim is never skipped, whatever the arithmetic says.
       *
       * It sits at the far end of the line, so `along` lands on 1 and a strict
       * bound drops it to floating-point noise — the shot would pierce
       * everything on the way to its target and then miss the target.
       */
      if (entity.id !== primaryId && (along < 0 || along * along > alongLimitSq)) continue;
      const nearX = attacker.x + Math.round(lineX * along);
      const nearY = attacker.y + Math.round(lineY * along);
      if (fxLenSq(entity.x - nearX, entity.y - nearY) > radiusSq) continue;

      applyDamage(state, entity, damageAgainst(entity, damage, card), attacker, damageOpts);
      if (card.onHitStatus !== 'None') applyStatus(card, entity, statusTicks);
      if (entity.id === primaryId) passive?.onHit?.(state, attacker, entity, card.passiveMagnitude);
    }
    state.events.push({ type: 'hit', cardId: card.id, x, y, damage, splash: true });
    return;
  }

  // A cone strikes a forward half-plane rather than a full circle. Previously
  // ConeSplash was handled identically to AreaSplash, so the damage type
  // existed on cards and in the Card Maker but changed nothing in play.
  const isCone = card.damageType === 'ConeSplash';
  const faceX = attacker?.faceX ?? 0;
  const faceY = attacker?.faceY ?? 0;
  const hasFacing = isCone && (faceX !== 0 || faceY !== 0);

  for (const entity of state.entities) {
    if (entity.team !== foe || !isTargetable(entity)) continue;
    // Splash respects the attacker's target filter: a ground-only splash
    // attack must not clip flying units caught in the blast.
    if (!canTarget(card.targetPriority, entity) && entity.id !== primaryId) continue;
    if (fxLenSq(entity.x - x, entity.y - y) > radiusSq) continue;
    if (hasFacing && entity.id !== primaryId) {
      // Dot product against the attacker's facing: negative means behind it.
      const toX = entity.x - (attacker as Entity).x;
      const toY = entity.y - (attacker as Entity).y;
      if (toX * faceX + toY * faceY < 0) continue;
    }
    applyDamage(state, entity, damageAgainst(entity, damage, card), attacker, damageOpts);
    if (card.onHitStatus !== 'None') applyStatus(card, entity, statusTicks);
    /*
     * A stun spell earths itself into everything it caught.
     *
     * A Zap over four bodies used to be one orange ring and four health bars
     * quietly shortening. The arcs are what say *these* are the units that got
     * hit, and they are why the effect reads as electricity rather than as an
     * explosion that happens to stun.
     */
    if (card.onHitStatus === 'ElectroReset' || card.onHitStatus === 'Stun') {
      state.events.push({ type: 'arc', team, x, y, toX: entity.x, toY: entity.y, kind: 'stun' });
    }
    // The passive fires once, on the intended target, not once per unit caught
    // in the splash — otherwise a chain passive squared itself on a swarm.
    if (attacker && entity.id === primaryId) {
      passive?.onHit?.(state, attacker, entity, card.passiveMagnitude);
    }
  }
  state.events.push({ type: 'hit', cardId: card.id, x, y, damage, splash: true });
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
    // Attack-ramp stacks each shave a tick off the next swing. Floored at
    // half the base cooldown so a long channel accelerates but never becomes
    // an instant-damage beam.
    if (card.passiveId === 'attack_ramp' && entity.passiveCharges > 0) {
      cooldown = Math.max(Math.ceil(stats.hitCooldown / 2), cooldown - entity.passiveCharges);
    }
    entity.attackCooldown = cooldown;

    const hooks = entity.evolved ? evolutionHooks(card.evoBehaviorScriptId) : undefined;

    // A charging unit lands one doubled hit, then drops straight back to a
    // walk. The reset happens here rather than in movement because impact is
    // what ends a charge, and movement cannot see an attack landing.
    let damage = stats.damage;

    // A ramp reads its stack count *before* incrementing, so the first bite on
    // a fresh victim always lands at the card's printed damage and the reward
    // is strictly for staying on the same thing.
    if (card.passiveId === 'damage_ramp') {
      if (entity.passiveTargetId !== target.id) {
        entity.passiveTargetId = target.id;
        entity.passiveCharges = 0;
      }
      damage = Math.round(damage * rampMultiplier(entity.passiveCharges, card.passiveMagnitude));
      entity.passiveCharges = Math.min(DAMAGE_RAMP_STACK_CAP, entity.passiveCharges + 1);
    }

    if (entity.charging) {
      damage *= CHARGE_DAMAGE_MULTIPLIER;
      entity.charging = false;
      entity.chargeDistance = 0;
    }

    if (card.usesProjectile) {
      fireProjectileFrom(
        state,
        entity,
        target,
        damage,
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
        damage,
        card,
        stats.statusTicks,
        target.id,
        entity,
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
    // A kill ends the channel: whoever was ramping on the corpse starts its
    // next victim from the weakest bite again.
    if (entity.passiveTargetId === deadId) resetDamageRamp(entity);
  }
}
