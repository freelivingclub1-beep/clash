/**
 * Balance probe.
 *
 * Runs random fields over each ladder and reports the three numbers that tell
 * you whether the sim is still in a sane place: how far the last dog is behind
 * the first, how fast the winner ran, and how many dogs failed to finish.
 *
 * A mismatched dog should lose clearly. It should not be lapped, and it should
 * not fail to get round.
 *
 *   node scripts/spread.ts
 */

import { randomDog } from "../src/creation/dog.ts";
import { generateCourse, type Ladder } from "../src/race/course.ts";
import { runRace, type Entrant } from "../src/race/race.ts";

const LADDERS: readonly Ladder[] = ["sprint", "long", "climb", "rough"];
const COURSES_PER_LADDER = 8;

const average = (xs: readonly number[]): number =>
  xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

console.log("ladder   last/first   winner      dnf");

for (const ladder of LADDERS) {
  const spreads: number[] = [];
  const speeds: number[] = [];
  let dnf = 0;
  let entries = 0;

  for (let i = 0; i < COURSES_PER_LADDER; i++) {
    const course = generateCourse(`spread-${i}`, ladder);
    const field: Entrant[] = Array.from({ length: course.fieldSize }, (_, j) => ({
      dog: randomDog(`spread-${ladder}-${i}-${j}`),
      orders: [],
    }));

    const result = runRace(course, field, `spread-${ladder}-${i}`);
    const times = result.standings.filter((s) => s.finished).map((s) => s.timeS!);

    entries += result.standings.length;
    dnf += result.standings.filter((s) => !s.finished).length;

    if (times.length > 1) {
      spreads.push(Math.max(...times) / Math.min(...times));
      speeds.push(course.lengthM / Math.min(...times));
    }
  }

  const dnfShare = ((dnf / entries) * 100).toFixed(0);
  console.log(
    `${ladder.padEnd(8)} ${average(spreads).toFixed(2)}x`.padEnd(22) +
      `${average(speeds).toFixed(2)} m/s   ${dnfShare}%`,
  );
}
