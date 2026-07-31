/**
 * The Effective Power Points (EPP) budget system.
 *
 * Every card in the game is balanced at Level 11 and scales 10% per level, so
 * a card that is fair at 11 is fair everywhere. This module is the arithmetic
 * that decides what "fair at 11" means:
 *
 *   1. Aether cost buys a raw EPP allowance (~1000 per aether).
 *   2. That allowance is split between a health pool and a damage pool.
 *   3. Utility — reach, splash, flight, speed, swarm count, passives — is paid
 *      for out of those pools, never granted for free.
 *   4. What remains is the card's legal stat line.
 *
 * `auditCard` runs the same arithmetic backwards against an already-authored
 * card and reports how far over or under budget it is. That is what lets the
 * roster be checked automatically instead of by eye, and it is what the Card
 * Maker shows live while you type.
 *
 * Deliberately plain floating-point: this is design-time tooling that never
 * runs inside the tick loop, so the determinism rules that bind `src/sim` do
 * not apply here.
 */

import type { CardDefinition } from './schema';

// ---------------------------------------------------------------------------
// Base budget
// ---------------------------------------------------------------------------

/** Raw stat allowance granted per point of aether at Level 11. */
export const EPP_PER_AETHER = 1000;

/**
 * Damage is budgeted over an assumed five-second engagement, so a card's DPS
 * allowance converts to EPP by multiplying by this window.
 */
export const DAMAGE_WINDOW_SECONDS = 5;

/**
 * Share of the raw allowance that actually becomes health and damage.
 *
 * The rest is the implicit cost of simply *being* a unit — occupying board
 * space, drawing fire, having a deploy time and a body that blocks. Calibrated
 * against the canonical roster: with this factor the median card audits at
 * 1.00, which is what makes the tolerance band meaningful rather than arbitrary.
 */
export const STAT_EFFICIENCY = 0.65;

/**
 * Extra budget per additional unit in a swarm.
 *
 * A three-body card genuinely carries more raw stats than a single unit of the
 * same cost, because each body is individually fragile and the whole card
 * evaporates to one splash spell. Without this the model reports every cheap
 * swarm as massively over budget — Skeletons audited at 2.2x before it existed.
 */
export const SWARM_BUDGET_PER_EXTRA_UNIT = 0.3;

/**
 * Champions carry above-curve stats, and legitimately so: only one may be on
 * the field at a time, and every use of the ability costs additional aether on
 * top of the deploy. Both are real constraints the raw stat line cannot see.
 */
export const CHAMPION_BUDGET_BONUS = 1.25;

/**
 * Buildings with a decay timer are renting their stats, not owning them — a
 * Cannon that expires after 30 seconds is worth less than a troop with the
 * same numbers that stays until killed.
 */
export const DECAYING_BUILDING_BUDGET_BONUS = 1.25;

/**
 * How the raw allowance divides between staying alive and dealing damage.
 * Ground troops lean toward health; the split shifts for other categories.
 */
export const HP_SHARE: Record<CardDefinition['category'], number> = {
  Troop: 0.62,
  Building: 0.7,
  TowerTroop: 0.65,
  Spell: 0,
};

// ---------------------------------------------------------------------------
// Trade-off modifiers
// ---------------------------------------------------------------------------

/** Targeting and radius penalties, applied to the DPS budget. */
export const SPLASH_DPS_MULTIPLIER = {
  single: 1.0,
  /** Small splash spends 35% of the DPS allowance on area coverage. */
  small: 0.65,
  /** Wide splash spends 55%. */
  wide: 0.45,
} as const;

/** Splash radius below this is "small"; at or above it is "wide". */
export const WIDE_SPLASH_THRESHOLD = 1.6;

/** Range penalties, applied to the HP budget. */
export const RANGE_HP_MULTIPLIER = {
  /** Melee, 0.0 - 1.2 tiles. No penalty: it has to walk into the fight. */
  melee: 1.0,
  /** Anything between melee and medium, scaled between the two. */
  short: 0.85,
  /** Medium, 5.0 - 6.0 tiles. Safe behind a tank, so -40% health. */
  medium: 0.6,
  /** Long, 6.5+. -65%, which puts it in the spell-killable band. */
  long: 0.35,
} as const;

/** Air units bypass ground terrain entirely, so -20% health. */
export const FLYING_HP_MULTIPLIER = 0.8;

/** Very fast movement cuts opponent reaction time, so -15% health. */
export const VERY_FAST_HP_MULTIPLIER = 0.85;

/** Air-and-ground targeting is strictly more useful than ground-only. */
export const AIR_AND_GROUND_DPS_MULTIPLIER = 0.85;

/** Buildings-only targeting ignores defenders, so it buys back budget. */
export const BUILDINGS_ONLY_DPS_MULTIPLIER = 1.25;

/**
 * Direct spell damage to Crown Towers is capped at a third of its troop
 * damage, so no deck can win by chipping towers from hand.
 */
export const CROWN_TOWER_DAMAGE_FACTOR = 0.32;

export type RangeBand = keyof typeof RANGE_HP_MULTIPLIER;
export type SplashBand = keyof typeof SPLASH_DPS_MULTIPLIER;

export function rangeBandFor(attackRange: number): RangeBand {
  if (attackRange <= 1.2) return 'melee';
  if (attackRange < 5.0) return 'short';
  if (attackRange <= 6.0) return 'medium';
  return 'long';
}

export function splashBandFor(card: Pick<CardDefinition, 'damageType' | 'splashRadius'>): SplashBand {
  if (card.damageType === 'Single' || card.splashRadius <= 0) return 'single';
  return card.splashRadius >= WIDE_SPLASH_THRESHOLD ? 'wide' : 'small';
}

// ---------------------------------------------------------------------------
// Passive ability weights
// ---------------------------------------------------------------------------

/**
 * What each special mechanic costs, in EPP, deducted before stats are set.
 *
 * These are judgement calls, not derivations — but they are *written down*
 * judgement calls, which is the point: a new card cannot quietly get a free
 * mechanic, because the audit will show the shortfall.
 */
export const PASSIVE_EPP_COST: Record<string, number> = {
  none: 0,
  /** Reflects a share of incoming ranged damage back at the shooter. */
  reflect_ranged: 250,
  /** Negates the next melee hit outright and counters. */
  parry_melee: 320,
  /** Chains attacks to additional nearby targets. */
  chain_attack: 280,
  /** Splits into smaller units on death. */
  death_split: 220,
  /** Attack speed ramps the longer it keeps hitting the same target. */
  attack_ramp: 240,
  /** Pushes enemies backward on hit. */
  displacement: 180,
  /** Immune to a damage type or to crowd control. */
  damage_immunity: 300,
  /** Heals nearby allies over time. */
  aura_heal: 260,
  /** Slows everything in a radius while alive. */
  aura_slow: 230,
  /** Becomes stronger below a health threshold. */
  enrage_low_hp: 190,
  /** First hit taken is absorbed by a shield. */
  spawn_shield: 160,
  /** Deals bonus damage to buildings and towers. */
  siege_bonus: 210,
  /** Leaves a damaging zone where it dies. */
  death_zone: 200,
};

export type PassiveId = keyof typeof PASSIVE_EPP_COST;

export function passiveCost(passiveId: string): number {
  return PASSIVE_EPP_COST[passiveId] ?? 0;
}

// ---------------------------------------------------------------------------
// Budget computation
// ---------------------------------------------------------------------------

export interface BudgetInput {
  aetherCost: number;
  category: CardDefinition['category'];
  attackRange: number;
  damageType: CardDefinition['damageType'];
  splashRadius: number;
  targetPriority: CardDefinition['targetPriority'];
  speedClass: CardDefinition['speedClass'];
  isFlying: boolean;
  spawnCount: number;
  /** Champions get a budget bonus for their one-at-a-time constraint. */
  isHero?: boolean;
  /** Buildings that decay rent their stats rather than owning them. */
  lifetimeSeconds?: number;
  /** EPP spent on a named passive, if any. */
  passiveId?: string;
  /** Extra EPP for a bespoke mechanic with no registry entry. */
  extraAbilityEpp?: number;
}

export interface Budget {
  /** Raw allowance before any modifier. */
  rawEpp: number;
  /** Allowance left after paying for special mechanics. */
  spentOnAbility: number;
  adjustedEpp: number;
  /** Health for the whole card — divided across units for a swarm. */
  healthBudget: number;
  /** Damage per second for the whole card. */
  dpsBudget: number;
  /** Per-unit values once the swarm split is applied. */
  healthPerUnit: number;
  dpsPerUnit: number;
  /** Every multiplier that was applied, for display and for debugging. */
  modifiers: Array<{ label: string; target: 'hp' | 'dps'; multiplier: number }>;
}

export function computeBudget(input: BudgetInput): Budget {
  const rawEpp = input.aetherCost * EPP_PER_AETHER;
  const spentOnAbility = passiveCost(input.passiveId ?? 'none') + (input.extraAbilityEpp ?? 0);
  // A mechanic can never eat the entire budget — a card with no stats is not a
  // card. Anything asking for more than 60% is clamped and shows as over budget.
  const adjustedEpp = Math.max(rawEpp * 0.4, rawEpp - spentOnAbility);

  const modifiers: Budget['modifiers'] = [];
  const hpShare = HP_SHARE[input.category];

  const units = Math.max(1, input.spawnCount);
  const swarmBonus = 1 + SWARM_BUDGET_PER_EXTRA_UNIT * (units - 1);
  if (units > 1) {
    modifiers.push({ label: `${units}-unit swarm`, target: 'hp', multiplier: swarmBonus });
  }

  const championBonus = input.isHero ? CHAMPION_BUDGET_BONUS : 1;
  if (input.isHero) {
    modifiers.push({ label: 'champion', target: 'hp', multiplier: championBonus });
  }

  const decayBonus =
    input.category === 'Building' && (input.lifetimeSeconds ?? 0) > 0
      ? DECAYING_BUILDING_BUDGET_BONUS
      : 1;
  if (decayBonus !== 1) {
    modifiers.push({ label: 'decaying', target: 'hp', multiplier: decayBonus });
  }

  const spendable = adjustedEpp * STAT_EFFICIENCY * swarmBonus * championBonus * decayBonus;

  let healthBudget = spendable * hpShare;
  let dpsEpp = spendable * (1 - hpShare);

  // --- health-side penalties ---
  const rangeBand = rangeBandFor(input.attackRange);
  const rangeMultiplier = RANGE_HP_MULTIPLIER[rangeBand];
  if (rangeMultiplier !== 1) {
    healthBudget *= rangeMultiplier;
    modifiers.push({ label: `${rangeBand} range`, target: 'hp', multiplier: rangeMultiplier });
  }

  if (input.isFlying) {
    healthBudget *= FLYING_HP_MULTIPLIER;
    modifiers.push({ label: 'flying', target: 'hp', multiplier: FLYING_HP_MULTIPLIER });
  }

  if (input.speedClass === 'VeryFast') {
    healthBudget *= VERY_FAST_HP_MULTIPLIER;
    modifiers.push({ label: 'very fast', target: 'hp', multiplier: VERY_FAST_HP_MULTIPLIER });
  }

  // --- damage-side penalties ---
  const splashBand = splashBandFor(input);
  const splashMultiplier = SPLASH_DPS_MULTIPLIER[splashBand];
  if (splashMultiplier !== 1) {
    dpsEpp *= splashMultiplier;
    modifiers.push({ label: `${splashBand} splash`, target: 'dps', multiplier: splashMultiplier });
  }

  if (input.targetPriority === 'AirAndGround') {
    dpsEpp *= AIR_AND_GROUND_DPS_MULTIPLIER;
    modifiers.push({
      label: 'air & ground',
      target: 'dps',
      multiplier: AIR_AND_GROUND_DPS_MULTIPLIER,
    });
  } else if (input.targetPriority === 'Buildings') {
    dpsEpp *= BUILDINGS_ONLY_DPS_MULTIPLIER;
    modifiers.push({
      label: 'buildings only',
      target: 'dps',
      multiplier: BUILDINGS_ONLY_DPS_MULTIPLIER,
    });
  }

  const dpsBudget = dpsEpp / DAMAGE_WINDOW_SECONDS;

  return {
    rawEpp,
    spentOnAbility,
    adjustedEpp,
    healthBudget: Math.round(healthBudget),
    dpsBudget: Math.round(dpsBudget),
    // A swarm divides the whole budget across its members, which is what drops
    // each one into a one-shot spell threshold and keeps clear counters.
    healthPerUnit: Math.round(healthBudget / units),
    dpsPerUnit: Math.round(dpsBudget / units),
    modifiers,
  };
}

// ---------------------------------------------------------------------------
// Auditing an existing card
// ---------------------------------------------------------------------------

export interface BalanceAudit {
  budget: Budget;
  /** What the card actually has, per unit. */
  actualHealthPerUnit: number;
  actualDpsPerUnit: number;
  /** Combined EPP the card actually spends. */
  actualEpp: number;
  /** actualEpp / adjustedEpp. 1.0 is exactly on budget. */
  ratio: number;
  /** How far outside tolerance, as a signed percentage. 0 when within. */
  variancePercent: number;
  withinTolerance: boolean;
  notes: string[];
}

/**
 * Cards are hand-tuned, so an exact match is neither achievable nor desirable.
 * This is the band inside which a card counts as balanced.
 */
export const BALANCE_TOLERANCE = 0.45;

export function budgetInputFor(card: CardDefinition, passiveId?: string): BudgetInput {
  return {
    aetherCost: card.aetherCost,
    category: card.category,
    attackRange: card.attackRange,
    damageType: card.damageType,
    splashRadius: card.splashRadius,
    targetPriority: card.targetPriority,
    speedClass: card.speedClass,
    isFlying: card.isFlying,
    spawnCount: card.spawnCount,
    isHero: card.isHero,
    lifetimeSeconds: card.lifetimeSeconds,
    passiveId: passiveId ?? card.passiveId,
  };
}

export function auditCard(card: CardDefinition): BalanceAudit {
  const budget = computeBudget(budgetInputFor(card));
  const notes: string[] = [];

  const actualHealthPerUnit = card.baseHealth + card.shieldHealth;
  const actualDpsPerUnit = card.hitSpeed > 0 ? card.damage / card.hitSpeed : 0;

  const units = Math.max(1, card.spawnCount);
  const actualEpp =
    actualHealthPerUnit * units + actualDpsPerUnit * units * DAMAGE_WINDOW_SECONDS;

  // Compare against the budget *after* modifiers, not the raw allowance.
  // Measuring a long-range flier against its unpenalised budget would report
  // every such card as wildly under-powered, because the penalties it already
  // paid are exactly why its stats are low.
  const effectiveBudget = budget.healthBudget + budget.dpsBudget * DAMAGE_WINDOW_SECONDS;
  const ratio = effectiveBudget > 0 ? actualEpp / effectiveBudget : 0;
  const withinTolerance = Math.abs(ratio - 1) <= BALANCE_TOLERANCE;
  const variancePercent = withinTolerance
    ? 0
    : Math.round((ratio - 1) * 100 - Math.sign(ratio - 1) * BALANCE_TOLERANCE * 100);

  if (ratio > 1 + BALANCE_TOLERANCE) notes.push('Over budget — reduce health, damage, or count.');
  if (ratio < 1 - BALANCE_TOLERANCE) notes.push('Under budget — this card will feel weak.');
  if (budget.spentOnAbility > budget.rawEpp * 0.6) {
    notes.push('The passive costs more than 60% of the raw budget; stats were floored.');
  }
  if (card.category !== 'Spell' && rangeBandFor(card.attackRange) === 'long') {
    notes.push('Long range: health should sit in the spell-killable band.');
  }

  return {
    budget,
    actualHealthPerUnit,
    actualDpsPerUnit: Math.round(actualDpsPerUnit * 10) / 10,
    actualEpp: Math.round(actualEpp),
    ratio: Math.round(ratio * 100) / 100,
    variancePercent,
    withinTolerance,
    notes,
  };
}

// ---------------------------------------------------------------------------
// Spell breakpoints
// ---------------------------------------------------------------------------

/**
 * Spells are not balanced by EPP — they are balanced by *what they kill*.
 * A spell's whole identity is which troops it removes from the board, so the
 * benchmarks below are the real specification and the EPP model does not apply.
 */
export interface SpellBreakpoint {
  spellId: string;
  /** Card ids this spell must kill outright at equal level. */
  mustKill: string[];
  /** Card ids that must survive, with roughly this share of health left. */
  mustSurvive: Array<{ cardId: string; minHealthFraction: number }>;
}

export const SPELL_BREAKPOINTS: readonly SpellBreakpoint[] = [
  {
    spellId: 'card_spell_zap',
    mustKill: ['card_troop_skeletons', 'card_troop_goblins', 'card_troop_spear_goblins'],
    mustSurvive: [{ cardId: 'card_troop_archers', minHealthFraction: 0.2 }],
  },
  {
    spellId: 'card_spell_arrows',
    mustKill: [
      'card_troop_skeletons',
      'card_troop_goblins',
      'card_troop_spear_goblins',
      'card_troop_minions',
      'card_troop_archers',
    ],
    mustSurvive: [{ cardId: 'card_troop_musketeer', minHealthFraction: 0.3 }],
  },
  {
    spellId: 'card_spell_fireball',
    // Glass-cannon ranged troops must die; mini-tanks must live at roughly 40%.
    mustKill: ['card_troop_musketeer', 'card_troop_wizard', 'card_troop_archers'],
    mustSurvive: [
      { cardId: 'card_troop_knight', minHealthFraction: 0.3 },
      { cardId: 'card_troop_valkyrie', minHealthFraction: 0.5 },
    ],
  },
];

/** Damage a spell actually deals to a Crown Tower, after the cap. */
export function crownTowerDamage(spellDamage: number): number {
  return Math.round(spellDamage * CROWN_TOWER_DAMAGE_FACTOR);
}
