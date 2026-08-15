/**
 * Layer four — MIND (design doc §7).
 *
 * Twelve axes, five named notches, 36 points to spend across them.
 *
 * Scale reconciliation: the doc names five notches
 * (`absent · slight · steady · strong · consuming`) and sets a 36-point budget
 * across 12 traits "average 3", while elsewhere referring to a "Greed-5 dog",
 * "Nerve capped at 2" and Wolf-strain raising ceilings "to 6". Those are all
 * consistent on a 1-5 scale where the notch name is the value:
 *
 *     1 absent · 2 slight · 3 steady · 4 strong · 5 consuming
 *
 * 12 traits x average 3 = 36. Blood can lower a ceiling below 5 (Hare-heart
 * pins Nerve at 2) or raise one past the top notch to 6 (Wolf-strain), which is
 * reachable only through drift, never at creation. A 6 has no notch name because
 * no handler ever built one on purpose — it is something the dog became.
 */

export const MIND_TRAITS = [
  "greed",
  "nerve",
  "patience",
  "loyalty",
  "curiosity",
  "spite",
  "pride",
  "caution",
  "focus",
  "temper",
  "trust",
  "want",
] as const;

export type MindTrait = (typeof MIND_TRAITS)[number];

export type Mind = Record<MindTrait, number>;

export type MindTraitDef = {
  readonly key: MindTrait;
  readonly label: string;
  readonly high: string;
  readonly failure: string;
};

export const MIND_TRAIT_DEFS: readonly MindTraitDef[] = [
  {
    key: "greed",
    label: "Greed",
    high: "takes every cache, every shortcut",
    failure: "overreaches, gets caught out, ignores “hold back”",
  },
  {
    key: "nerve",
    label: "Nerve",
    high: "unshaken by contest, crowds, weather",
    failure: "— (but expensive)",
  },
  {
    key: "patience",
    label: "Patience",
    high: "paces itself perfectly",
    failure: "won't chase when it should",
  },
  {
    key: "loyalty",
    label: "Loyalty",
    high: "obeys orders through pain",
    failure: "follows a bad order off a cliff",
  },
  {
    key: "curiosity",
    label: "Curiosity",
    high: "finds unmarked routes, scouts well",
    failure: "diverts mid-race",
  },
  {
    key: "spite",
    label: "Spite",
    high: "targets whoever beat it last",
    failure: "tunnels on a rival, forgets the race",
  },
  {
    key: "pride",
    label: "Pride",
    high: "never quits, never yields position",
    failure: "refuses shortcuts as beneath it",
  },
  {
    key: "caution",
    label: "Caution",
    high: "avoids injury, reads hazards",
    failure: "slow at every crossing",
  },
  {
    key: "focus",
    label: "Focus",
    high: "ignores distraction",
    failure: "misses opportunity",
  },
  {
    key: "temper",
    label: "Temper",
    high: "contests aggressively",
    failure: "fouls, gets penalized, exhausts itself",
  },
  {
    key: "trust",
    label: "Trust",
    high: "acts on your orders instantly",
    failure: "doesn't self-correct when you're wrong",
  },
  {
    key: "want",
    label: "Want",
    high: "pushes past exhaustion",
    failure: "runs itself into injury",
  },
];

const TRAIT_BY_KEY = new Map(MIND_TRAIT_DEFS.map((d) => [d.key, d]));

export const MIND_BUDGET = 36;
export const MIND_MIN = 1;
export const MIND_MAX = 5;
/** Drift may carry a trait this far from the value you set (§7). */
export const DRIFT_BOUND = 2;

export const NOTCH_NAMES = ["absent", "slight", "steady", "strong", "consuming"] as const;

export function traitDef(key: MindTrait): MindTraitDef {
  const def = TRAIT_BY_KEY.get(key);
  if (!def) throw new Error(`unknown trait: ${key}`);
  return def;
}

/** What a player reads. A 6 is off the top of the named scale on purpose. */
export function notchName(value: number): string {
  if (value >= 6) return "past consuming";
  return NOTCH_NAMES[Math.max(0, Math.min(4, Math.round(value) - 1))]!;
}

export function evenMind(): Mind {
  return Object.fromEntries(MIND_TRAITS.map((t) => [t, 3])) as Mind;
}

export function mindSpent(mind: Mind): number {
  let total = 0;
  for (const t of MIND_TRAITS) total += mind[t];
  return total;
}

export type MindLimits = {
  readonly ceilings: Partial<Record<MindTrait, number>>;
  readonly floors: Partial<Record<MindTrait, number>>;
};

export const NO_LIMITS: MindLimits = { ceilings: {}, floors: {} };

export function ceilingFor(trait: MindTrait, limits: MindLimits): number {
  return limits.ceilings[trait] ?? MIND_MAX;
}

export function floorFor(trait: MindTrait, limits: MindLimits): number {
  return limits.floors[trait] ?? MIND_MIN;
}

export type MindValidation = {
  readonly ok: boolean;
  readonly spent: number;
  readonly budget: number;
  readonly problems: readonly string[];
};

/**
 * Creation-time validation. Ceilings raised above 5 by Blood are deliberately
 * *not* honoured here — a Wolf-strain dog can drift to 6, but you cannot build
 * one there.
 */
export function validateMind(mind: Mind, limits: MindLimits = NO_LIMITS): MindValidation {
  const problems: string[] = [];

  for (const trait of MIND_TRAITS) {
    const value = mind[trait];
    const ceiling = Math.min(ceilingFor(trait, limits), MIND_MAX);
    const floor = floorFor(trait, limits);

    if (!Number.isInteger(value)) {
      problems.push(`${traitDef(trait).label} must be a whole notch`);
      continue;
    }
    if (value < MIND_MIN || value > MIND_MAX) {
      problems.push(`${traitDef(trait).label} is off the scale (${value})`);
      continue;
    }
    if (value > ceiling) {
      problems.push(
        `${traitDef(trait).label} is capped at ${notchName(ceiling)} by this dog's blood`,
      );
    }
    if (value < floor) {
      problems.push(
        `${traitDef(trait).label} cannot sit below ${notchName(floor)} for this dog's blood`,
      );
    }
  }

  const spent = mindSpent(mind);
  if (spent > MIND_BUDGET) {
    problems.push(`over temperament budget: ${spent} of ${MIND_BUDGET}`);
  }

  return { ok: problems.length === 0, spent, budget: MIND_BUDGET, problems };
}

/** Clamp a drifted value into everything that constrains it. */
export function applyLimits(
  trait: MindTrait,
  value: number,
  base: number,
  limits: MindLimits,
): number {
  const low = Math.max(MIND_MIN, base - DRIFT_BOUND, floorFor(trait, limits));
  const high = Math.min(ceilingFor(trait, limits), base + DRIFT_BOUND);
  return Math.max(low, Math.min(high, value));
}

/** The two or three traits that actually define this animal, loudest first. */
export function describeMind(mind: Mind): string {
  const notable = MIND_TRAITS.map((t) => ({ trait: t, value: mind[t] }))
    .filter((t) => t.value >= 4 || t.value <= 1)
    .sort((a, b) => Math.abs(b.value - 3) - Math.abs(a.value - 3))
    .slice(0, 3)
    .map(({ trait, value }) => `${notchName(value)} ${traitDef(trait).label.toLowerCase()}`);

  return notable.length === 0 ? "level-headed about everything" : notable.join(", ");
}
