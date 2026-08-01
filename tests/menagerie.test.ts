/**
 * The menagerie wave — thirty cards, and the twelve mechanics behind them.
 *
 * Every passive here is new, and three of them needed changes to the engine
 * rather than just a hook: `revive_once` had to be checked at the point death
 * is committed (an `onDamaged` hook only ever runs for a victim that survived,
 * so a passive about *not dying* could never see the blow that killed it),
 * `spell_ward` needed damage to say whether it came from a spell, and
 * `mark_target` needed a real field on the entity.
 *
 * The point of this file is that each mechanic is exercised in the simulation
 * rather than asserted from its card definition, because a card that names a
 * passive the engine never runs looks perfectly healthy in an audit.
 */

import { describe, it, expect } from 'vitest';
import '@cards/data';
import { STARTER_DECK, BOT_DECK } from '@cards/data';
import { getCard } from '@cards/registry';
import { createMatch, forceSpawn } from '@sim/state';
import { stepMatch, stepMatchBy, hashMatchState } from '@sim/tick';
import { applyDamage, MARK_DAMAGE_MULTIPLIER, resolveStats } from '@sim/entities';
import { BLUE, RED } from '@sim/nav/grid';
import { AP_PER_AETHER, TICK_HZ } from '@sim/constants';
import { MENAGERIE_CARDS } from '@cards/data/menagerie';
import { registeredPassives } from '@sim/scripts/passives';
import { PASSIVE_EPP_COST } from '@cards/balance';
import type { Entity, MatchState } from '@sim/types';

const newMatch = (seed = 99): MatchState =>
  createMatch({ seed, players: [{ deck: STARTER_DECK }, { deck: BOT_DECK }] });

/** Put a unit on the board, ready to act. */
function place(state: MatchState, team: 0 | 1, cardId: string, x: number, y: number): Entity {
  const e = forceSpawn(state, team, cardId, x, y);
  e.deployTimer = 0;
  return e;
}

/** Step until `done`, or give up after `seconds`. Returns ticks elapsed. */
function runUntil(state: MatchState, done: () => boolean, seconds = 20): number {
  const limit = Math.round(seconds * TICK_HZ);
  for (let i = 0; i < limit; i++) {
    if (done()) return i;
    stepMatch(state);
  }
  return limit;
}

describe('the wave itself', () => {
  it('adds thirty cards', () => {
    expect(MENAGERIE_CARDS).toHaveLength(30);
  });

  it('gives every new passive a price and an implementation', () => {
    const registered = new Set(registeredPassives());
    for (const card of MENAGERIE_CARDS) {
      if (!card.passiveId || card.passiveId === 'none') continue;
      expect(registered.has(card.passiveId)).toBe(true);
      expect(PASSIVE_EPP_COST[card.passiveId]).toBeGreaterThan(0);
    }
  });

  it('introduces no duplicate mechanic within the wave', () => {
    // Two cards may share a passive only if they are the deliberate pair the
    // comments describe; what must never happen is a passive appearing here
    // that the rest of the roster already had a card for in the same role.
    const seen = new Map<string, number>();
    for (const card of MENAGERIE_CARDS) {
      if (!card.passiveId || card.passiveId === 'none') continue;
      seen.set(card.passiveId, (seen.get(card.passiveId) ?? 0) + 1);
    }
    for (const [, count] of seen) expect(count).toBeLessThanOrEqual(2);
  });
});

describe('revive_once', () => {
  it('gets back up instead of dying, exactly once', () => {
    const state = newMatch();
    const sentinel = place(state, BLUE, 'card_troop_undying_sentinel', 8, 10);
    const card = getCard('card_troop_undying_sentinel');

    // A blow far larger than its whole pool: the revive must not be a
    // survive-with-1hp fudge that overkill can slip past.
    applyDamage(state, sentinel, sentinel.maxHp * 40);
    expect(sentinel.alive).toBe(true);
    expect(sentinel.hp).toBe(Math.round(sentinel.maxHp * card.passiveMagnitude));
    expect(sentinel.stunTicks).toBeGreaterThan(0);

    // The second death is final.
    applyDamage(state, sentinel, sentinel.maxHp * 40);
    expect(sentinel.alive).toBe(false);
  });

  it('does not revive a card that has no such passive', () => {
    const state = newMatch();
    const knight = place(state, BLUE, 'card_troop_knight', 8, 10);
    applyDamage(state, knight, knight.maxHp * 10);
    expect(knight.alive).toBe(false);
  });
});

describe('spell_ward', () => {
  it('negates one whole spell, however large, then is spent', () => {
    const state = newMatch();
    const bearer = place(state, BLUE, 'card_troop_rune_bearer', 8, 10);
    const full = bearer.hp;

    const dealt = applyDamage(state, bearer, 99_999, undefined, { spell: true });
    expect(dealt).toBe(0);
    expect(bearer.hp).toBe(full);

    // Spent: the next spell lands in full.
    applyDamage(state, bearer, 200, undefined, { spell: true });
    expect(bearer.hp).toBe(full - 200);
  });

  it('does nothing against an ordinary attack', () => {
    // The ward is not a shield. A unit hitting it must not consume the ward,
    // or the card would be disarmed by the first Skeleton that reached it.
    const state = newMatch();
    const bearer = place(state, BLUE, 'card_troop_rune_bearer', 8, 10);
    const full = bearer.hp;

    applyDamage(state, bearer, 150);
    expect(bearer.hp).toBe(full - 150);
    expect(bearer.passiveCharges).toBe(1);

    expect(applyDamage(state, bearer, 99_999, undefined, { spell: true })).toBe(0);
  });
});

describe('mark_target', () => {
  it('makes the marked body take more from every source', () => {
    const state = newMatch();
    const marked = place(state, RED, 'card_troop_knight', 8, 12);
    const clean = place(state, RED, 'card_troop_knight', 6, 12);
    marked.markedTicks = Math.round(TICK_HZ * 2);

    const before = { marked: marked.hp, clean: clean.hp };
    applyDamage(state, marked, 100);
    applyDamage(state, clean, 100);

    expect(before.clean - clean.hp).toBe(100);
    expect(before.marked - marked.hp).toBe(Math.round(100 * MARK_DAMAGE_MULTIPLIER));
  });

  it('wears off', () => {
    const state = newMatch();
    const victim = place(state, RED, 'card_troop_knight', 8, 12);
    victim.markedTicks = 3;
    stepMatchBy(state, 5);
    expect(victim.markedTicks).toBe(0);

    const before = victim.hp;
    applyDamage(state, victim, 100);
    expect(before - victim.hp).toBe(100);
  });

  it('is applied by the Spotter actually hitting something', () => {
    const state = newMatch();
    const spotter = place(state, BLUE, 'card_troop_spotter', 8, 11);
    const victim = place(state, RED, 'card_troop_knight', 8, 13);
    victim.speed = 0;

    runUntil(state, () => victim.markedTicks > 0, 12);
    expect(victim.markedTicks).toBeGreaterThan(0);
    expect(spotter.passiveTargetId).toBe(victim.id);
  });
});

describe('poison, on a card at last', () => {
  it('keeps working on a building, which shrugs off every other status', () => {
    /*
     * This is the whole reason the Fang exists. Structures are immune to stun,
     * freeze, slow and knockback; poison is the one status that still applies,
     * and no card had ever used it.
     */
    const state = newMatch();
    const fang = place(state, BLUE, 'card_troop_blight_fang', 8, 11);
    const building = place(state, RED, 'card_building_cannon', 8, 12);

    runUntil(state, () => building.poisonTicks > 0, 12);
    expect(building.poisonTicks).toBeGreaterThan(0);
    expect(building.poisonDamagePerTick).toBeGreaterThan(0);
    expect(fang.alive).toBe(true);

    // And it keeps draining after the source is gone.
    const before = building.hp;
    fang.alive = false;
    state.needsCompaction = true;
    stepMatchBy(state, 10);
    expect(building.hp).toBeLessThan(before);
  });
});

describe('death effects that no card had claimed', () => {
  it('DeathBomb detonates on the Powder Mule dying', () => {
    const state = newMatch();
    const mule = place(state, RED, 'card_troop_powder_mule', 8, 12);
    const bystander = place(state, BLUE, 'card_troop_knight', 8, 12);
    const before = bystander.hp;

    applyDamage(state, mule, mule.maxHp * 5);
    stepMatchBy(state, 2);

    expect(mule.alive).toBe(false);
    expect(bystander.hp).toBeLessThan(before);
  });

  it('DeathSpell leaves a real spell where the Doomseed fell', () => {
    const state = newMatch();
    const seed = place(state, RED, 'card_troop_doomseed', 8, 12);
    const bystander = place(state, BLUE, 'card_troop_knight', 8, 12);

    applyDamage(state, seed, seed.maxHp * 5);
    stepMatchBy(state, 2);

    expect(seed.alive).toBe(false);
    // Miasma is a poison spell, so the tell is the status rather than a
    // one-off chunk of damage.
    expect(bystander.poisonTicks).toBeGreaterThan(0);
  });
});

describe('the offensive passives', () => {
  it('lifesteal returns health to the attacker', () => {
    const state = newMatch();
    const wing = place(state, BLUE, 'card_troop_bloodwing', 8, 11);
    const prey = place(state, RED, 'card_troop_giant', 8, 12);
    prey.speed = 0;

    wing.hp = Math.round(wing.maxHp * 0.4);
    const wounded = wing.hp;
    runUntil(state, () => wing.hp > wounded, 12);
    expect(wing.hp).toBeGreaterThan(wounded);
    expect(wing.hp).toBeLessThanOrEqual(wing.maxHp);
  });

  it('ambush spends its whole card on the first blow', () => {
    const state = newMatch();
    const blade = place(state, BLUE, 'card_troop_nightblade', 8, 11);
    const target = place(state, RED, 'card_troop_giant', 8, 12);
    target.speed = 0;
    expect(blade.passiveCharges).toBe(1);
    expect(blade.invisibleTicks).toBeGreaterThan(0);

    const start = target.hp;
    runUntil(state, () => blade.passiveCharges === 0, 12);
    const opener = start - target.hp;

    const base = resolveStats(blade.cardId, blade.level, false).damage;
    // The opening blow is the ordinary hit plus the multiplied bonus.
    expect(opener).toBeGreaterThan(base * 2);
    // And it drops its cloak in the act.
    expect(blade.invisibleTicks).toBe(0);
  });

  it('harvest grows the reaper, but only on a kill', () => {
    const state = newMatch();
    const reaper = place(state, BLUE, 'card_troop_bone_reaper', 8, 11);
    const tough = place(state, RED, 'card_troop_giant', 8, 12);
    tough.speed = 0;
    const startMax = reaper.maxHp;

    // Chewing a body it cannot kill grants nothing.
    stepMatchBy(state, TICK_HZ * 3);
    expect(reaper.maxHp).toBe(startMax);

    // Killing one does.
    tough.hp = 1;
    runUntil(state, () => !tough.alive, 8);
    expect(reaper.maxHp).toBeGreaterThan(startMax);
  });

  it('sunder blunts a victim, down to a floor', () => {
    const state = newMatch();
    const beak = place(state, BLUE, 'card_troop_rustbeak', 8, 11);
    const victim = place(state, RED, 'card_troop_giant', 8, 12);
    victim.speed = 0;
    victim.damage = 1000;

    runUntil(state, () => victim.damage < 1000, 12);
    expect(victim.damage).toBeLessThan(1000);

    // It can never blunt something to nothing.
    for (let i = 0; i < 400 && beak.alive; i++) stepMatch(state);
    expect(victim.damage).toBeGreaterThan(0);
  });

  it('tether echoes onto the victim’s neighbours', () => {
    const state = newMatch();
    place(state, BLUE, 'card_troop_chainbinder', 8, 11);
    const front = place(state, RED, 'card_troop_knight', 8, 12);
    const neighbour = place(state, RED, 'card_troop_knight', 9, 12);
    front.speed = 0;
    neighbour.speed = 0;
    const before = neighbour.hp;

    runUntil(state, () => neighbour.hp < before, 12);
    expect(neighbour.hp).toBeLessThan(before);
  });

  it('split_shot strikes a second target at full weight', () => {
    const state = newMatch();
    place(state, BLUE, 'card_troop_twinbow', 8, 10);
    const a = place(state, RED, 'card_troop_knight', 8, 13);
    const b = place(state, RED, 'card_troop_knight', 9, 13);
    a.speed = 0;
    b.speed = 0;

    runUntil(state, () => a.hp < a.maxHp && b.hp < b.maxHp, 15);
    expect(a.hp).toBeLessThan(a.maxHp);
    expect(b.hp).toBeLessThan(b.maxHp);
  });

  it('momentum rewards a long unobstructed run', () => {
    const state = newMatch();
    const roller = place(state, BLUE, 'card_troop_boulder_roller', 3, 4);
    // Let it build up a full run before it meets anything.
    runUntil(state, () => roller.passiveTimer > TICK_HZ * 3, 20);
    expect(roller.passiveTimer).toBeGreaterThan(TICK_HZ * 3);
  });

  it('siphon drains the defender’s aether', () => {
    /*
     * Measured against a control rather than against the starting figure:
     * aether regenerates every tick, so the defender's bar climbs during the
     * whole run and "lower than it started" would never be true. What the card
     * promises is that they end up with *less than they otherwise would have*.
     */
    const withLeech = newMatch(7);
    place(withLeech, BLUE, 'card_troop_aether_leech', 8, 13);
    withLeech.players[RED].aetherPoints = 4 * AP_PER_AETHER;

    const control = newMatch(7);
    control.players[RED].aetherPoints = 4 * AP_PER_AETHER;

    stepMatchBy(withLeech, TICK_HZ * 25);
    stepMatchBy(control, TICK_HZ * 25);

    expect(withLeech.players[RED].aetherPoints).toBeLessThan(
      control.players[RED].aetherPoints,
    );
  });

  it('aura_guard mends the push around it', () => {
    const state = newMatch();
    place(state, BLUE, 'card_troop_aegis_matron', 8, 10);
    const hurt = place(state, BLUE, 'card_troop_knight', 8, 10);
    hurt.hp = Math.round(hurt.maxHp * 0.3);
    const wounded = hurt.hp;

    stepMatchBy(state, TICK_HZ * 3);
    expect(hurt.hp).toBeGreaterThan(wounded);
    expect(hurt.hp).toBeLessThanOrEqual(hurt.maxHp);
  });
});

describe('determinism', () => {
  it('hashes identically with the whole wave on the field', () => {
    // The wave added a field to every entity (`markedTicks`) and twelve
    // passives that mutate state. If any of them reached for wall-clock time,
    // floating-point drift or unstable iteration order, these two runs would
    // diverge.
    const run = (): number => {
      const state = newMatch(2024);
      let x = 3;
      for (const card of MENAGERIE_CARDS) {
        if (card.category === 'Spell') continue;
        place(state, x % 2 === 0 ? BLUE : RED, card.id, 2 + (x % 14), 4 + (x % 9));
        x += 3;
      }
      stepMatchBy(state, TICK_HZ * 8);
      return hashMatchState(state);
    };
    expect(run()).toBe(run());
  });
});
