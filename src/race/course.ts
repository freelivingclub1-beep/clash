/**
 * Courses and the eight facts (design doc §9).
 *
 * A course is fully specified underneath — every segment, every gradient, every
 * hazard's true severity. The *posting* is eight facts and nothing else. The
 * gap between the two is where the game lives: you are reasoning under real
 * uncertainty with real information.
 *
 * What a posting never gives away:
 *   - the order of the segments
 *   - the true severity of anything
 *   - who else is in the field
 */

import { Rng, clamp } from "../core/rng.ts";
import { TERRAINS, type Air, type Light, type Terrain, type Weather } from "../core/world.ts";

export const LADDERS = ["sprint", "long", "climb", "rough", "reading"] as const;
export type Ladder = (typeof LADDERS)[number];

export type Segment = {
  readonly index: number;
  readonly startM: number;
  readonly lengthM: number;
  readonly terrain: Terrain;
  /** -1 (plunging) .. +1 (wall). Positive is uphill. */
  readonly gradient: number;
  /** Metres above the start, used for the altitude penalty. */
  readonly altitudeM: number;
};

export type FeatureKind = "cache" | "fork" | "ledge" | "crossing" | "scrub" | "crowd";

export type Feature = {
  readonly id: string;
  readonly kind: FeatureKind;
  readonly atM: number;
  /** 0-1. Never posted. */
  readonly severity: number;
  /** Fork only: metres saved by the short line, and how much it can cost you. */
  readonly shortcutSavingM?: number;
  readonly shortcutRisk?: number;
  /** Cache only: how much condition it pays back. */
  readonly cacheValue?: number;
};

export type Start = {
  readonly formation: "bunched gate" | "staggered gate" | "line start" | "rolling start";
  readonly light: Light;
};

export type Course = {
  readonly id: string;
  readonly name: string;
  readonly ladder: Ladder;
  readonly lengthM: number;
  readonly segments: readonly Segment[];
  readonly features: readonly Feature[];
  readonly weather: Weather;
  readonly fieldSize: number;
  readonly start: Start;
};

const COURSE_NAMES = [
  "THE NARROWS",
  "COLDWATER",
  "HANGMAN'S REACH",
  "THE LONG SHELF",
  "BLACKFOOT",
  "WIDOW'S STAIR",
  "THE DRY BED",
  "GULLROOST",
  "SALT FLATS",
  "THE SPINE",
  "MERCY HILL",
  "IRONMOUTH",
  "THE CULVERT",
  "WINTERGATE",
  "LOW MEADOW",
  "THE SCOUR",
  "RAGGED END",
  "STONE LADDER",
  "THE FETCH",
  "NIGHTFALL RUN",
] as const;

/**
 * Water is never a running surface. A river is a `crossing` feature with a time
 * cost and a balk check — a dog does not swim a kilometre of course.
 */
type LadderShape = {
  readonly lengthM: readonly [number, number];
  readonly gradient: readonly [number, number];
  readonly terrains: readonly Terrain[];
  readonly featureBudget: readonly [number, number];
  /** Roughly how far above the start this ladder's courses are allowed to roam. */
  readonly altitudeBand: number;
};

const SHAPES: Record<Exclude<Ladder, "reading">, LadderShape> = {
  sprint: {
    lengthM: [1500, 3000],
    gradient: [-0.05, 0.08],
    terrains: ["flat", "flat", "flat", "sand", "mud"],
    featureBudget: [1, 2],
    altitudeBand: 80,
  },
  long: {
    lengthM: [20000, 34000],
    gradient: [-0.12, 0.16],
    terrains: ["flat", "flat", "scrub", "mud", "sand", "rock"],
    featureBudget: [3, 5],
    altitudeBand: 500,
  },
  climb: {
    lengthM: [8000, 16000],
    gradient: [-0.15, 0.42],
    terrains: ["rock", "rock", "scrub", "snow", "ice", "flat"],
    featureBudget: [2, 4],
    altitudeBand: 1100,
  },
  rough: {
    lengthM: [7000, 14000],
    gradient: [-0.2, 0.28],
    terrains: ["rock", "mud", "scrub", "ice", "snow", "mud"],
    featureBudget: [4, 6],
    altitudeBand: 400,
  },
};

/** The Reading ladder races on whatever the other four race on (§11). */
function shapeFor(ladder: Ladder, rng: Rng): LadderShape {
  if (ladder === "reading") {
    return SHAPES[rng.pick(["sprint", "long", "climb", "rough"] as const)];
  }
  return SHAPES[ladder];
}

export function generateCourse(seed: string, ladder: Ladder): Course {
  const rng = new Rng(`course:${seed}:${ladder}`);
  const shape = shapeFor(ladder, rng);

  const lengthM = Math.round(rng.range(shape.lengthM[0], shape.lengthM[1]) / 100) * 100;
  const segments = buildSegments(rng, lengthM, shape);
  const light = rng.pick(["dawn", "morning", "noon", "afternoon", "dusk", "night"] as const);
  const weather = rollWeather(rng, segments, light);
  const features = placeFeatures(rng, lengthM, segments, shape);

  return {
    id: `${seed}:${ladder}`,
    name: rng.pick(COURSE_NAMES),
    ladder,
    lengthM,
    segments,
    features,
    weather,
    fieldSize: rng.int(6, 14),
    start: {
      formation: rng.pick([
        "bunched gate",
        "staggered gate",
        "line start",
        "rolling start",
      ] as const),
      light,
    },
  };
}

function buildSegments(rng: Rng, lengthM: number, shape: LadderShape): Segment[] {
  const segments: Segment[] = [];
  const targetSegment = clamp(lengthM / rng.int(5, 10), 400, 3000);

  let startM = 0;
  let altitudeM = 0;
  let index = 0;

  while (startM < lengthM) {
    const segLength = Math.min(
      Math.round(targetSegment * rng.range(0.7, 1.3)),
      lengthM - startM,
    );
    if (segLength < 150 && segments.length > 0) {
      // Fold a runt tail segment into the one before it.
      const last = segments.pop()!;
      segments.push({ ...last, lengthM: last.lengthM + segLength });
      break;
    }

    // Independent gradient draws let a course wander into orbit over ten
    // segments, so pull each draw back toward the altitude it started at.
    const drift = clamp(altitudeM / shape.altitudeBand, -1, 1);
    const span = shape.gradient[1] - shape.gradient[0];
    const gradient = round3(
      clamp(
        rng.range(shape.gradient[0], shape.gradient[1]) - drift * span * 0.35,
        shape.gradient[0],
        shape.gradient[1],
      ),
    );

    segments.push({
      index: index++,
      startM,
      lengthM: segLength,
      terrain: rng.pick(shape.terrains),
      gradient,
      altitudeM: Math.round(altitudeM),
    });

    altitudeM += gradient * segLength;
    startM += segLength;
  }

  return segments;
}

function rollWeather(rng: Rng, segments: readonly Segment[], light: Light): Weather {
  const highest = segments.reduce((max, s) => Math.max(max, s.altitudeM), 0);
  const air: Air = highest > 900 ? "thin" : rng.pick(["clear", "clear", "humid", "dust", "smoke"]);

  return {
    temperature: rng.pick(["freezing", "cold", "cold", "mild", "mild", "warm", "hot"] as const),
    precipitation: rng.pick(["dry", "dry", "dry", "rain", "sleet", "snowfall"] as const),
    wind: rng.pick(["dead calm", "still", "breeze", "breeze", "wind", "gale"] as const),
    windFrom: rng.pick(["north", "south", "east", "west"] as const),
    light,
    air,
  };
}

function placeFeatures(
  rng: Rng,
  lengthM: number,
  segments: readonly Segment[],
  shape: LadderShape,
): Feature[] {
  const count = rng.int(shape.featureBudget[0], shape.featureBudget[1]);
  const features: Feature[] = [];

  for (let i = 0; i < count; i++) {
    // Keep features off the first and last 8% of the course; a hazard on the
    // line is a coin flip, not a decision.
    const atM = Math.round(rng.range(lengthM * 0.08, lengthM * 0.92));
    const segment = segmentAt(segments, atM);
    const kind = pickFeatureKind(rng, segment.terrain);
    const severity = round3(rng.range(0.25, 0.95));

    features.push({
      id: `${kind}-${i}`,
      kind,
      atM,
      severity,
      ...(kind === "fork"
        ? {
            shortcutSavingM: Math.round(lengthM * rng.range(0.02, 0.07)),
            shortcutRisk: round3(severity * rng.range(0.5, 1.0)),
          }
        : {}),
      ...(kind === "cache" ? { cacheValue: round3(rng.range(0.05, 0.18)) } : {}),
    });
  }

  return features.sort((a, b) => a.atM - b.atM);
}

function pickFeatureKind(rng: Rng, terrain: Terrain): FeatureKind {
  if (terrain === "water") return "crossing";
  return rng.pick(["cache", "fork", "ledge", "crossing", "scrub", "crowd"] as const);
}

export function segmentAt(segments: readonly Segment[], distanceM: number): Segment {
  for (const segment of segments) {
    if (distanceM < segment.startM + segment.lengthM) return segment;
  }
  return segments[segments.length - 1]!;
}

/** True gradient at a point. The player never sees this curve. */
export function gradientAt(course: Course, distanceM: number): number {
  return segmentAt(course.segments, distanceM).gradient;
}

export function terrainAt(course: Course, distanceM: number): Terrain {
  return segmentAt(course.segments, distanceM).terrain;
}

export function altitudeAt(course: Course, distanceM: number): number {
  const segment = segmentAt(course.segments, distanceM);
  return segment.altitudeM + segment.gradient * (distanceM - segment.startM);
}

// ---------------------------------------------------------------------------
// The posting: exactly eight facts.
// ---------------------------------------------------------------------------

export type Posting = {
  readonly name: string;
  readonly ladder: Ladder;
  /** Exactly eight. LENGTH · TERRAIN x2 · WEATHER · HAZARD · FEATURE · FIELD · START */
  readonly facts: readonly string[];
};

export function postCourse(course: Course): Posting {
  const facts = [
    lengthFact(course),
    ...terrainFacts(course),
    weatherFact(course),
    hazardFact(course),
    featureFact(course),
    fieldFact(course),
    startFact(course),
  ];

  if (facts.length !== 8) {
    throw new Error(`a posting is eight facts, got ${facts.length}`);
  }

  return { name: course.name, ladder: course.ladder, facts };
}

function lengthFact(course: Course): string {
  const km = course.lengthM / 1000;
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

/**
 * Two terrain facts, both deliberately coarse: which half is hard, and what is
 * underfoot. Never the segment list.
 */
function terrainFacts(course: Course): [string, string] {
  const half = Math.floor(course.segments.length / 2);
  const firstHalf = course.segments.slice(0, half);
  const secondHalf = course.segments.slice(half);
  const mean = (segs: readonly Segment[]) =>
    segs.length === 0 ? 0 : segs.reduce((sum, s) => sum + s.gradient, 0) / segs.length;

  const front = mean(firstHalf);
  const back = mean(secondHalf);
  const shape =
    Math.abs(front - back) < 0.04
      ? front > 0.12
        ? "climbs the whole way"
        : front < -0.06
          ? "drops the whole way"
          : "even ground throughout"
      : back > front
        ? back > 0.2
          ? "steep second half"
          : "rising second half"
        : front > 0.2
          ? "steep first half"
          : "falls away after halfway";

  const counts = new Map<Terrain, number>();
  for (const segment of course.segments) {
    counts.set(segment.terrain, (counts.get(segment.terrain) ?? 0) + segment.lengthM);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const dominant = ranked[0]![0];
  const share = ranked[0]![1] / course.lengthM;
  const underfoot =
    share > 0.6
      ? `${terrainWord(dominant)} underfoot for most of it`
      : `mixed going — ${ranked
          .slice(0, 2)
          .map(([t]) => terrainWord(t))
          .join(" and ")}`;

  return [shape, underfoot];
}

function terrainWord(terrain: Terrain): string {
  const words: Record<Terrain, string> = {
    flat: "hard ground",
    rock: "rock",
    mud: "mud",
    sand: "sand",
    snow: "snow",
    ice: "ice",
    scrub: "scrub",
    water: "wet ground",
  };
  return words[terrain];
}

function weatherFact(course: Course): string {
  const { temperature, precipitation, wind, windFrom, air } = course.weather;
  const parts: string[] = [temperature];
  if (precipitation !== "dry") parts.push(precipitation);
  if (wind !== "still" && wind !== "dead calm") parts.push(`${wind} from ${windFrom}`);
  else if (wind === "dead calm") parts.push("dead calm");
  if (air !== "clear") parts.push(air === "thin" ? "thin air" : air);
  return parts.join(", ");
}

const HAZARD_KINDS: readonly FeatureKind[] = ["ledge", "crossing", "scrub"];

function hazardFact(course: Course): string {
  const hazards = course.features.filter((f) => HAZARD_KINDS.includes(f.kind));
  if (hazards.length === 0) return "nothing posted as hazardous";
  if (hazards.length > 1) {
    const kinds = [...new Set(hazards.map((h) => hazardWord(h.kind)))];
    return `${hazards.length} marked hazards — ${kinds.join(", ")}`;
  }
  const only = hazards[0]!;
  return `${hazardWord(only.kind)} at km ${km(only.atM)}`;
}

function hazardWord(kind: FeatureKind): string {
  const words: Partial<Record<FeatureKind, string>> = {
    ledge: "narrow ledge",
    crossing: "river crossing",
    scrub: "thick scrub",
  };
  return words[kind] ?? String(kind);
}

function featureFact(course: Course): string {
  const caches = course.features.filter((f) => f.kind === "cache");
  const forks = course.features.filter((f) => f.kind === "fork");

  if (caches.length > 0 && forks.length > 0) {
    return `food cache at km ${km(caches[0]!.atM)}, a fork at km ${km(forks[0]!.atM)}`;
  }
  if (caches.length > 1) return `${caches.length} food caches on the line`;
  if (caches.length === 1) return `food cache at km ${km(caches[0]!.atM)}`;
  if (forks.length > 1) return `${forks.length} forks in the route`;
  if (forks.length === 1) return `a fork at km ${km(forks[0]!.atM)}`;
  return "no caches, no forks — one line all the way";
}

function fieldFact(course: Course): string {
  return `${course.fieldSize}-dog field`;
}

function startFact(course: Course): string {
  return `${course.start.light} start, ${course.start.formation}`;
}

function km(metres: number): number {
  return Math.round(metres / 100) / 10;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** How a posting reads on the board. */
export function formatPosting(posting: Posting): string {
  return `**${posting.name}** — ${posting.facts.join(" · ")}`;
}
