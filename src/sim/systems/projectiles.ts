/**
 * Projectile flight and impact.
 *
 * Projectiles home on their target while it lives, and fall through to their
 * last recorded destination once it dies — so a Musketeer's shot still lands
 * (and still splashes, if it splashes) on a target that expires mid-flight,
 * rather than vanishing.
 *
 * Spell casts are projectiles with no source and no target: they simply fly to
 * a fixed point and detonate.
 */

import { fxDiv, fxLen, fxMul } from '../math/fixed';
import { PROJECTILE_SPEED } from '../constants';
import { findEntity, isTargetable, resolveStats } from '../entities';
import { applyDamageAtPoint } from './combat';
import { type MatchState, NO_TARGET } from '../types';

export function projectiles(state: MatchState): void {
  for (const projectile of state.entities) {
    if (!projectile.alive || projectile.kind !== 'projectile') continue;

    // Track a live target; otherwise commit to the last known impact point.
    const target = findEntity(state, projectile.targetId);
    if (isTargetable(target)) {
      projectile.destX = target.x;
      projectile.destY = target.y;
    }

    const dx = projectile.destX - projectile.x;
    const dy = projectile.destY - projectile.y;
    const distance = fxLen(dx, dy);

    if (distance > PROJECTILE_SPEED) {
      const stepX = fxMul(fxDiv(dx, distance), PROJECTILE_SPEED);
      const stepY = fxMul(fxDiv(dy, distance), PROJECTILE_SPEED);
      projectile.x += stepX;
      projectile.y += stepY;
      projectile.faceX = stepX;
      projectile.faceY = stepY;
      continue;
    }

    // Arrival — snap to the impact point and resolve.
    projectile.x = projectile.destX;
    projectile.y = projectile.destY;

    const stats = resolveStats(projectile.cardId, projectile.level, projectile.evolved);
    applyDamageAtPoint(
      state,
      projectile.team,
      projectile.x,
      projectile.y,
      projectile.splashRadius,
      projectile.damage,
      stats.card,
      stats.statusTicks,
      projectile.targetId,
    );

    projectile.alive = false;
    state.needsCompaction = true;
  }
}

/** True when a projectile is still in flight — used by the renderer. */
export function isInFlight(state: MatchState, id: number): boolean {
  const entity = findEntity(state, id);
  return !!entity && entity.alive && entity.kind === 'projectile' && entity.targetId !== NO_TARGET;
}
