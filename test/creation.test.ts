import test from "node:test";
import assert from "node:assert/strict";

import { Rng } from "../src/core/rng.ts";
import {
  BASE_MASS_BUDGET,
  SLIDERS,
  deriveFrameProfile,
  massSpent,
  standardFrame,
  validateFrame,
} from "../src/creation/frame.ts";
import { LINEAGES, combineBlood } from "../src/creation/blood.ts";
import { MIND_BUDGET, MIND_TRAITS, evenMind, mindSpent, validateMind } from "../src/creation/mind.ts";
import { CHAPTERS, resolveHistory } from "../src/creation/history.ts";
import { CreationError, createDog, randomDog } from "../src/creation/dog.ts";

test("the rng is deterministic and seed-sensitive", () => {
  const a = new Rng("same").float();
  const b = new Rng("same").float();
  const c = new Rng("different").float();

  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("a standard frame costs nothing and sits inside any budget", () => {
  const frame = standardFrame();
  assert.equal(massSpent(frame), 0);
  assert.equal(validateFrame(frame, BASE_MASS_BUDGET).ok, true);
});

test("mass is spent going heavy and refunded going light", () => {
  const heavy = standardFrame();
  heavy.bone = 6;
  const light = standardFrame();
  light.bone = 0;

  assert.ok(massSpent(heavy) > 0);
  assert.equal(massSpent(light), -massSpent(heavy));
});

test("a frame over budget is rejected with a reason", () => {
  const frame = standardFrame();
  for (const def of SLIDERS) frame[def.key] = 6;

  const check = validateFrame(frame, BASE_MASS_BUDGET);
  assert.equal(check.ok, false);
  assert.match(check.problems.join(" "), /over mass budget/);
});

test("the frame's gains and costs point the way the doc says", () => {
  const base = deriveFrameProfile(standardFrame());

  const rangy = standardFrame();
  rangy.legLength = 6;
  assert.ok(deriveFrameProfile(rangy).flatSpeed > base.flatSpeed, "long legs gain top speed");
  assert.ok(deriveFrameProfile(rangy).climb < base.climb, "and lose climbing");

  const barrel = standardFrame();
  barrel.chestDepth = 6;
  assert.ok(
    deriveFrameProfile(barrel).staminaCeiling > base.staminaCeiling,
    "a deep chest raises the stamina ceiling",
  );
  assert.ok(deriveFrameProfile(barrel).heatGain > base.heatGain, "and holds heat");

  const shag = standardFrame();
  shag.coatLength = 6;
  assert.ok(deriveFrameProfile(shag).warmth > base.warmth);
  assert.ok(deriveFrameProfile(shag).heatShed < base.heatShed);
});

test("an even mind spends exactly the budget", () => {
  const mind = evenMind();
  assert.equal(mindSpent(mind), MIND_BUDGET);
  assert.equal(validateMind(mind).ok, true);
});

test("mind ceilings from blood are enforced at creation", () => {
  const blood = combineBlood("hare-heart", "deep-lung");
  const mind = evenMind();
  mind.nerve = 4;
  mind.patience = 2;

  const check = validateMind(mind, { ceilings: blood.mindCeiling, floors: blood.mindFloor });
  assert.equal(check.ok, false);
  assert.match(check.problems.join(" "), /Nerve is capped/);
});

test("blood combines by multiplying and by taking the tightest cap", () => {
  const bear = combineBlood("bear-frame", "deep-lung");
  assert.equal(bear.massBudgetMult, 1.4);

  const wolfAndHare = combineBlood("wolf-strain", "hare-heart");
  assert.equal(wolfAndHare.mindCeiling.want, 6, "wolf-strain raises what nothing else restricts");
  assert.equal(wolfAndHare.mindCeiling.nerve, 2, "hare-heart's cap survives");

  assert.throws(() => combineBlood("ice-blood", "ice-blood"), /two different lineages/);
});

test("every lineage is well formed", () => {
  const ids = new Set(LINEAGES.map((l) => l.id));
  assert.equal(ids.size, 20, "twenty lineages");
  for (const l of LINEAGES) {
    assert.ok(l.gift.length > 0 && l.cost.length > 0, `${l.id} states a gift and a cost`);
  }
});

test("history plants hooks and moves the mind", () => {
  const history = Object.fromEntries(CHAPTERS.map((c) => [c.id, c.options[0]!.id]));
  const effects = resolveHistory(history);

  assert.ok(Object.keys(effects.mind).length > 0);
  assert.ok(effects.hooks.every((h) => h.source.length > 0), "every hook says where it came from");
});

test("history must be complete", () => {
  assert.throws(() => resolveHistory({ born: "abandoned" }), /missing chapter/);
});

test("the same build with a different seed is a different dog", () => {
  const spec = {
    name: "Twin",
    frame: standardFrame(),
    blood: ["ice-blood", "deep-lung"] as const,
    history: Object.fromEntries(CHAPTERS.map((c) => [c.id, c.options[0]!.id])),
    mind: evenMind(),
  };

  // §2: two players who match every creation choice still get different animals.
  const differences = new Set<string>();
  for (let i = 0; i < 40; i++) {
    const dog = createDog(spec, `twin-${i}`);
    differences.add(MIND_TRAITS.map((t) => dog.mind[t]).join(","));
  }
  assert.ok(differences.size > 1, "the hidden nature roll separates identical builds");
});

test("an unbuildable dog explains itself", () => {
  const frame = standardFrame();
  frame.coatLength = 6;
  assert.throws(
    () =>
      createDog(
        {
          name: "Sweat",
          frame,
          blood: ["heat-shed", "deep-lung"],
          history: Object.fromEntries(CHAPTERS.map((c) => [c.id, c.options[0]!.id])),
          mind: evenMind(),
        },
        "sweat",
      ),
    CreationError,
  );
});

test("field dogs are built by the same rules a player builds under", () => {
  for (let i = 0; i < 60; i++) {
    const dog = randomDog(`field-${i}`);
    const budget = BASE_MASS_BUDGET * dog.blood.massBudgetMult;

    assert.equal(validateFrame(dog.spec.frame, budget).ok, true, `${dog.name} respects mass`);
    assert.ok(mindSpent(dog.spec.mind) <= MIND_BUDGET, `${dog.name} respects the mind budget`);
  }
});
