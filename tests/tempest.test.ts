/**
 * The tempest wave — twenty-four cards, and the twelve mechanics behind them.
 *
 * Same rule as the menagerie tests: every mechanic is driven through the real
 * simulation rather than asserted from its card definition, because a card
 * naming a passive the engine never runs looks perfectly healthy in an audit.
 *
 * This wave is mostly about position, which makes the assertions unusually
 * concrete — a pull is a measurable change in distance, a leap is a jump in
 * coordinates, a taunt is a target id. That is a happy accident of the theme
 * and worth using: these tests can check what the mechanic *did*, not just
 * that a number moved.
 */

import { describe, it, expect } from 'vitest';
import '@cards/data';
import { STARTER_DECK, BOT_DECK } from '@cards/data';
import { createMatch, forceSpawn } from '@sim/state';
import { stepMatch, stepMatchBy, hashMatchState } from '@sim/tick';
import { applyDamage, resolveStats } from '@sim/entities';
import { AP_PER_AETHER, TICK_HZ } from '@sim/constants';
import { TEMPEST_CARDS } from '@cards/data/tempest';
import { registeredPassives } from '@sim/scripts/passives';
import { PASSIVE_EPP_COST } from '@cards/balance';
import { fxToFloat } from '@sim/math/fixed';
import type { Entity, MatchState } from '@sim/types';

const newMatch = (seed = 4242): MatchState =>
  createMatch({ seed, players: [{ deck: STARTER_DECK }, { deck: BOT_DECK }] });

function place(state: MatchState, team: 0 | 1, cardId: string, x: number, y: number): Entity {
  const e = forceSpawn(state, team, cardId, x, y);
  e.deployTimer = 0;
  return e;
}

/** Straight-line distance between two entities, in tiles. */
function gap(a: Entity, b: Entity): number {
  return Math.hypot(fxToFloat(a.x - b.x), fxToFloat(a.y - b.y));
}

/** Kill an entity through the real damage path, so death hooks run. */
function slay(state: MatchState, victim: Entity): void {
  applyDamage(state, victim, victim.hp + victim.shield + 1000);
  stepMatch(state);
}

describe('the wave itself', () => {
  it('adds twenty-four cards', () => {
    expect(TEMPEST_CARDS).toHaveLength(24);
  });

  it('gives every new mechanic a price and an implementation', () => {
    const registered = new Set(registeredPassives());
    for (const card of TEMPEST_CARDS) {
      if (!card.passiveId || card.passiveId === 'none') continue;
      expect(registered.has(card.passiveId), card.name).toBe(true);
      expect(PASSIVE_EPP_COST[card.passiveId], card.name).toBeDefined();
      expect(PASSIVE_EPP_COST[card.passiveId], card.name).not.toBe(0);
    }
  });

  it('pairs every mechanic with two cards that are not the same card twice', () => {
    // The brief for the wave was contrast, not a big version and a small
    // version. Two cards sharing a mechanic must differ in what they *are*.
    const byPassive = new Map<string, typeof TEMPEST_CARDS>();
    for (const card of TEMPEST_CARDS) {
      const list = byPassive.get(card.passiveId) ?? [];
      list.push(card);
      byPassive.set(card.passiveId, list);
    }
    for (const [passive, cards] of byPassive) {
      expect(cards.length, passive).toBe(2);
      const [a, b] = cards;
      const differs =
        a.category !== b.category ||
        a.isFlying !== b.isFlying ||
        a.targetPriority !== b.targetPriority ||
        Math.abs(a.attackRange - b.attackRange) > 1.5 ||
        Math.abs(a.aetherCost - b.aetherCost) >= 2;
      expect(differs, `${a.name} and ${b.name} are the same card`).toBe(true);
    }
  });
});

describe('pull', () => {
  it('Maelstrom Djinn drags a ground enemy toward it', () => {
    const state = newMatch();
    const djinn = place(state, 0, 'card_troop_maelstrom_djinn', 8, 14);
    const victim = place(state, 1, 'card_troop_knight', 8, 17);
    // Frozen, so the only thing that can change the distance is the pull.
    victim.freezeTicks = 200;
    const before = gap(djinn, victim);
    stepMatchBy(state, 40);
    expect(gap(djinn, victim)).toBeLessThan(before);
  });

  it('does not pull buildings or towers, which have no business moving', () => {
    const state = newMatch();
    place(state, 0, 'card_troop_maelstrom_djinn', 8, 14);
    const tower = place(state, 1, 'card_building_cannon', 8, 16);
    const at = { x: tower.x, y: tower.y };
    stepMatchBy(state, 40);
    expect(tower.x).toBe(at.x);
    expect(tower.y).toBe(at.y);
  });

  it('Harpooner hauls what it hits and stuns it on arrival', () => {
    const state = newMatch();
    const harpooner = place(state, 0, 'card_troop_harpooner', 8, 13);
    const victim = place(state, 1, 'card_troop_knight', 8, 17);
    const before = gap(harpooner, victim);

    // Run until the hook lands, which the stun makes observable.
    let stunned = false;
    for (let i = 0; i < TICK_HZ * 8 && !stunned; i++) {
      stepMatch(state);
      if (victim.stunTicks > 0) stunned = true;
    }
    expect(stunned).toBe(true);
    expect(gap(harpooner, victim)).toBeLessThan(before);
  });
});

describe('leap', () => {
  it('Pounce Stalker jumps to a distant enemy rather than walking to it', () => {
    const state = newMatch();
    const stalker = place(state, 0, 'card_troop_pounce_stalker', 8, 8);
    const near = place(state, 1, 'card_troop_knight', 8, 9.4);
    const far = place(state, 1, 'card_troop_archers', 8, 12.5);
    const startY = fxToFloat(stalker.y);

    // One tick is enough: the leap is a teleport, so it cannot be confused
    // with the unit having walked there.
    stepMatch(state);
    const moved = fxToFloat(stalker.y) - startY;
    expect(moved).toBeGreaterThan(2);
    expect(near.alive).toBe(true);
    expect(far.hp).toBeLessThan(far.maxHp);
  });

  it('waits out its cooldown before leaping again', () => {
    const state = newMatch();
    const stalker = place(state, 0, 'card_troop_pounce_stalker', 8, 8);
    place(state, 1, 'card_troop_archers', 8, 12.5);
    stepMatch(state);
    const landed = fxToFloat(stalker.y);

    // A second target further on, which it must not immediately vault to.
    place(state, 1, 'card_troop_archers', 8, 14);
    stepMatchBy(state, 10);
    expect(fxToFloat(stalker.y) - landed).toBeLessThan(2);
  });

  it('will not vault the river, which it has not paid for', () => {
    /*
     * The leap exists to skip the line a defence puts up, not the map. At five
     * and a half tiles a leaper standing at the bank could clear the water
     * without using a bridge, which is `terrain_walk` — a different mechanic
     * with its own price.
     */
    const state = newMatch();
    const stalker = place(state, 0, 'card_troop_pounce_stalker', 8, 13.5);
    place(state, 1, 'card_troop_archers', 8, 17.5);
    const before = fxToFloat(stalker.y);
    stepMatch(state);
    expect(fxToFloat(stalker.y) - before).toBeLessThan(1);
  });
});

describe('wreckage', () => {
  it('Bombard Cart leaves a working turret where it died', () => {
    const state = newMatch();
    const cart = place(state, 0, 'card_troop_bombard_cart', 8, 12);
    const before = state.entities.filter((e) => e.alive && e.team === 0).length;
    slay(state, cart);

    const ours = state.entities.filter((e) => e.alive && e.team === 0);
    expect(ours.length).toBe(before);
    const wreck = ours.find((e) => e.cardId === 'card_building_cannon');
    expect(wreck).toBeDefined();
    expect(wreck?.hp).toBeGreaterThan(0);
  });

  it('scales the wreck down rather than handing over a full second card', () => {
    const state = newMatch();
    const cart = place(state, 0, 'card_troop_bombard_cart', 8, 12);
    // Read the full-strength figure at the cart's own level: the wreck
    // inherits it, and comparing against level one would pass for the wrong
    // reason as soon as anything scaled.
    const full = resolveStats('card_building_cannon', cart.level, false).hp;
    slay(state, cart);
    const wreck = state.entities.find(
      (e) => e.alive && e.team === 0 && e.cardId === 'card_building_cannon',
    );
    expect(wreck?.maxHp).toBeLessThan(full);
  });
});

describe('unstable core', () => {
  it('Aether Golem hands the opponent aether when it dies', () => {
    const state = newMatch();
    const golem = place(state, 0, 'card_troop_aether_golem', 8, 12);
    const before = state.players[1].aetherPoints;
    slay(state, golem);
    expect(state.players[1].aetherPoints).toBeGreaterThan(before);
  });

  it('refunds less than the card cost, so the drawback is a real one', () => {
    const state = newMatch();
    const golem = place(state, 0, 'card_troop_aether_golem', 8, 12);
    const card = TEMPEST_CARDS.find((c) => c.id === 'card_troop_aether_golem');
    const before = state.players[1].aetherPoints;
    slay(state, golem);
    const refunded = state.players[1].aetherPoints - before;
    expect(refunded).toBeGreaterThan(0);
    expect(refunded).toBeLessThan((card?.aetherCost ?? 0) * AP_PER_AETHER);
  });

  it('gives nothing to its own side', () => {
    const state = newMatch();
    const golem = place(state, 0, 'card_troop_aether_golem', 8, 12);
    const before = state.players[0].aetherPoints;
    slay(state, golem);
    // Aether regenerates, so this checks it did not jump by the gift amount.
    expect(state.players[0].aetherPoints - before).toBeLessThan(100);
  });
});

describe('deflect', () => {
  it('Warden Monk refuses a shot and returns it', () => {
    const state = newMatch();
    const monk = place(state, 0, 'card_troop_warden_monk', 8, 12);
    const shooter = place(state, 1, 'card_troop_archers', 8, 12);
    monk.hp = monk.maxHp - 500;
    const monkBefore = monk.hp;
    const shooterBefore = shooter.hp;

    applyDamage(state, monk, 200, shooter);
    expect(monk.hp).toBe(monkBefore);
    expect(shooter.hp).toBeLessThan(shooterBefore);
  });

  it('only refuses one shot per window', () => {
    const state = newMatch();
    const monk = place(state, 0, 'card_troop_warden_monk', 8, 12);
    const shooter = place(state, 1, 'card_troop_archers', 8, 12);
    monk.hp = monk.maxHp - 500;

    applyDamage(state, monk, 200, shooter);
    const afterFirst = monk.hp;
    applyDamage(state, monk, 200, shooter);
    expect(monk.hp).toBeLessThan(afterFirst);
  });

  it('does not refuse a melee blow', () => {
    const state = newMatch();
    const monk = place(state, 0, 'card_troop_warden_monk', 8, 12);
    const brawler = place(state, 1, 'card_troop_knight', 8, 12);
    const before = monk.hp;
    applyDamage(state, monk, 200, brawler);
    expect(monk.hp).toBeLessThan(before);
  });
});

describe('provoke', () => {
  it('Iron Provocateur pulls an enemy off its objective and onto itself', () => {
    const state = newMatch();
    const enemy = place(state, 1, 'card_troop_knight', 8, 14);
    const taunter = place(state, 0, 'card_troop_iron_provocateur', 9, 14);
    stepMatchBy(state, 20);
    expect(enemy.targetId).toBe(taunter.id);
    expect(enemy.tauntSourceId).toBe(taunter.id);
  });

  it('cannot make a building-only card attack a troop', () => {
    /*
     * A Giant does not swing at units, and a taunt must not be a way around
     * that — otherwise the card is a hard counter to every win condition in
     * the game rather than a way to choose where a fight happens. Targeting
     * re-checks the priority and drops a taunt it cannot honour.
     */
    const state = newMatch();
    const giant = place(state, 1, 'card_troop_giant', 8, 14);
    const taunter = place(state, 0, 'card_troop_iron_provocateur', 9, 14);
    stepMatchBy(state, 20);
    expect(giant.targetId).not.toBe(taunter.id);
  });

  it('leaves a provoked enemy able to attack', () => {
    /*
     * The mechanic reassigns the target twice a second. Doing that
     * unconditionally also reset the first-attack delay, so nothing inside the
     * radius ever finished a swing — the taunter was not tanking the push, it
     * was immune to it, and it won every fight in the fairness panel.
     */
    const state = newMatch();
    place(state, 1, 'card_troop_knight', 8, 14);
    const taunter = place(state, 0, 'card_troop_iron_provocateur', 8, 14.6);
    const before = taunter.hp;
    stepMatchBy(state, Math.round(TICK_HZ * 6));
    expect(taunter.hp).toBeLessThan(before);
  });
});

describe('disarm', () => {
  it('Manacle Warden stops its victim swinging', () => {
    const state = newMatch();
    place(state, 0, 'card_troop_manacle_warden', 8, 14);
    const victim = place(state, 1, 'card_troop_knight', 8, 14.6);

    // Run until the warden lands a blow, then check the victim is barred.
    let barred = 0;
    for (let i = 0; i < TICK_HZ * 6; i++) {
      stepMatch(state);
      barred = Math.max(barred, victim.attackCooldown);
    }
    expect(barred).toBeGreaterThan(Math.round(TICK_HZ * 0.8));
  });

  it('does not disarm a tower, which would be a free lane', () => {
    const state = newMatch();
    const warden = place(state, 0, 'card_troop_manacle_warden', 8, 12);
    const tower = state.entities.find((e) => e.kind === 'tower' && e.team === 1);
    expect(tower).toBeDefined();
    const before = tower?.attackCooldown ?? 0;
    // Hit the tower directly through the passive's own hook path.
    applyDamage(state, tower as Entity, 10, warden);
    expect(tower?.attackCooldown).toBe(before);
  });
});

describe('rally', () => {
  it('Drum Major makes a nearby ally swing faster than it would alone', () => {
    const measure = (withDrum: boolean): number => {
      const state = newMatch();
      const ally = place(state, 0, 'card_troop_knight', 8, 14);
      place(state, 1, 'card_troop_giant', 8, 14.6);
      if (withDrum) place(state, 0, 'card_troop_drum_major', 8.5, 14);
      const victim = state.entities.find((e) => e.team === 1 && e.cardId === 'card_troop_giant');
      void ally;
      stepMatchBy(state, Math.round(TICK_HZ * 8));
      return (victim?.maxHp ?? 0) - (victim?.hp ?? 0);
    };
    // The drum also attacks, so this compares the damage the *giant* took —
    // which is why the drum is placed off to the side and out of its reach.
    expect(measure(true)).toBeGreaterThan(measure(false));
  });
});

describe('mire', () => {
  it('Bog Crawler slows what walks near it', () => {
    const state = newMatch();
    place(state, 0, 'card_troop_bog_crawler', 8, 14);
    const victim = place(state, 1, 'card_troop_knight', 8, 16);
    stepMatchBy(state, 20);
    expect(victim.slowTicks).toBeGreaterThan(0);
  });

  it('leaves fliers alone, which is the counterplay', () => {
    const state = newMatch();
    place(state, 0, 'card_troop_bog_crawler', 8, 14);
    const flier = place(state, 1, 'card_troop_minions', 8, 15.5);
    stepMatchBy(state, 20);
    expect(flier.slowTicks).toBe(0);
  });
});

describe('overcharge', () => {
  it('Storm Anvil hits harder after waiting than after a busy fight', () => {
    const state = newMatch();
    const anvil = place(state, 0, 'card_troop_storm_anvil', 8, 12);
    // Nothing to hit for four seconds, so the bank fills.
    stepMatchBy(state, Math.round(TICK_HZ * 4));
    expect(anvil.passiveCharges).toBeGreaterThan(Math.round(TICK_HZ * 2));

    const victim = place(state, 1, 'card_troop_giant', 8, 12.7);
    const banked = anvil.passiveCharges;
    for (let i = 0; i < TICK_HZ * 8 && anvil.passiveCharges >= banked; i++) stepMatch(state);
    // The bank is spent on the blow, not carried.
    expect(anvil.passiveCharges).toBeLessThan(banked);
    expect(victim.hp).toBeLessThan(victim.maxHp);
  });
});

describe('blood pact', () => {
  it('Vitalist heals its neighbours when it dies', () => {
    const state = newMatch();
    const vitalist = place(state, 0, 'card_troop_vitalist', 8, 12);
    const ally = place(state, 0, 'card_troop_knight', 8.5, 12);
    ally.hp = Math.round(ally.maxHp * 0.4);
    const before = ally.hp;
    slay(state, vitalist);
    expect(ally.hp).toBeGreaterThan(before);
  });

  it('never heals past full', () => {
    const state = newMatch();
    const vitalist = place(state, 0, 'card_troop_vitalist', 8, 12);
    const ally = place(state, 0, 'card_troop_knight', 8.5, 12);
    slay(state, vitalist);
    expect(ally.hp).toBe(ally.maxHp);
  });

  it('gives nothing to the other side', () => {
    const state = newMatch();
    const vitalist = place(state, 0, 'card_troop_vitalist', 8, 12);
    const enemy = place(state, 1, 'card_troop_knight', 8.5, 12);
    enemy.hp = Math.round(enemy.maxHp * 0.4);
    const before = enemy.hp;
    slay(state, vitalist);
    expect(enemy.hp).toBeLessThanOrEqual(before);
  });
});

describe('determinism', () => {
  it('stays identical with the whole wave on the field', () => {
    const run = (): number => {
      const state = newMatch(7);
      let team: 0 | 1 = 0;
      let y = 8;
      for (const card of TEMPEST_CARDS) {
        if (card.category === 'Spell') continue;
        const unit = forceSpawn(state, team, card.id, team === 0 ? 6 : 11, y);
        unit.deployTimer = 0;
        team = team === 0 ? 1 : 0;
        y += 0.7;
        if (y > 24) y = 8;
      }
      stepMatchBy(state, 240);
      return hashMatchState(state);
    };
    expect(run()).toBe(run());
  });
});
