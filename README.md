# KENNEL

You raise a dog, you can't control it in the race, and the whole game is finding
out whether you understood it.

The design document is [`KENNEL.md`](KENNEL.md). Decisions the code had to make
where the doc was silent or contradicted itself are in [`NOTES.md`](NOTES.md).

## Where this is

**Phase 1 of §15: the sim, headless, no UI.** Frame, Blood, History, Mind, course
generation, standing orders, obedience resolution, the race tick loop, and a
plain text race report. No renderer, no client, no daily loop.

Phase 1 exists to answer one question, and the doc is blunt about it: *if a
text-only race report is not compelling to read, no amount of art will save the
game.* So the deliverable is the report, and everything else is in service of it.

```
npm install
npm run race
```

```
npm run race -- --seed=frost-3 --ladder=rough --course=b
```

`--ladder` is one of `sprint`, `long`, `climb`, `rough`, `reading`.
`--course` picks which of the day's two postings to enter.

## What comes out

```
**IRONMOUTH**
31 km · even ground throughout · mixed going — hard ground and sand · freezing, dead calm, humid · 2 marked hazards — narrow ledge, river crossing · 2 forks in the route · 6-dog field · dawn start, rolling start
Ladder: long.

Your standing orders:
  1. IF behind at the ridge -> PUSH
  2. IF at the cache -> SKIP THE CACHE
  3. IF a dog passes after km 5 -> CHASE
  4. IF stamina low at the last quarter -> HOLD BACK

— — —

km   0.2  Quill came past. Fifth now.
km   2.6  Up to third.
km   7.3  Grist came past. Third now.
km   7.3  Your order fired — chase. It did as you asked.
km   7.6  It cut the short line and it worked.
km  12.3  Moth came past. Second now.
km  13.0  It came off the ledge. 27 seconds, and it got up hurting.
km  13.3  It stayed on the main line at the fork.
km  14.0  It crossed the water — 4 seconds.
km  14.4  Nettle came past. Third now.
km  16.1  The stride shortened. You could see it from the rail.
km  23.3  Your order fired — hold back. It didn't: there was nothing left to give.

— — —

Third of 6, 2:51:15.
Moth won it in 2:34:28 — 17 minutes up the road.

What you might have noticed:
  · 1 of 2 orders got through.
  · 2 of your 4 orders never came up. A condition that never happens is a wasted slot.
  · It ran itself flat. Whatever it had, it spent, and then it kept going.
  · It has never been right about ledge — first scar: a fall.
  · It has never been right about water — first fear: deep water.
  · 31 seconds went at the features. Some of that was yours to prevent.
  · Look it over tonight. It came home carrying something.
```

## Layout

```
src/core/rng.ts          seeded PRNG — every random draw in the game goes through it
src/core/world.ts        terrain, weather, light
src/creation/frame.ts    §4  thirteen sliders -> a hidden physical profile
src/creation/blood.ts    §5  twenty lineages, each a gift with a real cost
src/creation/history.ts  §6  ten chapters -> mind nudges and hooks
src/creation/mind.ts     §7  twelve traits, 36 points
src/creation/dog.ts      assembly, plus the hidden nature roll (§2)
src/race/course.ts       course generation and the eight facts (§9)
src/race/orders.ts       order parsing and P(obey) (§9)
src/race/race.ts         the deterministic tick loop (§9)
src/race/events.ts       the race log — the only thing any view is allowed to read
src/race/report.ts       the text report
src/cli.ts               build a dog, post the board, run a race
scripts/spread.ts        balance probe: field spread, winner pace, DNF rate
```

Two architectural rules from the doc, both load-bearing:

- **All simulation is server-side and the client gets only a log** (§16.5). Nothing
  outside `src/race/race.ts` may reach into the sim's state; `events.ts` is the
  whole interface. The text report and a future replay renderer are peers.
- **No numbers are ever shown to the player** (§2). The report may say what a
  handler at the rail could see with a stopwatch — distances, clock times,
  seconds lost. It may never say stamina, morale, heat, bond or a trait value.
  There is a test for this.

## Checks

```
npm test          # 31 tests: determinism, budgets, the §9 obedience anchors, no leaks
npm run typecheck
node scripts/spread.ts
```
