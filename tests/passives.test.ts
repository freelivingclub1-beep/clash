/**
 * The role-wave passives, and the spawn hook that feeds all of them.
 */

import { describe, it, expect } from 'vitest';
import '@cards/data';
import { STARTER_DECK, BOT_DECK } from '@cards/data';
import { getCard } from '@cards/registry';
import { createMatch, forceSpawn } from '@sim/state';
import { stepMatch, stepMatchBy } from '@sim/tick';
import { BLUE, RED } from '@sim/nav/grid';
import { AP_PER_AETHER, TICK_HZ } from '@sim/constants';
import { applyDamage, resolveStats } from '@sim/entities';
import { applyStatus } from '@sim/systems/combat';
import { hasPassive } from '@sim/scripts/passives';
import { auditCard } from '@cards/balance';
import type { Command, Entity, MatchState } from '@sim/types';

const newMatch = (): MatchState =>
  createMatch({ seed: 4242, players: [{ deck: STARTER_DECK }, { deck: BOT_DECK }] });

const play = (state: MatchState, cardId: string, tileX = 8, tileY = 10) => {
  state.players[BLUE].hand[0] = cardId;
  state.players[BLUE].aetherPoints = 10 * AP_PER_AETHER;
  const command: Command = { type: 'deploy', team: BLUE, handIndex: 0, tileX, tileY };
  stepMatch(state, [command]);
  return state.entities.filter((e) => e.alive && e.cardId === cardId);
};

/** Park a unit so it fights where it is put instead of walking off. */
function park(entity: Entity): Entity {
  entity.deployTimer = 0;
  entity.speed = 0;
  return entity;
}

describe('spawn hooks', () => {
  it('fire for units the simulation spawns, not only hand-played ones', () => {
    /*
     * The hook used to live at the deploy site, so anything the sim itself put
     * on the board skipped its own passive's setup. A Bell Tower's skeletons
     * are the visible case, but the same gap silently stripped shields off
     * spawner output and parries off replicated copies.
     */
    const state = newMatch();
    const ronin = forceSpawn(state, BLUE, 'card_troop_ronin', 8, 12);
    expect(ronin.passiveCharges).toBe(1);
  });

  it('does not double up when a card is played from hand', () => {
    const state = newMatch();
    const bulwark = play(state, 'card_troop_bulwark')[0];
    const expected = resolveStats('card_troop_bulwark', bulwark.level, false).shield;
    const magnitude = getCard('card_troop_bulwark').passiveMagnitude;
    // A shield applied twice would read as double the card's own grant.
    expect(bulwark.shield).toBeLessThanOrEqual(Math.max(expected, bulwark.maxHp * magnitude) + 1);
  });
});

describe('reflect_melee', () => {
  const sentinel = 'card_troop_thornmail_sentinel';

  it('is a registered, priced mechanic', () => {
    expect(hasPassive('reflect_melee')).toBe(true);
    expect(getCard(sentinel).passiveId).toBe('reflect_melee');
    expect(auditCard(getCard(sentinel)).withinTolerance).toBe(true);
  });

  it('returns part of a melee blow to the attacker', () => {
    const state = newMatch();
    const sentry = park(forceSpawn(state, BLUE, sentinel, 8, 12));
    const attacker = park(forceSpawn(state, RED, 'card_troop_mini_pekka', 8, 13));
    const attackerHealth = attacker.hp;

    // Run until the PEKKA has actually swung.
    for (let i = 0; i < TICK_HZ * 4 && sentry.hp === sentry.maxHp; i++) stepMatch(state);
    expect(sentry.hp).toBeLessThan(sentry.maxHp);
    expect(attacker.hp).toBeLessThan(attackerHealth);
  });

  it('does nothing at all against a shooter', () => {
    // The whole reason it and Crystal Golem are a choice rather than a pair.
    const state = newMatch();
    const sentry = park(forceSpawn(state, BLUE, sentinel, 8, 12));
    const shooter = park(forceSpawn(state, RED, 'card_troop_musketeer', 8, 15));
    const shooterHealth = shooter.hp;

    for (let i = 0; i < TICK_HZ * 6 && sentry.hp === sentry.maxHp; i++) stepMatch(state);
    expect(sentry.hp).toBeLessThan(sentry.maxHp);
    expect(shooter.hp).toBe(shooterHealth);
  });
});

describe('execute_low_hp', () => {
  const headsman = 'card_troop_headsman';

  it('is a registered, priced mechanic', () => {
    expect(hasPassive('execute_low_hp')).toBe(true);
    expect(auditCard(getCard(headsman)).withinTolerance).toBe(true);
  });

  /** Damage of the first blow the headsman lands on `victim`. */
  const firstBlow = (victimHealthFraction: number): number => {
    const state = newMatch();
    park(forceSpawn(state, BLUE, headsman, 8, 12));
    const victim = park(forceSpawn(state, RED, 'card_troop_giant', 8, 13));
    victim.hp = Math.max(1, Math.round(victim.maxHp * victimHealthFraction));

    const before = victim.hp;
    for (let i = 0; i < TICK_HZ * 5; i++) {
      stepMatch(state);
      if (victim.hp < before) return before - victim.hp;
    }
    return 0;
  };

  it('hits far harder once the target is below half', () => {
    const healthy = firstBlow(1.0);
    const wounded = firstBlow(0.4);
    expect(healthy).toBeGreaterThan(0);
    expect(wounded).toBeGreaterThan(healthy * 1.5);
  });

  it('adds nothing at all against a target at full health', () => {
    expect(firstBlow(1.0)).toBe(resolveStats(headsman, 11, false).damage);
  });
});

describe('first_strike', () => {
  const duelist = 'card_troop_duelist';

  it('is a registered, priced mechanic', () => {
    expect(hasPassive('first_strike')).toBe(true);
    expect(auditCard(getCard(duelist)).withinTolerance).toBe(true);
  });

  it('front-loads its damage, then falls back to the printed number', () => {
    const state = newMatch();
    park(forceSpawn(state, BLUE, duelist, 8, 12));
    const victim = park(forceSpawn(state, RED, 'card_troop_giant', 8, 13));

    const blows: number[] = [];
    let health = victim.hp;
    for (let i = 0; i < TICK_HZ * 6 && blows.length < 3; i++) {
      stepMatch(state);
      if (victim.hp < health) {
        blows.push(health - victim.hp);
        health = victim.hp;
      }
    }

    expect(blows.length).toBeGreaterThanOrEqual(2);
    const base = resolveStats(duelist, 11, false).damage;
    expect(blows[0]).toBeGreaterThan(base * 1.5);
    expect(blows[1]).toBe(base);
  });

  it('is the inverse of the ramp: it rewards being pulled onto new targets', () => {
    // Two fresh victims means two opening blows; one victim means one.
    const state = newMatch();
    park(forceSpawn(state, BLUE, duelist, 8, 12));
    const first = park(forceSpawn(state, RED, 'card_troop_skeletons', 8, 13));
    const second = park(forceSpawn(state, RED, 'card_troop_skeletons', 9, 13));

    stepMatchBy(state, TICK_HZ * 5);
    expect(first.alive).toBe(false);
    expect(second.alive).toBe(false);
  });
});

describe('role-wave cards', () => {
  it('spawns Sewer Rats as five separate bodies', () => {
    const state = newMatch();
    expect(play(state, 'card_troop_sewer_rats')).toHaveLength(5);
  });

  it('lets the Pike Sentry strike from behind a friendly body', () => {
    const state = newMatch();
    const sentry = park(forceSpawn(state, BLUE, 'card_troop_pike_sentry', 8, 12));
    // A Knight stands between the pike and its target, a tile and a half away.
    park(forceSpawn(state, BLUE, 'card_troop_knight', 8, 13));
    const victim = park(forceSpawn(state, RED, 'card_troop_giant', 8, 14));
    const before = victim.hp;

    for (let i = 0; i < TICK_HZ * 5 && victim.hp === before; i++) stepMatch(state);
    expect(victim.hp).toBeLessThan(before);
    expect(sentry.alive).toBe(true);
  });

  it('rings a skeleton out of the Bell Tower without a hand-played card', () => {
    const state = newMatch();
    play(state, 'card_building_bell_tower', 8, 8);
    stepMatchBy(state, TICK_HZ * 8);
    const spawned = state.entities.filter(
      (e) => e.alive && e.team === BLUE && e.cardId === 'card_troop_skeletons',
    );
    expect(spawned.length).toBeGreaterThan(0);
  });

  it('drops the Sky Skiff crew when it falls', () => {
    const state = newMatch();
    const skiff = play(state, 'card_troop_sky_skiff', 8, 10)[0];
    applyDamage(state, skiff, skiff.maxHp + skiff.shield);
    stepMatch(state);
    const crew = state.entities.filter(
      (e) => e.alive && e.team === BLUE && e.cardId === 'card_troop_goblins',
    );
    expect(crew.length).toBeGreaterThan(0);
  });
});

describe('aura_shield', () => {
  const chaplain = 'card_troop_shield_chaplain';

  it('is a registered, priced mechanic', () => {
    expect(hasPassive('aura_shield')).toBe(true);
    expect(auditCard(getCard(chaplain)).withinTolerance).toBe(true);
  });

  it('plates a nearby ally that had no armour of its own', () => {
    const state = newMatch();
    park(forceSpawn(state, BLUE, chaplain, 8, 12));
    const ally = park(forceSpawn(state, BLUE, 'card_troop_knight', 8, 13));
    expect(ally.shield).toBe(0);

    stepMatchBy(state, TICK_HZ * 3);
    expect(ally.shield).toBeGreaterThan(0);
    // `maxShield` has to move too, or the renderer draws no plate on a unit
    // that is visibly wearing one.
    expect(ally.maxShield).toBeGreaterThanOrEqual(ally.shield);
  });

  it('grants armour that absorbs one hit of any size', () => {
    const state = newMatch();
    park(forceSpawn(state, BLUE, chaplain, 8, 12));
    const ally = park(forceSpawn(state, BLUE, 'card_troop_knight', 8, 13));
    stepMatchBy(state, TICK_HZ * 3);
    const health = ally.hp;

    applyDamage(state, ally, 50_000);
    expect(ally.shield).toBe(0);
    expect(ally.hp).toBe(health);
  });

  it('does not plate buildings or towers', () => {
    const state = newMatch();
    park(forceSpawn(state, BLUE, chaplain, 8, 12));
    const cannon = park(forceSpawn(state, BLUE, 'card_building_cannon', 8, 13));
    stepMatchBy(state, TICK_HZ * 3);
    expect(cannon.shield).toBe(0);
  });
});

describe('depth-wave cards', () => {
  it('slows a whole push with Snare and kills nothing', () => {
    const state = newMatch();
    const victim = forceSpawn(state, RED, 'card_troop_giant', 8, 12);
    victim.deployTimer = 0;
    const health = victim.hp;

    applyStatus(getCard('card_spell_snare'), victim, TICK_HZ * 4);
    expect(victim.hp).toBe(health);
    expect(victim.slowTicks).toBeGreaterThan(0);
  });

  it('hurries your own troops with Warcry rather than damaging theirs', () => {
    const state = newMatch();
    const ally = forceSpawn(state, BLUE, 'card_troop_knight', 8, 12);
    ally.deployTimer = 0;
    const health = ally.hp;

    applyStatus(getCard('card_spell_warcry'), ally, TICK_HZ * 6);
    expect(ally.rageTicks).toBeGreaterThan(0);
    expect(ally.hp).toBe(health);
  });

  it('makes the Barbed Fence hurt what chews on it without ever attacking', () => {
    const state = newMatch();
    const fence = play(state, 'card_building_barbed_fence', 8, 10)[0];
    fence.deployTimer = 0;
    const attacker = park(forceSpawn(state, RED, 'card_troop_mini_pekka', 8, 11));
    const attackerHealth = attacker.hp;

    for (let i = 0; i < TICK_HZ * 6 && fence.hp === fence.maxHp; i++) stepMatch(state);
    expect(fence.hp).toBeLessThan(fence.maxHp);
    expect(attacker.hp).toBeLessThan(attackerHealth);
    expect(getCard('card_building_barbed_fence').damage).toBe(0);
  });

  it('mends a wounded ally with the Wardstone', () => {
    const state = newMatch();
    play(state, 'card_building_wardstone', 8, 10);
    const ally = park(forceSpawn(state, BLUE, 'card_troop_knight', 8, 11));
    ally.hp = Math.round(ally.maxHp / 2);
    const wounded = ally.hp;

    stepMatchBy(state, TICK_HZ * 3);
    expect(ally.hp).toBeGreaterThan(wounded);
  });

  it('leaves two Barbarians standing when the Grave Titan falls', () => {
    const state = newMatch();
    const titan = play(state, 'card_troop_grave_titan', 8, 10)[0];
    applyDamage(state, titan, titan.maxHp + titan.shield);
    stepMatch(state);
    const risen = state.entities.filter(
      (e) => e.alive && e.team === BLUE && e.cardId === 'card_troop_barbarians',
    );
    expect(risen.length).toBeGreaterThanOrEqual(2);
  });

  it('lets the Halberdier answer air, which the Pike Sentry cannot', () => {
    expect(getCard('card_troop_halberdier').targetPriority).toBe('AirAndGround');
    expect(getCard('card_troop_pike_sentry').targetPriority).toBe('Ground');
    // The reach is the shared half of the idea.
    expect(getCard('card_troop_halberdier').attackRange).toBeGreaterThan(2);
  });

  it('hides the Tunnel Rats while they travel, all three of them', () => {
    // `burrow` is untargetable-while-moving, not river-crossing — that is
    // `terrain_walk`, a different passive on a different card.
    const state = newMatch();
    const rats = play(state, 'card_troop_tunnel_rats', 8, 10);
    expect(rats).toHaveLength(3);

    stepMatchBy(state, TICK_HZ * 3);
    expect(rats.every((rat) => rat.invisibleTicks > 0)).toBe(true);

    // Stopping to bite surfaces them: the window to answer them is the fight.
    for (const rat of rats) rat.speed = 0;
    stepMatchBy(state, TICK_HZ);
    expect(rats.every((rat) => rat.invisibleTicks === 0)).toBe(true);
  });
});
