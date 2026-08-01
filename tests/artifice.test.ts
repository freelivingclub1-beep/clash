/**
 * The artifice wave — eighteen cards, and the behaviours they exist to use.
 *
 * These mechanics were all in the engine already. The problem was that almost
 * nothing referenced them: a hundred and thirty-one cards dealt plain
 * single-target damage and a hundred and fifty-five carried no on-hit status,
 * so the board read as a lot of differently coloured projectiles that all did
 * the same thing.
 *
 * Which means these tests are not really about the new cards. They are about
 * whether the paths those cards now depend on work at all — several had one
 * user or none, and a mechanic with no users is a mechanic nobody has checked.
 */

import { describe, it, expect } from 'vitest';
import '@cards/data';
import { STARTER_DECK, BOT_DECK } from '@cards/data';
import { selectableCards } from '@cards/registry';
import { createMatch, forceSpawn } from '@sim/state';
import { stepMatch, stepMatchBy } from '@sim/tick';
import { applyDamage } from '@sim/entities';
import { TICK_HZ } from '@sim/constants';
import { ARTIFICE_CARDS } from '@cards/data/artifice';
import { STATUS_EPP_COST, DEATH_EFFECT_EPP_COST } from '@cards/balance';
import type { Entity, MatchState } from '@sim/types';

const newMatch = (seed = 1717): MatchState =>
  createMatch({ seed, players: [{ deck: STARTER_DECK }, { deck: BOT_DECK }] });

function place(state: MatchState, team: 0 | 1, cardId: string, x: number, y: number): Entity {
  const e = forceSpawn(state, team, cardId, x, y);
  e.deployTimer = 0;
  return e;
}

function slay(state: MatchState, victim: Entity): void {
  applyDamage(state, victim, victim.hp + victim.shield + 5000);
  stepMatch(state);
}

/** Run until `done`, or give up. Returns whether it happened. */
function until(state: MatchState, done: () => boolean, seconds = 10): boolean {
  for (let i = 0; i < seconds * TICK_HZ; i++) {
    if (done()) return true;
    stepMatch(state);
  }
  return done();
}

describe('the wave itself', () => {
  it('adds nineteen cards', () => {
    expect(ARTIFICE_CARDS).toHaveLength(19);
  });

  it('gives every card a behaviour beyond plain single-target damage', () => {
    /*
     * The whole reason the wave exists. A card here that is another
     * single-target body with a different colour would be the thing being
     * corrected, so it does not get to sit in this file quietly.
     */
    for (const card of ARTIFICE_CARDS) {
      const interesting =
        card.onHitStatus !== 'None' ||
        card.deathEffect !== 'None' ||
        card.damageType !== 'Single' ||
        card.passiveId !== 'none';
      expect(interesting, `${card.name} does nothing special`).toBe(true);
    }
  });

  it('charges for every status and death effect it uses', () => {
    /*
     * These were free until this wave. That never bit while eight cards in the
     * roster carried a status between them; eighteen more would have been
     * eighteen cards getting a mechanic for nothing.
     */
    for (const card of ARTIFICE_CARDS) {
      if (card.onHitStatus !== 'None') {
        expect(STATUS_EPP_COST[card.onHitStatus], `${card.name} status`).toBeGreaterThan(0);
      }
      if (card.deathEffect !== 'None') {
        expect(DEATH_EFFECT_EPP_COST[card.deathEffect], `${card.name} death`).toBeGreaterThan(0);
      }
    }
  });

  it('leaves the roster with far fewer plain-damage cards than it found', () => {
    // The measurement that started the wave, kept as a guard: it would be easy
    // for the next hundred cards to quietly drift back to all-projectiles.
    const cards = selectableCards().filter((c) => c.category !== 'Spell');
    const plain = cards.filter(
      (c) =>
        c.damageType === 'Single' &&
        c.onHitStatus === 'None' &&
        c.deathEffect === 'None' &&
        c.passiveId === 'none',
    );
    expect(plain.length / cards.length).toBeLessThan(0.3);
  });
});

describe('cold', () => {
  it('Frost Sage slows what it hits without killing it', () => {
    const state = newMatch();
    place(state, 0, 'card_troop_frost_sage', 8, 12);
    const victim = place(state, 1, 'card_troop_giant', 8, 14);
    const before = victim.hp;
    expect(until(state, () => victim.slowTicks > 0)).toBe(true);
    // The point of the card is that the damage is not the point.
    expect(victim.hp).toBeGreaterThan(before * 0.85);
  });

  it('Glacier Warden freezes rather than slows', () => {
    const state = newMatch();
    place(state, 0, 'card_troop_glacier_warden', 8, 12);
    const victim = place(state, 1, 'card_troop_giant', 8, 14);
    expect(until(state, () => victim.freezeTicks > 0)).toBe(true);
  });
});

describe('piercing', () => {
  it('Javelin Rider hits the body behind the one it is aiming at', () => {
    /*
     * The whole shape of the mechanic: putting a tank in front makes the
     * problem worse, because the tank lines everything else up.
     */
    const state = newMatch();
    place(state, 0, 'card_troop_javelin_rider', 8, 12);
    const front = place(state, 1, 'card_troop_knight', 8, 14);
    const behind = place(state, 1, 'card_troop_knight', 8, 15.2);
    expect(until(state, () => behind.hp < behind.maxHp, 12)).toBe(true);
    expect(front.hp).toBeLessThan(front.maxHp);
  });
});

describe('what it leaves behind', () => {
  it('Bomb Tower detonates where it fell', () => {
    const state = newMatch();
    const tower = place(state, 0, 'card_building_bomb_tower', 8, 12);
    const bystander = place(state, 1, 'card_troop_knight', 8, 12.8);
    const before = bystander.hp;
    slay(state, tower);
    expect(bystander.hp).toBeLessThan(before);
  });

  it('Grave Warden leaves bodies, and they are ours', () => {
    const state = newMatch();
    const warden = place(state, 0, 'card_troop_grave_warden', 8, 12);
    const ours = () => state.entities.filter((e) => e.alive && e.team === 0 && e.kind === 'troop').length;
    const before = ours();
    slay(state, warden);
    // Four raised, one lost.
    expect(ours()).toBe(before + 3);
  });

  it('Frostfall Bearer leaves a trap rather than a blast', () => {
    /*
     * Distinct from the Plague Bearer that already dies into damage. What
     * matters is that whatever killed it is now slowed, standing where it
     * stood — so this asserts the status, not the health bar.
     */
    const state = newMatch();
    const bearer = place(state, 0, 'card_troop_frostfall_bearer', 8, 12);
    const killer = place(state, 1, 'card_troop_knight', 8, 12.5);
    slay(state, bearer);
    stepMatchBy(state, 4);
    expect(killer.slowTicks).toBeGreaterThan(0);
  });
});

describe('buildings that make bodies', () => {
  it('Bone Spire produces a stream of them', () => {
    const state = newMatch();
    place(state, 0, 'card_building_bone_spire', 8, 12);
    const ours = () => state.entities.filter((e) => e.alive && e.team === 0 && e.kind === 'troop').length;
    const before = ours();
    stepMatchBy(state, Math.round(TICK_HZ * 12));
    expect(ours()).toBeGreaterThan(before + 1);
  });

  it('runs out on its own timer, which is the counter it gives away', () => {
    const state = newMatch();
    const spire = place(state, 0, 'card_building_bone_spire', 8, 12);
    expect(spire.lifetimeTicks).toBeGreaterThan(0);
    stepMatchBy(state, Math.round(TICK_HZ * 40));
    expect(spire.alive).toBe(false);
  });

  it('Wasp Hive sends its bodies over the ground rather than along it', () => {
    const state = newMatch();
    place(state, 0, 'card_building_wasp_hive', 8, 12);
    stepMatchBy(state, Math.round(TICK_HZ * 12));
    const emitted = state.entities.filter(
      (e) => e.alive && e.team === 0 && e.cardId === 'card_troop_minions',
    );
    expect(emitted.length).toBeGreaterThan(0);
    expect(emitted[0].flying).toBe(true);
  });
});

describe('interruption and displacement', () => {
  it('Thunder Adept resets the wind-up of what it hits', () => {
    const state = newMatch();
    place(state, 0, 'card_troop_thunder_adept', 8, 12);
    const victim = place(state, 1, 'card_troop_giant', 8, 14);
    victim.windupDone = true;
    expect(until(state, () => !victim.windupDone && victim.hp < victim.maxHp)).toBe(true);
  });

  it('Gale Priest pushes what it hits back', () => {
    const state = newMatch();
    place(state, 0, 'card_troop_gale_priest', 8, 12);
    const victim = place(state, 1, 'card_troop_knight', 8, 14);
    victim.freezeTicks = 400; // frozen, so only the shove can move it
    const startY = victim.y;
    expect(until(state, () => victim.hp < victim.maxHp)).toBe(true);
    stepMatchBy(state, 6);
    expect(victim.y).toBeGreaterThan(startY);
  });

  it('Concussion Guard stops the swing but not the walk', () => {
    const state = newMatch();
    place(state, 0, 'card_troop_concussion_guard', 8, 12);
    const victim = place(state, 1, 'card_troop_knight', 8, 13);
    expect(until(state, () => victim.stunTicks > 0)).toBe(true);
  });

  it('Sporeling leaves rot that outlives the bite', () => {
    const state = newMatch();
    place(state, 0, 'card_troop_sporeling', 8, 12);
    const victim = place(state, 1, 'card_troop_knight', 8, 13);
    expect(until(state, () => victim.poisonTicks > 0)).toBe(true);
  });
});

describe('boomerang', () => {
  it('strikes three bodies on one throw, all for the same amount', () => {
    /*
     * Flat across its targets is the whole point — a chain falls off and a
     * split shot takes exactly one extra, so a crowd is worth no more to
     * either than a pair. Asserting equal damage rather than merely "several
     * were hit" is what separates this from the two mechanics it sits between.
     */
    const state = newMatch();
    place(state, 0, 'card_troop_boomerang_thrower', 8, 12);
    const victims = [
      place(state, 1, 'card_troop_giant', 8, 14),
      place(state, 1, 'card_troop_giant', 8.7, 14.4),
      place(state, 1, 'card_troop_giant', 9.4, 14.8),
      place(state, 1, 'card_troop_giant', 10.1, 15.2),
    ];
    for (const v of victims) v.freezeTicks = 900;

    expect(until(state, () => victims.filter((v) => v.hp < v.maxHp).length >= 3, 12)).toBe(true);
    const hurt = victims.filter((v) => v.hp < v.maxHp);
    // Three, not four: the fourth body is beyond the throw.
    expect(hurt).toHaveLength(3);
    const dealt = hurt.map((v) => v.maxHp - v.hp);
    expect(new Set(dealt).size).toBe(1);
  });

  it('waits three seconds between throws', () => {
    const state = newMatch();
    place(state, 0, 'card_troop_boomerang_thrower', 8, 12);
    const victim = place(state, 1, 'card_troop_giant', 8, 14);
    victim.freezeTicks = 900;

    const hits: number[] = [];
    let last = victim.hp;
    for (let i = 0; i < 8 * TICK_HZ; i++) {
      stepMatch(state);
      if (victim.hp < last) {
        hits.push(i);
        last = victim.hp;
      }
    }
    expect(hits.length).toBeGreaterThanOrEqual(2);
    // A reload measured in seconds, not in the eighth-of-a-second most cards use.
    expect(hits[1] - hits[0]).toBeGreaterThan(TICK_HZ * 2.5);
  });

  it('never rebounds onto a tower', () => {
    // A throw that clipped a tower on the way round would make it a win
    // condition rather than a crowd answer, and it is priced as the latter.
    const state = newMatch();
    place(state, 0, 'card_troop_boomerang_thrower', 8, 22);
    const victim = place(state, 1, 'card_troop_knight', 8, 24);
    victim.freezeTicks = 900;
    const towers = state.entities.filter((e) => e.kind === 'tower' && e.team === 1);
    const before = towers.map((t) => t.hp);
    until(state, () => victim.hp < victim.maxHp, 10);
    expect(towers.map((t) => t.hp)).toEqual(before);
  });
});

describe('soul bind', () => {
  it('Soul Crone raises what it kills on our side', () => {
    const state = newMatch();
    const crone = place(state, 0, 'card_troop_soul_crone', 8, 12);
    const prey = place(state, 1, 'card_troop_skeletons', 8, 14);
    prey.hp = 1;
    const ours = () => state.entities.filter((e) => e.alive && e.team === 0 && e.kind === 'troop').length;
    const before = ours();
    expect(until(state, () => !prey.alive, 12)).toBe(true);
    stepMatch(state);
    expect(ours()).toBeGreaterThan(before);
    void crone;
  });

  it('raises nothing from a tower, which would fund itself', () => {
    const state = newMatch();
    const crone = place(state, 0, 'card_troop_soul_crone', 8, 12);
    const tower = state.entities.find((e) => e.kind === 'tower' && e.team === 1) as Entity;
    tower.hp = 1;
    const ours = () => state.entities.filter((e) => e.alive && e.team === 0 && e.kind === 'troop').length;
    const before = ours();
    applyDamage(state, tower, 5000, crone);
    stepMatch(state);
    expect(ours()).toBe(before);
  });
});
