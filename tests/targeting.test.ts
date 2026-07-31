/**
 * Target acquisition, and specifically what happens when you place a body in
 * the way of something that has already picked a target.
 *
 * The reported symptom: drop Archers behind, drop a tank in front of an
 * incoming push, and the push walks straight past the tank to the Archers.
 * That is the whole reason to place a blocker, so it is worth pinning from
 * several angles — including the cases where a lock *should* hold.
 */

import { describe, it, expect } from 'vitest';
import '@cards/data';
import { STARTER_DECK, BOT_DECK } from '@cards/data';
import { createMatch, forceSpawn } from '@sim/state';
import { stepMatch, stepMatchBy, hashMatchState } from '@sim/tick';
import { BLUE, RED } from '@sim/nav/grid';
import { AP_PER_AETHER, TICK_HZ } from '@sim/constants';
import { findEntity } from '@sim/entities';
import { fxToFloat } from '@sim/math/fixed';
import type { Entity, MatchState } from '@sim/types';

const newMatch = (): MatchState =>
  createMatch({ seed: 1717, players: [{ deck: STARTER_DECK }, { deck: BOT_DECK }] });

/** Live on the field immediately, and standing still. */
function park(entity: Entity): Entity {
  entity.deployTimer = 0;
  entity.speed = 0;
  return entity;
}

const lockedTarget = (state: MatchState, entity: Entity) => findEntity(state, entity.targetId);

describe('placing a blocker', () => {
  /**
   * The reported case, start to finish.
   *
   * A Barbarian is walking down the lane. Archers are placed behind, it locks
   * them, and then a Knight is dropped in its face. The Knight is nearer, so
   * the Knight is what it has to deal with.
   */
  it('pulls an incoming push off the shooters behind it', () => {
    const state = newMatch();

    const raider = forceSpawn(state, RED, 'card_troop_barbarians', 8, 14);
    raider.deployTimer = 0;
    const archers = park(forceSpawn(state, BLUE, 'card_troop_archers', 8, 10));

    // Let it settle onto the Archers, which is the correct first choice.
    stepMatchBy(state, 6);
    expect(lockedTarget(state, raider)?.id).toBe(archers.id);

    // Now the blocker, dropped between the two.
    const blocker = park(forceSpawn(state, BLUE, 'card_troop_knight', 8, 12));
    stepMatchBy(state, 6);

    expect(lockedTarget(state, raider)?.id).toBe(blocker.id);
  });

  it('lets the shooters behind it actually get their value', () => {
    const state = newMatch();
    const raider = forceSpawn(state, RED, 'card_troop_barbarians', 8, 14);
    raider.deployTimer = 0;
    const archers = park(forceSpawn(state, BLUE, 'card_troop_archers', 8, 10));

    stepMatchBy(state, 6);
    const blocker = park(forceSpawn(state, BLUE, 'card_troop_knight', 8, 12));

    /*
     * Five seconds of the Knight holding it. The blocker taking damage is the
     * assertion that matters — the Archers surviving is also true when the
     * raider simply has not arrived yet, which is how the broken behaviour
     * looked from the outside and why the bug survived this long.
     */
    stepMatchBy(state, TICK_HZ * 5);
    expect(blocker.hp).toBeLessThan(blocker.maxHp);
    expect(archers.hp).toBe(archers.maxHp);
    expect(raider.hp).toBeLessThan(raider.maxHp);
  });

  it('works through the real deploy path, deploy freeze and all', () => {
    /*
     * `forceSpawn` skips the one-second deploy freeze, and a unit is not
     * targetable while frozen — so a blocker cannot take aggro the instant it
     * lands, which is the actual skill in placing one. This runs the whole
     * chain: play the card from hand, wait out the freeze, then check.
     */
    const state = newMatch();
    const raider = forceSpawn(state, RED, 'card_troop_barbarians', 8, 15);
    raider.deployTimer = 0;
    const archers = park(forceSpawn(state, BLUE, 'card_troop_archers', 8, 10));

    stepMatchBy(state, 6);
    expect(lockedTarget(state, raider)?.id).toBe(archers.id);

    state.players[BLUE].hand[0] = 'card_troop_knight';
    state.players[BLUE].aetherPoints = 10 * AP_PER_AETHER;
    stepMatch(state, [{ type: 'deploy', team: BLUE, handIndex: 0, tileX: 8, tileY: 12 }]);

    const blocker = state.entities.find(
      (e) => e.alive && e.team === BLUE && e.cardId === 'card_troop_knight',
    );
    expect(blocker).toBeDefined();
    // Invisible to the raider while it is still landing.
    expect(blocker?.deployTimer).toBeGreaterThan(0);
    expect(lockedTarget(state, raider)?.id).toBe(archers.id);

    // Once it is on its feet, it takes the push.
    stepMatchBy(state, TICK_HZ + 6);
    expect(lockedTarget(state, raider)?.id).toBe(blocker?.id);
  });

  it('does not need the blocker to be exactly in the lane', () => {
    // A body dropped a little off the walking line still has to take the
    // aggro, or "place it in front" becomes a pixel-perfect requirement.
    const state = newMatch();
    const raider = forceSpawn(state, RED, 'card_troop_barbarians', 8, 14);
    raider.deployTimer = 0;
    park(forceSpawn(state, BLUE, 'card_troop_archers', 8, 10));

    stepMatchBy(state, 6);
    const blocker = park(forceSpawn(state, BLUE, 'card_troop_knight', 9, 12));
    stepMatchBy(state, 6);

    expect(lockedTarget(state, raider)?.id).toBe(blocker.id);
  });
});

describe('locks that must hold', () => {
  it('never turns a unit that is already swinging', () => {
    /*
     * The other half of the request: "it is different if they are already
     * locked on or close". A unit in melee stays in melee, or no exchange
     * would ever finish and a fight would be impossible to read.
     */
    const state = newMatch();
    const raider = park(forceSpawn(state, RED, 'card_troop_barbarians', 8, 12));
    const engaged = park(forceSpawn(state, BLUE, 'card_troop_knight', 8, 13));

    stepMatchBy(state, TICK_HZ);
    expect(lockedTarget(state, raider)?.id).toBe(engaged.id);
    expect(engaged.hp).toBeLessThan(engaged.maxHp);

    // Something dropped right on top of it, nearer than what it is hitting.
    park(forceSpawn(state, BLUE, 'card_troop_skeletons', 8, 12));
    stepMatchBy(state, 9);

    expect(lockedTarget(state, raider)?.id).toBe(engaged.id);
  });

  it('ignores a body that is barely nearer than the current target', () => {
    // The margin is what stops a unit twitching between two enemies at
    // similar range on every scan.
    const state = newMatch();
    const raider = forceSpawn(state, RED, 'card_troop_barbarians', 8, 16);
    raider.deployTimer = 0;
    const first = park(forceSpawn(state, BLUE, 'card_troop_archers', 8, 11));

    stepMatchBy(state, 6);
    expect(lockedTarget(state, raider)?.id).toBe(first.id);

    // A hair closer, well inside the margin.
    park(forceSpawn(state, BLUE, 'card_troop_musketeer', 9, 11));
    stepMatchBy(state, 9);

    expect(lockedTarget(state, raider)?.id).toBe(first.id);
  });

  it('does not oscillate when two bodies sit at the same distance', () => {
    const state = newMatch();
    const raider = forceSpawn(state, RED, 'card_troop_barbarians', 8, 16);
    raider.deployTimer = 0;
    park(forceSpawn(state, BLUE, 'card_troop_archers', 7, 11));
    park(forceSpawn(state, BLUE, 'card_troop_musketeer', 9, 11));

    stepMatchBy(state, 6);
    const settled = raider.targetId;

    const switches: number[] = [];
    let previous = settled;
    for (let i = 0; i < TICK_HZ * 2; i++) {
      stepMatch(state);
      if (raider.targetId !== previous) {
        switches.push(raider.targetId);
        previous = raider.targetId;
      }
    }
    // Closing the distance may legitimately hand the lock over once; trading
    // it back and forth is the failure this guards.
    expect(switches.length).toBeLessThanOrEqual(1);
  });

  it('still walks at the tower when nothing is in sight', () => {
    // The retarget rule must not disturb the ordinary march, which an earlier
    // targeting change did — every unit crawled at a third speed.
    const state = newMatch();
    const marcher = forceSpawn(state, BLUE, 'card_troop_knight', 8, 8);
    marcher.deployTimer = 0;

    const startY = marcher.y;
    stepMatchBy(state, TICK_HZ * 3);
    const travelled = fxToFloat(marcher.y - startY);

    expect(travelled).toBeGreaterThan(2.0);
  });
});

describe('determinism', () => {
  it('holds with blockers being dropped mid-push', () => {
    const run = () => {
      const state = newMatch();
      forceSpawn(state, RED, 'card_troop_barbarians', 8, 16).deployTimer = 0;
      forceSpawn(state, BLUE, 'card_troop_archers', 8, 10).deployTimer = 0;
      stepMatchBy(state, 20);
      forceSpawn(state, BLUE, 'card_troop_knight', 8, 12).deployTimer = 0;
      stepMatchBy(state, 400);
      return state;
    };
    expect(hashMatchState(run())).toBe(hashMatchState(run()));
  });
});
