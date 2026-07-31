/**
 * Target acquisition (spec §2).
 *
 * Re-querying every unit every tick is wasteful and, worse, makes lock-on
 * flicker when two candidates are near-equidistant. Instead each entity
 * re-queries every third tick, staggered by `(tick + id) % 3` so the cost is
 * spread evenly across ticks rather than spiking on every third one.
 *
 * A lock is sticky: once acquired it is held until the target dies, goes
 * invisible, or leaves `sightRange * 1.4`. That hysteresis is what stops units
 * from oscillating between two targets at the edge of range.
 */

import { fxLenSq } from '../math/fixed';
import { TARGET_REACQUIRE_INTERVAL } from '../constants';
import { TOWER_LAYOUTS, enemyOf } from '../nav/grid';
import { canTarget, findEntity, isTargetable, objectiveTowerIndex, resolveStats } from '../entities';
import { type Entity, type MatchState, NO_TARGET } from '../types';

/** Entities that never acquire targets of their own. */
function isPassive(entity: Entity): boolean {
  return entity.kind === 'projectile' || !entity.alive || entity.deployTimer > 0;
}

function currentTargetStillValid(state: MatchState, entity: Entity, loseRangeSq: number): boolean {
  if (entity.targetId === NO_TARGET) return false;
  const target = findEntity(state, entity.targetId);
  if (!isTargetable(target)) return false;
  if (target.team === entity.team) return false;

  const priority = resolveStats(entity.cardId, entity.level, entity.evolved).card.targetPriority;
  if (!canTarget(priority, target)) return false;

  /*
   * A march objective is exempt from the sight-range check.
   *
   * Without this a unit drops its objective tower every tick — the tower is
   * far away, which is the entire reason it is walking toward it — and only
   * re-acquires on the every-third-tick stagger. In between it has no target,
   * so steering produces no direction and it does not move. The net effect was
   * that every unit in the game travelled at roughly a third of its stated
   * speed, in a visible stutter. Only *engaged* targets should be droppable.
   */
  if (target.kind === 'tower' && target.towerIndex === entity.goalTowerIndex) return true;

  return fxLenSq(target.x - entity.x, target.y - entity.y) <= loseRangeSq;
}

/**
 * Best candidate for `entity`, or undefined.
 *
 * Candidates are scanned in ascending entity id and compared on squared
 * distance with a strict `<`, so an exact distance tie always resolves to the
 * lower id — a total order, and therefore replay-stable.
 */
function findBestTarget(state: MatchState, entity: Entity): Entity | undefined {
  const stats = resolveStats(entity.cardId, entity.level, entity.evolved);
  const priority = stats.card.targetPriority;
  const foe = enemyOf(entity.team);

  /** Nearest valid candidate, optionally restricted to living combatants. */
  const scan = (troopsOnly: boolean): Entity | undefined => {
    let best: Entity | undefined;
    let bestDistSq = stats.sightRangeSq;

    for (const candidate of state.entities) {
      if (candidate.team !== foe) continue;
      if (!isTargetable(candidate)) continue;
      if (!canTarget(priority, candidate)) continue;
      if (troopsOnly && candidate.kind !== 'troop') continue;

      const distSq = fxLenSq(candidate.x - entity.x, candidate.y - entity.y);
      if (distSq > stats.sightRangeSq) continue;
      if (best && distSq >= bestDistSq) continue;
      best = candidate;
      bestDistSq = distSq;
    }
    return best;
  };

  // Troop-hunters sweep for combatants first and only fall back to structures
  // when the field is clear, rather than taking whatever happens to be closest.
  if (stats.card.prefersTroops) return scan(true) ?? scan(false);
  return scan(false);
}

/**
 * The tower a unit falls back to when nothing is in sight. Also re-resolves
 * the objective when the lane's princess tower has since been destroyed.
 */
function objectiveTarget(state: MatchState, entity: Entity): Entity | undefined {
  if (entity.kind === 'tower' || entity.kind === 'building') return undefined;

  let goal = entity.goalTowerIndex;
  const existing = state.entities.find((e) => e.alive && e.towerIndex === goal);
  if (!existing) {
    goal = objectiveTowerIndex(state, entity.team, entity.lane);
    entity.goalTowerIndex = goal;
  }
  if (goal < 0 || goal >= TOWER_LAYOUTS.length) return undefined;
  return state.entities.find((e) => e.alive && e.towerIndex === goal);
}

export function targetAcquisition(state: MatchState): void {
  for (const entity of state.entities) {
    if (isPassive(entity)) continue;
    if (entity.kind === 'tower' && entity.dormant) {
      entity.targetId = NO_TARGET;
      continue;
    }

    const stats = resolveStats(entity.cardId, entity.level, entity.evolved);

    // A taunt overrides everything until it expires.
    if (entity.tauntSourceId !== NO_TARGET) {
      const tauntSource = findEntity(state, entity.tauntSourceId);
      if (entity.abilityTicks > 0 && isTargetable(tauntSource)) {
        entity.targetId = tauntSource.id;
        continue;
      }
      entity.tauntSourceId = NO_TARGET;
    }

    const current = findEntity(state, entity.targetId);
    const marchingAtObjective =
      !!current && current.kind === 'tower' && current.towerIndex === entity.goalTowerIndex;
    const valid = currentTargetStillValid(state, entity, stats.loseRangeSq);

    /*
     * A lock on a real combatant is sticky; a lock on the objective tower is
     * not.
     *
     * The objective is a fallback, not a commitment — it is simply where the
     * unit walks when nothing is in front of it. Treating it as sticky (which
     * the earlier stutter fix accidentally did, by exempting it from the range
     * check and then skipping the rescan) meant a unit that had locked the
     * tower never looked again, and walked straight past enemies within a tile
     * of it without swinging.
     */
    if (valid && !marchingAtObjective) continue;

    if (!valid && entity.targetId !== NO_TARGET) {
      // Losing a lock resets the wind-up: the next target must be earned.
      entity.targetId = NO_TARGET;
      entity.windupDone = false;
    }

    // Stagger by id so the scan cost spreads across ticks instead of spiking.
    if ((state.tick + entity.id) % TARGET_REACQUIRE_INTERVAL !== 0) continue;

    // Prefer a live combatant in sight; fall back to the march objective.
    const found = findBestTarget(state, entity) ?? objectiveTarget(state, entity);
    if (found && found.id !== entity.targetId) {
      entity.targetId = found.id;
      entity.windupDone = false;
    }
  }
}
