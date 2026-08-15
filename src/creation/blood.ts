/**
 * Layer two — BLOOD (design doc §5).
 *
 * Pick two of twenty lineages. Every one is a gift with a real cost, and the
 * pair is allowed to contradict itself — Ice-blood + Heat-shed is a build you
 * can make and will regret in exactly one season.
 *
 * A lineage is data: a bag of multipliers, caps and flags. Combining two is
 * multiplying the numbers, taking the tightest of the caps, and unioning the
 * flags. Nothing here reads the race sim, and the race sim only reads the
 * combined profile — so adding a 21st lineage is a data change.
 */

import type { SliderKey } from "./frame.ts";
import type { MindTrait } from "./mind.ts";
import type { Terrain } from "../core/world.ts";

export const BLOOD_FLAGS = [
  "iron-gut",
  "quick-heal",
  "scars-never-set",
  "silent-foot",
  "thick-pad",
  "night-eye",
  "high-nose",
  "long-wind",
  "storm-born",
  "ash-lung",
  "hare-heart",
  "bear-frame",
  "old-blood",
  "ghost-mark",
  "glass-back",
  "root-hold",
  "water-hair",
  "wolf-strain",
  "ice-blood",
  "deep-lung",
  "heat-shed",
] as const;

export type BloodFlag = (typeof BLOOD_FLAGS)[number];

/**
 * Every field is optional and every numeric field is a multiplier that defaults
 * to 1 — so a lineage only states what it changes.
 */
export type BloodEffects = {
  readonly massBudgetMult?: number;
  readonly staminaCeilingMult?: number;
  readonly recoveryMult?: number;
  readonly healRateMult?: number;
  readonly learnRateMult?: number;
  readonly ageRateMult?: number;
  readonly weightGainMult?: number;

  readonly terrain?: Partial<Record<Terrain, number>>;

  readonly coldPenaltyMult?: number;
  readonly heatPenaltyMult?: number;
  readonly heatGainMult?: number;
  readonly heatShedMult?: number;
  readonly windPenaltyMult?: number;
  readonly rainPenaltyMult?: number;
  readonly darknessPenaltyMult?: number;
  readonly glarePenaltyMult?: number;
  readonly humidityPenaltyMult?: number;
  readonly altitudePenaltyMult?: number;
  readonly dustPenaltyMult?: number;
  /** Morale bleed in dead calm and silence — Storm-born only. */
  readonly calmUnsettle?: number;

  readonly flatSpeedMult?: number;
  readonly climbMult?: number;
  readonly accelerationMult?: number;
  readonly burstMult?: number;
  readonly agilityMult?: number;
  readonly ledgeBalanceMult?: number;
  readonly swimMult?: number;
  readonly wetSpeedMult?: number;
  readonly padWearMult?: number;

  readonly injuryRiskMult?: number;
  readonly distanceInjuryRiskMult?: number;

  /** Lower is steadier. Long-wind is the flattest pace in the game. */
  readonly paceVariance?: number;
  /** How far ahead the dog reads caches, forks and hazards. */
  readonly detection?: number;
  /** Chance-weight of wandering off a known line. */
  readonly divertRisk?: number;

  readonly obedienceMult?: number;
  readonly bondGainMult?: number;

  readonly sprintGear?: boolean;
  readonly canDraft?: boolean;
  readonly contestedByRivals?: boolean;
  readonly dryInstantly?: boolean;

  readonly mindCeiling?: Partial<Record<MindTrait, number>>;
  readonly mindFloor?: Partial<Record<MindTrait, number>>;
  readonly frameMax?: Partial<Record<SliderKey, number>>;
  readonly frameMin?: Partial<Record<SliderKey, number>>;

  readonly flags?: readonly BloodFlag[];
};

export type Lineage = {
  readonly id: string;
  readonly name: string;
  readonly gift: string;
  readonly cost: string;
  readonly effects: BloodEffects;
};

export const LINEAGES: readonly Lineage[] = [
  {
    id: "ice-blood",
    name: "Ice-blood",
    gift: "No cold penalty; gains in snow",
    cost: "Severe heat penalty",
    effects: {
      coldPenaltyMult: 0,
      heatPenaltyMult: 1.9,
      heatGainMult: 1.2,
      terrain: { snow: 1.12 },
      flags: ["ice-blood"],
    },
  },
  {
    id: "deep-lung",
    name: "Deep-lung",
    gift: "+stamina ceiling",
    cost: "Slow recovery between races",
    effects: { staminaCeilingMult: 1.18, recoveryMult: 0.6, flags: ["deep-lung"] },
  },
  {
    id: "iron-gut",
    name: "Iron-gut",
    gift: "Digests anything; no bad-feed events",
    cost: "Gains weight fast; must be managed",
    effects: { weightGainMult: 1.6, flags: ["iron-gut"] },
  },
  {
    id: "night-eye",
    name: "Night-eye",
    gift: "No darkness penalty",
    cost: "Dazzled at dawn starts and high noon",
    effects: { darknessPenaltyMult: 0, glarePenaltyMult: 2.2, flags: ["night-eye"] },
  },
  {
    id: "silent-foot",
    name: "Silent-foot",
    gift: "Surefooted on rock and ledge",
    cost: "Poor traction in mud",
    effects: {
      terrain: { rock: 1.12, mud: 0.86 },
      ledgeBalanceMult: 1.18,
      flags: ["silent-foot"],
    },
  },
  {
    id: "quick-heal",
    name: "Quick-heal",
    gift: "Injuries resolve in days not weeks",
    cost: "Scars never set — loses all scar bonuses",
    effects: { healRateMult: 3.5, flags: ["quick-heal", "scars-never-set"] },
  },
  {
    id: "heat-shed",
    name: "Heat-shed",
    gift: "Excellent cooling",
    cost: "Cannot exceed `short` coat length",
    effects: { heatShedMult: 1.4, frameMax: { coatLength: 2 }, flags: ["heat-shed"] },
  },
  {
    id: "thick-pad",
    name: "Thick-pad",
    gift: "No pad wear on rock or gravel",
    cost: "Reduced grip on ice",
    effects: { padWearMult: 0, terrain: { ice: 0.86 }, flags: ["thick-pad"] },
  },
  {
    id: "wolf-strain",
    name: "Wolf-strain",
    gift: "Raises Want and Spite ceilings to 6",
    cost: "Hard obedience penalty; bond builds slowly",
    effects: {
      mindCeiling: { want: 6, spite: 6 },
      obedienceMult: 0.72,
      bondGainMult: 0.45,
      flags: ["wolf-strain"],
    },
  },
  {
    id: "water-hair",
    name: "Water-hair",
    gift: "Swims strongly; sheds water instantly",
    cost: "Heavy and slow while wet",
    effects: {
      swimMult: 1.35,
      terrain: { water: 1.25 },
      wetSpeedMult: 0.84,
      dryInstantly: true,
      flags: ["water-hair"],
    },
  },
  {
    id: "high-nose",
    name: "High-nose",
    gift: "Detects caches, shortcuts, hazards early",
    cost: "Easily distracted; may divert",
    effects: { detection: 1.7, divertRisk: 1.5, flags: ["high-nose"] },
  },
  {
    id: "long-wind",
    name: "Long-wind",
    gift: "Extremely consistent pace",
    cost: "No sprint gear at all",
    effects: { paceVariance: 0.3, sprintGear: false, flags: ["long-wind"] },
  },
  {
    id: "storm-born",
    name: "Storm-born",
    gift: "Ignores wind and rain",
    cost: "Unsettled in dead calm and silence",
    effects: {
      windPenaltyMult: 0,
      rainPenaltyMult: 0,
      calmUnsettle: 0.9,
      flags: ["storm-born"],
    },
  },
  {
    id: "ash-lung",
    name: "Ash-lung",
    gift: "Immune to smoke, dust, altitude",
    cost: "Weak in humidity",
    effects: {
      dustPenaltyMult: 0,
      altitudePenaltyMult: 0,
      humidityPenaltyMult: 1.8,
      flags: ["ash-lung"],
    },
  },
  {
    id: "hare-heart",
    name: "Hare-heart",
    gift: "Explosive burst; best acceleration in game",
    cost: "Panics under contest; Nerve capped at 2",
    effects: {
      burstMult: 1.4,
      accelerationMult: 1.22,
      mindCeiling: { nerve: 2 },
      flags: ["hare-heart"],
    },
  },
  {
    id: "bear-frame",
    name: "Bear-frame",
    gift: "+40% mass budget",
    cost: "Heat; poor acceleration",
    effects: {
      massBudgetMult: 1.4,
      heatGainMult: 1.25,
      accelerationMult: 0.84,
      flags: ["bear-frame"],
    },
  },
  {
    id: "old-blood",
    name: "Old-blood",
    gift: "Ages at half rate; long career",
    cost: "Learns at half rate",
    effects: { ageRateMult: 0.5, learnRateMult: 0.5, flags: ["old-blood"] },
  },
  {
    id: "ghost-mark",
    name: "Ghost-mark",
    gift: "Rivals don't contest or crowd it",
    cost: "Cannot draft behind others",
    effects: { contestedByRivals: false, canDraft: false, flags: ["ghost-mark"] },
  },
  {
    id: "glass-back",
    name: "Glass-back",
    gift: "Highest agility in game",
    cost: "Long-course injury risk doubled",
    effects: { agilityMult: 1.28, distanceInjuryRiskMult: 2.0, flags: ["glass-back"] },
  },
  {
    id: "root-hold",
    name: "Root-hold",
    gift: "Best climber; unshakeable on gradient",
    cost: "Slowest flat speed in game",
    effects: {
      climbMult: 1.28,
      ledgeBalanceMult: 1.12,
      flatSpeedMult: 0.84,
      flags: ["root-hold"],
    },
  },
];

const LINEAGE_BY_ID = new Map(LINEAGES.map((l) => [l.id, l]));

export function lineage(id: string): Lineage {
  const found = LINEAGE_BY_ID.get(id);
  if (!found) throw new Error(`unknown lineage: ${id}`);
  return found;
}

/** A resolved pair, with every default filled in. */
export type BloodProfile = {
  readonly lineages: readonly [Lineage, Lineage];
  readonly massBudgetMult: number;
  readonly staminaCeilingMult: number;
  readonly recoveryMult: number;
  readonly healRateMult: number;
  readonly learnRateMult: number;
  readonly ageRateMult: number;
  readonly weightGainMult: number;
  readonly terrain: Record<Terrain, number>;
  readonly coldPenaltyMult: number;
  readonly heatPenaltyMult: number;
  readonly heatGainMult: number;
  readonly heatShedMult: number;
  readonly windPenaltyMult: number;
  readonly rainPenaltyMult: number;
  readonly darknessPenaltyMult: number;
  readonly glarePenaltyMult: number;
  readonly humidityPenaltyMult: number;
  readonly altitudePenaltyMult: number;
  readonly dustPenaltyMult: number;
  readonly calmUnsettle: number;
  readonly flatSpeedMult: number;
  readonly climbMult: number;
  readonly accelerationMult: number;
  readonly burstMult: number;
  readonly agilityMult: number;
  readonly ledgeBalanceMult: number;
  readonly swimMult: number;
  readonly wetSpeedMult: number;
  readonly padWearMult: number;
  readonly injuryRiskMult: number;
  readonly distanceInjuryRiskMult: number;
  readonly paceVariance: number;
  readonly detection: number;
  readonly divertRisk: number;
  readonly obedienceMult: number;
  readonly bondGainMult: number;
  readonly sprintGear: boolean;
  readonly canDraft: boolean;
  readonly contestedByRivals: boolean;
  readonly dryInstantly: boolean;
  readonly mindCeiling: Partial<Record<MindTrait, number>>;
  readonly mindFloor: Partial<Record<MindTrait, number>>;
  readonly frameMax: Partial<Record<SliderKey, number>>;
  readonly frameMin: Partial<Record<SliderKey, number>>;
  readonly flags: ReadonlySet<BloodFlag>;
};

export function combineBlood(firstId: string, secondId: string): BloodProfile {
  if (firstId === secondId) {
    throw new Error("a dog needs two different lineages");
  }
  const first = lineage(firstId);
  const second = lineage(secondId);
  const pair = [first.effects, second.effects];

  const mult = (pick: (e: BloodEffects) => number | undefined): number =>
    pair.reduce((acc, e) => acc * (pick(e) ?? 1), 1);

  const terrain = {} as Record<Terrain, number>;
  for (const e of pair) {
    for (const [key, value] of Object.entries(e.terrain ?? {})) {
      const t = key as Terrain;
      terrain[t] = (terrain[t] ?? 1) * value;
    }
  }

  const mindCeiling: Partial<Record<MindTrait, number>> = {};
  const mindFloor: Partial<Record<MindTrait, number>> = {};
  const frameMax: Partial<Record<SliderKey, number>> = {};
  const frameMin: Partial<Record<SliderKey, number>> = {};

  for (const e of pair) {
    // The tightest constraint always wins, so a lineage that raises a ceiling
    // never overrides one that lowers it.
    for (const [key, value] of Object.entries(e.mindCeiling ?? {})) {
      const t = key as MindTrait;
      mindCeiling[t] = Math.min(mindCeiling[t] ?? value, value);
    }
    for (const [key, value] of Object.entries(e.mindFloor ?? {})) {
      const t = key as MindTrait;
      mindFloor[t] = Math.max(mindFloor[t] ?? value, value);
    }
    for (const [key, value] of Object.entries(e.frameMax ?? {})) {
      const s = key as SliderKey;
      frameMax[s] = Math.min(frameMax[s] ?? value, value);
    }
    for (const [key, value] of Object.entries(e.frameMin ?? {})) {
      const s = key as SliderKey;
      frameMin[s] = Math.max(frameMin[s] ?? value, value);
    }
  }

  const flags = new Set<BloodFlag>();
  for (const e of pair) for (const f of e.flags ?? []) flags.add(f);

  return {
    lineages: [first, second],
    massBudgetMult: mult((e) => e.massBudgetMult),
    staminaCeilingMult: mult((e) => e.staminaCeilingMult),
    recoveryMult: mult((e) => e.recoveryMult),
    healRateMult: mult((e) => e.healRateMult),
    learnRateMult: mult((e) => e.learnRateMult),
    ageRateMult: mult((e) => e.ageRateMult),
    weightGainMult: mult((e) => e.weightGainMult),
    terrain,
    coldPenaltyMult: mult((e) => e.coldPenaltyMult),
    heatPenaltyMult: mult((e) => e.heatPenaltyMult),
    heatGainMult: mult((e) => e.heatGainMult),
    heatShedMult: mult((e) => e.heatShedMult),
    windPenaltyMult: mult((e) => e.windPenaltyMult),
    rainPenaltyMult: mult((e) => e.rainPenaltyMult),
    darknessPenaltyMult: mult((e) => e.darknessPenaltyMult),
    glarePenaltyMult: mult((e) => e.glarePenaltyMult),
    humidityPenaltyMult: mult((e) => e.humidityPenaltyMult),
    altitudePenaltyMult: mult((e) => e.altitudePenaltyMult),
    dustPenaltyMult: mult((e) => e.dustPenaltyMult),
    calmUnsettle: pair.reduce((acc, e) => acc + (e.calmUnsettle ?? 0), 0),
    flatSpeedMult: mult((e) => e.flatSpeedMult),
    climbMult: mult((e) => e.climbMult),
    accelerationMult: mult((e) => e.accelerationMult),
    burstMult: mult((e) => e.burstMult),
    agilityMult: mult((e) => e.agilityMult),
    ledgeBalanceMult: mult((e) => e.ledgeBalanceMult),
    swimMult: mult((e) => e.swimMult),
    wetSpeedMult: mult((e) => e.wetSpeedMult),
    padWearMult: mult((e) => e.padWearMult),
    injuryRiskMult: mult((e) => e.injuryRiskMult),
    distanceInjuryRiskMult: mult((e) => e.distanceInjuryRiskMult),
    paceVariance: mult((e) => e.paceVariance),
    detection: mult((e) => e.detection),
    divertRisk: mult((e) => e.divertRisk),
    obedienceMult: mult((e) => e.obedienceMult),
    bondGainMult: mult((e) => e.bondGainMult),
    sprintGear: pair.every((e) => e.sprintGear !== false),
    canDraft: pair.every((e) => e.canDraft !== false),
    contestedByRivals: pair.every((e) => e.contestedByRivals !== false),
    dryInstantly: pair.some((e) => e.dryInstantly === true),
    mindCeiling,
    mindFloor,
    frameMax,
    frameMin,
    flags,
  };
}

/** Terrain multiplier from blood, defaulting to neutral. */
export function bloodTerrain(blood: BloodProfile, terrain: Terrain): number {
  return blood.terrain[terrain] ?? 1;
}
