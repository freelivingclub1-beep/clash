/**
 * Layer one — FRAME (design doc §4).
 *
 * Thirteen sliders, seven named notches each. The player never sees a number:
 * they see a notch name and a silhouette. Everything downstream of this file is
 * hidden machinery.
 *
 * Convention used throughout: a slider's *heavy* end (notch index 6) is the end
 * listed under "Gains" in the doc's table, and the *light* end (index 0) is the
 * refund. `standard` sits at index 3, so the working number for every formula is
 *
 *     n = index - 3       // -3 .. +3
 */

import { clamp } from "../core/rng.ts";

export const SLIDER_KEYS = [
  "chestDepth",
  "legLength",
  "backLength",
  "pawSpread",
  "skullWidth",
  "muzzleLength",
  "earCarriage",
  "coatLength",
  "coatDensity",
  "tailSet",
  "bone",
  "shoulderSlope",
  "hipAngle",
] as const;

export type SliderKey = (typeof SLIDER_KEYS)[number];

export type Frame = Record<SliderKey, number>;

export type SliderDef = {
  readonly key: SliderKey;
  readonly label: string;
  /** Seven notch names, light -> heavy. */
  readonly notches: readonly [string, string, string, string, string, string, string];
  /** Mass units spent per notch above `standard` (refunded per notch below). */
  readonly massPerNotch: number;
  readonly gains: string;
  readonly costs: string;
};

export const SLIDERS: readonly SliderDef[] = [
  {
    key: "chestDepth",
    label: "Chest depth",
    notches: ["slight", "lean", "light", "standard", "solid", "deep", "barrel"],
    massPerNotch: 1.4,
    gains: "lung capacity, stamina ceiling",
    costs: "mass, heat retention",
  },
  {
    key: "legLength",
    label: "Leg length",
    notches: ["stubby", "short", "low", "standard", "tall", "long", "rangy"],
    massPerNotch: 0.8,
    gains: "top speed, stride, water crossing",
    costs: "stability, climbing, tight turns",
  },
  {
    key: "backLength",
    label: "Back length",
    notches: ["compact", "short", "tight", "standard", "long", "stretched", "serpent"],
    massPerNotch: 0.7,
    gains: "agility, turn radius",
    costs: "power transfer, injury risk over distance",
  },
  {
    key: "pawSpread",
    label: "Paw spread",
    notches: ["pin", "narrow", "tight", "standard", "broad", "wide", "splayed"],
    massPerNotch: 0.4,
    gains: "snow, sand, mud",
    costs: "speed on rock, pad wear",
  },
  {
    key: "skullWidth",
    label: "Skull width",
    notches: ["fine", "narrow", "slim", "standard", "broad", "wide", "blocky"],
    massPerNotch: 0.9,
    gains: "nerve, contest, impact tolerance",
    costs: "heat shedding, mass",
  },
  {
    key: "muzzleLength",
    label: "Muzzle length",
    notches: ["snub", "short", "brief", "standard", "long", "reach", "needle"],
    massPerNotch: 0.2,
    gains: "cooling, scent range",
    costs: "cold-air intake, fragility",
  },
  {
    key: "earCarriage",
    label: "Ear carriage",
    notches: ["pinned", "tight", "low", "standard", "lifted", "high", "erect"],
    massPerNotch: 0.1,
    gains: "hearing orders in noise/wind",
    costs: "frostbite, injury in scrub",
  },
  {
    key: "coatLength",
    label: "Coat length",
    notches: ["bare", "thin", "short", "standard", "full", "long", "shag"],
    massPerNotch: 0.5,
    gains: "cold protection",
    costs: "heat, water weight, burr snag",
  },
  {
    key: "coatDensity",
    label: "Coat density",
    notches: ["sparse", "light", "open", "standard", "close", "dense", "plush"],
    massPerNotch: 0.5,
    gains: "wind, rain shedding",
    costs: "heat, drying time",
  },
  {
    key: "tailSet",
    label: "Tail set",
    notches: ["docked", "low", "dropped", "standard", "level", "high", "flag"],
    massPerNotch: 0.2,
    gains: "balance on ledge, turning",
    costs: "wind drag, visibility to rivals",
  },
  {
    key: "bone",
    label: "Bone",
    notches: ["fine", "light", "slim", "standard", "heavy", "thick", "dense"],
    massPerNotch: 1.6,
    gains: "durability, injury resistance",
    costs: "mass, acceleration",
  },
  {
    key: "shoulderSlope",
    label: "Shoulder slope",
    notches: ["upright", "steep", "forward", "standard", "laid", "open", "flat"],
    massPerNotch: 0.3,
    gains: "stride reach, flat speed",
    costs: "climbing power",
  },
  {
    key: "hipAngle",
    label: "Hip angle",
    notches: ["flat", "shallow", "low", "standard", "set", "deep", "cocked"],
    massPerNotch: 0.3,
    gains: "climbing drive, acceleration",
    costs: "flat-ground top speed",
  },
];

const SLIDER_BY_KEY = new Map(SLIDERS.map((s) => [s.key, s]));

export const STANDARD_NOTCH = 3;

/** Base mass budget in mass units, before Blood modifies it (see §5, Bear-frame). */
export const BASE_MASS_BUDGET = 6.0;

/** A dog with every slider at `standard`. */
export function standardFrame(): Frame {
  return Object.fromEntries(SLIDER_KEYS.map((k) => [k, STANDARD_NOTCH])) as Frame;
}

export function sliderDef(key: SliderKey): SliderDef {
  const def = SLIDER_BY_KEY.get(key);
  if (!def) throw new Error(`unknown slider: ${key}`);
  return def;
}

/** The notch name a player would read for this setting. */
export function notchName(key: SliderKey, index: number): string {
  return sliderDef(key).notches[clamp(Math.round(index), 0, 6)]!;
}

/** Working value for formulas: -3 (lightest) .. +3 (heaviest). */
export function n(frame: Frame, key: SliderKey): number {
  return frame[key] - STANDARD_NOTCH;
}

/** Mass units spent. Negative means the build has refunded mass. */
export function massSpent(frame: Frame): number {
  let total = 0;
  for (const def of SLIDERS) total += n(frame, def.key) * def.massPerNotch;
  return round2(total);
}

export type FrameValidation = {
  readonly ok: boolean;
  readonly spent: number;
  readonly budget: number;
  readonly problems: readonly string[];
};

export function validateFrame(frame: Frame, budget: number): FrameValidation {
  const problems: string[] = [];

  for (const key of SLIDER_KEYS) {
    const value = frame[key];
    if (!Number.isInteger(value) || value < 0 || value > 6) {
      problems.push(`${sliderDef(key).label} is off the slider (notch ${value})`);
    }
  }

  const spent = massSpent(frame);
  if (spent > budget + 1e-9) {
    problems.push(
      `over mass budget: ${spent.toFixed(1)} spent against ${budget.toFixed(1)} available`,
    );
  }

  return { ok: problems.length === 0, spent, budget, problems };
}

/**
 * Everything the sim actually reads. Multipliers hover around 1.0; scores that
 * represent a capacity are absolute. None of this is ever shown to a player.
 */
export type FrameProfile = {
  /** Body mass in kg. Real, and it costs stamina on every gradient. */
  readonly mass: number;
  readonly staminaCeiling: number;
  readonly flatSpeed: number;
  readonly acceleration: number;
  readonly climb: number;
  readonly descend: number;
  readonly agility: number;
  readonly powerTransfer: number;
  readonly ledgeBalance: number;
  readonly swim: number;
  readonly grip: {
    readonly rock: number;
    readonly mud: number;
    readonly sand: number;
    readonly snow: number;
    readonly scrub: number;
    readonly ice: number;
  };
  readonly padWear: number;
  readonly heatGain: number;
  readonly heatShed: number;
  readonly warmth: number;
  readonly coldIntake: number;
  readonly windDrag: number;
  readonly hearing: number;
  readonly scent: number;
  readonly durability: number;
  readonly distanceInjuryRisk: number;
  readonly scrubRisk: number;
  readonly frostbiteRisk: number;
  readonly contest: number;
  readonly conspicuous: number;
};

export function deriveFrameProfile(frame: Frame): FrameProfile {
  const chest = n(frame, "chestDepth");
  const leg = n(frame, "legLength");
  const back = n(frame, "backLength");
  const paw = n(frame, "pawSpread");
  const skull = n(frame, "skullWidth");
  const muzzle = n(frame, "muzzleLength");
  const ear = n(frame, "earCarriage");
  const coatLen = n(frame, "coatLength");
  const coatDen = n(frame, "coatDensity");
  const tail = n(frame, "tailSet");
  const boneN = n(frame, "bone");
  const shoulder = n(frame, "shoulderSlope");
  const hip = n(frame, "hipAngle");

  const mass = 24 + massSpent(frame) * 1.6;
  /** How far this dog is from an average 24 kg animal, as a multiplier-ready ratio. */
  const heaviness = (mass - 24) / 24;

  return {
    mass: round2(mass),
    staminaCeiling: 100 * (1 + 0.12 * chest) - Math.max(0, heaviness) * 8,

    flatSpeed: 1 + 0.055 * leg + 0.035 * shoulder - 0.025 * hip - 0.015 * boneN,
    acceleration: 1 + 0.06 * hip - 0.05 * boneN - 0.025 * leg - heaviness * 0.25,
    climb: 1 + 0.07 * hip - 0.045 * shoulder - 0.035 * leg - heaviness * 0.45,
    descend: 1 + 0.04 * hip + 0.03 * tail - 0.03 * leg - 0.02 * boneN,

    agility: 1 + 0.05 * back + 0.02 * tail - 0.03 * leg,
    powerTransfer: 1 - 0.04 * back + 0.03 * boneN,
    ledgeBalance: 1 + 0.05 * tail - 0.04 * leg + 0.02 * paw - heaviness * 0.2,
    swim: 1 + 0.05 * leg - 0.035 * coatLen - 0.02 * coatDen - heaviness * 0.15,

    grip: {
      rock: 1 - 0.035 * paw + 0.01 * boneN,
      mud: 1 + 0.04 * paw,
      sand: 1 + 0.045 * paw - heaviness * 0.2,
      snow: 1 + 0.045 * paw - heaviness * 0.15,
      scrub: 1 - 0.02 * leg - 0.015 * coatLen,
      ice: 1 + 0.02 * paw - 0.03 * leg,
    },
    padWear: 1 + 0.06 * paw,

    heatGain: 1 + 0.05 * coatLen + 0.045 * coatDen + 0.03 * skull + 0.02 * chest,
    heatShed: 1 + 0.05 * muzzle - 0.03 * skull - 0.04 * coatDen - 0.03 * coatLen,
    warmth: 1 + 0.06 * coatLen + 0.05 * coatDen,
    coldIntake: 1 + 0.04 * muzzle,
    windDrag: 1 + 0.03 * tail + 0.025 * coatLen - 0.02 * coatDen,

    hearing: 1 + 0.07 * ear,
    scent: 1 + 0.06 * muzzle,

    durability: 1 + 0.07 * boneN - 0.03 * back,
    distanceInjuryRisk: 1 + 0.06 * back - 0.04 * boneN,
    scrubRisk: 1 + 0.05 * ear + 0.04 * coatLen,
    frostbiteRisk: 1 + 0.05 * ear - 0.04 * coatLen,

    contest: 1 + 0.06 * skull + heaviness * 0.3,
    conspicuous: 1 + 0.08 * tail,
  };
}

/**
 * The one-sentence read of a build, the way the doc describes it:
 * "rangy, barrel-chested, thin-coated, fine-boned".
 *
 * Only sliders two or more notches off standard are worth mentioning — a dog
 * that is nearly standard everywhere should read as plain, not as a list.
 */
export function describeFrame(frame: Frame): string {
  const notable = SLIDERS.map((def) => ({ def, offset: n(frame, def.key) }))
    .filter((s) => Math.abs(s.offset) >= 2)
    .sort((a, b) => Math.abs(b.offset) - Math.abs(a.offset))
    .slice(0, 4)
    .map(({ def }) => `${notchName(def.key, frame[def.key])} ${def.label.toLowerCase()}`);

  return notable.length === 0 ? "an unremarkable, standard-built dog" : notable.join(", ");
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
