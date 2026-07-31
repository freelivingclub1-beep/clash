/**
 * Hero / Champion ability hooks (spec §4G).
 *
 * Card data names a hook by string; this registry maps that string to code.
 * The indirection is what keeps `src/cards` free of any dependency on the
 * simulation — data describes *what*, this module decides *how*.
 */

import { type Fx, fx, fxMul, fxLenSq, fxLen, fxDiv, FX_ONE } from '../math/fixed';
import { TICK_HZ } from '../constants';
import { enemyOf } from '../nav/grid';
import { applyDamage, canTarget, isTargetable, resolveStats, spawnTroop } from '../entities';
import { type Entity, type MatchState, NO_TARGET } from '../types';

export interface AbilityContext {
  state: MatchState;
  hero: Entity;
  /** Resolved from the hero's card, already level-scaled. */
  damage: number;
  radius: Fx;
  durationTicks: number;
}

export type AbilityImpl = (ctx: AbilityContext) => void;

/**
 * Candidate enemies for an ability, filtered by the card's target filter and
 * returned in ascending entity id so ties resolve identically every run.
 */
function enemiesInRadius(state: MatchState, hero: Entity, radius: Fx): Entity[] {
  const foe = enemyOf(hero.team);
  const radiusSq = Math.round((radius * radius) / FX_ONE);
  const found: Entity[] = [];
  for (const entity of state.entities) {
    if (entity.team !== foe || !isTargetable(entity)) continue;
    if (fxLenSq(entity.x - hero.x, entity.y - hero.y) > radiusSq) continue;
    found.push(entity);
  }
  return found;
}

function pickTarget(
  state: MatchState,
  hero: Entity,
  radius: Fx,
  filter: 'Self' | 'NearestEnemy' | 'BroadArea' | 'HighestHpUnit',
): Entity | undefined {
  if (filter === 'Self') return hero;
  const candidates = enemiesInRadius(state, hero, radius);
  if (candidates.length === 0) return undefined;

  if (filter === 'HighestHpUnit') {
    let best = candidates[0];
    for (const c of candidates) if (c.hp > best.hp) best = c;
    return best;
  }
  // NearestEnemy, and the anchor point for BroadArea.
  let best = candidates[0];
  let bestDist = fxLenSq(best.x - hero.x, best.y - hero.y);
  for (const c of candidates) {
    const d = fxLenSq(c.x - hero.x, c.y - hero.y);
    if (d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}

const registry = new Map<string, AbilityImpl>();

function register(hook: string, impl: AbilityImpl): void {
  registry.set(hook, impl);
}

/**
 * Charge/Dash — the hero leaps to the nearest enemy, damaging everything along
 * the way. Implemented as an instant reposition plus a swept-line damage pass
 * rather than a multi-tick animation, so the effect resolves inside one tick
 * and cannot be desynced by a mid-dash death.
 */
register('ChargeDash', ({ state, hero, damage, radius, durationTicks }) => {
  const target = pickTarget(state, hero, radius, 'NearestEnemy');
  if (!target) return;

  const dx = target.x - hero.x;
  const dy = target.y - hero.y;
  const distance = fxLen(dx, dy);
  if (distance <= 0) return;

  const stepX = fxDiv(dx, distance);
  const stepY = fxDiv(dy, distance);
  const startX = hero.x;
  const startY = hero.y;

  // Land just short of the target so the hero is in melee range, not inside it.
  const stopAt = Math.max(0, distance - fxMul(hero.radius + target.radius, FX_ONE));
  hero.x = startX + fxMul(stepX, stopAt);
  hero.y = startY + fxMul(stepY, stopAt);
  hero.faceX = stepX;
  hero.faceY = stepY;
  hero.abilityTicks = durationTicks;

  // Damage anything whose centre lies within a tile of the swept segment.
  const corridor = fx(1.0);
  const corridorSq = Math.round((corridor * corridor) / FX_ONE);
  for (const entity of state.entities) {
    if (entity.team === hero.team || !isTargetable(entity)) continue;
    const relX = entity.x - startX;
    const relY = entity.y - startY;
    let along = Math.round((relX * stepX + relY * stepY) / FX_ONE);
    if (along < 0) along = 0;
    if (along > stopAt) along = stopAt;
    const nearestX = startX + fxMul(stepX, along);
    const nearestY = startY + fxMul(stepY, along);
    if (fxLenSq(entity.x - nearestX, entity.y - nearestY) <= corridorSq) {
      applyDamage(state, entity, damage);
    }
  }
});

/**
 * Area Taunt — nearby enemies are forced to attack the hero for the duration.
 * `tauntSourceId` overrides normal target acquisition until it expires.
 */
register('AreaTaunt', ({ state, hero, radius, durationTicks }) => {
  for (const entity of enemiesInRadius(state, hero, radius)) {
    if (entity.kind === 'tower') continue; // towers cannot be pulled off their post
    entity.tauntSourceId = hero.id;
    entity.targetId = hero.id;
    entity.abilityTicks = durationTicks;
    entity.windupDone = false;
  }
});

/** Throw Unit — hurl the highest-HP nearby enemy back toward its own side. */
register('ThrowUnit', ({ state, hero, radius, damage }) => {
  const target = pickTarget(state, hero, radius, 'HighestHpUnit');
  if (!target || target.kind === 'tower' || target.kind === 'building') return;
  const away = target.team === 0 ? -FX_ONE : FX_ONE;
  target.pushX = 0;
  target.pushY = fxMul(away, fx(2.5));
  target.stunTicks = Math.max(target.stunTicks, Math.round(0.5 * TICK_HZ));
  applyDamage(state, target, damage);
});

/** Spawn Minions — a small escort appears around the hero. */
register('SpawnMinions', ({ state, hero }) => {
  const level = state.players[hero.team].levels.get(hero.cardId) ?? 11;
  const offsets: Array<[Fx, Fx]> = [
    [fx(-0.8), 0],
    [fx(0.8), 0],
    [0, fx(-0.8)],
  ];
  for (const [ox, oy] of offsets) {
    spawnTroop(state, 'card_troop_skeletons', level, false, hero.team, hero.x + ox, hero.y + oy, {
      skipDeployDelay: true,
    });
  }
});

/**
 * Invisibility — the hero becomes untargetable and attacks at double rate.
 * Existing attackers drop their lock immediately via `isTargetable`.
 */
register('Invisibility', ({ state, hero, durationTicks }) => {
  hero.invisibleTicks = durationTicks;
  hero.abilityTicks = durationTicks;
  for (const entity of state.entities) {
    if (entity.targetId === hero.id) {
      entity.targetId = NO_TARGET;
      entity.windupDone = false;
    }
  }
});

/** Heavy Slam — a ground pound damaging and stunning everything close by. */
register('HeavySlam', ({ state, hero, damage, radius, durationTicks }) => {
  for (const entity of enemiesInRadius(state, hero, radius)) {
    applyDamage(state, entity, damage);
    if (entity.kind !== 'tower') {
      entity.stunTicks = Math.max(entity.stunTicks, durationTicks);
    }
  }
  state.events.push({
    type: 'ability',
    team: hero.team,
    hook: 'HeavySlam',
    x: hero.x,
    y: hero.y,
  });
});

export function runAbility(state: MatchState, hero: Entity): boolean {
  const stats = resolveStats(hero.cardId, hero.level, hero.evolved);
  const card = stats.card;
  const impl = registry.get(card.abilityActionHook);
  if (!impl) return false;

  impl({
    state,
    hero,
    damage: card.abilityDamage,
    radius: fx(card.abilityRadius),
    durationTicks: Math.round(card.abilityDurationSeconds * TICK_HZ),
  });

  state.events.push({
    type: 'ability',
    team: hero.team,
    hook: card.abilityActionHook,
    x: hero.x,
    y: hero.y,
  });
  return true;
}

/** Exposed for tests and for the Card Maker's hook dropdown validation. */
export function hasAbilityHook(hook: string): boolean {
  return registry.has(hook);
}

export { canTarget };
