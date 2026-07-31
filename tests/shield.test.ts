import { describe, it, expect } from 'vitest';
import '@cards/data';
import { STARTER_DECK, BOT_DECK } from '@cards/data';
import { getCard } from '@cards/registry';
import { createMatch, forceSpawn } from '@sim/state';
import { stepMatch, stepMatchBy, hashMatchState } from '@sim/tick';
import { BLUE, RED } from '@sim/nav/grid';
import {
  AP_PER_AETHER,
  TICK_HZ,
  CHARGE_DAMAGE_MULTIPLIER,
  CHARGE_SPEED_MULTIPLIER,
} from '@sim/constants';
import { applyDamage, resolveStats } from '@sim/entities';
import { fxToFloat } from '@sim/math/fixed';
import { applyStatus, applyDamageAtPoint } from '@sim/systems/combat';
import { auditCard, SHIELD_EPP_WEIGHT } from '@cards/balance';
import { hasPassive } from '@sim/scripts/passives';
import type { Command, MatchState } from '@sim/types';

/** CHARGE_SPEED_MULTIPLIER is Q16.16; compare against it as a plain number. */
const CHARGE_SPEED_MULTIPLIER_FLOAT = fxToFloat(CHARGE_SPEED_MULTIPLIER);

const newMatch = (): MatchState =>
  createMatch({ seed: 8181, players: [{ deck: STARTER_DECK }, { deck: BOT_DECK }] });

const play = (state: MatchState, cardId: string, tileX = 8, tileY = 10) => {
  state.players[BLUE].hand[0] = cardId;
  state.players[BLUE].aetherPoints = 10 * AP_PER_AETHER;
  const command: Command = { type: 'deploy', team: BLUE, handIndex: 0, tileX, tileY };
  stepMatch(state, [command]);
  return state.entities.filter((e) => e.alive && e.cardId === cardId);
};

describe('shield layer', () => {
  it('discards all overkill — a huge hit costs only the shield', () => {
    const state = newMatch();
    const guard = play(state, 'card_troop_spear_guards')[0];
    const fullHealth = guard.hp;
    expect(guard.shield).toBeGreaterThan(0);

    // Ten times its total durability, in one blow.
    applyDamage(state, guard, 10000);

    expect(guard.shield).toBe(0);
    // The entire excess is negated: base health is untouched.
    expect(guard.hp).toBe(fullHealth);
    expect(guard.alive).toBe(true);
  });

  it('returns only the amount the shield actually absorbed', () => {
    const state = newMatch();
    const guard = play(state, 'card_troop_spear_guards')[0];
    const shield = guard.shield;
    const dealt = applyDamage(state, guard, 9999);
    expect(dealt).toBe(shield);
  });

  it('routes damage to base health only once the shield is gone', () => {
    const state = newMatch();
    const guard = play(state, 'card_troop_spear_guards')[0];
    applyDamage(state, guard, 10000);
    expect(guard.hp).toBe(guard.maxHp);

    applyDamage(state, guard, 60);
    expect(guard.hp).toBe(guard.maxHp - 60);
  });

  it('takes two hits to kill a shielded unit no matter how big the first is', () => {
    const state = newMatch();
    const guard = play(state, 'card_troop_spear_guards')[0];
    applyDamage(state, guard, 99999);
    expect(guard.alive).toBe(true);
    applyDamage(state, guard, 99999);
    expect(guard.alive).toBe(false);
  });

  it('emits a shield-break event exactly once', () => {
    const state = newMatch();
    const guard = play(state, 'card_troop_spear_guards')[0];
    state.events.length = 0;

    applyDamage(state, guard, 5000);
    expect(state.events.filter((e) => e.type === 'shieldBreak')).toHaveLength(1);

    state.events.length = 0;
    applyDamage(state, guard, 20);
    expect(state.events.some((e) => e.type === 'shieldBreak')).toBe(false);
  });

  it('grants brief displacement immunity as the shield breaks', () => {
    const state = newMatch();
    const guard = play(state, 'card_troop_spear_guards')[0];
    applyDamage(state, guard, 5000);
    expect(guard.shieldBreakTicks).toBeGreaterThan(0);

    // A knockback landing inside that window must not move it.
    applyStatus(getCard('card_spell_fireball'), guard, 10);
    expect(guard.pushY).toBe(0);
  });

  it('spawns three independently tracked guards', () => {
    const state = newMatch();
    const guards = play(state, 'card_troop_spear_guards');
    expect(guards).toHaveLength(3);

    applyDamage(state, guards[0], 10000);
    expect(guards[0].shield).toBe(0);
    // The other two are untouched — each tracks its own layer.
    expect(guards[1].shield).toBeGreaterThan(0);
    expect(guards[2].shield).toBeGreaterThan(0);
    expect(new Set(guards.map((g) => g.id)).size).toBe(3);
  });

  it('prices a point of shield above a point of health', () => {
    expect(SHIELD_EPP_WEIGHT).toBeGreaterThan(1);
    const card = getCard('card_troop_spear_guards');
    expect(card.shieldHealth).toBeGreaterThan(0);
    expect(auditCard(card).withinTolerance).toBe(true);
  });
});

describe('charge', () => {
  const charger = 'card_troop_iron_charger';

  it('is a registered, priced mechanic', () => {
    expect(hasPassive('charge')).toBe(true);
    expect(getCard(charger).passiveId).toBe('charge');
    expect(auditCard(getCard(charger)).withinTolerance).toBe(true);
  });

  it('enters the charge state after enough uninterrupted travel', () => {
    const state = newMatch();
    const unit = play(state, charger, 8, 10)[0];
    expect(unit.charging).toBe(false);

    stepMatchBy(state, TICK_HZ * 5);
    expect(unit.charging).toBe(true);
    expect(state.events.some((e) => e.type === 'charge') || unit.charging).toBe(true);
  });

  it('moves faster while charging', () => {
    const state = newMatch();
    // Open ground with a long unobstructed run ahead of it. Dropped closer to
    // the river the unit crosses the bridge and reaches the enemy tower before
    // the sample window, stops to attack, and appears not to move at all —
    // and rows 1-4 are inside the friendly King Tower's footprint, where a
    // deploy is rejected outright.
    const units = play(state, charger, 8, 8);
    expect(units).toHaveLength(1);
    const unit = units[0];

    /** Straight-line distance covered over `ticks`, not just vertical drift. */
    const travelled = (ticks: number) => {
      const x0 = unit.x;
      const y0 = unit.y;
      stepMatchBy(state, ticks);
      return Math.hypot(fxToFloat(unit.x - x0), fxToFloat(unit.y - y0));
    };

    // Clear the deploy freeze, then measure the ordinary walk.
    stepMatchBy(state, TICK_HZ + 2);
    expect(unit.charging).toBe(false);
    const walked = travelled(10);
    expect(walked).toBeGreaterThan(0);

    // Run until the charge triggers, then measure immediately — a later
    // window risks catching the unit mid-engagement rather than at speed.
    for (let i = 0; i < 600 && !unit.charging; i++) stepMatch(state);
    expect(unit.charging).toBe(true);
    const charged = travelled(10);

    // Should be very close to the multiplier itself, not merely "faster".
    const ratio = charged / walked;
    expect(ratio).toBeGreaterThan(CHARGE_SPEED_MULTIPLIER_FLOAT * 0.85);
    expect(ratio).toBeLessThan(CHARGE_SPEED_MULTIPLIER_FLOAT * 1.15);
  });

  it('a stun breaks the charge outright', () => {
    const state = newMatch();
    const unit = play(state, charger, 8, 10)[0];
    stepMatchBy(state, TICK_HZ * 5);
    expect(unit.charging).toBe(true);

    unit.stunTicks = 10;
    stepMatch(state);
    expect(unit.charging).toBe(false);
    expect(unit.chargeDistance).toBe(0);
  });

  it('a knockback breaks the charge', () => {
    const state = newMatch();
    const unit = play(state, charger, 8, 10)[0];
    stepMatchBy(state, TICK_HZ * 5);
    expect(unit.charging).toBe(true);

    applyStatus(getCard('card_spell_fireball'), unit, 10);
    expect(unit.charging).toBe(false);
  });

  it('lands a doubled hit on impact and resets to a walk', () => {
    const state = newMatch();
    // Left lane, so the unit heads for the x=4/5 bridge; the victim is parked
    // directly on that path or the two never meet.
    // Far enough apart that the charger clears its 4.5-tile threshold before
    // it arrives: parked any closer it acquires the target, walks straight
    // into attack range, and never builds speed at all.
    const unit = play(state, charger, 4, 10)[0];
    const victim = forceSpawn(state, RED, 'card_troop_giant', 4, 19);
    victim.deployTimer = 0;
    victim.speed = 0;
    const before = victim.hp;

    let sawCharge = false;
    for (let i = 0; i < 900 && victim.hp === before; i++) {
      stepMatch(state);
      if (unit.charging) sawCharge = true;
    }
    expect(sawCharge).toBe(true);

    const dealt = before - victim.hp;
    const base = resolveStats(charger, 11, false).damage;
    // The first connecting blow is the charge hit.
    expect(dealt).toBeGreaterThanOrEqual(base * CHARGE_DAMAGE_MULTIPLIER);
    expect(unit.charging).toBe(false);
  });

  it('stays deterministic with charging and shielded units on the field', () => {
    const run = () => {
      const state = newMatch();
      play(state, charger, 5, 12);
      stepMatchBy(state, 40);
      play(state, 'card_troop_spear_guards', 12, 12);
      stepMatchBy(state, 800);
      return state;
    };
    expect(hashMatchState(run())).toBe(hashMatchState(run()));
  });
});

describe('cone splash', () => {
  it('strikes in front of the attacker but not behind it', () => {
    const state = newMatch();
    const unit = play(state, 'card_troop_iron_charger', 8, 12)[0];
    unit.deployTimer = 0;

    // Facing up-field, toward higher Y.
    unit.faceX = 0;
    unit.faceY = 65536;

    const inFront = forceSpawn(state, RED, 'card_troop_skeletons', 8, 13);
    const behind = forceSpawn(state, RED, 'card_troop_skeletons', 8, 11);
    for (const e of [inFront, behind]) {
      e.deployTimer = 0;
      e.speed = 0;
    }
    const frontBefore = inFront.hp;
    const behindBefore = behind.hp;

    const card = getCard('card_troop_iron_charger');
    const stats = resolveStats(card.id, 11, false);
    applyDamageAtPoint(
      state, BLUE, unit.x, unit.y, stats.splashRadius, 50, card, 0, inFront.id, unit,
    );

    expect(inFront.hp).toBeLessThan(frontBefore);
    expect(behind.hp).toBe(behindBefore);
  });
});
