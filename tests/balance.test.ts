import { describe, it, expect } from 'vitest';
import '@cards/data';
import { BUILTIN_CARDS } from '@cards/data';
import { allCards, getCard } from '@cards/registry';
import { healthAtLevel, damageAtLevel } from '@cards/scaling';
import {
  auditCard,
  computeBudget,
  crownTowerDamage,
  passiveCost,
  rangeBandFor,
  splashBandFor,
  CROWN_TOWER_DAMAGE_FACTOR,
  EPP_PER_AETHER,
  FLYING_HP_MULTIPLIER,
  PASSIVE_EPP_COST,
  RANGE_HP_MULTIPLIER,
  SPELL_BREAKPOINTS,
  SPLASH_DPS_MULTIPLIER,
  SWARM_BUDGET_PER_EXTRA_UNIT,
  VERY_FAST_HP_MULTIPLIER,
} from '@cards/balance';
import { hasPassive, registeredPassives } from '@sim/scripts/passives';
import { createMatch, forceSpawn, tileCenter } from '@sim/state';
import { stepMatch, stepMatchBy, hashMatchState } from '@sim/tick';
import { STARTER_DECK, BOT_DECK } from '@cards/data';
import { BLUE, RED } from '@sim/nav/grid';
import { AP_PER_AETHER, TICK_HZ } from '@sim/constants';
import { applyDamageAtPoint } from '@sim/systems/combat';
import { applyDamage, resolveStats } from '@sim/entities';
import type { Command, MatchState } from '@sim/types';

const newMatch = (): MatchState =>
  createMatch({ seed: 909, players: [{ deck: STARTER_DECK }, { deck: BOT_DECK }] });

// ---------------------------------------------------------------------------

describe('budget model', () => {
  it('grants the stated allowance per aether', () => {
    const budget = computeBudget({
      aetherCost: 4,
      category: 'Troop',
      attackRange: 1.2,
      damageType: 'Single',
      splashRadius: 0,
      targetPriority: 'Ground',
      speedClass: 'Medium',
      isFlying: false,
      spawnCount: 1,
    });
    expect(budget.rawEpp).toBe(4 * EPP_PER_AETHER);
    expect(budget.spentOnAbility).toBe(0);
    expect(budget.adjustedEpp).toBe(budget.rawEpp);
  });

  it('classifies range bands at the documented thresholds', () => {
    expect(rangeBandFor(0.5)).toBe('melee');
    expect(rangeBandFor(1.2)).toBe('melee');
    expect(rangeBandFor(3.0)).toBe('short');
    expect(rangeBandFor(5.0)).toBe('medium');
    expect(rangeBandFor(6.0)).toBe('medium');
    expect(rangeBandFor(6.5)).toBe('long');
  });

  it('classifies splash bands by radius', () => {
    expect(splashBandFor({ damageType: 'Single', splashRadius: 0 })).toBe('single');
    expect(splashBandFor({ damageType: 'AreaSplash', splashRadius: 1.2 })).toBe('small');
    expect(splashBandFor({ damageType: 'AreaSplash', splashRadius: 2.5 })).toBe('wide');
  });

  it('deducts 40% of health for medium range and 65% for long', () => {
    expect(RANGE_HP_MULTIPLIER.medium).toBeCloseTo(0.6, 5);
    expect(RANGE_HP_MULTIPLIER.long).toBeCloseTo(0.35, 5);

    const base = { ...baseInput, attackRange: 1.2 };
    const melee = computeBudget(base);
    const medium = computeBudget({ ...base, attackRange: 5.5 });
    const long = computeBudget({ ...base, attackRange: 7.0 });

    expect(medium.healthBudget).toBeLessThan(melee.healthBudget);
    expect(long.healthBudget).toBeLessThan(medium.healthBudget);
    expect(medium.healthBudget / melee.healthBudget).toBeCloseTo(0.6, 2);
    expect(long.healthBudget / melee.healthBudget).toBeCloseTo(0.35, 2);
  });

  it('deducts 20% of health for flying and 15% for very fast', () => {
    expect(FLYING_HP_MULTIPLIER).toBeCloseTo(0.8, 5);
    expect(VERY_FAST_HP_MULTIPLIER).toBeCloseTo(0.85, 5);

    const ground = computeBudget(baseInput);
    expect(computeBudget({ ...baseInput, isFlying: true }).healthBudget / ground.healthBudget)
      .toBeCloseTo(0.8, 2);
    expect(
      computeBudget({ ...baseInput, speedClass: 'VeryFast' }).healthBudget / ground.healthBudget,
    ).toBeCloseTo(0.85, 2);
  });

  it('applies the 0.65 and 0.45 splash multipliers to the damage budget', () => {
    expect(SPLASH_DPS_MULTIPLIER.small).toBeCloseTo(0.65, 5);
    expect(SPLASH_DPS_MULTIPLIER.wide).toBeCloseTo(0.45, 5);

    const single = computeBudget(baseInput);
    const small = computeBudget({ ...baseInput, damageType: 'AreaSplash', splashRadius: 1.2 });
    const wide = computeBudget({ ...baseInput, damageType: 'AreaSplash', splashRadius: 2.5 });

    expect(small.dpsBudget / single.dpsBudget).toBeCloseTo(0.65, 2);
    expect(wide.dpsBudget / single.dpsBudget).toBeCloseTo(0.45, 2);
  });

  it('grants a swarm extra budget and then divides it across the bodies', () => {
    const solo = computeBudget(baseInput);
    const swarm = computeBudget({ ...baseInput, spawnCount: 4 });

    // Four bodies get more raw stats in total than one, because each is
    // individually fragile and the whole card dies to a single splash spell.
    const expectedBonus = 1 + SWARM_BUDGET_PER_EXTRA_UNIT * 3;
    expect(swarm.healthBudget / solo.healthBudget).toBeCloseTo(expectedBonus, 2);

    // But each individual body is far weaker than the solo unit would be,
    // which is what keeps swarms inside one-shot spell thresholds.
    expect(swarm.healthPerUnit).toBeCloseTo(swarm.healthBudget / 4, 0);
    expect(swarm.healthPerUnit).toBeLessThan(solo.healthBudget / 2);
  });

  it('charges for a passive out of the stat budget', () => {
    const plain = computeBudget(baseInput);
    const withPassive = computeBudget({ ...baseInput, passiveId: 'reflect_ranged' });

    expect(withPassive.spentOnAbility).toBe(PASSIVE_EPP_COST.reflect_ranged);
    expect(withPassive.adjustedEpp).toBe(plain.adjustedEpp - PASSIVE_EPP_COST.reflect_ranged);
    expect(withPassive.healthBudget).toBeLessThan(plain.healthBudget);
  });

  it('never lets a passive eat the whole budget', () => {
    const budget = computeBudget({ ...baseInput, aetherCost: 1, extraAbilityEpp: 5000 });
    expect(budget.adjustedEpp).toBeGreaterThan(0);
    expect(budget.healthBudget).toBeGreaterThan(0);
  });

  it('worked example: the Crystal Golem lands where the spec says it should', () => {
    const card = getCard('card_troop_crystal_golem');
    expect(card.aetherCost).toBe(4);
    expect(card.baseHealth).toBe(1150);
    expect(card.damage).toBe(210);
    expect(card.hitSpeed).toBeCloseTo(1.4, 5);
    // 210 / 1.4 = 150 DPS.
    expect(card.damage / card.hitSpeed).toBeCloseTo(150, 5);
    expect(passiveCost(card.passiveId)).toBe(250);
    expect(auditCard(card).withinTolerance).toBe(true);
  });
});

const baseInput = {
  aetherCost: 4,
  category: 'Troop' as const,
  attackRange: 1.2,
  damageType: 'Single' as const,
  splashRadius: 0,
  targetPriority: 'Ground' as const,
  speedClass: 'Medium' as const,
  isFlying: false,
  spawnCount: 1,
};

// ---------------------------------------------------------------------------

describe('roster audit', () => {
  /**
   * The point of the budget system: no card may quietly sit outside it. If
   * this fails, either the card is wrong or the model needs a new modifier —
   * but the discrepancy has to be resolved deliberately, not ignored.
   */
  it('keeps every non-spell card inside the balance tolerance', () => {
    const offenders: string[] = [];
    for (const card of BUILTIN_CARDS) {
      // Spells are balanced by breakpoint, not by EPP; towers are fixtures.
      if (card.category === 'Spell' || card.category === 'TowerTroop') continue;
      const audit = auditCard(card);
      if (!audit.withinTolerance) {
        offenders.push(
          `${card.name}: ratio ${audit.ratio} (budget ${audit.budget.adjustedEpp}, actual ${audit.actualEpp})`,
        );
      }
    }
    expect(offenders).toEqual([]);
  });

  it('has a registered implementation for every passive a card names', () => {
    const missing = allCards()
      .filter((card) => !hasPassive(card.passiveId))
      .map((card) => `${card.name} -> ${card.passiveId}`);
    expect(missing).toEqual([]);
  });

  it('has a declared EPP price for every registered passive', () => {
    const unpriced = registeredPassives().filter(
      (id) => id !== 'none' && PASSIVE_EPP_COST[id] === undefined,
    );
    expect(unpriced).toEqual([]);
  });

  it('gives every passive-carrying card a magnitude', () => {
    for (const card of BUILTIN_CARDS) {
      if (card.passiveId === 'none') continue;
      expect(card.passiveMagnitude, `${card.name} magnitude`).toBeGreaterThan(0);
    }
  });

  it('puts every long-range troop into the spell-killable band', () => {
    for (const card of BUILTIN_CARDS) {
      if (card.category !== 'Troop') continue;
      if (rangeBandFor(card.attackRange) !== 'long') continue;
      // Arrows at level 11 must be able to finish it.
      expect(card.baseHealth, `${card.name}`).toBeLessThan(700);
    }
  });

  it('scales every card by exactly 10% per level from the level-11 baseline', () => {
    for (const card of BUILTIN_CARDS) {
      if (card.scalingMultiplier !== 1.1) continue;
      const at11 = healthAtLevel(card, 11);
      const at12 = healthAtLevel(card, 12);
      expect(at11).toBe(card.baseHealth);
      expect(at12).toBe(Math.round(at11 * 1.1));
      if (card.damage > 0) expect(damageAtLevel(card, 11)).toBe(card.damage);
    }
  });
});

// ---------------------------------------------------------------------------

describe('spell breakpoints', () => {
  /**
   * Spells are defined by what they kill. These assertions are the real
   * balance specification for the spell slot — the EPP model does not apply.
   */
  const damageOf = (spellId: string) => getCard(spellId).damage;
  const healthOf = (cardId: string) => getCard(cardId).baseHealth;

  for (const breakpoint of SPELL_BREAKPOINTS) {
    describe(breakpoint.spellId, () => {
      for (const victimId of breakpoint.mustKill) {
        it(`kills ${victimId} outright`, () => {
          expect(damageOf(breakpoint.spellId)).toBeGreaterThanOrEqual(healthOf(victimId));
        });
      }
      for (const survivor of breakpoint.mustSurvive) {
        it(`leaves ${survivor.cardId} alive with health to spare`, () => {
          const remaining = healthOf(survivor.cardId) - damageOf(breakpoint.spellId);
          expect(remaining).toBeGreaterThan(0);
          expect(remaining / healthOf(survivor.cardId)).toBeGreaterThanOrEqual(
            survivor.minHealthFraction,
          );
        });
      }
    });
  }

  it('caps direct spell damage against Crown Towers', () => {
    expect(CROWN_TOWER_DAMAGE_FACTOR).toBeGreaterThanOrEqual(0.3);
    expect(CROWN_TOWER_DAMAGE_FACTOR).toBeLessThanOrEqual(0.35);
    expect(crownTowerDamage(1000)).toBe(320);
  });

  it('applies that cap in the simulation, not just on paper', () => {
    const state = newMatch();
    const tower = state.entities.find((e) => e.towerIndex === 3);
    expect(tower).toBeDefined();

    const fireball = getCard('card_spell_fireball');
    const stats = resolveStats(fireball.id, 11, false);
    const before = tower!.hp;

    const centre = tileCenter(Math.round(tower!.x / 65536), Math.round(tower!.y / 65536));
    applyDamageAtPoint(
      state,
      BLUE,
      centre.x,
      centre.y,
      stats.splashRadius,
      stats.damage,
      fireball,
      stats.statusTicks,
      tower!.id,
    );

    const dealt = before - tower!.hp;
    // A tower must take the capped figure, not the full troop damage.
    expect(dealt).toBe(crownTowerDamage(stats.damage));
    expect(dealt).toBeLessThan(stats.damage);
  });

  it('still deals full damage to troops', () => {
    const state = newMatch();
    const victim = forceSpawn(state, RED, 'card_troop_musketeer', 8, 20);
    victim.deployTimer = 0;

    const fireball = getCard('card_spell_fireball');
    const stats = resolveStats(fireball.id, 11, false);
    const before = victim.hp;

    applyDamageAtPoint(
      state,
      BLUE,
      victim.x,
      victim.y,
      stats.splashRadius,
      stats.damage,
      fireball,
      stats.statusTicks,
      victim.id,
    );

    expect(before - victim.hp).toBe(Math.min(before, stats.damage));
  });
});

// ---------------------------------------------------------------------------

describe('passive mechanics in play', () => {
  const play = (state: MatchState, cardId: string, tileX = 8, tileY = 10) => {
    state.players[BLUE].hand[0] = cardId;
    state.players[BLUE].aetherPoints = 10 * AP_PER_AETHER;
    const command: Command = { type: 'deploy', team: BLUE, handIndex: 0, tileX, tileY };
    stepMatch(state, [command]);
  };

  it('Bulwark enters with a shield worth 40% of its health', () => {
    const state = newMatch();
    play(state, 'card_troop_bulwark');
    const bulwark = state.entities.find((e) => e.cardId === 'card_troop_bulwark');
    expect(bulwark).toBeDefined();
    expect(bulwark!.shield).toBe(Math.round(bulwark!.maxHp * 0.4));
  });

  it('Crystal Golem reflects ranged damage but not melee', () => {
    const state = newMatch();
    play(state, 'card_troop_crystal_golem', 8, 12);
    stepMatchBy(state, TICK_HZ + 2);
    const golem = state.entities.find((e) => e.cardId === 'card_troop_crystal_golem');
    expect(golem).toBeDefined();

    // A ranged attacker takes damage back.
    const shooter = forceSpawn(state, RED, 'card_troop_musketeer', 8, 14);
    shooter.deployTimer = 0;
    const shooterBefore = shooter.hp;
    applyDamage(state, golem!, 200, shooter);
    expect(shooter.hp).toBeLessThan(shooterBefore);
    expect(shooterBefore - shooter.hp).toBe(Math.round(200 * 0.3));

    // A melee attacker does not.
    const brawler = forceSpawn(state, RED, 'card_troop_knight', 8, 14);
    brawler.deployTimer = 0;
    const brawlerBefore = brawler.hp;
    applyDamage(state, golem!, 200, brawler);
    expect(brawler.hp).toBe(brawlerBefore);
  });

  it('Ronin negates a melee hit and counters, then goes on cooldown', () => {
    const state = newMatch();
    play(state, 'card_troop_ronin', 8, 12);
    stepMatchBy(state, TICK_HZ + 2);

    const ronin = state.entities.find((e) => e.cardId === 'card_troop_ronin');
    expect(ronin).toBeDefined();
    expect(ronin!.passiveCharges).toBe(1);

    const attacker = forceSpawn(state, RED, 'card_troop_knight', 8, 14);
    attacker.deployTimer = 0;
    const roninHp = ronin!.hp;
    const attackerHp = attacker.hp;

    applyDamage(state, ronin!, 300, attacker);

    // Parried: Ronin is whole, the attacker took double back.
    expect(ronin!.hp).toBe(roninHp);
    expect(attackerHp - attacker.hp).toBe(600);
    expect(ronin!.passiveCharges).toBe(0);

    // The second hit lands normally while the parry is down.
    applyDamage(state, ronin!, 300, attacker);
    expect(ronin!.hp).toBeLessThan(roninHp);
  });

  it('Ironhide shrugs off freeze, stun and slow', () => {
    const state = newMatch();
    play(state, 'card_troop_ironhide', 8, 12);
    stepMatchBy(state, TICK_HZ + 2);

    const ironhide = state.entities.find((e) => e.cardId === 'card_troop_ironhide');
    expect(ironhide).toBeDefined();

    ironhide!.stunTicks = 60;
    ironhide!.freezeTicks = 60;
    ironhide!.slowTicks = 60;
    stepMatch(state);

    expect(ironhide!.stunTicks).toBe(0);
    expect(ironhide!.freezeTicks).toBe(0);
    expect(ironhide!.slowTicks).toBe(0);
  });

  it('Hive Titan splits into Goblins when it dies', () => {
    const state = newMatch();
    play(state, 'card_troop_hive_titan', 8, 12);
    stepMatchBy(state, 2);

    const titan = state.entities.find((e) => e.cardId === 'card_troop_hive_titan');
    expect(titan).toBeDefined();
    const goblinsBefore = state.entities.filter((e) => e.cardId === 'card_troop_goblins').length;

    titan!.hp = 0;
    titan!.alive = false;
    state.needsCompaction = true;
    stepMatch(state);

    const goblinsAfter = state.entities.filter((e) => e.cardId === 'card_troop_goblins').length;
    // Four from the death effect plus four from the passive split.
    expect(goblinsAfter).toBeGreaterThan(goblinsBefore);
  });

  it('Frost Wisp slows nearby enemies and the slow lapses when it dies', () => {
    const state = newMatch();
    play(state, 'card_troop_frost_wisp', 8, 14);
    stepMatchBy(state, TICK_HZ + 2);

    const wisp = state.entities.find((e) => e.cardId === 'card_troop_frost_wisp');
    expect(wisp).toBeDefined();

    const victim = forceSpawn(state, RED, 'card_troop_knight', 8, 15);
    victim.deployTimer = 0;
    stepMatch(state);
    expect(victim.slowTicks).toBeGreaterThan(0);

    wisp!.hp = 0;
    wisp!.alive = false;
    state.needsCompaction = true;
    stepMatchBy(state, 6);
    expect(victim.slowTicks).toBe(0);
  });

  it('Berserkers rage only once wounded', () => {
    const state = newMatch();
    play(state, 'card_troop_berserkers', 8, 12);
    stepMatchBy(state, TICK_HZ + 2);

    const pair = state.entities.filter((e) => e.cardId === 'card_troop_berserkers');
    expect(pair).toHaveLength(2);
    expect(pair[0].rageTicks).toBe(0);

    pair[0].hp = Math.floor(pair[0].maxHp * 0.3);
    stepMatch(state);
    expect(pair[0].rageTicks).toBeGreaterThan(0);
    expect(pair[1].rageTicks).toBe(0);
  });

  it('keeps a match deterministic with every unique card in play', () => {
    const run = () => {
      const state = newMatch();
      const uniques = [
        'card_troop_crystal_golem',
        'card_troop_ronin',
        'card_troop_arc_warden',
        'card_troop_frost_wisp',
        'card_troop_hive_titan',
        'card_troop_plague_bearer',
      ];
      uniques.forEach((cardId, index) => {
        state.players[BLUE].hand[0] = cardId;
        state.players[BLUE].aetherPoints = 10 * AP_PER_AETHER;
        stepMatch(state, [
          { type: 'deploy', team: BLUE, handIndex: 0, tileX: 4 + index, tileY: 12 },
        ]);
        stepMatchBy(state, 40);
      });
      stepMatchBy(state, 600);
      return state;
    };

    expect(hashMatchState(run())).toBe(hashMatchState(run()));
  });
});
