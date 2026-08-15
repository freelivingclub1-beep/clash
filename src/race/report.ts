/**
 * The text race report.
 *
 * §15, Phase 1: "Output plain text race reports. If a text-only race report is
 * not compelling to read, no amount of art will save the game."
 *
 * Two rules hold this file together:
 *
 *   1. No numbers that describe the dog. Distances, times and seconds lost are
 *      things a handler at the rail can see with a stopwatch. Stamina, morale,
 *      heat and trait values are not, and never appear.
 *   2. Every loss gets a legible cause (§16.2). If the dog lost time, the
 *      report says where and to what.
 */

import type { Course, Posting } from "./course.ts";
import type { RaceEvent, RaceResult } from "./events.ts";
import type { Order } from "./orders.ts";
import type { Dog } from "../creation/dog.ts";

export type ReportInput = {
  readonly course: Course;
  readonly posting: Posting;
  readonly dog: Dog;
  readonly orders: readonly Order[];
  readonly result: RaceResult;
};

export function renderRaceReport(input: ReportInput): string {
  const { course, posting, dog, orders, result } = input;
  const mine = result.events.filter((e) => "dogId" in e && e.dogId === dog.id);
  const summary = result.summaries.find((s) => s.dogId === dog.id)!;

  const sections = [
    header(posting, course),
    ordersBlock(orders),
    "— — —",
    narrate(mine, result, dog),
    "— — —",
    finishBlock(result, dog),
    observations(mine, summary, result, dog, course, orders),
  ];

  return sections.filter((s) => s.length > 0).join("\n\n");
}

function header(posting: Posting, course: Course): string {
  return [
    `**${posting.name}**`,
    posting.facts.join(" · "),
    `Ladder: ${course.ladder}.`,
  ].join("\n");
}

function ordersBlock(orders: readonly Order[]): string {
  if (orders.length === 0) return "You sent it out with nothing.";
  const lines = orders.map((o, i) => `  ${i + 1}. ${o.text}`);
  return ["Your standing orders:", ...lines].join("\n");
}

// ---------------------------------------------------------------------------
// The race, in order
// ---------------------------------------------------------------------------

function narrate(events: readonly RaceEvent[], result: RaceResult, dog: Dog): string {
  const beats: string[] = [];
  let lastPositionTick = -Infinity;
  let lastReported: number | null = null;
  const told = new Set<string>();

  // A fall off a ledge produces both a decision and an injury on the same tick.
  // That is one moment at the rail, so the decision line carries the injury and
  // the separate injury beat is dropped.
  const decisionTicks = new Set(events.filter((e) => e.kind === "decision").map((e) => e.tick));
  const hurtAt = new Set(
    events.filter((e) => e.kind === "injury" && decisionTicks.has(e.tick)).map((e) => e.tick),
  );

  for (const event of events) {
    if (event.kind === "injury" && hurtAt.has(event.tick)) continue;
    const line = beatFor(event, result, dog, hurtAt, () => {
      if (event.kind !== "position") return false;
      // Worth saying out loud: a named dog going past, taking the lead, or a
      // move of two places or more. Everything else is the field breathing.
      const notable =
        event.byDogId !== undefined ||
        event.to === 1 ||
        lastReported === null ||
        Math.abs(event.to - lastReported) >= 2;
      if (!notable || event.tick - lastPositionTick < 120) return false;

      // Two dogs swapping places for a kilometre is one moment, not five.
      const key = event.byDogId ? `by:${event.byDogId}` : `to:${event.to}`;
      if (told.has(key)) return false;

      told.add(key);
      lastPositionTick = event.tick;
      lastReported = event.to;
      return true;
    });
    if (line) beats.push(line);
  }

  if (beats.length === 0) {
    return "It ran the whole way without anything happening to it. Not every race has a story in it.";
  }
  return beats.join("\n");
}

function beatFor(
  event: RaceEvent,
  result: RaceResult,
  dog: Dog,
  hurtAt: ReadonlySet<number>,
  allowPosition: () => boolean,
): string | null {
  switch (event.kind) {
    case "order": {
      const at = mark(event.atM);
      if (event.obeyed) {
        return `${at}  Your order fired — ${event.action.toLowerCase()}. It did as you asked.`;
      }
      return `${at}  Your order fired — ${event.action.toLowerCase()}. It didn't: ${event.instead}.`;
    }

    case "decision":
      return `${mark(event.atM)}  ${decisionSentence(event, hurtAt.has(event.tick))}`;

    case "state": {
      const at = mark(event.atM);
      switch (event.state) {
        case "fading":
          return `${at}  The stride shortened. You could see it from the rail.`;
        case "overheating":
          return `${at}  It was running with its mouth open and it never shut it again.`;
        case "cold":
          return `${at}  It ran tight and unhappy in the cold.`;
        case "labouring":
          return `${at}  It was labouring.`;
        case "second wind":
          return `${at}  Something came back into it.`;
      }
      return null;
    }

    case "injury": {
      const at = mark(event.atM);
      const words = {
        knock: "It took a knock",
        strain: "Something pulled",
        real: "Something went",
      } as const;
      return `${at}  ${words[event.severity]} — ${event.cause}. It ran on.`;
    }

    case "position": {
      if (!allowPosition()) return null;
      if (event.to < event.from) {
        return `${mark(event.atM)}  Up to ${ordinal(event.to)}.`;
      }
      const by = event.byDogId ? nameOf(result, event.byDogId) : null;
      return by
        ? `${mark(event.atM)}  ${by} came past. ${capitalise(ordinal(event.to))} now.`
        : `${mark(event.atM)}  Back to ${ordinal(event.to)}.`;
    }

    case "retired":
      return `${mark(event.atM)}  ${dog.name} ${event.cause}. That was the race.`;

    case "hook":
    case "finish":
    case "start":
      return null;
  }
}

function decisionSentence(
  event: Extract<RaceEvent, { kind: "decision" }>,
  hurt: boolean,
): string {
  const lost = event.lostS ?? 0;
  const ordered = event.ordered ? " Your doing." : "";
  // A fall already says it hurt; anything else that drew blood has to say so.
  const sore = hurt && event.outcome !== "fell" ? " It came out of it sore." : "";

  switch (event.feature) {
    case "cache":
      return event.choice.startsWith("took")
        ? `It went into the cache and stood over it — ${lost} seconds.${ordered}`
        : `It ran straight past the cache without turning its head.${ordered}`;
    case "fork":
      if (event.outcome === "paid off") return `It cut the short line and it worked.${ordered}`;
      if (event.outcome === "costly") {
        return `It cut the short line, got it wrong, and lost ${lost} seconds doing it.${ordered}`;
      }
      return `It stayed on the main line at the fork.${ordered}`;
    case "ledge":
      if (event.outcome === "fell") return `It came off the ledge. ${lost} seconds, and it got up hurting.`;
      if (event.outcome === "costly") {
        return `It picked its way along the ledge — ${lost} seconds it did not have to lose.`;
      }
      return `It took the ledge without breaking stride.${sore}`;
    case "crossing":
      if (event.outcome === "balked") {
        return `It stopped at the water. ${lost} seconds on the bank before it would go in.`;
      }
      return `It crossed the water${lost > 3 ? ` — ${lost} seconds` : " without fuss"}.${sore}`;
    case "scrub":
      return `It shoved through the scrub — ${lost} seconds.${sore}`;
    case "crowd":
      return event.outcome === "costly"
        ? `It shrank going past the crowd.`
        : `It ran taller going past the crowd.`;
  }
}

// ---------------------------------------------------------------------------
// The line
// ---------------------------------------------------------------------------

function finishBlock(result: RaceResult, dog: Dog): string {
  const mine = result.standings.find((s) => s.dogId === dog.id)!;
  const winner = result.standings.find((s) => s.position === 1);
  const field = result.standings.length;

  if (!mine.finished) {
    return `${dog.name} did not finish.`;
  }

  const lines = [
    `${capitalise(ordinal(mine.position))} of ${field}, ${clock(mine.timeS!)}.`,
  ];

  if (winner && winner.dogId !== dog.id && winner.timeS !== null) {
    const gap = mine.timeS! - winner.timeS;
    lines.push(`${winner.name} won it in ${clock(winner.timeS)} — ${gapWords(gap)} up the road.`);
  } else if (winner && winner.dogId === dog.id) {
    const second = result.standings.find((s) => s.position === 2);
    if (second?.timeS != null) {
      lines.push(`${second.name} was ${gapWords(second.timeS - mine.timeS!)} back.`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// What you might have noticed
// ---------------------------------------------------------------------------

function observations(
  events: readonly RaceEvent[],
  summary: RaceResult["summaries"][number],
  result: RaceResult,
  dog: Dog,
  course: Course,
  orders: readonly Order[],
): string {
  const notes: string[] = [];

  // Orders: the emotional core is the gap between what you said and what it did.
  if (summary.ordersFired === 0) {
    notes.push("Not one of your orders found its moment. You wrote them for a race that didn't happen.");
  } else {
    const missed = summary.ordersFired - summary.ordersObeyed;
    if (missed === 0) {
      notes.push(
        `It took every order you gave it — ${summary.ordersFired} of ${summary.ordersFired}.`,
      );
    } else if (summary.ordersObeyed === 0) {
      notes.push(
        summary.ordersFired === 1
          ? "You spoke to it once and it did not listen."
          : `It heard you ${summary.ordersFired} times and listened to none of them.`,
      );
    } else {
      notes.push(
        `${summary.ordersObeyed} of ${summary.ordersFired} orders got through.`,
      );
    }
  }

  const silent = orders.length - summary.ordersFired;
  if (silent > 0 && orders.length > 0) {
    notes.push(
      `${silent} of your ${orders.length} orders never came up. A condition that never happens is a wasted slot.`,
    );
  }

  // Fuel at the line, expressed the way a handler reads it: how it looked.
  if (summary.finished) {
    if (summary.staminaLeft > 0.4) {
      notes.push("It came back off the course still fresh. You never asked it for enough.");
    } else if (summary.staminaLeft > 0.18) {
      notes.push("It finished tired and level — about right.");
    } else if (summary.staminaLeft > 0.04) {
      notes.push("It was empty at the line. Nothing left for a sprint if one had been needed.");
    } else {
      notes.push("It ran itself flat. Whatever it had, it spent, and then it kept going.");
    }
  }

  if (summary.heatPeak > 0.8) {
    notes.push("It ran hot. That coat is not for this weather.");
  }

  // Hooks: this is where the dog's history became visible in public.
  const hooks = events.filter((e) => e.kind === "hook");
  for (const hook of hooks) {
    if (hook.kind !== "hook") continue;
    const verb =
      hook.hookKind === "dread"
        ? "It has never been right about"
        : hook.hookKind === "love"
          ? "It is at its best around"
          : "It is at home in";
    notes.push(`${verb} ${hook.situation.replace("-", " ")} — ${hook.source}.`);
  }

  // Time given away at features, totalled. Specific, checkable, fixable.
  const lost = events.reduce(
    (sum, e) => (e.kind === "decision" ? sum + (e.lostS ?? 0) : sum),
    0,
  );
  if (lost >= 8) {
    notes.push(`${lost} seconds went at the features. Some of that was yours to prevent.`);
  }

  if (summary.injured) {
    notes.push("Look it over tonight. It came home carrying something.");
  }

  const winner = result.standings.find((s) => s.position === 1);
  if (winner && winner.dogId === dog.id) {
    notes.push(`It won ${course.name} outright. Write down what the weather was doing.`);
  }

  if (notes.length === 0) return "";
  return ["What you might have noticed:", ...notes.map((n) => `  · ${n}`)].join("\n");
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function mark(metres: number): string {
  const km = Math.round(metres / 100) / 10;
  return `km ${km.toFixed(1).padStart(5, " ")}`;
}

/** A gap the way a handler would say it out loud. */
function gapWords(seconds: number): string {
  if (seconds < 1) return "a stride";
  if (seconds < 90) return `${seconds} seconds`;
  const minutes = Math.round(seconds / 60);
  return `${minutes} minutes`;
}

function clock(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

function ordinal(position: number): string {
  const names = [
    "first",
    "second",
    "third",
    "fourth",
    "fifth",
    "sixth",
    "seventh",
    "eighth",
    "ninth",
    "tenth",
    "eleventh",
    "twelfth",
  ];
  return names[position - 1] ?? `${position}th`;
}

function capitalise(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function nameOf(result: RaceResult, dogId: string): string {
  return result.standings.find((s) => s.dogId === dogId)?.name ?? "another dog";
}
