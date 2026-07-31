/**
 * Target acquisition (spec §2).
 *
 * Re-querying every unit every tick is wasteful and, worse, makes lock-on
 * flicker when two candidates are near-equidistant. Instead each entity
 * re-queries every third tick, staggered by `(tick + id) % 3` so the cost is
 * spread evenly across ticks rather than spiking on every third one.
 *
 * A lock is held until the target dies, goes invisible, or leaves
 * `sightRange * 1.4` — but it is not absolute. Three rules decide it, in
 * order:
 *
 *   1. A unit already in range and swinging never switches. Mid-melee is
 *      exactly when a lock should be immovable.
 *   2. A unit still walking to its target will drop it for anything
 *      meaningfully closer. This is what makes a blocker a blocker: a body
 *      dropped in front of a push takes the push, rather than being strolled
 *      past on the way to the shooters behind it.
 *   3. The march objective is never sticky at all — it is where a unit goes
 *      when nothing else is in sight, not a commitment.
 *
 * The margin in rule 2 is load-bearing hysteresis. Without it two enemies at
 * roughly equal range would trade the lock on every scan.
 */

import { fxLenSq, FX_ONE } from '../math/fixed';
import {
  RETARGET_CLOSER_DENOMINATOR,
  RETARGET_CLOSER_NUMERATOR,
  TARGET_REACQUIRE_INTERVAL,
} from '../constants';
import { TOWER_LAYOUTS, enemyOf } from '../nav/grid';
import {
  type ResolvedStats,
  canTarget,
  findEntity,
  isTargetable,
  objectiveTowerIndex,
  resolveStats,
} from '../entities';
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
 * Is `candidate` near enough that `entity` is actually swinging at it?
 *
 * Mirrors the reach `combat` uses, so "engaged" here means the same thing it
 * means there — a unit that is landing hits, not merely one that is close.
 */
function inAttackReach(entity: Entity, candidate: Entity, stats: ResolvedStats): boolean {
  const reach = stats.attackRange + entity.radius + candidate.radius;
  const reachSq = Math.round((reach * reach) / FX_ONE);
  return fxLenSq(candidate.x - entity.x, candidate.y - entity.y) <= reachSq;
}

/**
 * Is `foundDistSq` closer than `currentDistSq` by more than the retarget
 * margin?
 *
 * Both are squared Q16.16 distances, so the margin is applied by squaring the
 * fraction: `found <= (4/5)^2 * current` becomes `found * 25 <= current * 16`.
 * Pure integer arithmetic — no square root, no division — which is what keeps
 * the comparison identical on every machine replaying the match.
 */
function meaningfullyCloser(foundDistSq: number, currentDistSq: number): boolean {
  const numeratorSq = RETARGET_CLOSER_NUMERATOR * RETARGET_CLOSER_NUMERATOR;
  const denominatorSq = RETARGET_CLOSER_DENOMINATOR * RETARGET_CLOSER_DENOMINATOR;
  return foundDistSq * denominatorSq <= currentDistSq * numeratorSq;
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
     * A unit already swinging at something keeps swinging.
     *
     * This is the one case where a lock is absolute. Letting a unit mid-melee
     * turn to face whatever wandered a little nearer would make every fight
     * unreadable and would mean no exchange ever finished — and it is exactly
     * the case a player means by "it is already committed".
     */
    if (valid && !marchingAtObjective && current && inAttackReach(entity, current, stats)) {
      continue;
    }

    if (!valid && entity.targetId !== NO_TARGET) {
      // Losing a lock resets the wind-up: the next target must be earned.
      entity.targetId = NO_TARGET;
      entity.windupDone = false;
    }

    // Stagger by id so the scan cost spreads across ticks instead of spiking.
    if ((state.tick + entity.id) % TARGET_REACQUIRE_INTERVAL !== 0) continue;

    // Prefer a live combatant in sight; fall back to the march objective.
    const found = findBestTarget(state, entity) ?? objectiveTarget(state, entity);
    if (!found || found.id === entity.targetId) continue;

    /*
     * Still holding a valid lock on a combatant it has not reached yet: only
     * a meaningfully closer body takes it.
     *
     * This is what makes placement work. A horde walking at your Archers used
     * to be locked to them absolutely, so the tank you dropped in its face was
     * simply walked past; now the tank is nearer, so the tank gets hit and the
     * Archers get their value. The margin keeps two enemies at similar range
     * from trading the lock every scan.
     *
     * The objective tower is exempt because it is a fallback rather than a
     * choice — anything real in sight should take priority over walking at a
     * tower, however far away that troop happens to be.
     */
    if (valid && !marchingAtObjective && current) {
      const currentDistSq = fxLenSq(current.x - entity.x, current.y - entity.y);
      const foundDistSq = fxLenSq(found.x - entity.x, found.y - entity.y);
      if (!meaningfullyCloser(foundDistSq, currentDistSq)) continue;
    }

    entity.targetId = found.id;
    entity.windupDone = false;
  }
}
