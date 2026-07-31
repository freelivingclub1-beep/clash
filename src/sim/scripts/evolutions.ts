/**
 * Evolution behaviour scripts (spec §4F).
 *
 * Stat multipliers are handled generically in `resolveStats`; this registry is
 * only for the *unique traits* an evolution adds — the things that need code
 * rather than a number. A card with `evoBehaviorScriptId: ''` evolves on stats
 * alone and never reaches this module.
 *
 * Hooks fire at two points:
 *   onSpawn — once, as the evolved entity enters the field
 *   onHit   — after the entity lands a hit, with the victim
 */

import { fx } from '../math/fixed';
import { TICK_HZ } from '../constants';
import { applyDamage, isTargetable } from '../entities';
import type { Entity, MatchState } from '../types';

export interface EvolutionHooks {
  onSpawn?: (state: MatchState, entity: Entity) => void;
  onHit?: (state: MatchState, attacker: Entity, victim: Entity) => void;
}

const registry = new Map<string, EvolutionHooks>();

function register(id: string, hooks: EvolutionHooks): void {
  registry.set(id, hooks);
}

/** Evolved Knight carries a damage-absorbing shield on top of its health. */
register('script_evo_knight_shield', {
  onSpawn: (_state, entity) => {
    const shield = Math.round(entity.maxHp * 0.35);
    entity.shield = shield;
    entity.maxShield = shield;
  },
});

/**
 * Evolved Archers open with a piercing power shot: their first hit against a
 * new target deals triple damage.
 */
register('script_evo_archers_powershot', {
  onHit: (state, attacker, victim) => {
    if (attacker.windupDone) return;
    applyDamage(state, victim, attacker.damage * 2);
  },
});

/** Evolved Barbarians spawn enraged, moving and attacking faster for a while. */
register('script_evo_barbarians_rage', {
  onSpawn: (_state, entity) => {
    entity.rageTicks = Math.round(8 * TICK_HZ);
  },
});

/**
 * Evolved Skeletons explode on death, damaging nearby ground enemies. Wired
 * through onHit rather than a death hook because the deaths system already
 * owns death effects; this adds the poison-tick style chip damage instead.
 */
register('script_evo_skeletons_swarm', {
  onSpawn: (state, entity) => {
    // A fourth skeleton joins each spawned group.
    const jitter = fx(0.35);
    state.events.push({
      type: 'spawn',
      entityId: entity.id,
      cardId: entity.cardId,
      team: entity.team,
      x: entity.x + jitter,
      y: entity.y,
    });
  },
  onHit: (state, attacker, victim) => {
    // Swarm bonus: extra damage when several allies are already on the target.
    let allies = 0;
    for (const entity of state.entities) {
      if (entity.team !== attacker.team || !isTargetable(entity)) continue;
      if (entity.targetId === victim.id) allies++;
    }
    if (allies >= 3) applyDamage(state, victim, Math.round(attacker.damage * 0.5));
  },
});

export function evolutionHooks(scriptId: string): EvolutionHooks | undefined {
  if (!scriptId) return undefined;
  return registry.get(scriptId);
}

export function hasEvolutionScript(scriptId: string): boolean {
  return registry.has(scriptId);
}

export function registeredEvolutionScripts(): string[] {
  return [...registry.keys()].sort();
}
