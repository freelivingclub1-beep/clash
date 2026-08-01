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
 * space, drawing fire, having a deploy time and a body that blocks.
 *
 * Calibrated against Clash Royale itself. Seventeen of our cards are direct
 * counterparts with the reference game's own numbers (see `@cards/clashReference`),
 * and at this factor those seventeen audit at a median of exactly 1.00.
 *
 * It briefly sat at 0.77, and that is worth recording as a cautionary tale.
 * The reference stats it was fitted to were wrong — every Rare had been scaled
 * to Tournament Standard with the *Common* multiplier, inflating it 21% (and
 * every Epic 60%). Fitting the model to those numbers moved the constant to
 * absorb the error, so the audit went quiet and the roster looked balanced
 * while Rares were systematically oversized. Correcting the source data put
 * this back within a hair of the 0.65 it started at.
 *
 * The lesson is about direction of fit: this constant may be tuned to match
 * the reference cards, but it must never be tuned to make a disagreement go
 * away. A model that suddenly needs a 15% nudge is reporting a data bug.
 */
export const STAT_EFFICIENCY = 0.67;

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
 * Direct spell damage to Crown Towers is capped at this share of its troop
 * damage, so no deck can win by chipping towers from hand.
 *
 * Clash Royale's own figure: every damage spell in its data carries
 * `crown_tower_damage_percent: -70`, i.e. towers take 30%.
 */
export const CROWN_TOWER_DAMAGE_FACTOR = 0.3;

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
  /**
   * The melee twin of the above. Priced a little higher because melee is what
   * most pushes lead with, so it fires more often in an average match.
   */
  reflect_melee: 290,
  /**
   * Bonus damage against anything already below half health.
   *
   * Cheap for how much damage it can add, because it adds none at all until
   * something else has done the first half of the work — and it is the
   * defender who chooses whether that ever happens.
   */
  execute_low_hp: 260,
  /**
   * The opening blow on each new victim is doubled.
   *
   * Priced well under `damage_ramp` despite a similar peak: the bonus is a
   * flat one-off per target rather than a curve, and a single big body blanks
   * it after one swing.
   */
  first_strike: 300,
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
  /**
   * Digs to any tile on the board, arriving untargetable and unseen.
   *
   * The most expensive positional mechanic in the table. Ignoring territory
   * entirely means it can start behind a tower, and no stat line can price
   * "your defence is in the wrong place" — only the dig time can, which is why
   * the card that carries it is deliberately fragile once it is up.
   */
  tunnel: 900,

  // --- the menagerie wave ---------------------------------------------------

  /** Heals itself for a share of what it deals. Worthless against burst. */
  lifesteal: 260,
  /**
   * Paints a target so *everything* hits it harder.
   *
   * Priced above what it does for the card carrying it, because the card
   * carrying it is not where the value lands — a marker played alone is two
   * aether of nothing, and played behind a committed push it is the largest
   * damage multiplier in the set.
   */
  mark_target: 300,
  /** One colossal opening blow out of stealth, then an ordinary body. */
  ambush: 280,
  /**
   * Gets back up once. Effectively a second health pool, so it is the dearest
   * of this wave; the discount against simply buying that much health is the
   * tempo it loses lying down, and that it returns where it fell.
   */
  revive_once: 380,
  /** Permanently stronger per kill. Fed by exactly the chaff that answers it. */
  harvest: 250,
  /** Damage scales with unobstructed distance run. Blocking early beats late. */
  momentum: 220,
  /** Negates one whole spell of any size. Spent by the cheapest one thrown. */
  spell_ward: 300,
  /** Permanently blunts what it hits. Decisive on bruisers, blank on towers. */
  sunder: 240,
  /** Echoes damage onto the victim's neighbours. Punishes tight formations. */
  tether: 270,
  /** Steady trickle of repair to everything near it. Beats chip, loses to burst. */
  aura_guard: 280,
  /** Strikes a second target in reach at the same instant, at full weight. */
  split_shot: 290,
  /** Drains the defender's aether while it connects. Attacks the clock. */
  siphon: 200,

  // --- pull, leap, provoke and the rest of the second mechanics wave -------
  /**
   * Drags everything hostile toward it, continuously.
   *
   * Priced above knockback rather than beside it. A push scatters a formation
   * and buys time; a pull gathers one, and a gathered formation is what every
   * splash card in the set is waiting for — so this is half of a two-card play
   * whose other half the opponent also has to answer.
   */
  vortex_pull: 340,
  /**
   * Yanks whatever it hits out of position, stunned on arrival.
   *
   * The only mechanic that answers a *formation* rather than a unit: the
   * support standing safely behind a tank is not safe. Dear because the play
   * it enables — hooking the one card that matters into your own bodies — has
   * no counter except spacing, which costs the opponent tempo either way.
   */
  hook_pull: 320,
  /**
   * Vaults past the front line and lands on what is behind it, with splash.
   *
   * The most expensive positional mechanic here, because it ignores the thing
   * defence is made of. Every cheap body in the game works by standing in the
   * way; this does not care.
   */
  leap_strike: 420,
  /**
   * Leaves a working turret where it died.
   *
   * Two cards of value out of one deployment, so it is priced as most of a
   * second card. The discount is that the wreck arrives where the fight
   * already went badly, which is rarely where you would have placed it.
   */
  wreckage: 360,
  /**
   * Hands the opponent aether when it dies. The only price below zero.
   *
   * Everything else in this table buys a mechanic out of the stat budget.
   * This sells a drawback back into it, which is what lets the card be
   * enormous for its cost — and what makes every one you lose fund the answer
   * to the next. Refunding less than a full card's cost is deliberate: a
   * drawback that paid for itself entirely would be no drawback at all.
   */
  gift_aether: -260,
  /**
   * Refuses one shot per window and returns it.
   *
   * Cheaper than `reflect_ranged` looks like it should be, because it fires
   * on a cooldown rather than on every hit: a fast shooter simply pays
   * through it, and only a slow heavy one is genuinely answered.
   */
  deflect: 270,
  /**
   * Forces everything nearby to attack it.
   *
   * The one defensive mechanic that protects things it is not standing in
   * front of. Priced as a heavy mechanic and paid for out of the health it
   * would otherwise have, so the answer is simply to kill it.
   */
  taunt: 330,
  /** Its blows stop the victim swinging back. Near-total against one big threat, blank against a swarm. */
  disarm: 300,
  /** Everything around it swings faster. Worth nothing alone, a great deal behind a push. */
  rally: 290,
  /** Holds and hurts the ground around it. Punishes a defence for standing still. */
  quicksand: 280,
  /**
   * Banks the blows it did not land into the next one.
   *
   * The inverse of `attack_ramp` and much cheaper, because it pays out once
   * and then resets — the ceiling is a single large hit rather than an
   * escalating stream that never stops.
   */
  overcharge: 310,
  /** Heals everything near it when it dies. Killing it is the heal. */
  bloodpact: 250,
  /**
   * Everything it kills comes back on your side.
   *
   * The dearest mechanic outside the spawners, and for the same reason: its
   * real cost is the aggregate value of everything it raises, which the audit
   * cannot see. Unlike a spawner it produces nothing on its own, so the price
   * is set for a card that is actually winning fights rather than one standing
   * in a lane emitting bodies on a timer.
   */
  soul_bind: 520,
  /**
   * Hits three bodies for full damage on one throw.
   *
   * Priced above `split_shot`, which strikes one extra, and above
   * `chain_attack`, which strikes several with falloff — this does neither.
   * Flat damage across three targets is three times the card's printed output
   * whenever a crowd obliges, and the audit only ever sees the printed figure.
   * The three-second reload is what keeps the average honest, and the price is
   * what stops a card pairing that reload with a large single hit.
   */
  boomerang: 400,
  /**
   * Tops nearby allies up to a small armour layer every few seconds.
   *
   * Dearer than the healing aura because overkill absorption means a point of
   * shield handed to a swarm is worth far more than a point of health: every
   * body it lands on eats one blow of any size, whatever that blow was.
   */
  aura_shield: 340,
  /** Becomes stronger below a health threshold. */
  enrage_low_hp: 190,
  /** First hit taken is absorbed by a shield. */
  spawn_shield: 160,
  /** Deals bonus damage to buildings and towers. */
  siege_bonus: 210,
  /** Leaves a damaging zone where it dies. */
  death_zone: 200,

  // --- second wave -------------------------------------------------------
  /** Bonus damage against flying targets. Narrow, so cheap. */
  air_superiority: 150,
  /** Bonus damage against shielded targets. Narrower still. */
  shield_breaker: 130,
  /** Detonates on its target, destroying itself. Huge burst, one use. */
  suicide_charge: 280,
  /** Enrages nearby allies while alive. */
  aura_damage: 270,
  /** Stronger while allies are close. Conditional, so cheaper than an aura. */
  pack_bond: 170,
  /** Maximum health climbs the longer it survives. */
  growth: 240,
  /** Untargetable while moving; surfaces only to attack. */
  burrow: 310,
  /**
   * Periodically spawns units for free.
   *
   * Priced far above the other passives on purpose: a spawner's real cost is
   * the aggregate value of everything it emits, not the mechanic itself. A
   * nest producing a Skeleton every 4s across a 40s life yields ten bodies —
   * roughly 4900 EPP of raw stats — so the spawner card itself must be
   * correspondingly weak or it is simply two cards for one aether cost.
   *
   * This flat figure is calibrated to that emission rate. A spawner emitting
   * something larger, or living longer, needs `extraAbilityEpp` on top rather
   * than reusing this number unchanged.
   */
  spawner: 2600,
  /** Reduced damage from attackers in front of it. */
  frontal_armor: 220,
  /** Splits incoming damage with the nearest ally. */
  damage_share: 230,
  /** Spawns a weakened copy of itself the first time it is hurt. */
  self_replicate: 290,
  /** Teleports next to the nearest enemy on deployment. */
  blink_strike: 200,
  /** Walks over the river, ignoring bridges entirely. */
  terrain_walk: 260,
  /** Accelerates over uninterrupted distance, then lands a doubled hit. */
  charge: 300,
  /**
   * Damage escalates the longer it stays on one target.
   *
   * By far the most expensive mechanic in the table, and it has to be: the
   * audit can only see base damage, and a card whose damage multiplies sevenfold
   * over a sustained bite is worth vastly more than that number suggests. The
   * price is what forces the stat line underneath it to be genuinely fragile.
   */
  damage_ramp: 2300,
};

export type PassiveId = keyof typeof PASSIVE_EPP_COST;

export function passiveCost(passiveId: string): number {
  return PASSIVE_EPP_COST[passiveId] ?? 0;
}

/**
 * What an on-hit status costs.
 *
 * These were free. A hundred and thirty-one cards in the roster deal plain
 * single-target damage and a hundred and fifty-five carry no status at all,
 * so the omission never bit — but it means any card that *does* carry one has
 * been getting it for nothing, and a wave of them would be a wave of strictly
 * better cards.
 *
 * Priced by how much of a fight the status takes away rather than by how
 * dramatic it looks. A slow costs the target a share of its output for the
 * duration; a freeze costs all of it; a reset costs one swing and is therefore
 * cheap on a slow attacker and dear on a fast one.
 */
export const STATUS_EPP_COST: Record<string, number> = {
  None: 0,
  /** Shaves speed and rate of fire. Small, constant, and stacks with itself. */
  Slow: 170,
  /** Takes the target out of the fight entirely for the duration. */
  Freeze: 320,
  /** Freeze without the movement lock — it keeps walking, it cannot swing. */
  Stun: 240,
  /** Pushes the target back, which buys distance rather than time. */
  Knockback: 190,
  /** Keeps working on buildings and towers, and outlives the attacker. */
  Poison: 210,
  /** Interrupts the wind-up. Devastating against slow heavy hitters. */
  ElectroReset: 230,
  /** Speeds an ally up. Priced with the offensive statuses because it is one. */
  Rage: 200,
  /** Repairs an ally. */
  Heal: 220,
};

/**
 * What a death effect costs.
 *
 * A card that leaves something behind is two cards in a trench coat, and the
 * second one arrives exactly when the opponent has committed to killing the
 * first. `SpawnDeathUnit` is priced per body by the caller, since dropping one
 * skeleton and dropping six are not the same mechanic.
 */
export const DEATH_EFFECT_EPP_COST: Record<string, number> = {
  None: 0,
  /** A blast where it fell. Guaranteed value: dying is not optional. */
  DeathBomb: 190,
  /** A whole spell, cast for free, at the worst possible moment for the killer. */
  DeathSpell: 260,
  /** Bodies. Priced per unit on top of this. */
  SpawnDeathUnit: 90,
};

/** Each extra body a `SpawnDeathUnit` card leaves behind. */
export const DEATH_UNIT_EPP = 110;

export function statusCost(status: string): number {
  return STATUS_EPP_COST[status] ?? 0;
}

export function deathEffectCost(effect: string, count: number): number {
  const base = DEATH_EFFECT_EPP_COST[effect] ?? 0;
  return effect === 'SpawnDeathUnit' ? base + DEATH_UNIT_EPP * Math.max(0, count) : base;
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
  /** On-hit status the card applies, if any. */
  onHitStatus?: string;
  /** What it leaves behind when it dies. */
  deathEffect?: string;
  deathEffectCount?: number;
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
  const spentOnAbility =
    passiveCost(input.passiveId ?? 'none') +
    statusCost(input.onHitStatus ?? 'None') +
    deathEffectCost(input.deathEffect ?? 'None', input.deathEffectCount ?? 0) +
    (input.extraAbilityEpp ?? 0);
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
 * A point of shield is worth more than a point of health.
 *
 * Shields absorb overkill: a single hit of any size costs exactly the shield
 * and nothing more, which makes shielded units immune to burst damage in a way
 * no amount of raw health achieves. Counting shield 1:1 with health let a card
 * buy that immunity at face value, so the audit weights it.
 */
export const SHIELD_EPP_WEIGHT = 1.6;

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
    onHitStatus: card.onHitStatus,
    deathEffect: card.deathEffect,
    deathEffectCount: card.deathEffectCount,
  };
}

export function auditCard(card: CardDefinition): BalanceAudit {
  const budget = computeBudget(budgetInputFor(card));
  const notes: string[] = [];

  const actualHealthPerUnit = card.baseHealth + Math.round(card.shieldHealth * SHIELD_EPP_WEIGHT);
  const actualDpsPerUnit = card.hitSpeed > 0 ? card.damage / card.hitSpeed : 0;

  const units = Math.max(1, card.spawnCount);
  const actualEpp =
    actualHealthPerUnit * units + actualDpsPerUnit * units * DAMAGE_WINDOW_SECONDS;

  /*
   * Compare against the budget *after* modifiers, not the raw allowance.
   * Measuring a long-range flier against its unpenalised budget would report
   * every such card as wildly under-powered, because the penalties it already
   * paid are exactly why its stats are low.
   *
   * A card that deals no damage still gets charged for a damage allowance it
   * cannot spend, which is correct rather than a gap: the allowance is what
   * such a card must convert into health to be worth its cost. It just means
   * a healing stone or a wall has to be *much* sturdier than its health budget
   * alone suggests, and the audit is where that shows up.
   */
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
    /*
     * Zap does not kill Goblins, and that is the correct, current Clash
     * Royale interaction rather than an oversight: 192 damage against 202
     * health leaves them standing on ten. It is exactly why a Zap deck still
     * has to carry a second answer to a Goblin pack.
     */
    spellId: 'card_spell_zap',
    mustKill: ['card_troop_skeletons', 'card_troop_spear_goblins'],
    mustSurvive: [
      { cardId: 'card_troop_goblins', minHealthFraction: 0.02 },
      { cardId: 'card_troop_archers', minHealthFraction: 0.3 },
    ],
  },
  {
    // Arrows clears the swarm tier and leaves Archers alive on sixteen health.
    spellId: 'card_spell_arrows',
    mustKill: [
      'card_troop_skeletons',
      'card_troop_goblins',
      'card_troop_spear_goblins',
      'card_troop_minions',
    ],
    mustSurvive: [{ cardId: 'card_troop_archers', minHealthFraction: 0.02 }],
  },
  {
    // Sunbeam is our own card: Arrows' kill list over a much tighter blast,
    // which is what a whole aether of radius is worth.
    spellId: 'card_spell_sunbeam',
    mustKill: [
      'card_troop_skeletons',
      'card_troop_goblins',
      'card_troop_spear_goblins',
      'card_troop_minions',
    ],
    mustSurvive: [{ cardId: 'card_troop_musketeer', minHealthFraction: 0.35 }],
  },
  {
    /*
     * Fireball does not kill a Musketeer either — 832 against 870 leaves
     * thirty-eight. That single interaction is most of what makes Fireball a
     * skill card in the reference game: it needs a tower tick, a Zap, or a
     * higher level to finish the job, and playing it as though it were lethal
     * is the mistake.
     */
    spellId: 'card_spell_fireball',
    mustKill: ['card_troop_archers', 'card_troop_minions', 'card_troop_goblins'],
    mustSurvive: [
      { cardId: 'card_troop_musketeer', minHealthFraction: 0.02 },
      { cardId: 'card_troop_wizard', minHealthFraction: 0.02 },
      { cardId: 'card_troop_knight', minHealthFraction: 0.3 },
    ],
  },
  {
    /*
     * Splinter Bomb is Fireball's kill list for one less aether, bought with
     * a blast barely wider than a single body. It cannot finish a Musketeer
     * either — nothing at this cost should.
     */
    spellId: 'card_spell_splinter_bomb',
    mustKill: ['card_troop_archers', 'card_troop_minions', 'card_troop_goblins'],
    mustSurvive: [
      { cardId: 'card_troop_musketeer', minHealthFraction: 0.1 },
      { cardId: 'card_troop_knight', minHealthFraction: 0.4 },
    ],
  },
];

/** Damage a spell actually deals to a Crown Tower, after the cap. */
export function crownTowerDamage(spellDamage: number): number {
  return Math.round(spellDamage * CROWN_TOWER_DAMAGE_FACTOR);
}
