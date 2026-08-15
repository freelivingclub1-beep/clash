# Implementation notes

Where the code had to decide something `KENNEL.md` did not say, or where it says
two things. Every entry here is a design question waiting for an answer, not a
bug — but they are the places the doc and the sim can drift apart.

---

## 1. The Mind scale (§7)

The doc names five notches — `absent · slight · steady · strong · consuming` —
and gives a 36-point budget across 12 traits, "average 3". Elsewhere it refers to
a "Greed-5 dog", to Hare-heart capping "Nerve at 2", and to Wolf-strain raising
ceilings "to 6".

**Implemented as** a 1–5 scale where the notch name *is* the value
(1 absent … 5 consuming), so 12 × 3 = 36 balances exactly. Blood can lower a
ceiling below 5 or raise one to 6; a 6 is reachable only through drift, never at
creation, and has no notch name because no handler ever built one on purpose.

## 2. History does not multiply out to 7^10 (§6)

§6 claims "7^10 ≈ 282 million histories", but as written four chapters list six
options (`The litter`, `First winter`, `Taught by`, `First scar`) and one lists
five (`What it lost`). The options were transcribed exactly rather than padded,
which gives:

| | |
|---|---|
| As written | 7·6·6·7·7·6·6·7·5·6 = **93,350,880** |
| As claimed | 7^10 = **282,475,249** |

**Decision needed:** write the five missing options, or restate the number. The
combined figure with Frame and Blood is still past 10^18 either way.

## 3. The hidden nature roll (§2)

§2 promises that "two players who match all their creation choices exactly get
different animals", but no layer in the doc produces that divergence — Frame,
Blood, History and Mind are all authored.

**Implemented as** a seeded per-dog roll that moves two to four Mind traits by
one notch, invisible and unstated. `Born: nobody knows` and `First race: never
raced` widen it. This is the smallest mechanism that keeps the promise; it is
also the one most worth playtesting, because too much of it makes the player's
allocation feel meaningless and too little makes builds copyable.

## 4. Mass costs per slider (§4)

The doc says weight is the currency and lists which end of each slider costs
mass, but not how much. The per-notch costs in `src/creation/frame.ts` are
invented: bone (1.6) and chest (1.4) are expensive, ear carriage (0.1) and tail
set (0.2) are nearly free. The base budget is 6.0 units, and Bear-frame's "+40%
mass budget" reads against that.

## 5. The posting shows feature positions (§9)

§9 says a player does not learn "the exact placement of hazards", but the worked
example posts "narrow ledge at km 7 · food cache at km 3". The example wins:
postings name an approximate kilometre for the hazard and feature facts. What
stays hidden is segment ordering, true severity, the field, and anything the
eight facts have no room for — a crowd on the course is never posted at all.

## 6. Simulation constants are placeholders

Base speed (6.2 m/s), stamina drain, heat gain and shed, gradient cost and the
injury rates are all invented and tuned by feel against one measure: the field
should finish, the winner should run a plausible speed, and a dog built for the
wrong ladder should lose clearly without being lapped. Current behaviour, eight
courses per ladder, random fields:

| Ladder | last ÷ first | winner | DNF |
|---|---|---|---|
| sprint | 1.33× | 5.4 m/s | 0% |
| long | 1.55× | 3.9 m/s | 6% |
| climb | 1.96× | 4.1 m/s | 0% |
| rough | 1.74× | 4.7 m/s | 0% |

Re-check with `node scripts/spread.ts` after touching anything in
`src/race/race.ts`.

## 7. Water is a crossing, never a surface

`rough` originally listed `water` among its terrains, which produced courses with
1.3 km of swimming in them and a field moving at walking pace. Water is now only
ever a `crossing` feature with a time cost and a balk check. `Terrain.water`
still exists for a future course type that genuinely wants a swim leg.

Segment gradients are also drawn with a pull back toward the start altitude, per
ladder (`altitudeBand`), or ten independent draws send a course into orbit.

## 8. Orders resolve before features, within a tick

An order written against a landmark has to be in the dog's head *before* it
arrives at the thing the landmark names, or `IF at the cache → SKIP THE CACHE`
fires at the first cache and gets spent at the second one. Order resolution
therefore runs ahead of feature resolution inside each tick.

## 9. Not built yet

Phase 1 is the sim. These are named in the doc and deliberately absent:

- Mind drift, scars, superstitions, developed fears, vices, aging (§7, §10)
- Bond as something earned over months — it is currently a number you pass in (§8)
- Training, feed, condition, rest, kit (§8)
- The five ladders as standings; the Reading ladder and predictions (§11)
- Rivalries, legacy, retirement, breeding (§10, §11)
- The silhouette renderer and the replay layer (§14) — both read the same
  deterministic log the text report reads, and neither needs the sim to change
