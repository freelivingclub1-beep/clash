/**
 * Tower state: crowns, king activation, and deployment rights.
 *
 * Runs after deaths so it sees a consistent picture of which towers are gone,
 * but before compaction so the dead tower entities are still addressable.
 */

import { TOWER_LAYOUTS, type Team, enemyOf } from '../nav/grid';
import type { MatchState } from '../types';

/** Crowns are recounted from scratch each tick rather than incremented. */
export function towerState(state: MatchState): void {
  const standing = new Set<number>();
  for (const entity of state.entities) {
    if (entity.alive && entity.towerIndex >= 0) standing.add(entity.towerIndex);
  }

  for (const player of state.players) {
    player.crowns = 0;
    player.deployRights.laneOpen = [false, false];
  }

  for (let towerIndex = 0; towerIndex < TOWER_LAYOUTS.length; towerIndex++) {
    if (standing.has(towerIndex)) continue;
    const layout = TOWER_LAYOUTS[towerIndex];
    const attacker = state.players[enemyOf(layout.team)];

    // Announce the fall exactly once, on the tick the tower's entity is still
    // present but no longer alive. Crowns are recounted from scratch every
    // tick, so the loop itself cannot tell "already down" from "just fell" —
    // the dying entity can.
    const justFell = state.entities.some(
      (e) => e.towerIndex === towerIndex && !e.alive && e.hp <= 0,
    );
    if (justFell) {
      state.events.push({ type: 'towerDestroyed', towerIndex, team: layout.team });
    }

    // A king tower is worth three crowns and ends the match outright.
    attacker.crowns += layout.kind === 'king' ? 3 : 1;

    // Destroying a princess tower opens that lane for forward deployment.
    if (layout.kind === 'princess' && layout.lane !== null) {
      attacker.deployRights.laneOpen[layout.lane] = true;
    }
  }

  // A king tower wakes as soon as either of its princess towers falls.
  for (const entity of state.entities) {
    if (!entity.alive || entity.towerIndex < 0) continue;
    const layout = TOWER_LAYOUTS[entity.towerIndex];
    if (layout.kind !== 'king' || !entity.dormant) continue;

    const princessesDown = TOWER_LAYOUTS.some(
      (t, i) => t.team === layout.team && t.kind === 'princess' && !standing.has(i),
    );
    if (princessesDown) entity.dormant = false;
  }
}

export function crownsFor(state: MatchState, team: Team): number {
  return state.players[team].crowns;
}

export function kingTowerAlive(state: MatchState, team: Team): boolean {
  const kingIndex = TOWER_LAYOUTS.findIndex((t) => t.team === team && t.kind === 'king');
  return state.entities.some((e) => e.alive && e.towerIndex === kingIndex);
}

/** Total remaining health across a team's towers, for the overtime tiebreak. */
export function towerHealthFraction(state: MatchState, team: Team): number {
  let current = 0;
  let max = 0;
  for (const entity of state.entities) {
    if (entity.towerIndex < 0) continue;
    if (TOWER_LAYOUTS[entity.towerIndex].team !== team) continue;
    max += entity.maxHp;
    if (entity.alive) current += entity.hp;
  }
  return max === 0 ? 0 : current / max;
}

/** Lowest-health standing tower, used to decide a sudden-death tiebreak. */
export function lowestTowerHealth(state: MatchState, team: Team): number {
  let lowest = Number.POSITIVE_INFINITY;
  for (const entity of state.entities) {
    if (!entity.alive || entity.towerIndex < 0) continue;
    if (TOWER_LAYOUTS[entity.towerIndex].team !== team) continue;
    if (entity.hp < lowest) lowest = entity.hp;
  }
  return lowest === Number.POSITIVE_INFINITY ? 0 : lowest;
}
