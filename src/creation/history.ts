/**
 * Layer three — HISTORY (design doc §6).
 *
 * Ten chapters of a life the dog already had before you met it. Every option is
 * plain language and its meaning is inferable but never stated — so the data
 * here is the part the player is meant to work out by watching, not by reading.
 *
 * History does two things:
 *   1. nudges the starting Mind values, invisibly
 *   2. plants hooks — situations that mean something specific to *this* dog
 *
 * Note on the doc's arithmetic: §6 claims 7^10 histories, but four chapters as
 * written list six options and "What it lost" lists five, which comes to about
 * 93 million rather than 282 million. The options are transcribed exactly as
 * written rather than padded out — see NOTES.md.
 */

import type { MindTrait } from "./mind.ts";

/** Situations the race sim knows how to recognise. */
export const SITUATIONS = [
  "water",
  "crowd",
  "open",
  "alone",
  "fire",
  "dogs-near",
  "dark",
  "cold",
  "quiet",
  "watched",
  "ledge",
  "cache",
  "front",
] as const;

export type Situation = (typeof SITUATIONS)[number];

/**
 * `dread` costs speed and morale when the situation is live, `love` pays both
 * back, `edge` is a quiet competence with no emotional weight.
 */
export type HookKind = "dread" | "love" | "edge";

export type Hook = {
  readonly kind: HookKind;
  readonly situation: Situation;
  /** 0-1. Training can wear this down; experience can deepen it. */
  readonly strength: number;
  /** Where it came from, so the kennel can tell the player a true story later. */
  readonly source: string;
};

export type HistoryOption = {
  readonly id: string;
  readonly label: string;
  readonly mind?: Partial<Record<MindTrait, number>>;
  readonly hooks?: readonly Omit<Hook, "source">[];
  /** Widens the hidden per-dog nature roll (§2, "every dog has a hidden nature"). */
  readonly natureSpread?: number;
};

export type Chapter = {
  readonly id: string;
  readonly prompt: string;
  readonly options: readonly HistoryOption[];
};

export const CHAPTERS: readonly Chapter[] = [
  {
    id: "born",
    prompt: "Born",
    options: [
      {
        id: "mountain-kennel",
        label: "mountain kennel",
        mind: { nerve: 1, patience: 1 },
        hooks: [{ kind: "edge", situation: "cold", strength: 0.5 }],
      },
      { id: "city-street", label: "city street", mind: { nerve: 1, caution: 1, trust: -1 } },
      {
        id: "river-barge",
        label: "river barge",
        mind: { caution: 1 },
        hooks: [{ kind: "love", situation: "water", strength: 0.5 }],
      },
      { id: "working-farm", label: "working farm", mind: { loyalty: 1, focus: 1 } },
      { id: "abandoned", label: "abandoned", mind: { trust: -1, want: 1, caution: 1 } },
      { id: "hunters-line", label: "a hunter's line", mind: { focus: 1, curiosity: 1 } },
      { id: "nobody-knows", label: "nobody knows", natureSpread: 1 },
    ],
  },
  {
    id: "litter",
    prompt: "The litter",
    options: [
      { id: "runt-of-nine", label: "runt of nine", mind: { want: 1, spite: 1, nerve: -1 } },
      { id: "only-pup", label: "only pup", mind: { trust: 1, patience: 1, nerve: -1 } },
      { id: "raised-with-cats", label: "raised with cats", mind: { curiosity: 1, temper: -1 } },
      {
        id: "hand-fed",
        label: "hand-fed by a person",
        mind: { trust: 1, loyalty: 1, want: -1 },
      },
      { id: "one-of-two", label: "one of two", mind: { patience: 1, focus: 1 } },
      {
        id: "fought-for-everything",
        label: "fought for everything",
        mind: { temper: 1, greed: 1, patience: -1 },
      },
    ],
  },
  {
    id: "first-winter",
    prompt: "First winter",
    options: [
      { id: "starved", label: "starved", mind: { greed: 2, patience: -1 } },
      { id: "sheltered", label: "sheltered", mind: { nerve: 1, caution: 1, want: -1 } },
      {
        id: "lost-for-a-week",
        label: "lost for a week",
        mind: { curiosity: 1, nerve: 1, trust: -1 },
      },
      { id: "worked-through-it", label: "worked through it", mind: { want: 1, focus: 1 } },
      { id: "sick", label: "sick", mind: { caution: 1, nerve: -1 } },
      { id: "unusually-mild", label: "unusually mild", mind: { trust: 1 } },
    ],
  },
  {
    id: "first-fear",
    prompt: "First fear",
    options: [
      {
        id: "deep-water",
        label: "deep water",
        mind: { caution: 1 },
        hooks: [{ kind: "dread", situation: "water", strength: 0.8 }],
      },
      {
        id: "loud-men",
        label: "loud men",
        mind: { caution: 1, trust: -1 },
        hooks: [{ kind: "dread", situation: "crowd", strength: 0.7 }],
      },
      {
        id: "open-sky",
        label: "open sky",
        mind: { caution: 1 },
        hooks: [{ kind: "dread", situation: "open", strength: 0.7 }],
      },
      {
        id: "being-alone",
        label: "being alone",
        mind: { loyalty: 1 },
        hooks: [{ kind: "dread", situation: "alone", strength: 0.75 }],
      },
      {
        id: "fire",
        label: "fire",
        mind: { caution: 1 },
        hooks: [{ kind: "dread", situation: "fire", strength: 0.8 }],
      },
      {
        id: "other-dogs",
        label: "other dogs",
        mind: { caution: 1 },
        hooks: [{ kind: "dread", situation: "dogs-near", strength: 0.7 }],
      },
      { id: "nothing-yet", label: "nothing yet", mind: { nerve: 1, caution: -1 } },
    ],
  },
  {
    id: "fed-on",
    prompt: "Fed on",
    options: [
      { id: "fish", label: "fish", mind: { focus: 1 } },
      { id: "red-meat", label: "red meat", mind: { temper: 1, want: 1 } },
      { id: "scraps", label: "scraps", mind: { greed: 2 } },
      { id: "milk-too-long", label: "milk too long", mind: { trust: 1, nerve: -1 } },
      {
        id: "whatever-it-caught",
        label: "whatever it caught",
        mind: { curiosity: 1, greed: 1, focus: 1 },
      },
      { id: "grain", label: "grain", mind: { patience: 1, want: -1 } },
      { id: "irregularly", label: "irregularly", mind: { greed: 1, caution: 1, trust: -1 } },
    ],
  },
  {
    id: "taught-by",
    prompt: "Taught by",
    options: [
      {
        id: "patient-hand",
        label: "a patient hand",
        mind: { trust: 1, loyalty: 1, patience: 1 },
      },
      { id: "harsh-hand", label: "a harsh one", mind: { loyalty: 1, nerve: 1, trust: -1 } },
      { id: "another-dog", label: "another dog", mind: { focus: 1, curiosity: 1, trust: -1 } },
      { id: "nobody", label: "nobody", mind: { trust: -2, curiosity: 1 } },
      { id: "a-child", label: "a child", mind: { trust: 1, temper: -1, focus: -1 } },
      { id: "many-hands", label: "many hands", mind: { nerve: 1, trust: -1, loyalty: -1 } },
    ],
  },
  {
    id: "first-scar",
    prompt: "First scar",
    options: [
      { id: "fight-it-won", label: "a fight it won", mind: { pride: 1, temper: 1 } },
      { id: "fight-it-lost", label: "a fight it lost", mind: { spite: 2, nerve: -1 } },
      { id: "an-accident", label: "an accident", mind: { caution: 1 } },
      { id: "a-trap", label: "a trap", mind: { caution: 2, trust: -1 } },
      {
        id: "a-fall",
        label: "a fall",
        mind: { caution: 1 },
        hooks: [{ kind: "dread", situation: "ledge", strength: 0.7 }],
      },
      { id: "unmarked", label: "unmarked", mind: { nerve: 1, pride: -1 } },
    ],
  },
  {
    id: "what-it-loves",
    prompt: "What it loves",
    options: [
      { id: "running", label: "running", mind: { want: 1 } },
      { id: "winning", label: "winning", mind: { pride: 1, spite: 1 } },
      { id: "you", label: "you", mind: { loyalty: 1, trust: 1 } },
      {
        id: "food",
        label: "food",
        mind: { greed: 2 },
        hooks: [{ kind: "love", situation: "cache", strength: 0.6 }],
      },
      {
        id: "being-watched",
        label: "being watched",
        mind: { pride: 1 },
        hooks: [{ kind: "love", situation: "watched", strength: 0.7 }],
      },
      {
        id: "the-cold",
        label: "the cold",
        hooks: [{ kind: "love", situation: "cold", strength: 0.7 }],
      },
      {
        id: "quiet",
        label: "quiet",
        mind: { focus: 1 },
        hooks: [{ kind: "dread", situation: "crowd", strength: 0.4 }],
      },
    ],
  },
  {
    id: "what-it-lost",
    prompt: "What it lost",
    options: [
      {
        id: "a-littermate",
        label: "a littermate",
        mind: { loyalty: 1 },
        hooks: [{ kind: "dread", situation: "alone", strength: 0.5 }],
      },
      { id: "a-home", label: "a home", mind: { trust: -1, caution: 1 } },
      { id: "a-previous-handler", label: "a previous handler", mind: { trust: -2, loyalty: 1 } },
      {
        id: "a-race-it-should-have-won",
        label: "a race it should have won",
        mind: { spite: 2, pride: 1 },
      },
      { id: "nothing-yet", label: "nothing yet" },
    ],
  },
  {
    id: "first-race",
    prompt: "First race",
    options: [
      { id: "won-easily", label: "won easily", mind: { pride: 2, patience: -1 } },
      { id: "won-barely", label: "won barely", mind: { want: 1, nerve: 1 } },
      { id: "lost-badly", label: "lost badly", mind: { spite: 1, nerve: -1 } },
      {
        id: "didnt-finish",
        label: "didn't finish",
        mind: { caution: 1, want: -1, nerve: -1 },
      },
      { id: "pulled-out", label: "was pulled out", mind: { trust: -1, want: 1 } },
      { id: "never-raced", label: "never raced", mind: { curiosity: 1 }, natureSpread: 0.5 },
    ],
  },
];

const CHAPTER_BY_ID = new Map(CHAPTERS.map((c) => [c.id, c]));

export type History = Record<string, string>;

export function chapter(id: string): Chapter {
  const found = CHAPTER_BY_ID.get(id);
  if (!found) throw new Error(`unknown chapter: ${id}`);
  return found;
}

export function historyOption(chapterId: string, optionId: string): HistoryOption {
  const found = chapter(chapterId).options.find((o) => o.id === optionId);
  if (!found) throw new Error(`unknown option ${optionId} in chapter ${chapterId}`);
  return found;
}

export function chosenOptions(history: History): readonly HistoryOption[] {
  return CHAPTERS.map((c) => {
    const chosen = history[c.id];
    if (chosen === undefined) throw new Error(`history is missing chapter: ${c.id}`);
    return historyOption(c.id, chosen);
  });
}

export type HistoryEffects = {
  readonly mind: Partial<Record<MindTrait, number>>;
  readonly hooks: readonly Hook[];
  readonly natureSpread: number;
};

export function resolveHistory(history: History): HistoryEffects {
  const mind: Partial<Record<MindTrait, number>> = {};
  const hooks: Hook[] = [];
  let natureSpread = 0;

  for (const chapterDef of CHAPTERS) {
    const optionId = history[chapterDef.id];
    if (optionId === undefined) throw new Error(`history is missing chapter: ${chapterDef.id}`);
    const option = historyOption(chapterDef.id, optionId);

    for (const [trait, delta] of Object.entries(option.mind ?? {})) {
      const t = trait as MindTrait;
      mind[t] = (mind[t] ?? 0) + delta;
    }
    for (const hook of option.hooks ?? []) {
      hooks.push({ ...hook, source: `${chapterDef.prompt.toLowerCase()}: ${option.label}` });
    }
    natureSpread += option.natureSpread ?? 0;
  }

  return { mind, hooks, natureSpread };
}

/** Combined strength of every hook on a situation, capped at 1. */
export function hookStrength(hooks: readonly Hook[], situation: Situation, kind: HookKind): number {
  let total = 0;
  for (const hook of hooks) {
    if (hook.situation === situation && hook.kind === kind) {
      total = total + hook.strength * (1 - total);
    }
  }
  return total;
}

/** Human-readable summary of what this dog carries into every race. */
export function describeHooks(hooks: readonly Hook[]): readonly string[] {
  return hooks.map((h) => {
    const verb = h.kind === "dread" ? "dreads" : h.kind === "love" ? "loves" : "is at home in";
    return `${verb} ${h.situation.replace("-", " ")} (${h.source})`;
  });
}
