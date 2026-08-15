import test from "node:test";
import assert from "node:assert/strict";

import { evenMind } from "../src/creation/mind.ts";
import { randomDog } from "../src/creation/dog.ts";
import { LADDERS, generateCourse, postCourse, type Ladder } from "../src/race/course.ts";
import {
  MAX_ORDERS,
  OrderSyntaxError,
  conditionModifier,
  obedienceChance,
  orderAlignment,
  parseOrder,
  parseOrders,
} from "../src/race/orders.ts";
import { runRace, type Entrant } from "../src/race/race.ts";
import { renderRaceReport } from "../src/race/report.ts";

const RACING_LADDERS: readonly Ladder[] = ["sprint", "long", "climb", "rough", "reading"];

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

test("a posting is exactly eight facts, on every ladder", () => {
  for (const ladder of RACING_LADDERS) {
    for (let i = 0; i < 25; i++) {
      const posting = postCourse(generateCourse(`post-${i}`, ladder));
      assert.equal(posting.facts.length, 8, `${ladder} #${i}`);
      assert.ok(posting.facts.every((f) => f.length > 0));
    }
  }
});

test("a posting never gives away segment order or severity", () => {
  for (let i = 0; i < 25; i++) {
    const course = generateCourse(`hide-${i}`, "rough");
    const text = postCourse(course).facts.join(" · ");

    for (const feature of course.features) {
      assert.ok(
        !text.includes(String(feature.severity)),
        "severity is never posted",
      );
    }
    assert.ok(
      !/segment/i.test(text),
      "the segment list is never posted",
    );
  }
});

test("courses are seeded and reproducible", () => {
  const a = generateCourse("same-seed", "climb");
  const b = generateCourse("same-seed", "climb");
  assert.deepEqual(a, b);

  const c = generateCourse("other-seed", "climb");
  assert.notDeepEqual(a, c);
});

test("course segments tile the whole distance without gaps", () => {
  for (const ladder of LADDERS) {
    const course = generateCourse(`tile-${ladder}`, ladder);
    let cursor = 0;
    for (const segment of course.segments) {
      assert.equal(segment.startM, cursor, `${ladder}: segments are contiguous`);
      cursor += segment.lengthM;
    }
    assert.equal(cursor, course.lengthM, `${ladder}: segments cover the course`);
    assert.ok(course.features.every((f) => f.atM > 0 && f.atM < course.lengthM));
  }
});

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

test("orders parse the shapes the doc writes them in", () => {
  assert.deepEqual(parseOrder("IF behind at the ridge -> PUSH").action, "PUSH");
  assert.deepEqual(parseOrder("IF behind at the ridge → PUSH").action, "PUSH");
  assert.deepEqual(
    parseOrder("IF raining at the crossing -> TAKE THE LONG WAY").trigger.kind,
    "raining",
  );
  assert.deepEqual(parseOrder("IF a dog passes after km 8 -> CHASE").trigger, {
    kind: "passed",
    afterM: 8000,
  });
  assert.deepEqual(
    parseOrder("IF stamina low at the ledge -> HOLD BACK").trigger.kind,
    "stamina-low",
  );
});

test("a malformed order says what is wrong with it", () => {
  assert.throws(() => parseOrder("PUSH"), OrderSyntaxError);
  assert.throws(() => parseOrder("IF behind at the ridge -> SPRINT"), /not an order this dog/);
  assert.throws(() => parseOrder("IF the vibes are off -> PUSH"), /not a condition/);
  assert.throws(() => parseOrder("IF behind at the moon -> PUSH"), /not a place on this course/);
  assert.throws(
    () => parseOrders(Array(MAX_ORDERS + 1).fill("IF behind at the ridge -> PUSH")),
    /standing orders/,
  );
});

test("order alignment matches the three worked examples in §9", () => {
  const mind = evenMind();

  const greedy = { ...mind, greed: 5 };
  assert.ok(Math.abs(orderAlignment("SKIP THE CACHE", greedy) - 0.4) < 0.001);

  const proud = { ...mind, pride: 5 };
  assert.ok(Math.abs(orderAlignment("YIELD", proud) - 0.3) < 0.001);

  const wanting = { ...mind, want: 5 };
  assert.ok(Math.abs(orderAlignment("HOLD BACK", wanting) - 0.35) < 0.001);
});

test("pain, exhaustion and crowding all degrade compliance", () => {
  const mind = evenMind();
  const calm = { pain: 0, exhaustion: 0, rivalProximity: 0, audibility: 1 };

  assert.ok(conditionModifier(mind, { ...calm, pain: 0.8 }) < conditionModifier(mind, calm));
  assert.ok(conditionModifier(mind, { ...calm, exhaustion: 0.9 }) < conditionModifier(mind, calm));
  assert.ok(
    conditionModifier(mind, { ...calm, rivalProximity: 1 }) < conditionModifier(mind, calm),
  );

  // Loyalty is the trait that holds an order together through pain (§7).
  const loyal = { ...mind, loyalty: 5 };
  assert.ok(
    conditionModifier(loyal, { ...calm, pain: 0.8 }) >
      conditionModifier({ ...mind, loyalty: 1 }, { ...calm, pain: 0.8 }),
  );
});

test("bond scales every order and is never certain either way", () => {
  const mind = evenMind();
  const calm = { pain: 0, exhaustion: 0, rivalProximity: 0, audibility: 1 };

  const low = obedienceChance("PUSH", mind, 0.4, 1, calm);
  const high = obedienceChance("PUSH", mind, 0.95, 1, calm);

  assert.ok(high > low);
  assert.ok(low > 0.02 && high < 0.99, "a dog is never a guarantee in either direction");
});

// ---------------------------------------------------------------------------
// The race
// ---------------------------------------------------------------------------

function field(seed: string, size: number): Entrant[] {
  return Array.from({ length: size }, (_, i) => ({
    dog: randomDog(`${seed}-dog-${i}`),
    orders: [],
  }));
}

test("the same seed runs the same race, every time", () => {
  const course = generateCourse("determinism", "rough");
  const entrants = field("determinism", 8);

  const a = runRace(course, entrants, "run-seed");
  const b = runRace(course, entrants, "run-seed");

  assert.equal(a.ticks, b.ticks);
  assert.equal(a.events.length, b.events.length);
  assert.deepEqual(a.standings, b.standings);
});

test("a different run seed gives a different race", () => {
  const course = generateCourse("divergence", "rough");
  const entrants = field("divergence", 8);

  const a = runRace(course, entrants, "run-a");
  const b = runRace(course, entrants, "run-b");

  assert.notDeepEqual(a.standings, b.standings);
});

test("every entrant gets exactly one place, and places are 1..n", () => {
  for (const ladder of LADDERS) {
    const course = generateCourse(`places-${ladder}`, ladder);
    const entrants = field(`places-${ladder}`, course.fieldSize);
    const result = runRace(course, entrants, `places-${ladder}`);

    assert.equal(result.standings.length, entrants.length);
    assert.deepEqual(
      [...result.standings.map((s) => s.position)].sort((x, y) => x - y),
      entrants.map((_, i) => i + 1),
    );
    assert.equal(new Set(result.standings.map((s) => s.dogId)).size, entrants.length);
  }
});

test("finishing times are ordered by finishing position", () => {
  const course = generateCourse("ordering", "long");
  const result = runRace(course, field("ordering", 8), "ordering");
  const times = result.standings.filter((s) => s.finished).map((s) => s.timeS!);

  for (let i = 1; i < times.length; i++) {
    assert.ok(times[i]! >= times[i - 1]!, "a later place is never a faster time");
  }
});

test("the field actually finishes in a plausible time", () => {
  for (const ladder of ["sprint", "climb", "rough"] as const) {
    for (let i = 0; i < 5; i++) {
      const course = generateCourse(`plausible-${ladder}-${i}`, ladder);
      const result = runRace(
        course,
        field(`plausible-${ladder}-${i}`, course.fieldSize),
        `plausible-${ladder}-${i}`,
      );
      const winner = result.standings.find((s) => s.position === 1)!;

      assert.ok(winner.finished, `${ladder} #${i}: somebody finishes`);
      const speed = course.lengthM / winner.timeS!;
      assert.ok(speed > 1.5 && speed < 10, `${ladder} #${i}: winner ran at ${speed.toFixed(2)} m/s`);
    }
  }
});

test("orders fire, and a dog with no bond ignores more of them than a bonded one", () => {
  const course = generateCourse("obedience", "rough");
  const orders = parseOrders([
    "IF at halfway -> PUSH",
    "IF at the last quarter -> CHASE",
    "IF at the start -> STEADY",
  ]);

  let obeyedWhenBonded = 0;
  let obeyedWhenNot = 0;

  for (let i = 0; i < 30; i++) {
    const base = randomDog(`ob-${i}`);
    const bonded = { ...base, bond: 0.95 };
    const stranger = { ...base, bond: 0.4 };

    for (const [dog, tally] of [
      [bonded, "bonded"],
      [stranger, "stranger"],
    ] as const) {
      const result = runRace(
        course,
        [{ dog, orders }, ...field(`ob-${i}`, 5)],
        `ob-${i}-${tally}`,
      );
      const summary = result.summaries.find((s) => s.dogId === dog.id)!;
      if (tally === "bonded") obeyedWhenBonded += summary.ordersObeyed;
      else obeyedWhenNot += summary.ordersObeyed;
    }
  }

  assert.ok(obeyedWhenBonded > 0, "orders do fire");
  assert.ok(
    obeyedWhenBonded > obeyedWhenNot,
    `bond is the multiplier on every order (${obeyedWhenBonded} vs ${obeyedWhenNot})`,
  );
});

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

test("the report never leaks a hidden number", () => {
  const course = generateCourse("leak", "rough");
  const dog = randomDog("leak-dog");
  const orders = parseOrders(["IF at halfway -> PUSH", "IF behind at the ridge -> CHASE"]);
  const result = runRace(course, [{ dog, orders }, ...field("leak", 6)], "leak");

  const text = renderRaceReport({
    course,
    posting: postCourse(course),
    dog,
    orders,
    result,
  });

  // §2: no numbers are ever shown to the player. Distances and clock times are
  // things a handler can see from the rail; the dog's internals are not.
  for (const forbidden of ["stamina", "morale", "bond", "heat", "obedience", "trait"]) {
    assert.ok(!text.toLowerCase().includes(forbidden), `report leaks "${forbidden}"`);
  }
  assert.ok(text.includes(course.name));
});

test("the report gives every loss a cause", () => {
  const course = generateCourse("cause", "rough");
  const dog = randomDog("cause-dog");
  const orders = parseOrders(["IF at halfway -> HOLD BACK"]);
  const result = runRace(course, [{ dog, orders }, ...field("cause", 6)], "cause");

  const text = renderRaceReport({ course, posting: postCourse(course), dog, orders, result });

  for (const event of result.events) {
    if (event.kind === "order" && event.dogId === dog.id && !event.obeyed) {
      assert.ok(event.instead && event.instead.length > 0, "disobedience always has a reason");
      assert.ok(text.includes(event.instead), "and the reason reaches the player");
    }
  }
});
