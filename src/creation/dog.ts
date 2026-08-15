/**
 * Assembling a dog from the four creation layers.
 *
 * The player authors Frame, Blood, History and Mind. What comes out the other
 * side is not quite what they authored, because of the hidden nature roll (§2:
 * "Two players who match all their creation choices exactly get different
 * animals"). That roll is seeded per dog and never shown, and it is the reason
 * a shared build order is not a shared dog.
 */

import { Rng, clamp } from "../core/rng.ts";
import {
  BASE_MASS_BUDGET,
  SLIDERS,
  SLIDER_KEYS,
  deriveFrameProfile,
  describeFrame,
  notchName as frameNotch,
  sliderDef,
  standardFrame,
  validateFrame,
  type Frame,
  type FrameProfile,
} from "./frame.ts";
import { LINEAGES, combineBlood, type BloodProfile } from "./blood.ts";
import {
  CHAPTERS,
  describeHooks,
  resolveHistory,
  type History,
  type Hook,
} from "./history.ts";
import {
  MIND_MAX,
  MIND_MIN,
  MIND_TRAITS,
  ceilingFor,
  describeMind,
  evenMind,
  floorFor,
  validateMind,
  type Mind,
  type MindLimits,
  type MindTrait,
} from "./mind.ts";

export type DogSpec = {
  readonly name: string;
  readonly frame: Frame;
  /** Exactly two lineage ids. */
  readonly blood: readonly [string, string];
  readonly history: History;
  /** The 36 points the player allocated. */
  readonly mind: Mind;
};

export type Dog = {
  readonly id: string;
  readonly name: string;
  readonly spec: DogSpec;
  readonly frameProfile: FrameProfile;
  readonly blood: BloodProfile;
  /** What the dog actually is: allocation + history + hidden nature. */
  readonly mind: Mind;
  /** Drift is bounded to +/-2 around this (§7). */
  readonly mindAnchor: Mind;
  readonly hooks: readonly Hook[];
  /** 0.4 - 0.95. Earned, never set (§8). */
  readonly bond: number;
  /** 0 - 1. Today's condition. */
  readonly condition: number;
  readonly seed: string;
};

export class CreationError extends Error {
  readonly problems: readonly string[];
  constructor(problems: readonly string[]) {
    super(`this dog cannot be built:\n  - ${problems.join("\n  - ")}`);
    this.name = "CreationError";
    this.problems = problems;
  }
}

export type CreateOptions = {
  readonly bond?: number;
  readonly condition?: number;
};

export function createDog(spec: DogSpec, seed: string, options: CreateOptions = {}): Dog {
  const blood = combineBlood(spec.blood[0], spec.blood[1]);
  const limits: MindLimits = { ceilings: blood.mindCeiling, floors: blood.mindFloor };
  const problems: string[] = [];

  const budget = BASE_MASS_BUDGET * blood.massBudgetMult;
  const frameCheck = validateFrame(spec.frame, budget);
  problems.push(...frameCheck.problems);

  for (const key of SLIDER_KEYS) {
    const max = blood.frameMax[key];
    const min = blood.frameMin[key];
    if (max !== undefined && spec.frame[key] > max) {
      problems.push(
        `${sliderDef(key).label} cannot exceed ${frameNotch(key, max)} for this dog's blood`,
      );
    }
    if (min !== undefined && spec.frame[key] < min) {
      problems.push(
        `${sliderDef(key).label} cannot sit below ${frameNotch(key, min)} for this dog's blood`,
      );
    }
  }

  problems.push(...validateMind(spec.mind, limits).problems);

  for (const chapterDef of CHAPTERS) {
    if (spec.history[chapterDef.id] === undefined) {
      problems.push(`history is missing a chapter: ${chapterDef.prompt}`);
    }
  }

  if (problems.length > 0) throw new CreationError(problems);

  const effects = resolveHistory(spec.history);
  const mind = settleMind(spec.mind, effects.mind, effects.natureSpread, limits, seed);

  return {
    id: seed,
    name: spec.name,
    spec,
    frameProfile: deriveFrameProfile(spec.frame),
    blood,
    mind,
    mindAnchor: { ...mind },
    hooks: effects.hooks,
    bond: clamp(options.bond ?? 0.55, 0.4, 0.95),
    condition: clamp(options.condition ?? 0.85, 0, 1),
    seed,
  };
}

/**
 * Allocation + history + the hidden nature roll, clamped into everything that
 * constrains a trait. Nature touches two to four traits by one notch.
 */
function settleMind(
  allocated: Mind,
  historyDelta: Partial<Record<MindTrait, number>>,
  natureSpread: number,
  limits: MindLimits,
  seed: string,
): Mind {
  const rng = new Rng(`${seed}:nature`);
  const touched = rng.pickMany(MIND_TRAITS, 2 + Math.round(clamp(natureSpread, 0, 1) * 2));

  const mind = {} as Mind;
  for (const trait of MIND_TRAITS) {
    const nature = touched.includes(trait) ? (rng.chance(0.5) ? 1 : -1) : 0;
    const raw = allocated[trait] + (historyDelta[trait] ?? 0) + nature;
    const ceiling = Math.min(ceilingFor(trait, limits), MIND_MAX);
    const floor = Math.max(floorFor(trait, limits), MIND_MIN);
    mind[trait] = clamp(Math.round(raw), floor, ceiling);
  }
  return mind;
}

/** The paragraph a kennel page would show. Descriptions only — never a number. */
export function describeDog(dog: Dog): string {
  const lines = [
    `${dog.name} — ${describeFrame(dog.spec.frame)}.`,
    `${dog.blood.lineages[0].name} out of ${dog.blood.lineages[1].name}.`,
    `Temperament: ${describeMind(dog.mind)}.`,
  ];
  const hooks = describeHooks(dog.hooks);
  if (hooks.length > 0) lines.push(`Carries: ${hooks.join("; ")}.`);
  return lines.join("\n");
}

const NAME_PARTS = [
  "Ash",
  "Bram",
  "Cinder",
  "Dell",
  "Ember",
  "Fen",
  "Grist",
  "Harrow",
  "Ivy",
  "Jack",
  "Kite",
  "Larch",
  "Moth",
  "Nettle",
  "Osprey",
  "Pike",
  "Quill",
  "Rook",
  "Slate",
  "Tally",
  "Vesper",
  "Whin",
  "Yarrow",
  "Bellow",
  "Comet",
  "Drift",
  "Flint",
  "Gale",
  "Hazel",
  "Juniper",
] as const;

/**
 * A field dog. Deliberately built the way a careless player would build one:
 * a handful of sliders pushed, two lineages, a real history, a lumpy Mind.
 *
 * §16.4 — AI dogs fill fields invisibly, and the game never discloses which is
 * which. So these have to come out of the same constructor as a player's dog.
 */
export function randomDog(seed: string): Dog {
  const rng = new Rng(`${seed}:field`);
  const [firstBlood, secondBlood] = rng.pickMany(LINEAGES, 2);
  const blood = combineBlood(firstBlood!.id, secondBlood!.id);
  const budget = BASE_MASS_BUDGET * blood.massBudgetMult;

  const frame = standardFrame();
  for (const def of rng.pickMany(SLIDERS, rng.int(3, 7))) {
    frame[def.key] = rng.int(0, 6);
  }
  // Blood caps bind on every slider, not just the ones we happened to move —
  // Heat-shed pins coat length below `standard`, where the default sits.
  for (const key of SLIDER_KEYS) {
    frame[key] = clamp(frame[key], blood.frameMin[key] ?? 0, blood.frameMax[key] ?? 6);
  }
  // Trim back toward standard until the build is inside its mass budget.
  let guard = 0;
  while (validateFrame(frame, budget).spent > budget && guard++ < 200) {
    const heaviest = [...SLIDERS]
      .filter((d) => frame[d.key] > 3)
      .sort((a, b) => (frame[b.key] - 3) * b.massPerNotch - (frame[a.key] - 3) * a.massPerNotch)[0];
    if (!heaviest) break;
    frame[heaviest.key] -= 1;
  }

  const history: History = {};
  for (const chapterDef of CHAPTERS) {
    history[chapterDef.id] = rng.pick(chapterDef.options).id;
  }

  const limits: MindLimits = { ceilings: blood.mindCeiling, floors: blood.mindFloor };
  const mind = evenMind();
  // Move points around without changing the total, so field dogs respect the
  // same 36-point budget a player does.
  for (let i = 0; i < 8; i++) {
    const from = rng.pick(MIND_TRAITS);
    const to = rng.pick(MIND_TRAITS);
    const ceiling = Math.min(ceilingFor(to, limits), MIND_MAX);
    if (from === to || mind[from] <= MIND_MIN || mind[to] >= ceiling) continue;
    mind[from] -= 1;
    mind[to] += 1;
  }
  for (const trait of MIND_TRAITS) {
    mind[trait] = clamp(mind[trait], MIND_MIN, Math.min(ceilingFor(trait, limits), MIND_MAX));
  }

  const name = `${rng.pick(NAME_PARTS)}`;

  return createDog(
    { name, frame, blood: [firstBlood!.id, secondBlood!.id], history, mind },
    seed,
    { bond: rng.range(0.45, 0.85), condition: rng.range(0.7, 0.98) },
  );
}
