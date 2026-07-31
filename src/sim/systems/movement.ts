/**
 * Steering and movement.
 *
 * Two passes, deliberately kept apart:
 *   steering — decides each entity's intended step for this tick
 *   movement — applies every step at once, then resolves overlaps
 *
 * Splitting them means an entity's decision never depends on how far a
 * neighbour has already moved this tick, so the result is independent of
 * iteration order in everything but the final push-out.
 *
 * Direction comes from a flow field when the unit is marching at its
 * objective, and from direct seeking once it has a live target — flow fields
 * are goal-oriented and cannot chase a moving troop.
 */

import {
  type Fx,
  fx,
  fxDiv,
  fxLen,
  fxLenSq,
  fxMul,
  fxFloorToInt,
  FX_ONE,
} from '../math/fixed';
import { GRID_W, GRID_H, SEPARATION_STRENGTH } from '../constants';
import { TOWER_LAYOUTS, isWalkable } from '../nav/grid';
import { flowDirection, rectCells } from '../nav/flowfield';
import { findEntity, isTargetable, resolveStats } from '../entities';
import type { Entity, MatchState } from '../types';
import { SpatialHash } from '../nav/spatialHash';

/** Rebuilt every tick; reused so steady-state ticks allocate nothing. */
const neighbourHash = new SpatialHash();
const neighbourScratch: number[] = [];

const KNOCKBACK_DECAY: Fx = fx(0.72);
const RAGE_SPEED_BONUS: Fx = fx(1.35);
const MIN_PUSH: Fx = fx(0.004);

export function tileOf(value: Fx): number {
  return fxFloorToInt(value);
}

/** Effective speed after rage, slow, and hard stops. */
function effectiveSpeed(entity: Entity): Fx {
  if (entity.freezeTicks > 0 || entity.stunTicks > 0) return 0;
  let speed = entity.speed;
  if (entity.rageTicks > 0) speed = fxMul(speed, RAGE_SPEED_BONUS);
  if (entity.slowTicks > 0) speed = fxMul(speed, entity.slowFactor);
  return speed;
}

function goalCellsFor(towerIndex: number): number[] {
  return rectCells(TOWER_LAYOUTS[towerIndex].footprint);
}

export function buildNeighbourHash(state: MatchState): SpatialHash {
  neighbourHash.clear();
  for (let i = 0; i < state.entities.length; i++) {
    const entity = state.entities[i];
    if (!entity.alive || entity.kind === 'projectile') continue;
    neighbourHash.insert(i, tileOf(entity.x), tileOf(entity.y));
  }
  return neighbourHash;
}

/**
 * Boids separation. Cohesion and alignment are deliberately omitted: units in
 * this game already share a goal via the flow field, which supplies the
 * grouping those two forces would provide, and adding them made squads orbit
 * their objective instead of committing to it.
 */
function separationForce(
  state: MatchState,
  hash: SpatialHash,
  entity: Entity,
  out: { x: Fx; y: Fx },
): void {
  out.x = 0;
  out.y = 0;
  if (entity.kind === 'tower' || entity.kind === 'building') return;

  neighbourScratch.length = 0;
  hash.query(tileOf(entity.x), tileOf(entity.y), 2, neighbourScratch);

  for (const index of neighbourScratch) {
    const other = state.entities[index];
    if (other === entity || !other.alive) continue;
    // Air and ground occupy separate layers and never push each other.
    if (other.flying !== entity.flying) continue;

    const dx = entity.x - other.x;
    const dy = entity.y - other.y;
    const minDistance = entity.radius + other.radius;
    const distSq = fxLenSq(dx, dy);
    if (distSq >= Math.round((minDistance * minDistance) / FX_ONE)) continue;

    const distance = fxLen(dx, dy);
    if (distance <= 0) {
      // Perfectly co-located: nudge apart by id so the split is deterministic.
      out.x += entity.id < other.id ? -MIN_PUSH : MIN_PUSH;
      continue;
    }
    // Heavier units shove lighter ones: push scales with the mass ratio.
    const massRatio = fxDiv(fx(other.mass), fx(entity.mass + other.mass));
    const overlap = minDistance - distance;
    const push = fxMul(fxDiv(overlap, minDistance), massRatio);
    out.x += fxMul(fxDiv(dx, distance), push);
    out.y += fxMul(fxDiv(dy, distance), push);
  }

  out.x = fxMul(out.x, SEPARATION_STRENGTH);
  out.y = fxMul(out.y, SEPARATION_STRENGTH);
}

const forceScratch = { x: 0 as Fx, y: 0 as Fx };

export function steering(state: MatchState): void {
  const hash = buildNeighbourHash(state);

  for (const entity of state.entities) {
    entity.stepX = 0;
    entity.stepY = 0;
    if (!entity.alive || entity.kind === 'projectile') continue;
    if (entity.kind === 'tower' || entity.kind === 'building') continue;
    if (entity.deployTimer > 0) continue;

    const speed = effectiveSpeed(entity);
    const stats = resolveStats(entity.cardId, entity.level, entity.evolved);
    const target = findEntity(state, entity.targetId);

    let dirX: Fx = 0;
    let dirY: Fx = 0;

    if (isTargetable(target)) {
      const dx = target.x - entity.x;
      const dy = target.y - entity.y;
      const distSq = fxLenSq(dx, dy);
      // Stop once inside attack range, allowing for both bodies.
      const stopDistance = stats.attackRange + entity.radius + target.radius;
      const stopSq = Math.round((stopDistance * stopDistance) / FX_ONE);

      if (distSq > stopSq) {
        if (target.kind === 'tower' || target.kind === 'building') {
          // Structures are static goals, so the flow field routes around
          // obstacles (and over bridges) far better than a straight line.
          const [fdx, fdy] = flowFieldStep(state, entity, target);
          dirX = fdx;
          dirY = fdy;
        } else {
          const distance = fxLen(dx, dy);
          if (distance > 0) {
            dirX = fxDiv(dx, distance);
            dirY = fxDiv(dy, distance);
          }
        }
      }
    }

    if (speed > 0 && (dirX !== 0 || dirY !== 0)) {
      entity.stepX = fxMul(dirX, speed);
      entity.stepY = fxMul(dirY, speed);
      entity.faceX = dirX;
      entity.faceY = dirY;
    }

    separationForce(state, hash, entity, forceScratch);
    entity.stepX += forceScratch.x;
    entity.stepY += forceScratch.y;

    // Knockback rides on top of steering and decays geometrically.
    if (entity.pushX !== 0 || entity.pushY !== 0) {
      entity.stepX += entity.pushX;
      entity.stepY += entity.pushY;
      entity.pushX = fxMul(entity.pushX, KNOCKBACK_DECAY);
      entity.pushY = fxMul(entity.pushY, KNOCKBACK_DECAY);
      if (Math.abs(entity.pushX) < MIN_PUSH) entity.pushX = 0;
      if (Math.abs(entity.pushY) < MIN_PUSH) entity.pushY = 0;
    }
  }
}

/** Flow-field step toward a structure, normalised into Fx tile space. */
function flowFieldStep(state: MatchState, entity: Entity, structure: Entity): [Fx, Fx] {
  if (structure.towerIndex < 0) {
    // A placed building is not one of the six cached goals; seek it directly
    // and let separation and the walkability clamp handle the geometry.
    const dx = structure.x - entity.x;
    const dy = structure.y - entity.y;
    const distance = fxLen(dx, dy);
    if (distance <= 0) return [0, 0];
    return [fxDiv(dx, distance), fxDiv(dy, distance)];
  }

  // A terrain_walk unit needs the river-ignoring field too, or it would path
  // to a bridge despite being able to swim straight across.
  const ignoresRiver = entity.flying || entity.ignoresTerrain;
  const key = `tower:${structure.towerIndex}:${ignoresRiver ? 'air' : 'ground'}`;
  const field = state.flowFields.get(key, goalCellsFor(structure.towerIndex), ignoresRiver);
  const [sx, sy] = flowDirection(field, tileOf(entity.x), tileOf(entity.y));

  if (sx === 0 && sy === 0) {
    const dx = structure.x - entity.x;
    const dy = structure.y - entity.y;
    const distance = fxLen(dx, dy);
    if (distance <= 0) return [0, 0];
    return [fxDiv(dx, distance), fxDiv(dy, distance)];
  }

  // Diagonal steps must be normalised or units would move ~41% faster on them.
  if (sx !== 0 && sy !== 0) {
    const diagonal = 46341; // 65536 / sqrt(2), rounded
    return [sx * diagonal, sy * diagonal];
  }
  return [sx * FX_ONE, sy * FX_ONE];
}

const MAX_X: Fx = fx(GRID_W) - 1;
const MAX_Y: Fx = fx(GRID_H) - 1;

export function movement(state: MatchState): void {
  for (const entity of state.entities) {
    if (!entity.alive || entity.kind === 'projectile') continue;
    if (entity.stepX === 0 && entity.stepY === 0) continue;

    let nextX = entity.x + entity.stepX;
    let nextY = entity.y + entity.stepY;

    if (nextX < 0) nextX = 0;
    if (nextX > MAX_X) nextX = MAX_X;
    if (nextY < 0) nextY = 0;
    if (nextY > MAX_Y) nextY = MAX_Y;

    // terrain_walk units are ground units for collision and targeting, but
    // the river does not stop them — so the mask check is skipped, not the
    // whole movement path.
    if (!entity.flying && !entity.ignoresTerrain) {
      // Resolve each axis separately so a unit sliding along a wall or a
      // bridge edge keeps its remaining momentum instead of stopping dead.
      const currentTileX = tileOf(entity.x);
      const currentTileY = tileOf(entity.y);
      const targetTileX = tileOf(nextX);
      const targetTileY = tileOf(nextY);

      if (targetTileX !== currentTileX && !isWalkable(state.grid, targetTileX, currentTileY, false)) {
        nextX = entity.x;
      }
      const settledTileX = tileOf(nextX);
      if (targetTileY !== currentTileY && !isWalkable(state.grid, settledTileX, targetTileY, false)) {
        nextY = entity.y;
      }
      // Reject any residual move into a blocked cell (diagonal corner cases).
      if (!isWalkable(state.grid, tileOf(nextX), tileOf(nextY), false)) {
        nextX = entity.x;
        nextY = entity.y;
      }
    }

    entity.x = nextX;
    entity.y = nextY;
  }
}
