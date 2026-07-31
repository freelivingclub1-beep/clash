# Clash — Mobile-First RTS Arena Battler

A portrait-orientation real-time arena battler in the Clash Royale mould, built on a
deterministic 30Hz simulation. Implements the 2026 meta systems: Card Evolutions,
Hero/Champion active abilities, Tower Troops, Level 16 progression, and the nine-slot deck.

```bash
npm install
npm run dev        # play at http://localhost:5173
npm test           # 122 tests
npm run typecheck
npm run lint
npm run build
```

## What's here

A playable vertical slice with the full architecture: a three-minute match against a bot
opponent, a 35-card roster, a deck builder, and the Card Maker Studio.

**Multiplayer is bot-only.** The Node/WebSocket server and live matchmaking queue are not
built. What *is* built is everything that makes them a drop-in later — a DOM-free
deterministic simulation, serialisable command payloads, seeded RNG, a frame-bucket
transport interface, and the matchmaking rules and persistence schemas from spec §5. This
is the one place the implementation deliberately stops short of the specification.

## Layering

```
src/cards/    card schema, validator, registry, roster    (no dependencies)
src/sim/      deterministic simulation — no DOM, no Math.random, no Date
src/net/      transport, matchmaking, bot                 (DOM-free)
src/game/     profile persistence, deck rules, match runner
src/render/   Canvas2D renderer (reads sim, never writes)
src/ui/       React — screens, battle HUD, Card Maker Studio
```

The arrow points one way. `src/sim` may import only from `src/cards`, enforced by an ESLint
zone in `.eslintrc.cjs` that also bans DOM globals, `Math.random` and `Date` inside the
simulation. That constraint is what keeps `src/sim` liftable into a headless server without
modification. (The movement-speed table lives in `@cards/schema` rather than
`@sim/constants` for exactly this reason.)

## Determinism

Every other design decision follows from this one.

- **Fixed-point.** Positions, ranges and velocities are Q16.16 integers (`@sim/math/fixed`).
  Health, damage and aether stay plain integers — Q16.16 would overflow int32 on a
  100k-HP tower. Time is integer ticks and nothing else.
- **Seeded RNG.** sfc32 stored as a plain struct so it snapshots with the rest of match
  state. Two independent streams per match: `shuffleRng` for the deck cycle, `simRng` for
  everything else, so adding a random effect can never shift card order.
- **Stable iteration.** Entities live in a dense array keyed by monotonic id, removed by
  tombstone and compacted in order — never swap-removed. `findEntity` binary-searches on
  that invariant.
- **Total orderings everywhere.** Pathfinding heap ties break on cell index; target ties
  break on entity id. Cost and distance alone are not total orders, and leaving ties to
  insertion order would make results depend on spawn history.
- **No drift in the economy.** The spec's 2.8s / 1.4s / 0.7s aether rates are exactly
  84 / 42 / 21 ticks at 30Hz. Defining one aether as 84 integer *aether points* makes the
  per-tick gain 1, 2 and 4 — no accumulator, no remainder, no rounding over five minutes.

A seed plus a command log is a complete match. `RecordingTransport` captures one and
`ReplayTransport` replays it; the test suite asserts the replay reaches an identical state
hash, which is what makes the determinism claim checkable rather than merely asserted.

## Simulation

One fixed system order per tick, documented in `src/sim/tick.ts`. The ordering is
load-bearing — commands resolve before aether income so a card is paid for at the balance
it was played against, and towers update before the clock because the clock reads crowns.

**Navigation.** Nearly every unit is walking at one of six fixed goals (each team's two
princess towers and its king), so those get BFS/Dijkstra flow fields cached against a grid
version counter, and units navigate by one array lookup per tick. Placing a building or
losing a tower bumps the version and rebuilds — cheap across 576 cells. A* remains for
dynamic goals.

**Steering** and **movement** are separate passes, so a unit's decision never depends on how
far a neighbour has already moved this tick. Boids separation is weighted by mass and fed by
a spatial hash rebuilt allocation-free each tick. Cohesion and alignment are deliberately
omitted: the flow field already supplies grouping, and adding them made squads orbit their
objective instead of committing to it.

**Combat.** Sticky target locks with hysteresis at `sightRange * 1.4`, re-queried every third
tick staggered by entity id. Projectiles home while their target lives and fall through to
its last known position when it dies, so shots still land and still splash.

## Cards

One Zod schema in `src/cards/schema.ts` is the only description of a card in the project.
The simulation reads it, the Card Maker renders a form from it, JSON import/export
round-trips through it, and the TypeScript types are inferred from it. There is no second
"editor model" to drift.

Authored stats are level-11 baselines; levels 1–16 scale through integer multiplier tables
rather than `Math.pow`, so a stat computed here and a stat computed on a future server are
byte-identical.

Two notes where the implementation interprets the spec:

- **Splash radius** is capped at 3.0 tiles for troops and buildings as the spec says, but
  allowed to 6.0 for spells. That bound describes a troop's *attack* splash; a spell's area
  of effect is a different quantity, and Arrows covers 4 tiles by design.
- **Evolution counters** count *down*. The spec says "increments… when the counter reaches
  0", which is self-contradictory; a counter initialised to `evoCycleRequirement` and
  decremented per ordinary play, evolving on the play after it hits zero, matches the live
  game. One constant flips it.

## Card balance — the EPP budget system

`src/cards/balance.ts` is the arithmetic that decides what a card is allowed to be. Aether
buys a raw allowance (1000 Effective Power Points each); utility is paid for out of it; what
remains is the legal stat line. Reach, splash, flight, speed, swarm count and named passives
all carry a written-down price, so a card cannot get a mechanic for free.

`auditCard` runs it backwards against an authored card. `tests/balance.test.ts` fails the
build if any card drifts outside the tolerance band, which is what makes generating new
cards safe to do unattended.

The model was calibrated against the canonical roster rather than guessed, and that
surfaced three real gaps worth recording:

- The audit originally compared stats against the **pre-modifier** budget, so every
  long-range or flying card reported as badly underpowered — when the penalties it had
  already paid were precisely why its stats were low.
- Cheap melee swarms blew past the model entirely (Skeletons audited at 2.2×). They
  genuinely carry more raw stats per aether because each body is fragile and the whole card
  dies to one splash spell, so swarms get an explicit per-extra-unit allowance.
- Champions and decaying buildings were over budget for reasons the stat line cannot see —
  one-at-a-time plus a per-use aether cost, and a 30-second lease on the stats.

With those in, the median card audits at 0.95 and the whole roster fits a 0.55–1.45 band.

**Spells are not balanced by EPP.** A spell's identity is what it kills, so
`SPELL_BREAKPOINTS` is the specification for that slot. Those tests caught genuine bugs:
Zap did not kill Goblins, Arrows did not kill Archers, and Fireball killed neither Musketeer
nor Wizard. Crown Tower damage is capped at 32%, asserted in the simulation rather than only
on paper.

Passives live in `src/sim/scripts/passives.ts` — reflect, parry, chain, attack ramp,
displacement, siege bonus, heal and slow auras, death split, death zone, enrage, crowd
control immunity, spawn shield. Each has a price in the balance module, and a test fails if
a card names a passive the price list has never heard of.

## 2026 meta systems

| System | Where |
|---|---|
| Deck slots (evolution / hero / wild / tower troop) | `src/game/deck.ts` |
| Evolution counters and behaviour scripts | `src/sim/systems/commands.ts`, `src/sim/scripts/evolutions.ts` |
| Hero abilities (6 hooks) | `src/sim/scripts/abilities.ts` |
| Tower Troops | `src/sim/state.ts`, `src/sim/entities.ts` |
| Level 1–16 progression | `src/cards/scaling.ts` |
| Aether phases, overtime, sudden death | `src/sim/systems/clock.ts` |
| Card passives and their EPP prices | `src/sim/scripts/passives.ts`, `src/cards/balance.ts` |

Princess tower health comes from the equipped Tower Troop card, which is what differentiates
Dagger Duchess (2200 HP, long reach, fast) from Cannoneer (2800 HP, ground-only, heavy).
Behaviour ids resolve through `Map` registries in `src/sim/scripts/`, so card data names code
without the data layer importing it.

## Rendering

A fixed 1080×1920 logical canvas scaled uniformly to the device, so a tile occupies the same
fraction of the screen everywhere. The field band is 1080×1248 for an 18×32 grid, so tiles
are 60×39 rather than square — that ~0.65 vertical squash is the foreshortening a tilted
camera produces, and it is confined entirely to `src/render/camera.ts`. The simulation
treats tiles as unit squares; screen→tile hit-testing inverts through the same transform.

The arena is drawn from the same grid the simulation navigates, so the picture and the
pathfinding cannot disagree about where the river is.

Units are composed figures — legs, torso, head, weapon, shield — rasterised once into cached
offscreen canvases per (card, team, pose). Art resolves from a card's `spriteKey` when that
is a URL, fetched at runtime so any card can point at hosted art without a rebuild;
otherwise a procedural generator derives a visual archetype from the card's own stats, so a
card authored in the Card Maker has recognisable art the instant it exists.

**No third-party art is bundled.** Shipping Clash Royale's actual textures would be
straightforward and also copyright infringement, and the two large CC0 asset hosts are
unreachable under this environment's network policy — so runtime URLs are the seam for real
assets rather than a vendored folder.

Animation is derived entirely from simulation state rather than held renderer-side: walk
phase from speed and tick, spawn scale from the deploy timer, attack lunge from the attack
cooldown along the facing vector. The renderer holds no animation state and can be rebuilt
mid-match without a glitch.

React owns the HUD and the drag gesture; the renderer owns the field and the frame loop.
They meet at two narrow points — a mutable drag state pushed in, a coarse HUD snapshot
pushed back — so a 120Hz canvas never means 120 React renders a second.

## Card Maker Studio

`Card Maker Studio` on the home screen. Implements spec §4 sections A–G with the specified
control types, validating through the same `validateCard` the built-in roster is checked
with. Sections reveal conditionally — splash radius only for splash damage, Section F only
for evolution cards, Section G only for heroes — so the form stays usable on a phone.

Cards export to JSON, import back, and "Add to Roster" registers them as runtime cards that
are immediately selectable in the deck builder and playable in a match.

It also shows a live balance audit — raw budget, what the passive cost, every modifier with
its multiplier, and the health and DPS allowance against what the card actually has. It
calls the same `auditCard` the roster test enforces at build time, so the editor and CI
cannot disagree about whether a card is legal.

## Testing

122 tests across five suites:

- `tests/cards.test.ts` — roster integrity, cross-field validation, runtime cards, scaling
- `tests/sim.test.ts` — arena geometry, aether rates, deployment rules, river avoidance,
  bridge crossing, tower engagement, and determinism asserted **tick by tick**, not only at
  the end
- `tests/net.test.ts` — transport bucketing, record/replay convergence, matchmaking gates,
  and a full bot-vs-bot match played to a real outcome
- `tests/meta.test.ts` — evolution cycles, hero abilities, tower troops, deck rules,
  profile persistence
- `tests/balance.test.ts` — the budget model, a roster-wide audit, spell breakpoints, the
  Crown Tower cap, and each unique passive exercised in a live match

The client was additionally driven end-to-end in headless Chromium — home, deck builder,
Card Maker, and a live match with a real drag-to-deploy — which is how three layout defects
were found and fixed.
