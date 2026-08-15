/**
 * Headless KENNEL — Phase 1.
 *
 * Builds a dog, posts the day's two courses, enters one of them, and prints a
 * plain text race report. No UI, no renderer, no client. This is the go/no-go
 * gate from §15: if reading this output is not interesting, the game does not
 * work and no amount of art will fix it.
 *
 *   npm run race
 *   npm run race -- --seed=marrow-14 --ladder=rough
 */

import { Rng } from "./core/rng.ts";
import { createDog, describeDog, randomDog, type DogSpec } from "./creation/dog.ts";
import { standardFrame, type Frame } from "./creation/frame.ts";
import type { Mind } from "./creation/mind.ts";
import type { History } from "./creation/history.ts";
import { generateCourse, postCourse, type Ladder, LADDERS } from "./race/course.ts";
import { parseOrders } from "./race/orders.ts";
import { runRace, type Entrant } from "./race/race.ts";
import { renderRaceReport } from "./race/report.ts";

// ---------------------------------------------------------------------------
// One authored dog, so the demo shows a real build rather than noise.
// ---------------------------------------------------------------------------

function marrowFrame(): Frame {
  const frame = standardFrame();
  frame.chestDepth = 5; // deep
  frame.legLength = 2; // low
  frame.backLength = 2; // tight
  frame.pawSpread = 5; // wide
  frame.muzzleLength = 2; // brief
  frame.coatLength = 4; // full
  frame.coatDensity = 5; // dense
  frame.tailSet = 4; // level
  frame.bone = 4; // heavy
  frame.shoulderSlope = 2; // forward
  frame.hipAngle = 5; // deep
  return frame;
}

const MARROW_MIND: Mind = {
  greed: 2,
  nerve: 4,
  patience: 5,
  loyalty: 4,
  curiosity: 2,
  spite: 1,
  pride: 3,
  caution: 3,
  focus: 4,
  temper: 2,
  trust: 3,
  want: 3,
};

const MARROW_HISTORY: History = {
  born: "mountain-kennel",
  litter: "one-of-two",
  "first-winter": "worked-through-it",
  "first-fear": "deep-water",
  "fed-on": "fish",
  "taught-by": "patient-hand",
  "first-scar": "a-fall",
  "what-it-loves": "the-cold",
  "what-it-lost": "a-littermate",
  "first-race": "lost-badly",
};

const MARROW: DogSpec = {
  name: "Marrow",
  frame: marrowFrame(),
  blood: ["ice-blood", "deep-lung"],
  history: MARROW_HISTORY,
  mind: MARROW_MIND,
};

const STANDING_ORDERS = [
  "IF behind at the ridge -> PUSH",
  "IF at the cache -> SKIP THE CACHE",
  "IF a dog passes after km 5 -> CHASE",
  "IF stamina low at the last quarter -> HOLD BACK",
];

// ---------------------------------------------------------------------------

function main(argv: readonly string[]): void {
  const args = parseArgs(argv);
  const seed = args.seed ?? "cold-run";

  const dog = createDog(MARROW, `${seed}:marrow`, { bond: 0.68, condition: 0.9 });

  console.log("=".repeat(72));
  console.log("KENNEL — headless simulation, phase 1");
  console.log("=".repeat(72));
  console.log();
  console.log(describeDog(dog));
  console.log();

  // §3: two courses post every day, and entering both costs condition.
  const ladders = args.ladder ? [args.ladder, args.ladder] : pickLadders(seed);
  const posted = [
    generateCourse(`${seed}:a`, ladders[0]!),
    generateCourse(`${seed}:b`, ladders[1]!),
  ];

  console.log("TODAY'S BOARD");
  for (const course of posted) {
    const posting = postCourse(course);
    console.log(`  ${posting.name} [${posting.ladder}] — ${posting.facts.join(" · ")}`);
  }
  console.log();

  const course = posted[args.course === "b" ? 1 : 0]!;
  const posting = postCourse(course);
  console.log(`You enter ${posting.name}.`);
  console.log();
  const orders = parseOrders(STANDING_ORDERS);

  const field: Entrant[] = [
    { dog, orders },
    ...Array.from({ length: course.fieldSize - 1 }, (_, i) => ({
      dog: randomDog(`${seed}:${course.id}:rival-${i}`),
      orders: [],
    })),
  ];

  const result = runRace(course, field, `${seed}:run`);
  console.log(renderRaceReport({ course, posting, dog, orders, result }));
  console.log();
}

/** Two different ladders each day, so the board is a real choice (§11). */
function pickLadders(seed: string): Ladder[] {
  const rng = new Rng(`board:${seed}`);
  return rng.pickMany(["sprint", "long", "climb", "rough"] as const, 2);
}

type Args = { seed?: string; ladder?: Ladder; course?: "a" | "b" };

function parseArgs(argv: readonly string[]): Args {
  const args: Args = {};
  for (const raw of argv) {
    const [key, value] = raw.replace(/^--/, "").split("=");
    if (key === "seed" && value) args.seed = value;
    if (key === "course" && (value === "a" || value === "b")) args.course = value;
    if (key === "ladder" && value) {
      const found = LADDERS.find((l) => l === value);
      if (!found) throw new Error(`unknown ladder: ${value}. One of ${LADDERS.join(", ")}`);
      args.ladder = found;
    }
  }
  return args;
}

main(process.argv.slice(2));
