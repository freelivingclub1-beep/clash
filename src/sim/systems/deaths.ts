/**
 * Death resolution, building decay, and end-of-tick compaction.
 *
 * Death effects run here rather than at the point of damage so they resolve in
 * a single, ordered pass. A death bomb that kills another unit therefore has
 * its victim's own death effect deferred to the next tick instead of recursing
 * — which bounds the chain and keeps the ordering reproducible.
 */

import { getCard } from '@cards/registry';
import { fx } from '../math/fixed';
import { setOccupied, TOWER_LAYOUTS } from '../nav/grid';
import { applyDamageAtPoint, releaseLocksOn } from './combat';
import { findEntity, formationOffsets, resolveStats, spawnTroop } from '../entities';
import { type Entity, type MatchState, NO_TARGET } from '../types';

function runDeathEffect(state: MatchState, entity: Entity): void {
  const stats = resolveStats(entity.cardId, entity.level, entity.evolved);
  const card = stats.card;

  switch (card.deathEffect) {
    case 'SpawnDeathUnit': {
      const spawnId = card.deathEffectParam;
      if (!spawnId) break;
      const level = state.players[entity.team].levels.get(spawnId) ?? entity.level;
      for (const [ox, oy] of formationOffsets(card.deathEffectCount)) {
        spawnTroop(state, spawnId, level, false, entity.team, entity.x + ox, entity.y + oy, {
          skipDeployDelay: true,
        });
      }
      break;
    }
    case 'DeathBomb': {
      const radius = fx(Number(card.deathEffectParam) || 2);
      applyDamageAtPoint(
        state,
        entity.team,
        entity.x,
        entity.y,
        radius,
        card.deathEffectDamage,
        card,
        stats.statusTicks,
        NO_TARGET,
      );
      break;
    }
    case 'DeathSpell': {
      const spellId = card.deathEffectParam;
      if (!spellId) break;
      const spell = getCard(spellId);
      const spellStats = resolveStats(spellId, entity.level, false);
      applyDamageAtPoint(
        state,
        entity.team,
        entity.x,
        entity.y,
        spellStats.splashRadius,
        spellStats.damage,
        spell,
        spellStats.statusTicks,
        NO_TARGET,
      );
      break;
    }
    case 'None':
      break;
  }
}

export function deaths(state: MatchState): void {
  if (!state.needsCompaction) return;

  for (const entity of state.entities) {
    if (entity.alive) continue;
    if (entity.kind === 'projectile') continue;

    state.events.push({
      type: 'death',
      entityId: entity.id,
      cardId: entity.cardId,
      team: entity.team,
      x: entity.x,
      y: entity.y,
    });

    runDeathEffect(state, entity);
    releaseLocksOn(state, entity.id);

    // A dead structure stops blocking movement, which invalidates flow fields.
    if (entity.kind === 'building') {
      setOccupied(state.grid, footprintOf(entity), false);
    }
    if (entity.kind === 'tower' && entity.towerIndex >= 0) {
      setOccupied(state.grid, TOWER_LAYOUTS[entity.towerIndex].footprint, false);
    }

    // A fallen hero frees its player to deploy the champion again.
    const player = state.players[entity.team];
    if (entity.isHero && player.heroEntityId === entity.id) {
      player.heroEntityId = NO_TARGET;
      player.heroAbilityCooldown = 0;
    }
  }
}

/** A placed building's tile footprint, derived from its body radius. */
function footprintOf(entity: Entity) {
  const half = Math.max(0, Math.round(entity.radius / 65536));
  const tx = Math.floor(entity.x / 65536);
  const ty = Math.floor(entity.y / 65536);
  return { minX: tx - half, minY: ty - half, maxX: tx + half, maxY: ty + half };
}

export function buildingDecay(state: MatchState): void {
  for (const entity of state.entities) {
    if (!entity.alive || entity.kind !== 'building') continue;
    if (entity.lifetimeTicks <= 0) continue;

    entity.lifetimeTicks--;
    if (entity.lifetimeTicks === 0) {
      // Decay is not damage: it leaves no killer and triggers no death effect
      // credit, but it does still run the card's own death effect.
      entity.hp = 0;
      entity.alive = false;
      state.needsCompaction = true;
    }
  }
}

/**
 * Drop dead entities, preserving ascending id order so the binary search in
 * `findEntity` stays valid.
 */
export function compact(state: MatchState): void {
  if (!state.needsCompaction) return;

  let write = 0;
  for (let read = 0; read < state.entities.length; read++) {
    const entity = state.entities[read];
    if (!entity.alive) continue;
    state.entities[write++] = entity;
  }
  state.entities.length = write;
  state.needsCompaction = false;
}

/** Register a newly placed building's footprint as blocking. */
export function occupyBuilding(state: MatchState, entity: Entity): void {
  if (entity.kind !== 'building') return;
  setOccupied(state.grid, footprintOf(entity), true);
}

export function heroOf(state: MatchState, team: 0 | 1): Entity | undefined {
  return findEntity(state, state.players[team].heroEntityId);
}
