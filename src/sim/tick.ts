/**
 * The tick pipeline.
 *
 * One function, one fixed order, no conditional system scheduling. The order
 * below is load-bearing for determinism and for correctness — a few notes on
 * why each neighbour pairing is where it is:
 *
 *   commands before aether   a card played this tick is paid for at this
 *                            tick's balance, not after the tick's income
 *   targeting before steering steering needs a settled target to seek
 *   steering before movement  every step is decided from the same snapshot
 *   combat before projectiles a shot fired this tick starts moving next tick
 *   deaths before towers      crown counting must see this tick's casualties
 *   towers before clock       the clock reads crowns to decide the outcome
 *   compact last              ids stay addressable for the whole tick
 */

import { resolveCommands } from './systems/commands';
import { aetherTick, matchClock } from './systems/clock';
import { targetAcquisition } from './systems/targeting';
import { steering, movement } from './systems/movement';
import { combat } from './systems/combat';
import { projectiles } from './systems/projectiles';
import { statusEffects } from './systems/status';
import { passiveTick } from './scripts/passives';
import { deaths, buildingDecay, compact } from './systems/deaths';
import { towerState } from './systems/towers';
import type { Command, MatchState } from './types';

const NO_COMMANDS: readonly Command[] = [];

/**
 * Advance the simulation by exactly one tick.
 *
 * `commands` are the inputs confirmed for *this* tick by the transport. The
 * simulation never reads wall-clock time; the caller decides when to call
 * this, and the caller alone is responsible for pacing.
 */
export function stepMatch(state: MatchState, commands: readonly Command[] = NO_COMMANDS): void {
  // Events are per-tick and consumed by the renderer; clear before producing.
  state.events.length = 0;

  if (state.phase === 'finished') return;

  resolveCommands(state, commands);
  aetherTick(state);

  targetAcquisition(state);
  steering(state);
  movement(state);

  combat(state);
  projectiles(state);

  statusEffects(state);
  // Auras run after status expiry so a slow aura re-applies the same tick it
  // would otherwise lapse, rather than flickering off for one frame.
  passiveTick(state);

  buildingDecay(state);
  deaths(state);
  towerState(state);
  matchClock(state);

  compact(state);

  state.tick++;
}

/** Run `count` ticks with no input. Used by tests and by fast-forwarding. */
export function stepMatchBy(state: MatchState, count: number): void {
  for (let i = 0; i < count; i++) stepMatch(state);
}

/**
 * A cheap order-sensitive hash of everything that must match between two runs.
 *
 * Deliberately excludes `events` (render-only, regenerated each tick) and the
 * flow-field cache (derived from the grid). Anything that influences a future
 * tick must be folded in here, or the determinism tests will not catch drift
 * in it.
 */
export function hashMatchState(state: MatchState): number {
  let hash = 0x811c9dc5;

  const fold = (value: number): void => {
    // FNV-1a over 32-bit chunks, forced back to int32 each step.
    hash ^= value | 0;
    hash = Math.imul(hash, 0x01000193);
  };

  fold(state.tick);
  fold(state.entities.length);
  fold(state.nextEntityId);
  fold(state.phase.length);
  fold(state.outcome.length);

  for (const entity of state.entities) {
    fold(entity.id);
    fold(entity.x);
    fold(entity.y);
    fold(entity.hp);
    fold(entity.shield);
    fold(entity.targetId);
    fold(entity.attackCooldown);
    fold(entity.deployTimer);
    fold(entity.freezeTicks + entity.stunTicks * 7 + entity.slowTicks * 13);
    fold(entity.rageTicks + entity.poisonTicks * 7 + entity.invisibleTicks * 13);
    fold(entity.goalTowerIndex);
    fold(entity.passiveCharges + entity.passiveTimer * 7 + entity.passiveTargetId * 13);
    fold(entity.alive ? 1 : 0);
  }

  for (const player of state.players) {
    fold(player.aetherPoints);
    fold(player.crowns);
    fold(player.heroEntityId);
    fold(player.heroAbilityCooldown);
    for (const id of player.hand) fold(id.length);
    for (const id of player.queue) fold(id.length);
    for (const [, counter] of player.evoCounters) fold(counter);
  }

  fold(state.simRng.a);
  fold(state.simRng.b);
  fold(state.simRng.c);
  fold(state.simRng.d);
  fold(state.shuffleRng.a);
  fold(state.shuffleRng.d);

  return hash >>> 0;
}
