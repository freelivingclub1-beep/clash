/**
 * The bot opponent.
 *
 * The bot emits ordinary `Command`s through the ordinary transport — it has no
 * privileged access to the simulation and cannot do anything a human could
 * not. That constraint is what makes it a genuine stand-in for a remote player
 * rather than a special case wired into the engine.
 *
 * It carries its own RNG rather than drawing from `state.simRng`. Sharing that
 * stream would mean a recorded command log could not be replayed without the
 * bot also running, since the replay would consume different random values.
 */

import { getCard } from '@cards/registry';
import { createRng, nextInt, nextRange, type Rng } from '@sim/math/rng';
import { fxToFloat } from '@sim/math/fixed';
import { LANE_SPLIT_X, AP_PER_AETHER } from '@sim/constants';
import { type Team, enemyOf, canDeployAt } from '@sim/nav/grid';
import { findEntity } from '@sim/entities';
import type { Command, Entity, MatchState } from '@sim/types';

/** How often the bot reconsiders. ~0.5s — deliberate, not twitchy. */
const DECISION_INTERVAL_TICKS = 15;

/** Below this the bot holds; it should not dribble single cards away. */
const MIN_ATTACK_AETHER = 6;

export interface BotOptions {
  team: Team;
  seed: number;
  /** 0 = passive, 1 = relentless. Scales aggression and reaction speed. */
  aggression?: number;
}

interface Threat {
  entity: Entity;
  lane: 0 | 1;
  /** How deep into the bot's territory the threat has pushed. */
  depth: number;
}

export class BotController {
  private readonly rng: Rng;
  private readonly team: Team;
  private readonly aggression: number;

  constructor(options: BotOptions) {
    this.team = options.team;
    this.aggression = options.aggression ?? 0.6;
    // Own stream, derived from the match seed so runs stay reproducible.
    this.rng = createRng((options.seed ^ 0x5bf03635) | 0);
  }

  /** Commands to submit this tick. Usually empty. */
  decide(state: MatchState): Command[] {
    if (state.phase === 'finished') return [];
    if (state.tick % DECISION_INTERVAL_TICKS !== 0) return [];

    const player = state.players[this.team];
    const aether = player.aetherPoints / AP_PER_AETHER;

    const ability = this.maybeUseAbility(state, aether);
    if (ability) return [ability];

    const threat = this.biggestThreat(state);
    if (threat) {
      const defence = this.playDefence(state, threat, aether);
      if (defence) return [defence];
    }

    return this.maybeAttack(state, aether);
  }

  // -------------------------------------------------------------------------

  private maybeUseAbility(state: MatchState, aether: number): Command | null {
    const player = state.players[this.team];
    if (player.heroAbilityCooldown > 0) return null;

    const hero = findEntity(state, player.heroEntityId);
    if (!hero || !hero.alive || hero.deployTimer > 0) return null;

    const card = getCard(hero.cardId);
    if (aether < card.abilityAetherCost) return null;

    // Only worth spending on if something is actually near the hero.
    const foe = enemyOf(this.team);
    const inRange = state.entities.some(
      (e) =>
        e.alive &&
        e.team === foe &&
        e.kind === 'troop' &&
        Math.abs(fxToFloat(e.x) - fxToFloat(hero.x)) < 5 &&
        Math.abs(fxToFloat(e.y) - fxToFloat(hero.y)) < 5,
    );
    if (!inRange) return null;

    return { type: 'ability', team: this.team };
  }

  /** The enemy troop that has pushed deepest into the bot's half. */
  private biggestThreat(state: MatchState): Threat | null {
    const foe = enemyOf(this.team);
    let best: Threat | null = null;

    for (const entity of state.entities) {
      if (!entity.alive || entity.team !== foe) continue;
      if (entity.kind !== 'troop') continue;

      const y = fxToFloat(entity.y);
      // Depth is measured from the river toward the bot's own towers.
      const depth = this.team === 1 ? y - 16 : 16 - y;
      if (depth < 0) continue;

      const lane: 0 | 1 = fxToFloat(entity.x) < LANE_SPLIT_X ? 0 : 1;
      if (!best || depth > best.depth) best = { entity, lane, depth };
    }
    return best;
  }

  private playDefence(state: MatchState, threat: Threat, aether: number): Command | null {
    const player = state.players[this.team];

    // Pick the most expensive affordable answer that can actually hit it.
    let bestIndex = -1;
    let bestCost = -1;
    for (let i = 0; i < player.hand.length; i++) {
      const card = getCard(player.hand[i]);
      if (card.aetherCost > aether) continue;
      if (card.category === 'Spell') {
        // Only worth a spell if the threat is a swarm or already committed.
        if (threat.depth < 3) continue;
      } else if (threat.entity.flying && card.targetPriority === 'Ground') {
        continue;
      } else if (card.targetPriority === 'Buildings') {
        continue; // win conditions are for attacking, not defending
      }
      if (card.aetherCost > bestCost) {
        bestCost = card.aetherCost;
        bestIndex = i;
      }
    }
    if (bestIndex === -1) return null;

    const card = getCard(player.hand[bestIndex]);
    const threatX = Math.round(fxToFloat(threat.entity.x));
    const threatY = Math.round(fxToFloat(threat.entity.y));

    if (card.category === 'Spell') {
      return { type: 'deploy', team: this.team, handIndex: bestIndex, tileX: threatX, tileY: threatY };
    }

    // Drop just behind the threat, on the bot's side of it.
    const offset = this.team === 1 ? 2 : -2;
    const placement = this.legalNear(state, threatX, threatY + offset, card.isFlying);
    if (!placement) return null;

    return {
      type: 'deploy',
      team: this.team,
      handIndex: bestIndex,
      tileX: placement[0],
      tileY: placement[1],
    };
  }

  private maybeAttack(state: MatchState, aether: number): Command[] {
    const player = state.players[this.team];

    // Hold until there is enough aether for a push, scaled by aggression.
    const threshold = MIN_ATTACK_AETHER + (1 - this.aggression) * 3;
    if (aether < threshold) return [];

    const affordable: number[] = [];
    for (let i = 0; i < player.hand.length; i++) {
      if (getCard(player.hand[i]).aetherCost <= aether) affordable.push(i);
    }
    if (affordable.length === 0) return [];

    const handIndex = affordable[nextInt(this.rng, affordable.length)];
    const card = getCard(player.hand[handIndex]);

    // Spells are not an opening move; save them for a real target.
    if (card.category === 'Spell') return [];

    // Push down a bridge lane, from just behind the bot's own side of the river.
    const bridgeX = nextInt(this.rng, 2) === 0 ? 4 : 13;
    const tileX = bridgeX + nextInt(this.rng, 2);
    const tileY = this.team === 1 ? nextRange(this.rng, 17, 20) : nextRange(this.rng, 11, 14);

    const placement = this.legalNear(state, tileX, tileY, card.isFlying);
    if (!placement) return [];

    return [
      { type: 'deploy', team: this.team, handIndex, tileX: placement[0], tileY: placement[1] },
    ];
  }

  /**
   * Nearest legal tile to (tx, ty), searched in a fixed spiral so the result
   * never depends on iteration order.
   */
  private legalNear(
    state: MatchState,
    tx: number,
    ty: number,
    flying: boolean,
  ): [number, number] | null {
    const player = state.players[this.team];
    for (let radius = 0; radius <= 4; radius++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const x = tx + dx;
          const y = ty + dy;
          if (canDeployAt(state.grid, this.team, x, y, player.deployRights, flying)) {
            return [x, y];
          }
        }
      }
    }
    return null;
  }
}
