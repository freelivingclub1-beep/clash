/**
 * Elixir trades — the currency the whole genre is scored in.
 *
 * Two things are covered here. The first is the *ledger*: the engine now counts
 * what each player has destroyed as well as what they have spent, because a
 * player who is only ever told what a push cost them cannot learn to trade.
 *
 * The second is the play that ledger is meant to reward. Dropping a cheap swarm
 * on top of an expensive single-target bruiser surrounds it, so it can only
 * face one body while the others hit its back — and that was quietly broken:
 * `formationOffsets` always took the first `n` of six fixed directions, so a
 * three-body card spawned in a 120-degree fan on one flank instead of a
 * triangle around the drop point.
 */

import { describe, it, expect } from 'vitest';
import '@cards/data';
import { STARTER_DECK, BOT_DECK } from '@cards/data';
import { getCard } from '@cards/registry';
import { createMatch, forceSpawn } from '@sim/state';
import { applyDamage } from '@sim/entities';
import { stepMatch, stepMatchBy } from '@sim/tick';
import { BLUE, RED } from '@sim/nav/grid';
import { AP_PER_AETHER, TICK_HZ } from '@sim/constants';
import { formationOffsets } from '@sim/entities';
import { fxToFloat } from '@sim/math/fixed';
import { defensiveTrade, SKILL_MATCHUPS } from '@game/fairness';
import type { Command, Entity, MatchState } from '@sim/types';

const newMatch = (): MatchState =>
  createMatch({ seed: 4242, players: [{ deck: STARTER_DECK }, { deck: BOT_DECK }] });

const play = (state: MatchState, cardId: string, tileX: number, tileY: number) => {
  state.players[BLUE].hand[0] = cardId;
  state.players[BLUE].aetherPoints = 10 * AP_PER_AETHER;
  const command: Command = { type: 'deploy', team: BLUE, handIndex: 0, tileX, tileY };
  stepMatch(state, [command]);
  return state.entities.filter((e) => e.alive && e.team === BLUE && e.cardId === cardId);
};

describe('spawn formation', () => {
  /** Angle of an offset in turns, 0..1, so gaps are easy to reason about. */
  const bearings = (count: number) =>
    formationOffsets(count)
      .map(([x, y]) => Math.atan2(fxToFloat(y), fxToFloat(x)) / (Math.PI * 2))
      .map((turn) => (turn + 1) % 1)
      .sort((a, b) => a - b);

  it('puts three bodies right around a drop point, not in a fan', () => {
    const spread = bearings(3);
    // Three bodies a third of a turn apart. The bug put all three inside a
    // third of a turn *total*, which is the opposite arrangement.
    for (let i = 0; i < spread.length; i++) {
      const gap = (spread[(i + 1) % spread.length] - spread[i] + 1) % 1;
      expect(gap).toBeGreaterThan(0.25);
    }
  });

  it('encircles for every swarm size, not just six', () => {
    for (const count of [2, 3, 4, 5, 6]) {
      const spread = bearings(count);
      expect(spread).toHaveLength(count);
      const gaps = spread.map((_, i) => (spread[(i + 1) % count] - spread[i] + 1) % 1);
      // No body may sit more than half a turn from the next one round, which
      // is what "surrounds" means and what a one-sided fan fails.
      expect(Math.max(...gaps)).toBeLessThanOrEqual(0.51);
    }
  });

  it('surrounds a body standing on the drop tile', () => {
    const state = newMatch();
    const bruiser = forceSpawn(state, RED, 'card_troop_mini_pekka', 8, 12);
    bruiser.deployTimer = 0;
    bruiser.speed = 0;

    const swarm = play(state, 'card_troop_skeletons', 8, 12);
    expect(swarm).toHaveLength(3);

    // At least one body on each side of it: that is the whole mechanic.
    const dx = swarm.map((s) => fxToFloat(s.x - bruiser.x));
    const dy = swarm.map((s) => fxToFloat(s.y - bruiser.y));
    expect(Math.max(...dx)).toBeGreaterThan(0.15);
    expect(Math.min(...dx)).toBeLessThan(-0.15);
    expect(Math.max(...dy)).toBeGreaterThan(0.15);
    expect(Math.min(...dy)).toBeLessThan(-0.15);
  });
});

describe('the trade ledger', () => {
  /** Kill a body outright through the real damage path, and resolve the death. */
  const slay = (state: MatchState, victim: Entity) => {
    applyDamage(state, victim, victim.hp + victim.shield);
    stepMatchBy(state, 1);
  };

  it('counts nothing before anything has died', () => {
    const state = newMatch();
    expect(state.players[BLUE].aetherDestroyed).toBe(0);
  });

  it('credits the killer with what the body was worth', () => {
    const state = newMatch();
    const victim = forceSpawn(state, RED, 'card_troop_knight', 8, 12);
    victim.deployTimer = 0;
    slay(state, victim);

    const knight = getCard('card_troop_knight');
    expect(state.players[BLUE].aetherDestroyed).toBe(knight.aetherCost * AP_PER_AETHER);
    // And the other side is not credited for losing it.
    expect(state.players[RED].aetherDestroyed).toBe(0);
  });

  it('scores a swarm body at its share of the card, not the whole card', () => {
    /*
     * Killing one of three Skeletons is a third of a Skeletons card. Scoring
     * it as a whole one would make clipping the edge of a swarm read as a full
     * trade, which is exactly the misread the ledger exists to correct.
     */
    const state = newMatch();
    const bodies = [0, 1, 2].map((i) => {
      const s = forceSpawn(state, RED, 'card_troop_skeletons', 7 + i, 12);
      s.deployTimer = 0;
      return s;
    });
    slay(state, bodies[0]);

    const card = getCard('card_troop_skeletons');
    const perBody = Math.round((card.aetherCost * AP_PER_AETHER) / card.spawnCount);
    expect(state.players[BLUE].aetherDestroyed).toBe(perBody);
  });

  it('leaves towers out of it', () => {
    // Crowns already score towers; folding one into the ledger would swamp
    // every troop trade in the match with a single number.
    const state = newMatch();
    const tower = state.entities.find((e) => e.kind === 'tower' && e.team === RED);
    expect(tower).toBeDefined();
    slay(state, tower!);
    expect(tower!.alive).toBe(false);
    expect(state.players[BLUE].aetherDestroyed).toBe(0);
  });
});

describe('skilled trades', () => {
  it('rewards a cheap swarm dropped onto a single-target bruiser', () => {
    /*
     * One aether of Skeletons against four of Mini P.E.K.K.A. It can only face
     * one at a time, so surrounding it wins the exchange outright. Before the
     * formation fix this was a *losing* trade when the swarm was dropped right
     * on top — the bodies all arrived on one flank and were cut down in turn.
     */
    const trade = defensiveTrade('card_troop_mini_pekka', 'card_troop_skeletons', 13);
    expect(trade).not.toBeNull();
    expect(trade!.threatKilled).toBe(true);
    expect(trade!.net).toBeGreaterThan(2);
  });

  it('punishes feeding a swarm to something that splashes', () => {
    // The counter to the counter. A Valkyrie clears the ring in one swing, so
    // the same play that beats a bruiser is a two-aether donation here.
    const trade = defensiveTrade('card_troop_valkyrie', 'card_troop_goblins', 13);
    expect(trade).not.toBeNull();
    expect(trade!.threatKilled).toBe(false);
    expect(trade!.net).toBeLessThan(0);
  });

  it('resolves every matchup the roster is expected to answer', () => {
    /*
     * A guard against a card quietly becoming unanswerable. Each threat has a
     * designated cheaper answer, and played at its best placement that answer
     * must actually *win* the exchange — kill the threat and come out ahead on
     * the combined ledger. Merely breaking even is not an answer, and the
     * earlier version of this test accepted anything down to -2, which is how
     * it went on passing while a designated counter lost every placement.
     */
    for (const { threat, answer } of SKILL_MATCHUPS) {
      const outcomes = [13, 11, 9]
        .map((row) => defensiveTrade(threat, answer, row))
        .filter((o) => o !== null);
      expect(outcomes.length).toBeGreaterThan(0);

      const best = outcomes.reduce((a, b) => (b!.net > a!.net ? b : a))!;
      expect(`${answer} vs ${threat}: killed=${best.threatKilled}`).toBe(
        `${answer} vs ${threat}: killed=true`,
      );
      expect(best.net).toBeGreaterThan(0);
    }
  });
});

describe('the ledger the player sees', () => {
  it('moves the running trade when a defence pays off', () => {
    const state = newMatch();
    const threat = forceSpawn(state, RED, 'card_troop_mini_pekka', 3, 14);
    threat.deployTimer = 0;
    play(state, 'card_troop_skeletons', 3, 13);

    for (let i = 0; i < TICK_HZ * 20 && threat.alive; i++) stepMatch(state);

    const player = state.players[BLUE];
    const trade = (player.aetherDestroyed - player.aetherSpent) / AP_PER_AETHER;
    expect(threat.alive).toBe(false);
    expect(trade).toBeGreaterThan(0);
  });
});
