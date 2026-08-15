/**
 * The race log.
 *
 * §9: "because the race is a deterministic log, the visuals are a replay layer
 * completely decoupled from game logic." Everything the sim wants anyone to
 * know about a race comes out as one of these events, in tick order. The text
 * report reads them; a renderer would read the same list and draw instead.
 *
 * Nothing downstream of here may reach back into the sim's internal state.
 */

import type { Action } from "./orders.ts";
import type { FeatureKind } from "./course.ts";
import type { Situation } from "../creation/history.ts";

export type RaceEvent =
  | { readonly kind: "start"; readonly tick: number; readonly fieldSize: number }
  | {
      readonly kind: "order"; // a standing order's condition fired
      readonly tick: number;
      readonly dogId: string;
      readonly atM: number;
      readonly orderIndex: number;
      readonly orderText: string;
      readonly action: Action;
      readonly obeyed: boolean;
      /** What the dog did instead, when it didn't listen. */
      readonly instead?: string;
    }
  | {
      readonly kind: "decision"; // a fork, cache or hazard resolved
      readonly tick: number;
      readonly dogId: string;
      readonly feature: FeatureKind;
      readonly atM: number;
      readonly choice: string;
      readonly ordered: boolean;
      readonly outcome: "clean" | "costly" | "paid off" | "balked" | "fell";
      readonly lostS?: number;
    }
  | {
      readonly kind: "hook"; // this dog's own history showed up in the race
      readonly tick: number;
      readonly dogId: string;
      readonly atM: number;
      readonly situation: Situation;
      readonly hookKind: "dread" | "love" | "edge";
      readonly source: string;
    }
  | {
      readonly kind: "position";
      readonly tick: number;
      readonly dogId: string;
      readonly atM: number;
      readonly from: number;
      readonly to: number;
      readonly byDogId?: string;
    }
  | {
      readonly kind: "state"; // fading, overheating, coming back
      readonly tick: number;
      readonly dogId: string;
      readonly atM: number;
      readonly state: "fading" | "overheating" | "cold" | "second wind" | "labouring";
    }
  | {
      readonly kind: "injury";
      readonly tick: number;
      readonly dogId: string;
      readonly atM: number;
      readonly severity: "knock" | "strain" | "real";
      readonly cause: string;
    }
  | {
      readonly kind: "finish";
      readonly tick: number;
      readonly dogId: string;
      readonly position: number;
      readonly timeS: number;
    }
  | {
      readonly kind: "retired"; // pulled up, did not finish
      readonly tick: number;
      readonly dogId: string;
      readonly atM: number;
      readonly cause: string;
    };

export type Standing = {
  readonly dogId: string;
  readonly name: string;
  readonly position: number;
  readonly timeS: number | null;
  readonly finished: boolean;
};

export type DogSummary = {
  readonly dogId: string;
  readonly name: string;
  readonly position: number;
  readonly finished: boolean;
  readonly timeS: number | null;
  /** 0-1 at the line. */
  readonly staminaLeft: number;
  readonly heatPeak: number;
  readonly moraleEnd: number;
  readonly ordersFired: number;
  readonly ordersObeyed: number;
  readonly topSpeed: number;
  readonly injured: boolean;
};

export type RaceResult = {
  readonly courseId: string;
  readonly seed: string;
  readonly ticks: number;
  readonly events: readonly RaceEvent[];
  readonly standings: readonly Standing[];
  readonly summaries: readonly DogSummary[];
};

export function eventsFor(result: RaceResult, dogId: string): readonly RaceEvent[] {
  return result.events.filter((e) => "dogId" in e && e.dogId === dogId);
}
