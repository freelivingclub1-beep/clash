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
  DAMAGE_RAMP_STACK_CAP,
} from '@sim/constants';
import { applyDamage, canTarget, findEntity, resolveStats } from '@sim/entities';
import { fxToFloat } from '@sim/math/fixed';
import { applyStatus, applyDamageAtPoint, releaseLocksOn } from '@sim/systems/combat';
import { auditCard, SHIELD_EPP_WEIGHT } from '@cards/balance';
import { hasPassive } from '@sim/scripts/passives';
import type { Command, Entity, MatchState } from '@sim/types';

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

  /**
   * Step until the charge triggers, up to `seconds`.
   *
   * Not a fixed window: the threshold is a *distance*, so any change to how
   * fast units move changes how long it takes to cover. A fixed five-second
   * step silently encoded the old movement speeds, and broke the moment those
   * were corrected to the reference game's — which was a test asserting the
   * bug, not the behaviour.
   */
  const runUntilCharging = (state: MatchState, unit: Entity, seconds = 12): void => {
    for (let i = 0; i < TICK_HZ * seconds && !unit.charging; i++) stepMatch(state);
  };

  it('enters the charge state after enough uninterrupted travel', () => {
    const state = newMatch();
    const unit = play(state, charger, 8, 8)[0];
    expect(unit.charging).toBe(false);

    runUntilCharging(state, unit);
    expect(unit.charging).toBe(true);
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
    const unit = play(state, charger, 8, 8)[0];
    runUntilCharging(state, unit);
    expect(unit.charging).toBe(true);

    unit.stunTicks = 10;
    stepMatch(state);
    expect(unit.charging).toBe(false);
    expect(unit.chargeDistance).toBe(0);
  });

  it('a knockback breaks the charge', () => {
    const state = newMatch();
    const unit = play(state, charger, 8, 8)[0];
    runUntilCharging(state, unit);
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

describe('elite hounds', () => {
  const hounds = 'card_troop_elite_hounds';

  /** One hound and one parked victim, in range of each other, deploy over. */
  const biteRig = (victimCard = 'card_troop_giant') => {
    const state = newMatch();
    const hound = forceSpawn(state, BLUE, hounds, 8, 12);
    hound.deployTimer = 0;
    const victim = forceSpawn(state, RED, victimCard, 8, 13);
    victim.deployTimer = 0;
    victim.speed = 0;
    // Survive long enough to sample the whole ramp.
    victim.maxHp = 400_000;
    victim.hp = victim.maxHp;
    return { state, hound, victim };
  };

  /** Damage of each successive bite, read off the victim's health. */
  const biteDamages = (state: MatchState, victim: { hp: number }, ticks: number): number[] => {
    const damages: number[] = [];
    let hp = victim.hp;
    for (let i = 0; i < ticks; i++) {
      stepMatch(state);
      if (victim.hp < hp) {
        damages.push(hp - victim.hp);
        hp = victim.hp;
      }
    }
    return damages;
  };

  it('takes four princess-tower hits to kill, one of them the armour', () => {
    /*
     * The pack's whole reason to exist. Armour absorbs one blow of any size,
     * so the first hit is spent on the plate however hard it lands — and the
     * body then has to take three more. Three is the number: at two the pack
     * evaporates before it reaches anything and the card is a donation, and
     * the plate is doing nothing that raw health would not do cheaper.
     *
     * Driven at the real tower's real damage rather than a made-up figure,
     * because the requirement is expressed in tower hits and a card tuned
     * against an invented number is tuned against nothing.
     */
    const state = newMatch();
    const pack = play(state, hounds);
    const hound = pack[0];
    const towerDamage = getCard('card_towertroop_tower_princess').damage;

    let hits = 0;
    while (hound.alive && hits < 12) {
      applyDamage(state, hound, towerDamage);
      hits++;
    }
    expect(hits).toBe(4);
  });

  it('spends the plate on the first blow however large it is', () => {
    // The other half of the requirement, and the half a big spell would break
    // if overkill leaked: a thousand-damage hit must still cost exactly the
    // armour and leave the dog at full health.
    const state = newMatch();
    const hound = play(state, hounds)[0];
    const full = hound.hp;
    applyDamage(state, hound, 10_000);
    expect(hound.shield).toBe(0);
    expect(hound.hp).toBe(full);
    expect(hound.alive).toBe(true);
  });

  it('is a registered, priced mechanic', () => {
    expect(hasPassive('damage_ramp')).toBe(true);
    const card = getCard(hounds);
    expect(card.passiveId).toBe('damage_ramp');
    expect(card.spawnCount).toBe(3);
    expect(card.prefersTroops).toBe(true);
    expect(auditCard(card).withinTolerance).toBe(true);
  });

  it('spawns three hounds, each with its own one-hit armour', () => {
    const state = newMatch();
    const pack = play(state, hounds);
    expect(pack).toHaveLength(3);

    const health = pack[0].hp;
    applyDamage(state, pack[0], 50_000);
    expect(pack[0].shield).toBe(0);
    // Armour absorbs a hit of any size and nothing bleeds through it.
    expect(pack[0].hp).toBe(health);
    expect(pack[1].shield).toBeGreaterThan(0);
    expect(pack[2].shield).toBeGreaterThan(0);
  });

  it('is fragile once the armour is gone', () => {
    const state = newMatch();
    const hound = play(state, hounds)[0];
    applyDamage(state, hound, 50_000);
    applyDamage(state, hound, hound.maxHp);
    expect(hound.alive).toBe(false);
  });

  it('bites harder the longer it stays on one target', () => {
    const { state, victim } = biteRig();
    const damages = biteDamages(state, victim, 400);

    expect(damages.length).toBeGreaterThan(6);
    // The first bite is the card's printed damage — the ramp is the reward for
    // staying, not something the card starts with.
    expect(damages[0]).toBe(resolveStats(hounds, 11, false).damage);
    for (let i = 1; i < Math.min(damages.length, DAMAGE_RAMP_STACK_CAP); i++) {
      expect(damages[i]).toBeGreaterThan(damages[i - 1]);
    }
  });

  it('escalates superlinearly — quicker and quicker, not by a flat step', () => {
    const { state, victim } = biteRig();
    const damages = biteDamages(state, victim, 400);
    expect(damages.length).toBeGreaterThan(4);

    const step = (i: number) => damages[i] - damages[i - 1];
    expect(step(2)).toBeGreaterThan(step(1));
    expect(step(3)).toBeGreaterThan(step(2));
  });

  it('caps the ramp so a long channel cannot run away', () => {
    const { state, hound, victim } = biteRig();
    biteDamages(state, victim, 600);
    expect(hound.passiveCharges).toBe(DAMAGE_RAMP_STACK_CAP);
  });

  it('resets to the weakest bite when it switches targets', () => {
    const { state, hound, victim } = biteRig();
    biteDamages(state, victim, 200);
    expect(hound.passiveCharges).toBeGreaterThan(2);

    // Kill the first victim outright and park a fresh one in reach.
    applyDamage(state, victim, victim.hp);
    const next = forceSpawn(state, RED, 'card_troop_giant', 8, 13);
    next.deployTimer = 0;
    next.speed = 0;
    next.maxHp = 400_000;
    next.hp = next.maxHp;

    const damages = biteDamages(state, next, 200);
    expect(damages[0]).toBe(resolveStats(hounds, 11, false).damage);
  });

  it('resets that hound only when its target dies, not the whole pack', () => {
    const { state, hound, victim } = biteRig();
    biteDamages(state, victim, 200);
    expect(hound.passiveCharges).toBeGreaterThan(0);

    // A second hound mid-channel on something else entirely. Spawned after the
    // stepping so no incidental combat can disturb its stack count.
    const other = forceSpawn(state, BLUE, hounds, 12, 12);
    other.passiveTargetId = victim.id + 1000;
    other.passiveCharges = 5;

    releaseLocksOn(state, victim.id);
    expect(hound.passiveCharges).toBe(0);
    // Each dog tracks its own bite; one kill does not calm the rest.
    expect(other.passiveCharges).toBe(5);
  });

  it('a reset spell wipes the ramp', () => {
    const { state, hound, victim } = biteRig();
    biteDamages(state, victim, 250);
    expect(hound.passiveCharges).toBeGreaterThan(3);

    applyStatus(getCard('card_spell_zap'), hound, 12);
    expect(hound.passiveCharges).toBe(0);

    // And the bite that follows is back to the printed damage.
    const damages = biteDamages(state, victim, 200);
    expect(damages[0]).toBe(resolveStats(hounds, 11, false).damage);
  });

  it('a reset spell does not wipe unrelated one-shot passives', () => {
    // `passiveCharges` is shared storage — a blanket reset here would silently
    // delete Ronin's parry instead of resetting a ramp.
    const state = newMatch();
    const ronin = play(state, 'card_troop_ronin', 8, 12)[0];
    expect(ronin.passiveCharges).toBe(1);
    applyStatus(getCard('card_spell_zap'), ronin, 12);
    expect(ronin.passiveCharges).toBe(1);
  });

  it('cannot touch air at all', () => {
    const card = getCard(hounds);
    const state = newMatch();
    const flier = forceSpawn(state, RED, 'card_troop_minions', 8, 13);
    flier.deployTimer = 0;
    flier.speed = 0;
    expect(flier.flying).toBe(true);
    expect(canTarget(card.targetPriority, flier)).toBe(false);

    const hound = forceSpawn(state, BLUE, hounds, 8, 12);
    hound.deployTimer = 0;
    const before = flier.hp;
    stepMatchBy(state, TICK_HZ * 4);
    expect(flier.hp).toBe(before);
    expect(hound.targetId).not.toBe(flier.id);
  });

  it('still reaches towers and buildings on the ground', () => {
    const card = getCard(hounds);
    const state = newMatch();
    const tower = state.entities.find((e) => e.kind === 'tower' && e.team === RED);
    expect(tower).toBeDefined();
    expect(canTarget(card.targetPriority, tower!)).toBe(true);
  });

  it('hunts troops before towers even when the tower is closer', () => {
    const state = newMatch();
    // Right up against the RED princess tower footprint (13-15, 24-26), with a
    // defender standing further away but still inside the hound's sight.
    const hound = forceSpawn(state, BLUE, hounds, 14, 22);
    hound.deployTimer = 0;
    const defender = forceSpawn(state, RED, 'card_troop_knight', 14, 19);
    defender.deployTimer = 0;
    defender.speed = 0;

    stepMatchBy(state, 6);
    const locked = findEntity(state, hound.targetId);
    expect(locked?.kind).toBe('troop');
    expect(locked?.id).toBe(defender.id);
  });

  it('stays deterministic with a ramping pack on the field', () => {
    const run = () => {
      const state = newMatch();
      play(state, hounds, 8, 10);
      stepMatchBy(state, 40);
      forceSpawn(state, RED, 'card_troop_giant', 8, 16);
      stepMatchBy(state, 700);
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
