/**
 * Command resolution — the first system in every tick.
 *
 * Commands arrive from the transport and are never trusted: a remote client
 * (or a buggy bot) can ask for anything, so every command is re-validated
 * against authoritative state here. Rejected commands are dropped silently
 * except for a render-side event; they must never throw, because a throw on
 * one client and not another is itself a desync.
 */

import { getCard } from '@cards/registry';
import { fx, fxMul } from '../math/fixed';
import { AP_PER_AETHER, PROJECTILE_SPEED, TICK_HZ } from '../constants';
import { canDeployAt } from '../nav/grid';
import {
  findEntity,
  formationOffsets,
  objectiveTowerIndex,
  spawnJitter,
  spawnProjectile,
  spawnTroop,
  resolveStats,
} from '../entities';
import { canAfford, cycleHand, spendAether, tileCenter } from '../state';
import { runAbility } from '../scripts/abilities';
import { evolutionHooks } from '../scripts/evolutions';
import { type Command, type MatchState, type PlayerState, NO_TARGET } from '../types';

function reject(state: MatchState, player: PlayerState, reason: string): void {
  state.events.push({ type: 'deployRejected', team: player.team, reason });
}

/**
 * Decide whether this play produces an evolved unit, and advance the counter.
 *
 * The spec's wording ("increments… when the counter reaches 0") is
 * self-contradictory; the resolution here is a countdown initialised to
 * `evoCycleRequirement`, decremented on each ordinary play, with the play
 * after it hits zero producing the evolved form. A 2-cycle evolution therefore
 * takes two normal plays and evolves on the third, matching the live game.
 */
function consumeEvolution(player: PlayerState, cardId: string): boolean {
  if (!player.evolutionSlots.includes(cardId)) return false;

  if (player.evoReady.get(cardId)) {
    player.evoReady.set(cardId, false);
    player.evoCounters.set(cardId, getCard(cardId).evoCycleRequirement);
    return true;
  }

  const remaining = (player.evoCounters.get(cardId) ?? 0) - 1;
  player.evoCounters.set(cardId, Math.max(0, remaining));
  if (remaining <= 0) player.evoReady.set(cardId, true);
  return false;
}

function resolveDeploy(
  state: MatchState,
  command: Extract<Command, { type: 'deploy' }>,
): void {
  const player = state.players[command.team];

  if (command.handIndex < 0 || command.handIndex >= player.hand.length) {
    reject(state, player, 'bad-hand-index');
    return;
  }
  const cardId = player.hand[command.handIndex];
  const card = getCard(cardId);

  if (!canAfford(player, card.aetherCost)) {
    reject(state, player, 'insufficient-aether');
    return;
  }

  const isSpell = card.category === 'Spell';
  // Spells may be cast anywhere; everything else obeys territory rules.
  if (
    !isSpell &&
    !canDeployAt(state.grid, command.team, command.tileX, command.tileY, player.deployRights, card.isFlying, card.deployAnywhere)
  ) {
    reject(state, player, 'illegal-placement');
    return;
  }
  if (isSpell && (command.tileX < 0 || command.tileX > 17 || command.tileY < 0 || command.tileY > 31)) {
    reject(state, player, 'out-of-bounds');
    return;
  }

  // A hero already on the field cannot be deployed a second time.
  if (card.isHero && findEntity(state, player.heroEntityId)?.alive) {
    reject(state, player, 'hero-already-deployed');
    return;
  }

  spendAether(player, card.aetherCost);
  cycleHand(player, command.handIndex);
  player.cardsPlayed++;

  const evolved = consumeEvolution(player, cardId);
  const level = player.levels.get(cardId) ?? 11;
  const center = tileCenter(command.tileX, command.tileY);

  if (isSpell) {
    const stats = resolveStats(cardId, level, evolved);
    /*
     * Spells arrive from behind their caster, and the distance is a time.
     *
     * Projectiles move at a fixed speed, so throwing from a fixed *offset*
     * meant every spell in the game took the same four-ninths of a second to
     * land whatever it was. Deriving the offset from the card's own travel
     * time makes the throw legible: the shot enters from off-screen behind
     * you, arcs over the board and lands, which is a beat the defender can
     * see coming rather than a blast that appears.
     */
    const tiles = fxMul(PROJECTILE_SPEED, fx(card.castTravelSeconds * TICK_HZ));
    const approach = command.team === 0 ? -tiles : tiles;
    spawnProjectile(state, {
      team: command.team,
      cardId,
      level,
      evolved,
      originX: center.x,
      originY: center.y + approach,
      sourceId: NO_TARGET,
      targetId: NO_TARGET,
      destX: center.x,
      destY: center.y,
      damage: stats.damage,
      splashRadius: stats.splashRadius,
      appliesStatus: card.onHitStatus !== 'None',
    });
    /*
     * No event here. The blast is announced when the spell *lands*, from the
     * projectile system — emitting it at cast time played the whole explosion
     * at the destination while the shot was still in the air, which is
     * precisely why a spell looked like it hit the instant you dropped it.
     */
    return;
  }

  const hooks = evolved ? evolutionHooks(card.evoBehaviorScriptId) : undefined;
  for (const [ox, oy] of formationOffsets(card.spawnCount)) {
    const entity = spawnTroop(
      state,
      cardId,
      level,
      evolved,
      command.team,
      center.x + ox + spawnJitter(state.simRng),
      center.y + oy + spawnJitter(state.simRng),
    );
    entity.goalTowerIndex = objectiveTowerIndex(state, command.team, entity.lane);
    // The passive's own spawn hook already fired inside `spawnTroop`, for
    // every spawn source rather than only this one. The evolution hook runs
    // after it, so an evolved card stacks its shield on top of a passive one
    // rather than replacing it.
    hooks?.onSpawn?.(state, entity);
  }
}

function resolveAbility(state: MatchState, team: 0 | 1): void {
  const player = state.players[team];
  const hero = findEntity(state, player.heroEntityId);

  if (!hero || !hero.alive) {
    reject(state, player, 'no-hero-on-field');
    return;
  }
  if (player.heroAbilityCooldown > 0) {
    reject(state, player, 'ability-on-cooldown');
    return;
  }

  const card = getCard(hero.cardId);
  if (!canAfford(player, card.abilityAetherCost)) {
    reject(state, player, 'insufficient-aether');
    return;
  }

  player.aetherPoints -= card.abilityAetherCost * AP_PER_AETHER;
  player.aetherSpent += card.abilityAetherCost * AP_PER_AETHER;
  player.heroAbilityCooldown = Math.round(card.abilityCooldown * TICK_HZ);
  runAbility(state, hero);
}

export function resolveCommands(state: MatchState, commands: readonly Command[]): void {
  for (const command of commands) {
    switch (command.type) {
      case 'deploy':
        resolveDeploy(state, command);
        break;
      case 'ability':
        resolveAbility(state, command.team);
        break;
      case 'emote':
        // Purely cosmetic; forwarded to the renderer without touching state.
        break;
    }
  }
}
