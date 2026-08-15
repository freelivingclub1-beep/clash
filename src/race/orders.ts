/**
 * Standing orders and obedience resolution (design doc §9).
 *
 * You write four conditional instructions before the race and then you have no
 * control at all. When a condition fires, the dog rolls to obey:
 *
 *     P(obey) = BOND x ORDER_ALIGNMENT x CONDITION_MODIFIER
 *
 * The alignment table is anchored on the three worked examples in the doc:
 * telling a Greed-5 dog to skip a cache is x0.4, telling a Pride-5 dog to yield
 * is x0.3, telling a Want-5 dog to hold back is x0.35.
 */

import { clamp } from "../core/rng.ts";
import type { Mind } from "../creation/mind.ts";
import type { FeatureKind } from "./course.ts";

export const MAX_ORDERS = 4;

export const ACTIONS = [
  "PUSH",
  "HOLD BACK",
  "CHASE",
  "STEADY",
  "CONTEST",
  "YIELD",
  "TAKE THE SHORT WAY",
  "TAKE THE LONG WAY",
  "TAKE THE CACHE",
  "SKIP THE CACHE",
] as const;

export type Action = (typeof ACTIONS)[number];

export type Landmark =
  | { readonly kind: "feature"; readonly feature: FeatureKind }
  | { readonly kind: "distance"; readonly atM: number }
  | { readonly kind: "fraction"; readonly at: number; readonly label: string }
  | { readonly kind: "ridge" };

export type Trigger =
  | { readonly kind: "behind"; readonly at: Landmark }
  | { readonly kind: "leading"; readonly at: Landmark }
  | { readonly kind: "raining"; readonly at: Landmark }
  | { readonly kind: "stamina-low"; readonly at: Landmark }
  | { readonly kind: "arrives"; readonly at: Landmark }
  | { readonly kind: "passed"; readonly afterM: number }
  | { readonly kind: "contested" }
  | { readonly kind: "overheating" };

export type Order = {
  readonly text: string;
  readonly trigger: Trigger;
  readonly action: Action;
};

// ---------------------------------------------------------------------------
// Parsing. "Natural but structured" — a small grammar with real error messages.
// ---------------------------------------------------------------------------

const FEATURE_WORDS: Record<string, FeatureKind> = {
  crossing: "crossing",
  river: "crossing",
  water: "crossing",
  ledge: "ledge",
  cache: "cache",
  food: "cache",
  fork: "fork",
  scrub: "scrub",
  crowd: "crowd",
};

export class OrderSyntaxError extends Error {
  readonly text: string;
  constructor(message: string, text: string) {
    super(`${message}\n  in: ${text}`);
    this.name = "OrderSyntaxError";
    this.text = text;
  }
}

/** `IF behind at the ridge -> PUSH` (either `->` or `→`). */
export function parseOrder(text: string): Order {
  const normalised = text.trim().replace(/→/g, "->");
  const [rawCondition, rawAction, ...rest] = normalised.split("->");

  if (rawAction === undefined || rest.length > 0) {
    throw new OrderSyntaxError("an order is `IF <condition> -> <ACTION>`", text);
  }

  const action = parseAction(rawAction.trim(), text);
  const condition = rawCondition!.trim().replace(/^if\s+/i, "").toLowerCase();

  return { text: text.trim(), trigger: parseTrigger(condition, text), action };
}

function parseAction(raw: string, text: string): Action {
  const wanted = raw.toUpperCase().replace(/\s+/g, " ").trim();
  const found = ACTIONS.find((a) => a === wanted);
  if (!found) {
    throw new OrderSyntaxError(
      `“${raw.trim()}” is not an order this dog understands. Try one of: ${ACTIONS.join(", ")}`,
      text,
    );
  }
  return found;
}

function parseTrigger(condition: string, text: string): Trigger {
  if (condition === "contested" || condition === "crowded") return { kind: "contested" };
  if (condition === "overheating" || condition === "hot") return { kind: "overheating" };

  const passed = condition.match(/^a dog passes(?:\s+after\s+km\s+([\d.]+))?$/);
  if (passed) {
    return { kind: "passed", afterM: passed[1] ? Number(passed[1]) * 1000 : 0 };
  }

  const behind = condition.match(/^behind at (.+)$/);
  if (behind) return { kind: "behind", at: parseLandmark(behind[1]!, text) };

  const leading = condition.match(/^(?:leading|ahead) at (.+)$/);
  if (leading) return { kind: "leading", at: parseLandmark(leading[1]!, text) };

  const raining = condition.match(/^rain(?:ing)? at (.+)$/);
  if (raining) return { kind: "raining", at: parseLandmark(raining[1]!, text) };

  const tired = condition.match(/^stamina low at (.+)$/);
  if (tired) return { kind: "stamina-low", at: parseLandmark(tired[1]!, text) };

  const arrives = condition.match(/^(?:at|reaching) (.+)$/);
  if (arrives) return { kind: "arrives", at: parseLandmark(arrives[1]!, text) };

  throw new OrderSyntaxError(`“${condition}” is not a condition this dog can recognise`, text);
}

function parseLandmark(raw: string, text: string): Landmark {
  const cleaned = raw.trim().replace(/^the\s+/, "");

  if (cleaned === "ridge" || cleaned === "top" || cleaned === "summit") return { kind: "ridge" };
  if (cleaned === "halfway" || cleaned === "half") {
    return { kind: "fraction", at: 0.5, label: "halfway" };
  }
  if (cleaned === "last quarter") return { kind: "fraction", at: 0.75, label: "the last quarter" };
  if (cleaned === "finish" || cleaned === "line") {
    return { kind: "fraction", at: 0.92, label: "the run-in" };
  }
  if (cleaned === "start" || cleaned === "gate") {
    return { kind: "fraction", at: 0.04, label: "the start" };
  }

  const distance = cleaned.match(/^km\s*([\d.]+)$/);
  if (distance) return { kind: "distance", atM: Number(distance[1]) * 1000 };

  const feature = FEATURE_WORDS[cleaned.split(/\s+/)[0]!];
  if (feature) return { kind: "feature", feature };

  throw new OrderSyntaxError(`“${raw.trim()}” is not a place on this course`, text);
}

export function parseOrders(lines: readonly string[]): Order[] {
  if (lines.length > MAX_ORDERS) {
    throw new Error(`a dog can hold ${MAX_ORDERS} standing orders, not ${lines.length}`);
  }
  return lines.map(parseOrder);
}

export function describeLandmark(landmark: Landmark): string {
  switch (landmark.kind) {
    case "ridge":
      return "the ridge";
    case "fraction":
      return landmark.label;
    case "distance":
      return `km ${Math.round(landmark.atM / 100) / 10}`;
    case "feature":
      return `the ${landmark.feature}`;
  }
}

// ---------------------------------------------------------------------------
// Obedience.
// ---------------------------------------------------------------------------

/**
 * How hard this order fights the dog's nature. 1.0 is an order that costs the
 * dog nothing to follow; the doc's worked examples land at 0.3-0.4.
 */
export function orderAlignment(action: Action, mind: Mind): number {
  const above = (trait: keyof Mind) => mind[trait] - 1; // 0..4, "how far past absent"
  const from3 = (trait: keyof Mind) => mind[trait] - 3; // -2..+2

  let alignment: number;

  switch (action) {
    case "SKIP THE CACHE":
      // Greed-5 -> 0.4, per §9.
      alignment = 1 - 0.15 * above("greed");
      break;
    case "YIELD":
      // Pride-5 -> 0.3, per §9.
      alignment = 1 - 0.175 * above("pride") - 0.03 * from3("temper");
      break;
    case "HOLD BACK":
      // Want-5 -> 0.35, per §9.
      alignment = 1 - 0.1625 * above("want") + 0.04 * from3("patience");
      break;
    case "PUSH":
      alignment = 1 + 0.05 * from3("want") - 0.07 * from3("caution");
      break;
    case "CHASE":
      alignment = 1 - 0.08 * from3("patience") + 0.05 * from3("spite") + 0.03 * from3("want");
      break;
    case "STEADY":
      alignment = 1 + 0.07 * from3("patience") - 0.06 * from3("want") - 0.05 * from3("temper");
      break;
    case "CONTEST":
      alignment = 1 + 0.06 * from3("temper") + 0.05 * from3("nerve") - 0.07 * from3("caution");
      break;
    case "TAKE THE SHORT WAY":
      // "refuses shortcuts as beneath it"
      alignment = 1 - 0.1 * from3("pride") + 0.05 * from3("greed");
      break;
    case "TAKE THE LONG WAY":
      alignment = 1 + 0.07 * from3("caution") - 0.07 * from3("greed") - 0.04 * from3("want");
      break;
    case "TAKE THE CACHE":
      alignment = 1 + 0.06 * from3("greed") - 0.04 * from3("focus");
      break;
  }

  // Trust is the trait that makes a dog act on your word rather than its own.
  alignment *= 0.85 + 0.075 * above("trust");

  return clamp(alignment, 0.05, 1.35);
}

export type ObedienceContext = {
  /** 0-1, how much this dog is hurting right now. */
  readonly pain: number;
  /** 0-1, 1 being empty. */
  readonly exhaustion: number;
  /** 0-1, how crowded it is at this moment. */
  readonly rivalProximity: number;
  /** How well your voice carries: wind, noise, ear carriage. */
  readonly audibility: number;
};

/**
 * Pain, exhaustion and rival proximity all degrade compliance (§9). Loyalty is
 * the trait that holds an order together through pain; focus is the one that
 * holds it together in a crowd.
 */
export function conditionModifier(mind: Mind, ctx: ObedienceContext): number {
  const loyalty = (mind.loyalty - 1) / 4; // 0..1
  const focus = (mind.focus - 1) / 4;

  const painFactor = 1 - ctx.pain * 0.55 * (1 - 0.6 * loyalty);
  const exhaustionFactor = 1 - ctx.exhaustion * 0.45 * (1 - 0.4 * loyalty);
  const crowdFactor = 1 - ctx.rivalProximity * 0.3 * (1 - 0.7 * focus);

  return clamp(painFactor * exhaustionFactor * crowdFactor * ctx.audibility, 0.05, 1);
}

export function obedienceChance(
  action: Action,
  mind: Mind,
  bond: number,
  bloodObedienceMult: number,
  ctx: ObedienceContext,
): number {
  const p = bond * orderAlignment(action, mind) * conditionModifier(mind, ctx) * bloodObedienceMult;
  return clamp(p, 0.02, 0.98);
}
