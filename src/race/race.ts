/**
 * The race (design doc §9).
 *
 * A deterministic, seeded, tick-based simulation. One tick is one second of
 * race time. Nothing in here is interactive: the player's entire contribution
 * was made before the gate opened, in the four standing orders and in the
 * months of handling that set the bond.
 *
 * Per tick, per dog, following the doc:
 *
 *   speed    = base(frame, mass) x terrain x gradient x condition x morale x obedience
 *   stamina -= drain(mass, gradient, speed, chest, blood)
 *   heat    += gain(effort, coat, ambient) - shed(muzzle, skull, blood)
 *   morale  += f(position vs rivals, spite triggers, hooks)
 */

import { Rng, clamp } from "../core/rng.ts";
import {
  DARKNESS,
  TEMPERATURE_LOAD,
  WIND_FORCE,
  isGlaring,
  type Terrain,
} from "../core/world.ts";
import type { Dog } from "../creation/dog.ts";
import { hookStrength, type Situation } from "../creation/history.ts";
import {
  altitudeAt,
  gradientAt,
  terrainAt,
  type Course,
  type Feature,
  type FeatureKind,
} from "./course.ts";
import type { DogSummary, RaceEvent, RaceResult, Standing } from "./events.ts";
import {
  obedienceChance,
  type Action,
  type Landmark,
  type Order,
  type ObedienceContext,
} from "./orders.ts";

export type Entrant = {
  readonly dog: Dog;
  readonly orders: readonly Order[];
};

const TICK_S = 1;
const BASE_SPEED = 6.2;
const MAX_TICKS = 14_400; // four hours of race time is a hard stop
/** Nobody's position means anything while the field is still on top of itself. */
const SETTLE_TICKS = 20;

/** Base going for each surface, before grip. */
const TERRAIN_SPEED: Record<Terrain, number> = {
  flat: 1.0,
  rock: 0.92,
  mud: 0.82,
  sand: 0.85,
  snow: 0.8,
  ice: 0.78,
  scrub: 0.86,
  water: 0.42,
};

/** How much each surface costs in stamina beyond its speed penalty. */
const TERRAIN_DRAIN: Record<Terrain, number> = {
  flat: 1.0,
  rock: 1.08,
  mud: 1.3,
  sand: 1.35,
  snow: 1.25,
  ice: 1.12,
  scrub: 1.15,
  water: 1.6,
};

type ActiveAction = {
  readonly action: Action;
  readonly untilTick: number;
};

type OrderState = {
  readonly order: Order;
  readonly index: number;
  /** Distance at which the order's landmark sits, or null if it has none. */
  readonly landmarkM: number | null;
  crossed: boolean;
  fired: boolean;
};

type Runner = {
  readonly dog: Dog;
  readonly orders: OrderState[];
  distanceM: number;
  speed: number;
  stamina: number;
  readonly staminaMax: number;
  heat: number;
  heatPeak: number;
  morale: number;
  pain: number;
  wet: number;
  position: number;
  finished: boolean;
  retired: boolean;
  timeS: number | null;
  topSpeed: number;
  active: ActiveAction | null;
  /** Set when an order told the dog which way to go at the next feature. */
  routeOrder: { action: Action } | null;
  resolvedFeatures: Set<string>;
  ordersFired: number;
  ordersObeyed: number;
  injured: boolean;
  wasPassedSinceM: number | null;
  announcedFading: boolean;
  announcedHeat: boolean;
  announcedHooks: Set<Situation>;
};

export function runRace(course: Course, entrants: readonly Entrant[], seed: string): RaceResult {
  const rng = new Rng(`race:${seed}:${course.id}`);
  const events: RaceEvent[] = [];
  const runners = entrants.map((e) => makeRunner(e, course));

  events.push({ kind: "start", tick: 0, fieldSize: runners.length });

  const finishOrder: Runner[] = [];
  let tick = 0;

  while (tick < MAX_TICKS && finishOrder.length + countRetired(runners) < runners.length) {
    tick += 1;

    for (const runner of runners) {
      if (runner.finished || runner.retired) continue;
      stepRunner(runner, runners, course, rng, tick, events);
    }

    updatePositions(runners, events, tick, tick > SETTLE_TICKS);

    for (const runner of runners) {
      if (runner.finished || runner.retired) continue;
      if (runner.distanceM >= course.lengthM) {
        runner.finished = true;
        runner.timeS = tick * TICK_S;
        finishOrder.push(runner);
        events.push({
          kind: "finish",
          tick,
          dogId: runner.dog.id,
          position: finishOrder.length,
          timeS: runner.timeS,
        });
      }
    }
  }

  // Anyone still on the course when the clock ran out is recorded as unfinished.
  for (const runner of runners) {
    if (!runner.finished && !runner.retired) {
      runner.retired = true;
      events.push({
        kind: "retired",
        tick,
        dogId: runner.dog.id,
        atM: runner.distanceM,
        cause: "still out on the course",
      });
    }
  }

  const standings = buildStandings(runners, finishOrder);
  return {
    courseId: course.id,
    seed,
    ticks: tick,
    events,
    standings,
    summaries: runners.map((r) => summarise(r, standings)),
  };
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function makeRunner(entrant: Entrant, course: Course): Runner {
  const { dog } = entrant;
  return {
    dog,
    orders: entrant.orders.map((order, index) => ({
      order,
      index,
      landmarkM: landmarkDistance(order.trigger, course),
      crossed: false,
      fired: false,
    })),
    distanceM: 0,
    speed: 0,
    stamina: dog.frameProfile.staminaCeiling * dog.blood.staminaCeilingMult,
    staminaMax: dog.frameProfile.staminaCeiling * dog.blood.staminaCeilingMult,
    heat: 0.1,
    heatPeak: 0.1,
    morale: 0.55 + (dog.mind.nerve - 3) * 0.04,
    pain: 0,
    wet: 0,
    position: 1,
    finished: false,
    retired: false,
    timeS: null,
    topSpeed: 0,
    active: null,
    routeOrder: null,
    resolvedFeatures: new Set(),
    ordersFired: 0,
    ordersObeyed: 0,
    injured: false,
    wasPassedSinceM: null,
    announcedFading: false,
    announcedHeat: false,
    announcedHooks: new Set(),
  };
}

function landmarkDistance(
  trigger: Order["trigger"],
  course: Course,
): number | null {
  if (!("at" in trigger)) return null;
  return resolveLandmark(trigger.at, course);
}

function resolveLandmark(landmark: Landmark, course: Course): number | null {
  switch (landmark.kind) {
    case "distance":
      return landmark.atM <= course.lengthM ? landmark.atM : null;
    case "fraction":
      return course.lengthM * landmark.at;
    case "ridge":
      return highestPointM(course);
    case "feature": {
      const found = course.features.find((f) => f.kind === landmark.feature);
      return found ? found.atM : null;
    }
  }
}

function highestPointM(course: Course): number {
  let best = 0;
  let bestAltitude = -Infinity;
  for (const segment of course.segments) {
    const top = segment.altitudeM + segment.gradient * segment.lengthM;
    if (top > bestAltitude) {
      bestAltitude = top;
      best = segment.startM + segment.lengthM;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// One dog, one second
// ---------------------------------------------------------------------------

function stepRunner(
  runner: Runner,
  field: readonly Runner[],
  course: Course,
  rng: Rng,
  tick: number,
  events: RaceEvent[],
): void {
  const { dog } = runner;
  const frame = dog.frameProfile;
  const blood = dog.blood;
  const mind = dog.mind;

  if (runner.active && tick > runner.active.untilTick) runner.active = null;

  const terrain = terrainAt(course, runner.distanceM);
  const gradient = gradientAt(course, runner.distanceM);
  const altitude = altitudeAt(course, runner.distanceM);
  const crowding = rivalProximity(runner, field);

  // --- effort ------------------------------------------------------------
  const remaining = 1 - runner.distanceM / course.lengthM;
  const staminaFraction = clamp(runner.stamina / runner.staminaMax, 0, 1);
  let effort = pacedEffort(runner, remaining, staminaFraction);

  switch (runner.active?.action) {
    case "PUSH":
      effort += 0.2;
      break;
    case "CHASE":
      effort += 0.14;
      break;
    case "CONTEST":
      effort += 0.1;
      break;
    case "HOLD BACK":
      effort -= 0.18;
      break;
    case "STEADY":
      effort = clamp(effort, 0.82, 0.98);
      break;
    default:
      break;
  }

  // A dog with a sprint gear and something left will use it in the run-in.
  if (blood.sprintGear && remaining < 0.08 && staminaFraction > 0.12) {
    effort += 0.1 + 0.04 * (mind.want - 3) + 0.03 * (mind.pride - 3);
  }
  effort = clamp(effort, 0.45, 1.6);

  // --- speed -------------------------------------------------------------
  const grip = gripFor(frame, terrain);
  const terrainMult = TERRAIN_SPEED[terrain] * grip * (blood.terrain[terrain] ?? 1);
  const gradientMult = gradientMultiplier(gradient, frame.climb * blood.climbMult, frame.descend);
  const weatherMult = weatherMultiplier(runner, course, altitude);
  const conditionMult = 0.75 + 0.25 * dog.condition - runner.pain * 0.45;
  const moraleMult = 0.9 + 0.2 * runner.morale;
  const staminaMult = staminaFraction > 0.25 ? 1 : 0.6 + 1.6 * staminaFraction;
  const heatMult = runner.heat > 0.75 ? clamp(1 - (runner.heat - 0.75) * 0.3, 0.85, 1) : 1;
  const draft = draftBonus(runner, field);

  const target =
    BASE_SPEED *
    frame.flatSpeed *
    blood.flatSpeedMult *
    terrainMult *
    gradientMult *
    weatherMult *
    conditionMult *
    moraleMult *
    staminaMult *
    heatMult *
    draft *
    effort *
    (1 + rng.jitter(0.02 * blood.paceVariance));

  const responsiveness = clamp(
    0.18 * frame.acceleration * blood.accelerationMult * blood.burstMult,
    0.05,
    0.6,
  );
  runner.speed += (target - runner.speed) * responsiveness;
  runner.speed = Math.max(0.4, runner.speed);
  runner.topSpeed = Math.max(runner.topSpeed, runner.speed);

  const previousM = runner.distanceM;
  runner.distanceM += runner.speed * TICK_S;

  // --- stamina, heat, morale --------------------------------------------
  const massFactor = Math.pow(frame.mass / 24, 0.7);
  const drain =
    (0.024 * Math.pow(effort, 2.2) + 0.09 * Math.max(0, gradient)) *
    massFactor *
    TERRAIN_DRAIN[terrain] *
    (100 / runner.staminaMax);
  runner.stamina = Math.max(0, runner.stamina - drain * runner.staminaMax * 0.01);

  const ambient = TEMPERATURE_LOAD[course.weather.temperature];
  const heatIn =
    (0.0016 * Math.pow(effort, 2) + 0.0011 * ambient) *
    frame.heatGain *
    blood.heatGainMult *
    (ambient > 0 ? blood.heatPenaltyMult : 1);
  const heatOut = 0.0024 * frame.heatShed * blood.heatShedMult;
  runner.heat = clamp(runner.heat + heatIn - heatOut, 0, 1.2);
  runner.heatPeak = Math.max(runner.heatPeak, runner.heat);

  if (course.weather.precipitation !== "dry" || terrain === "water") {
    runner.wet = blood.dryInstantly ? 0 : clamp(runner.wet + 0.01, 0, 1);
  } else {
    runner.wet = clamp(runner.wet - 0.004, 0, 1);
  }

  updateMorale(runner, field, course, crowding);

  // --- events the handler would notice -----------------------------------
  if (!runner.announcedFading && staminaFraction < 0.22 && remaining > 0.1) {
    runner.announcedFading = true;
    events.push({ kind: "state", tick, dogId: dog.id, atM: runner.distanceM, state: "fading" });
  }
  if (!runner.announcedHeat && runner.heat > 0.8) {
    runner.announcedHeat = true;
    events.push({ kind: "state", tick, dogId: dog.id, atM: runner.distanceM, state: "overheating" });
  }

  // --- orders, then features ----------------------------------------------
  // Orders resolve first: an order written against a landmark has to be in the
  // dog's head *before* it arrives at the thing the landmark names.
  checkOrders(runner, course, rng, tick, events, previousM, crowding, staminaFraction);

  for (const feature of course.features) {
    if (
      !runner.resolvedFeatures.has(feature.id) &&
      previousM < feature.atM &&
      runner.distanceM >= feature.atM
    ) {
      runner.resolvedFeatures.add(feature.id);
      resolveFeature(runner, feature, rng, tick, events);
    }
  }

  checkInjury(runner, course, rng, tick, events, effort, remaining);
}

/**
 * How hard a dog runs when nobody has told it anything. Patience is the trait
 * that reads a course; Want is the one that ignores what it read.
 */
function pacedEffort(runner: Runner, remaining: number, staminaFraction: number): number {
  const mind = runner.dog.mind;
  let effort = 1.02 - 0.03 * (mind.patience - 3);

  // Compare fuel left against course left. A patient dog acts on the gap.
  const gap = staminaFraction - remaining;
  if (gap < 0) {
    const restraint = 0.35 + 0.12 * (mind.patience - 3) - 0.1 * (mind.want - 3);
    effort += gap * clamp(restraint, 0.05, 0.8);
  } else if (remaining < 0.3) {
    effort += Math.min(gap, 0.4) * (0.2 + 0.06 * (mind.want - 3));
  }

  if (!runner.dog.blood.sprintGear) effort = Math.min(effort, 1.05);
  return effort;
}

function gradientMultiplier(gradient: number, climb: number, descend: number): number {
  if (gradient > 0) return 1 / (1 + (gradient * 2.4) / Math.max(0.35, climb));
  return 1 + Math.min(0.28, -gradient * 1.1) * descend;
}

function gripFor(frame: Dog["frameProfile"], terrain: Terrain): number {
  switch (terrain) {
    case "rock":
      return frame.grip.rock;
    case "mud":
      return frame.grip.mud;
    case "sand":
      return frame.grip.sand;
    case "snow":
      return frame.grip.snow;
    case "ice":
      return frame.grip.ice;
    case "scrub":
      return frame.grip.scrub;
    case "water":
      return frame.swim;
    case "flat":
      return 1;
  }
}

function weatherMultiplier(runner: Runner, course: Course, altitudeM: number): number {
  const { dog } = runner;
  const frame = dog.frameProfile;
  const blood = dog.blood;
  const weather = course.weather;

  let mult = 1;

  const ambient = TEMPERATURE_LOAD[weather.temperature];
  if (ambient < 0) {
    mult *= 1 - (-ambient * 0.11 * blood.coldPenaltyMult) / frame.warmth / frame.coldIntake;
  }

  const wind = WIND_FORCE[weather.wind];
  mult *= 1 - wind * 0.05 * frame.windDrag * blood.windPenaltyMult;
  if (weather.wind === "dead calm" && blood.calmUnsettle > 0) {
    mult *= 1 - 0.04 * blood.calmUnsettle;
  }

  if (weather.precipitation !== "dry") {
    mult *= 1 - 0.035 * blood.rainPenaltyMult;
  }
  if (runner.wet > 0) mult *= 1 - runner.wet * (1 - blood.wetSpeedMult);

  const dark = DARKNESS[weather.light];
  if (dark > 0) mult *= 1 - dark * 0.05 * blood.darknessPenaltyMult;
  if (isGlaring(weather.light)) mult *= 1 - 0.015 * blood.glarePenaltyMult;

  if (weather.air === "humid") mult *= 1 - 0.03 * blood.humidityPenaltyMult;
  if (weather.air === "dust" || weather.air === "smoke") mult *= 1 - 0.04 * blood.dustPenaltyMult;
  if (weather.air === "thin" || altitudeM > 900) {
    mult *= 1 - clamp(altitudeM / 12000, 0, 0.12) * blood.altitudePenaltyMult;
  }

  return clamp(mult, 0.78, 1.08);
}

function rivalProximity(runner: Runner, field: readonly Runner[]): number {
  if (!runner.dog.blood.contestedByRivals) return 0;
  let near = 0;
  for (const other of field) {
    if (other === runner || other.finished || other.retired) continue;
    if (Math.abs(other.distanceM - runner.distanceM) < 15) near += 1;
  }
  return clamp(near / 3, 0, 1);
}

function draftBonus(runner: Runner, field: readonly Runner[]): number {
  if (!runner.dog.blood.canDraft) return 1;
  for (const other of field) {
    if (other === runner || other.finished || other.retired) continue;
    const gap = other.distanceM - runner.distanceM;
    if (gap > 0 && gap < 8) return 1.02;
  }
  return 1;
}

function updateMorale(
  runner: Runner,
  field: readonly Runner[],
  course: Course,
  crowding: number,
): void {
  const mind = runner.dog.mind;
  const active = field.filter((r) => !r.retired);
  const share = active.length <= 1 ? 0 : (runner.position - 1) / (active.length - 1);

  let delta = (0.35 - share) * 0.0016;
  delta += 0.0008 * (mind.nerve - 3);
  delta -= crowding * 0.0012 * (1 - (mind.nerve - 1) / 4);

  // Spite only means anything when there is someone in front to resent.
  if (mind.spite >= 4 && share > 0.2) delta += 0.0009 * (mind.spite - 3);

  for (const situation of activeSituations(runner, course, crowding)) {
    delta -= hookStrength(runner.dog.hooks, situation, "dread") * 0.0035;
    delta += hookStrength(runner.dog.hooks, situation, "love") * 0.0025;
  }

  runner.morale = clamp(runner.morale + delta, 0.05, 1);
}

/** Which of this dog's hooks the world is currently pressing on. */
function activeSituations(
  runner: Runner,
  course: Course,
  crowding: number,
): readonly Situation[] {
  const out: Situation[] = [];
  const terrain = terrainAt(course, runner.distanceM);

  if (terrain === "water") out.push("water");
  if (crowding > 0.5) out.push("crowd", "dogs-near");
  if (crowding === 0 && runner.position === 1) out.push("alone", "front");
  if (course.weather.light === "night" || course.weather.light === "dusk") out.push("dark");
  if (course.weather.temperature === "freezing" || course.weather.temperature === "cold") {
    out.push("cold");
  }
  if (course.weather.air === "smoke") out.push("fire");
  if (course.weather.wind === "dead calm") out.push("quiet");
  if (terrain === "flat" && course.weather.wind !== "dead calm") out.push("open");

  return out;
}

// ---------------------------------------------------------------------------
// Decision points
// ---------------------------------------------------------------------------

function resolveFeature(
  runner: Runner,
  feature: Feature,
  rng: Rng,
  tick: number,
  events: RaceEvent[],
): void {
  const { dog } = runner;
  const mind = dog.mind;
  const ordered = consumeRouteOrder(runner, feature.kind);

  switch (feature.kind) {
    case "cache": {
      const wants = 0.12 + 0.17 * (mind.greed - 1) + hookStrength(dog.hooks, "cache", "love") * 0.3;
      const take =
        ordered === "TAKE THE CACHE" ? true : ordered === "SKIP THE CACHE" ? false : rng.chance(wants);

      if (take) {
        const lost = 3 + feature.severity * 6;
        runner.distanceM -= runner.speed * lost * 0.35;
        runner.stamina = Math.min(
          runner.staminaMax,
          runner.stamina + runner.staminaMax * (feature.cacheValue ?? 0.1),
        );
        events.push({
          kind: "decision",
          tick,
          dogId: dog.id,
          feature: "cache",
          atM: feature.atM,
          choice: "took the cache",
          ordered: ordered !== null,
          outcome: "paid off",
          lostS: Math.round(lost),
        });
      } else {
        events.push({
          kind: "decision",
          tick,
          dogId: dog.id,
          feature: "cache",
          atM: feature.atM,
          choice: "went past the cache",
          ordered: ordered !== null,
          outcome: "clean",
        });
      }
      break;
    }

    case "fork": {
      const pride = mind.pride - 3;
      const inclination = 0.45 + 0.1 * (mind.greed - 3) - 0.09 * pride - 0.08 * (mind.caution - 3);
      const short =
        ordered === "TAKE THE SHORT WAY"
          ? true
          : ordered === "TAKE THE LONG WAY"
            ? false
            : rng.chance(clamp(inclination, 0.05, 0.95));

      if (short) {
        const risk = clamp(
          (feature.shortcutRisk ?? 0.4) / (dog.frameProfile.agility * dog.blood.agilityMult),
          0.02,
          0.85,
        );
        if (rng.chance(risk * 0.5)) {
          const lost = 6 + feature.severity * 14;
          runner.distanceM -= runner.speed * lost * 0.5;
          runner.speed *= 0.6;
          events.push({
            kind: "decision",
            tick,
            dogId: dog.id,
            feature: "fork",
            atM: feature.atM,
            choice: "took the short line",
            ordered: ordered !== null,
            outcome: "costly",
            lostS: Math.round(lost),
          });
        } else {
          runner.distanceM += feature.shortcutSavingM ?? 0;
          events.push({
            kind: "decision",
            tick,
            dogId: dog.id,
            feature: "fork",
            atM: feature.atM,
            choice: "took the short line",
            ordered: ordered !== null,
            outcome: "paid off",
          });
        }
      } else {
        events.push({
          kind: "decision",
          tick,
          dogId: dog.id,
          feature: "fork",
          atM: feature.atM,
          choice: "held the long line",
          ordered: ordered !== null,
          outcome: "clean",
        });
      }
      break;
    }

    case "ledge": {
      noteHook(runner, "ledge", tick, events);
      const dread = hookStrength(dog.hooks, "ledge", "dread");
      const balance = dog.frameProfile.ledgeBalance * dog.blood.ledgeBalanceMult;
      const care = 1 + 0.12 * (mind.caution - 3);
      const fallChance = clamp((feature.severity * 0.22 * (1 + dread)) / (balance * care), 0.01, 0.6);

      if (rng.chance(fallChance)) {
        const lost = 10 + feature.severity * 25;
        runner.distanceM -= runner.speed * lost * 0.5;
        runner.speed *= 0.45;
        runner.pain = clamp(runner.pain + 0.25, 0, 1);
        runner.injured = true;
        events.push({
          kind: "decision",
          tick,
          dogId: dog.id,
          feature: "ledge",
          atM: feature.atM,
          choice: "went out onto the ledge",
          ordered: ordered !== null,
          outcome: "fell",
          lostS: Math.round(lost),
        });
        events.push({
          kind: "injury",
          tick,
          dogId: dog.id,
          atM: feature.atM,
          severity: feature.severity > 0.7 ? "real" : "knock",
          cause: "came off the ledge",
        });
      } else {
        const slow = 2 + feature.severity * 5 * (1 + dread) * care;
        runner.distanceM -= runner.speed * slow * 0.4;
        events.push({
          kind: "decision",
          tick,
          dogId: dog.id,
          feature: "ledge",
          atM: feature.atM,
          choice: dread > 0.3 ? "picked its way across the ledge" : "took the ledge cleanly",
          ordered: ordered !== null,
          outcome: dread > 0.3 ? "costly" : "clean",
          lostS: Math.round(slow),
        });
      }
      break;
    }

    case "crossing": {
      noteHook(runner, "water", tick, events);
      const dread = hookStrength(dog.hooks, "water", "dread");
      const love = hookStrength(dog.hooks, "water", "love");
      const swim = dog.frameProfile.swim * dog.blood.swimMult;
      const balkChance = clamp(dread * 0.6 - love * 0.3 - (mind.nerve - 3) * 0.06, 0, 0.75);

      if (rng.chance(balkChance)) {
        const lost = 4 + dread * 10;
        runner.distanceM -= runner.speed * lost * 0.5;
        runner.morale = clamp(runner.morale - 0.06, 0.05, 1);
        events.push({
          kind: "decision",
          tick,
          dogId: dog.id,
          feature: "crossing",
          atM: feature.atM,
          choice: "balked at the water",
          ordered: ordered !== null,
          outcome: "balked",
          lostS: Math.round(lost),
        });
      } else {
        const lost = (2 + feature.severity * 6) / swim;
        runner.distanceM -= runner.speed * lost * 0.35;
        if (!dog.blood.dryInstantly) runner.wet = clamp(runner.wet + 0.5, 0, 1);
        events.push({
          kind: "decision",
          tick,
          dogId: dog.id,
          feature: "crossing",
          atM: feature.atM,
          choice: love > 0.3 ? "went straight into the water" : "crossed",
          ordered: ordered !== null,
          outcome: "clean",
          lostS: Math.round(lost),
        });
      }
      break;
    }

    case "scrub": {
      const risk = clamp(
        feature.severity * 0.15 * dog.frameProfile.scrubRisk * dog.blood.injuryRiskMult,
        0.01,
        0.5,
      );
      if (rng.chance(risk)) {
        runner.pain = clamp(runner.pain + 0.12, 0, 1);
        events.push({
          kind: "injury",
          tick,
          dogId: dog.id,
          atM: feature.atM,
          severity: "knock",
          cause: "caught by the scrub",
        });
      }
      const slow = 2 + feature.severity * 4;
      runner.distanceM -= runner.speed * slow * 0.3;
      events.push({
        kind: "decision",
        tick,
        dogId: dog.id,
        feature: "scrub",
        atM: feature.atM,
        choice: "pushed through the scrub",
        ordered: ordered !== null,
        outcome: "clean",
        lostS: Math.round(slow),
      });
      break;
    }

    case "crowd": {
      noteHook(runner, "watched", tick, events);
      const love = hookStrength(dog.hooks, "watched", "love");
      const dread = hookStrength(dog.hooks, "crowd", "dread");
      runner.morale = clamp(runner.morale + love * 0.12 - dread * 0.14, 0.05, 1);
      events.push({
        kind: "decision",
        tick,
        dogId: dog.id,
        feature: "crowd",
        atM: feature.atM,
        choice:
          love > dread ? "ran taller through the crowd" : dread > 0 ? "shrank past the crowd" : "ran through the crowd",
        ordered: false,
        outcome: dread > love ? "costly" : "clean",
      });
      break;
    }
  }
}

/** A route order is spent the first time a matching feature comes up. */
function consumeRouteOrder(runner: Runner, kind: FeatureKind): Action | null {
  const pending = runner.routeOrder;
  if (!pending) return null;

  const matches =
    (kind === "cache" && (pending.action === "TAKE THE CACHE" || pending.action === "SKIP THE CACHE")) ||
    (kind === "fork" &&
      (pending.action === "TAKE THE SHORT WAY" || pending.action === "TAKE THE LONG WAY"));

  if (!matches) return null;
  runner.routeOrder = null;
  return pending.action;
}

function noteHook(runner: Runner, situation: Situation, tick: number, events: RaceEvent[]): void {
  if (runner.announcedHooks.has(situation)) return;
  for (const hook of runner.dog.hooks) {
    if (hook.situation !== situation) continue;
    runner.announcedHooks.add(situation);
    events.push({
      kind: "hook",
      tick,
      dogId: runner.dog.id,
      atM: runner.distanceM,
      situation,
      hookKind: hook.kind,
      source: hook.source,
    });
    return;
  }
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

function checkOrders(
  runner: Runner,
  course: Course,
  rng: Rng,
  tick: number,
  events: RaceEvent[],
  previousM: number,
  crowding: number,
  staminaFraction: number,
): void {
  for (const state of runner.orders) {
    if (state.fired) continue;

    const trigger = state.order.trigger;
    let fires = false;

    if (state.landmarkM !== null) {
      // Landmark conditions are judged at the moment the dog gets there, and
      // only then. Arrive in the wrong state and the order simply never fires.
      const arriving = previousM < state.landmarkM && runner.distanceM >= state.landmarkM;
      if (!arriving) continue;
      state.crossed = true;

      switch (trigger.kind) {
        case "arrives":
          fires = true;
          break;
        case "behind":
          fires = runner.position > Math.ceil(course.fieldSize / 2);
          break;
        case "leading":
          fires = runner.position === 1;
          break;
        case "raining":
          fires = course.weather.precipitation !== "dry";
          break;
        case "stamina-low":
          fires = staminaFraction < 0.35;
          break;
        default:
          fires = false;
      }
    } else {
      switch (trigger.kind) {
        case "passed":
          fires =
            runner.wasPassedSinceM !== null && runner.wasPassedSinceM >= trigger.afterM;
          break;
        case "contested":
          fires = crowding > 0.6;
          break;
        case "overheating":
          fires = runner.heat > 0.75;
          break;
        default:
          fires = false;
      }
    }

    if (!fires) continue;

    state.fired = true;
    runner.ordersFired += 1;

    const ctx: ObedienceContext = {
      pain: runner.pain,
      exhaustion: 1 - staminaFraction,
      rivalProximity: crowding,
      audibility: audibility(runner, course, crowding),
    };
    const p = obedienceChance(
      state.order.action,
      runner.dog.mind,
      runner.dog.bond,
      runner.dog.blood.obedienceMult,
      ctx,
    );
    const obeyed = rng.chance(p);

    if (obeyed) {
      runner.ordersObeyed += 1;
      applyAction(runner, state.order.action, tick);
    }

    events.push({
      kind: "order",
      tick,
      dogId: runner.dog.id,
      atM: runner.distanceM,
      orderIndex: state.index,
      orderText: state.order.text,
      action: state.order.action,
      obeyed,
      ...(obeyed ? {} : { instead: disobedienceReason(runner, state.order.action) }),
    });
  }
}

function applyAction(runner: Runner, action: Action, tick: number): void {
  switch (action) {
    case "TAKE THE SHORT WAY":
    case "TAKE THE LONG WAY":
    case "TAKE THE CACHE":
    case "SKIP THE CACHE":
      runner.routeOrder = { action };
      break;
    case "YIELD":
      runner.speed *= 0.9;
      runner.active = { action, untilTick: tick + 20 };
      break;
    default:
      runner.active = { action, untilTick: tick + 150 };
      break;
  }
}

/**
 * Why the dog didn't listen. The player is owed a legible cause for every loss
 * (§16.2), and "it just rolled badly" is not one.
 */
function disobedienceReason(runner: Runner, action: Action): string {
  const mind = runner.dog.mind;

  if (runner.pain > 0.3) return "it was hurting too much to hear you";
  if (runner.stamina / runner.staminaMax < 0.2) return "there was nothing left to give";

  switch (action) {
    case "SKIP THE CACHE":
      return mind.greed >= 4 ? "it was never going past food" : "it wanted the cache";
    case "YIELD":
      return mind.pride >= 4 ? "it does not give up a place" : "it would not come off the rail";
    case "HOLD BACK":
      return mind.want >= 4 ? "it could smell the front and went anyway" : "it kept going";
    case "TAKE THE SHORT WAY":
      return mind.pride >= 4 ? "it thought the short line was beneath it" : "it stayed on the main line";
    case "CHASE":
      return mind.patience >= 4 ? "it would not be hurried" : "it let them go";
    case "CONTEST":
      return mind.caution >= 4 ? "it would not put a shoulder in" : "it gave up the ground";
    case "PUSH":
      return mind.caution >= 4 ? "it was reading the ground, not you" : "it held its own pace";
    default:
      return "it had its own idea";
  }
}

function audibility(runner: Runner, course: Course, crowding: number): number {
  const wind = WIND_FORCE[course.weather.wind];
  const hearing = runner.dog.frameProfile.hearing;
  return clamp(1 - (wind * 0.22) / hearing - crowding * 0.12, 0.35, 1);
}

// ---------------------------------------------------------------------------
// Injury, positions, results
// ---------------------------------------------------------------------------

function checkInjury(
  runner: Runner,
  course: Course,
  rng: Rng,
  tick: number,
  events: RaceEvent[],
  effort: number,
  remaining: number,
): void {
  const { dog } = runner;
  if (runner.pain > 0) runner.pain = Math.max(0, runner.pain - 0.00008);

  // Long courses find a long back. This is Glass-back's whole bargain.
  if (course.lengthM > 12000 && remaining < 0.5) {
    const p =
      0.000008 *
      dog.frameProfile.distanceInjuryRisk *
      dog.blood.distanceInjuryRiskMult *
      Math.pow(effort, 2);
    if (rng.chance(p)) {
      runner.pain = clamp(runner.pain + 0.3, 0, 1);
      runner.injured = true;
      events.push({
        kind: "injury",
        tick,
        dogId: dog.id,
        atM: runner.distanceM,
        severity: "strain",
        cause: "went in its back",
      });
    }
  }

  // A dog with Want past its own body will run itself into the ground (§7).
  if (runner.stamina <= 0 && dog.mind.want >= 4) {
    if (rng.chance(0.00002 * (dog.mind.want - 3))) {
      runner.pain = clamp(runner.pain + 0.4, 0, 1);
      runner.injured = true;
      events.push({
        kind: "injury",
        tick,
        dogId: dog.id,
        atM: runner.distanceM,
        severity: "real",
        cause: "kept going on an empty tank",
      });
    }
  }

  if (runner.pain >= 0.95) {
    runner.retired = true;
    events.push({
      kind: "retired",
      tick,
      dogId: dog.id,
      atM: runner.distanceM,
      cause: "pulled up lame",
    });
  }
}

function updatePositions(
  runners: Runner[],
  events: RaceEvent[],
  tick: number,
  announce: boolean,
): void {
  const ordered = [...runners]
    .filter((r) => !r.retired)
    .sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished && b.finished) return (a.timeS ?? 0) - (b.timeS ?? 0);
      return b.distanceM - a.distanceM;
    });

  ordered.forEach((runner, index) => {
    const next = index + 1;
    if (runner.position !== next) {
      const overtaker =
        next < runner.position ? undefined : ordered[next - 2];
      if (announce) {
        events.push({
          kind: "position",
          tick,
          dogId: runner.dog.id,
          atM: runner.distanceM,
          from: runner.position,
          to: next,
          ...(overtaker && next > runner.position ? { byDogId: overtaker.dog.id } : {}),
        });
      }
      if (next > runner.position) runner.wasPassedSinceM = runner.distanceM;
      runner.position = next;
    }
  });
}

function countRetired(runners: readonly Runner[]): number {
  return runners.filter((r) => r.retired).length;
}

function buildStandings(runners: readonly Runner[], finishOrder: readonly Runner[]): Standing[] {
  const standings: Standing[] = finishOrder.map((runner, index) => ({
    dogId: runner.dog.id,
    name: runner.dog.name,
    position: index + 1,
    timeS: runner.timeS,
    finished: true,
  }));

  const unfinished = runners
    .filter((r) => !r.finished)
    .sort((a, b) => b.distanceM - a.distanceM);

  unfinished.forEach((runner, index) => {
    standings.push({
      dogId: runner.dog.id,
      name: runner.dog.name,
      position: finishOrder.length + index + 1,
      timeS: null,
      finished: false,
    });
  });

  return standings;
}

function summarise(runner: Runner, standings: readonly Standing[]): DogSummary {
  const standing = standings.find((s) => s.dogId === runner.dog.id)!;
  return {
    dogId: runner.dog.id,
    name: runner.dog.name,
    position: standing.position,
    finished: standing.finished,
    timeS: standing.timeS,
    staminaLeft: clamp(runner.stamina / runner.staminaMax, 0, 1),
    heatPeak: runner.heatPeak,
    moraleEnd: runner.morale,
    ordersFired: runner.ordersFired,
    ordersObeyed: runner.ordersObeyed,
    topSpeed: runner.topSpeed,
    injured: runner.injured,
  };
}
