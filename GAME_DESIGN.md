# CLASH — 3v3 Card Basketball

A turn-based, spot-based 3v3 basketball game for mobile. You manage three collected
cards. Every possession is a series of short decision exchanges: the offense picks
where to go and what to do, the defense predicts it. Card stats set the math; the
player still has to think, read, and time the release.

**Not** a live-dragging arcade game. Two taps per beat, five seconds to decide.

---

## 1. Core Loop

```
Possession start
  └─ BEAT (repeat until shot / turnover / shot clock 0)
       ├─ Offense picks: ball-handler action + optional off-ball order change
       ├─ Defense picks: on-ball read + optional off-ball order change
       ├─ Both lock in (5s timer, simultaneous — neither side sees the other)
       ├─ Reveal → resolve
       └─ If SHOOT: shot meter → make / miss → carom → rebound contest
```

A **beat** is one decision exchange. A possession is 7 beats max. That is the
answer to "you can't hog the ball forever" — see §5.

---

## 2. The Floor — 40 Spots

The half court is a graph of 40 spots arranged in **rings** (distance from rim)
and **lanes** (angle). Movement is along graph edges. Distance determines shot
value and base percentage; lane determines who can help-defend you.

| Ring | Name       | Distance  | Spots | Lanes present                              | Value |
|------|------------|-----------|-------|--------------------------------------------|-------|
| R0   | Rim        | 0–3 ft    | 1     | RIM                                         | 2 |
| R1   | Paint      | 3–8 ft    | 4     | L-block, R-block, front, dunker             | 2 |
| R2   | Short Mid  | 8–14 ft   | 6     | LB, LW, TOP, RW, RB, + L/R elbow            | 2 |
| R3   | Mid        | 15–21 ft  | 8     | LC, LW, LS, TOP, RS, RW, RC, + FT extended  | 2 |
| R4   | Three      | 23–26 ft  | 11    | 7 lanes + 4 in-between spots                | 3 |
| R5   | Deep       | 27–33 ft  | 10    | 7 lanes + 3 logo spots                      | 3 |
|      |            |           | **40**|                                             |   |

**Lanes** (left → right): `L-CORNER, L-WING, L-SLOT, TOP, R-SLOT, R-WING, R-CORNER`

**Adjacency:** each spot connects to its neighbors in the same ring (±1 lane) and
the ring in front/behind it in the same or adjacent lane. Roughly 4–6 edges per
spot. Corner spots are dead ends on the baseline side — that's real, and it's why
trapping the corner works.

Spot IDs: `R4-LW`, `R1-BLOCK-L`, `R0-RIM`, etc.

---

## 3. Actions

### Offense — ball handler (pick exactly one per beat)

| Action | Cost | Effect |
|---|---|---|
| **Advance 1** | 4 stamina | Move to any adjacent spot. Low steal exposure. |
| **Burst 2** | 11 stamina | Move 2 edges. Beats a wrong read badly. High steal exposure. Requires Speed ≥ 70 or costs +5. |
| **Shoot** | 8 stamina | Opens the shot meter (§6). |
| **Pass** | 3 stamina | Choose a teammate card. Contested by Deny (§4). |
| **Hold** | 2 stamina | Burn a beat. Builds defensive Lock-On. Default on timeout. |
| **Screen call** | 3 stamina | Pull an off-ball card to your spot; sets a pick (see orders). |

### Offense — off-ball orders (sticky; change one per beat, free)

| Order | Effect |
|---|---|
| **Spot Up** | Holds position. If they catch and shoot immediately: **+30% meter window** (catch-and-shoot bonus). |
| **Cut** | Advances toward the rim each beat. Strong pass target if their defender is denying elsewhere. |
| **Screen** | Moves to the ball handler. Defender must pass an IQ check vs screener's Screen stat or their read drops one tier. |
| **Post Up** | Holds an R1 spot, can receive an entry pass, +8 rebound. |
| **Box Out** | +15 rebound score, cannot be a pass target. |
| **Clear Out** | Vacates their side. Removes one help defender from that half of the floor — this is how you create isolation. |

### Defense — on-ball (pick exactly one per beat)

| Action | Effect if read is right | Effect if read is wrong |
|---|---|---|
| **Contest** | Applies contest tier to the shot meter. Safe. | Handler is open next beat. |
| **Block** | If they shoot: block check, can negate the shot outright. | Defender is out of position → next advance is uncontested, +1 open tier. |
| **Steal** | If they advance/pass: steal check → turnover. | Blow-by. Handler advances free and gains +1 open tier. |
| **Wall Off** | Denies a *direction*. Handler cannot advance toward the rim this beat. | No effect. |

Every on-ball action also carries a **spot prediction**: you name the spot you
think the handler will occupy at end of beat.

- **Exact spot** → Tight contest
- **Adjacent spot** → Light contest
- **Neither** → Open

### Defense — off-ball orders (sticky)

**Deny** (specific card — kills pass lanes, opens their cut), **Help** (covers a
ring band on one side), **Box Out**, **Roam** (chance to intercept any pass, but
leaves their assignment open for a catch-and-shoot).

---

## 4. Prediction — Making It a Read, Not a Coin Flip

Pure "guess the spot" is 1-in-5 luck. The fix is **tells**.

Before locking in, the defender sees a subset of the handler's *legal* destinations
highlighted. How many depends on the matchup:

```
tellCount = clamp( round( (defenderIQ - handlerHandle) / 12 ) + 2, 1, legalSpots )
```

- A 90 IQ lockdown vs a 60 Handle big: sees 4–5 of 6 → he's basically guessing right.
- A 70 IQ defender vs a 95 Handle guard: sees 1 → he's throwing darts.

**Lock-On:** if a defender reads the handler correctly two beats in a row, they get
**+1 contest tier** on the next beat. Standing in one place gets punished.

**Screen** knocks the tell down: a successful screen removes 2 highlighted spots
and drops the contest tier by one.

This is the heart of the game. Stats decide *how much information* you get; you
decide what to do with it.

---

## 5. Turn Timers & Anti-Ball-Hogging

Four independent pressures, so no single one has to be heavy-handed:

1. **Lock-in timer: 5s** (4s in ranked). Timeout → `Hold`, which is nearly always bad.
2. **Shot clock: 7 beats.** Hits 0 → turnover, no shot.
3. **Stamina.** Advancing burns 4–11 a beat. A handler who dribbles five beats
   shoots the sixth with a visibly shrunken meter window.
4. **Lock-On.** Repetition makes the defense better at reading you.

The intended feel: a good possession is 3–5 beats. Anything longer should feel
like you're losing, because you are.

---

## 6. The Shot Meter

**Design contract: the meter is honest.** It never lies about your odds. The only
hidden information is whether the defender gambled on a Block — and that's a read,
not a rig.

### Pre-shot readout (0.4s, before the bar moves)
Shows the green window at its true computed size, plus a live estimate:
`3PT · 41% · TIGHT CONTEST · STAMINA 62%`. You always know what you're taking.

### Mechanic
Hold to fill, release to shoot. Bar travels its full length in **1100ms**.
One thumb, no dragging.

### Window size

```
windowMs = 300
         × (0.55 + rating / 125)      // rating for THIS zone's band
         × zoneFactor                  // rim 1.30, paint 1.15, shortMid 1.00,
                                       // mid 0.95, three 0.85, deep 0.70
         × (0.60 + 0.40 × staminaPct)  // fatigue
         × contestFactor               // open 1.00, light 0.85, tight 0.65, smothered 0.45
         × skillModifiers              // e.g. Corner Sniper +12% in corner spots
         × (isCatchAndShoot ? 1.30 : 1.00)
```

*Worked example:* 78-rated shooter, open three, full stamina
→ `300 × 1.174 × 0.85 × 1.0 × 1.0 = 299ms` of green in an 1100ms bar. Comfortable.
Same shooter, tight contest, 40% stamina
→ `300 × 1.174 × 0.85 × 0.76 × 0.65 = 148ms`. Tense — and you saw it before you shot.

### Make probability

The meter **modulates**, it never decides. A perfect release on a smothered
33-footer with a 65-rated shooter is still a bad shot.

```
baseMake  = zoneBase + (rating - 75) × zoneSlope
finalMake = baseMake × timingMult × contestMult × (0.90 + 0.10 × staminaPct)
```

| Ring | zoneBase | zoneSlope /pt |
|---|---|---|
| R0 Rim | 62% | 0.40 |
| R1 Paint | 48% | 0.45 |
| R2 Short Mid | 42% | 0.50 |
| R3 Mid | 40% | 0.50 |
| R4 Three | 35% | 0.55 |
| R5 Deep | 28% | 0.70 |

| Timing | Multiplier |
|---|---|
| Perfect (inner 30% of window) | ×1.35 |
| Good (window) | ×1.15 |
| Slightly off (±120ms outside) | ×0.85 |
| Bad | ×0.45 |
| No release / overfill | ×0.20 |

| Contest | Make mult |
|---|---|
| Open | ×1.00 |
| Light | ×0.88 |
| Tight | ×0.72 |
| Smothered | ×0.55 |

Hard cap: **92%**. Floor: **4%**. Nothing is automatic.

### Defensive interference with the meter
- **Contest** shrinks the window (already in the formula).
- **Block** gamble: rolls *before* the meter resolves. `blockChance = (blockerInterior + verticality − shooterFinishing) / 200`, halved outside R1. A successful block ends the shot regardless of a perfect release.
- **Smothered** (tight read + Perimeter D ≥ 85, or tight + Block): the window *position* jitters ±80ms after the bar starts. Size stays honest, placement gets harder. This is the only place the meter gets mean, and it's gated behind an elite defender making a correct read.

### Free throws
Same meter, `contestFactor = 1.0`, `zoneFactor = 1.4`, no jitter, 1400ms bar. Fast and mostly automatic for good shooters.

---

## 7. Misses & Rebounds

This was your open question, and it's the best place in the design to reward
positioning. **Caroms are not random — they're a table.** Players learn it, and
learning it is a skill.

### Carom direction is derived from *why* you missed

| Miss cause | Carom |
|---|---|
| Released **early** (short miss) | Same lane, short: `R1` in shooter's lane (70%) or `R0-RIM` (30%) |
| Released **late** (long miss) | **Weak side, long**: `R2`–`R3` in the *opposite* lane |
| **Bad/red** timing | Wild: random spot in `R1`–`R3` |
| **Tight/smothered** contest | Biases short by one ring (rushed shots come up short) |
| **Blocked** | Lands in the blocker's Wall-Off direction; `blockControl ≥ 70` means the blocker's team recovers it |
| **Deep (R5)** miss | Always long — carom lands at `R3`–`R4`, which is why deep threes are transition suicide |

### Rebound contest
Every card **in or adjacent to** the carom spot rolls:

```
score = rebound
      + height / 2
      + (order == BOX_OUT   ? 15 : 0)
      + (isOffense          ? -8 : 0)   // crash penalty
      + (atCaromSpot        ? 10 : 0)   // adjacency is worse than being there
      + rand(0, 20)
```

Highest score takes it. Ties → defense.

**The trade:** sending a card to crash the offensive glass means they aren't back
on defense. Grabbing the offensive board resets the shot clock to 5 beats (not 7).

---

## 8. Managing Three Cards

The rule that keeps this mobile: **one direct action + one sticky order change per beat.**
Two taps. Everything else runs on standing orders.

- The **ball handler** is who you control directly.
- The other two run their sticky orders autonomously, resolving with their own stats.
- Passing transfers direct control to the receiver.
- On defense: you control the **on-ball defender's** read; the other two run sticky orders.

Orders persist across beats until changed, so a good player sets up a structure
(`Clear Out` + `Spot Up`) and only adjusts when the defense reacts. A panicking
player changes an order every beat and never builds anything.

**Fatigue across the game** is what makes all three cards matter. There are no
substitutions — you have three. Burn your star for six straight possessions and
his meter window is 60% of what it was in the first quarter. Feeding the other two
isn't generosity, it's resource management.

---

## 9. Card Stats

Ten stats. Every one is legible in-game — a player should be able to look at a
number and know exactly which formula it enters.

| Stat | Drives |
|---|---|
| **Finishing** | R0–R1 make%, block resistance |
| **Mid** | R2–R3 make% |
| **Three** | R4–R5 make% |
| **Handle** | Steal resistance, reduces defender's tell count |
| **Pass** | Pass success vs Deny, enables catch-and-shoot bonus |
| **Perimeter D** | Contest strength on R3–R5, steal success |
| **Interior D** | Contest strength on R0–R2, block chance |
| **Rebound** | Rebound score |
| **Speed** | Burst cost, closeout range |
| **IQ** | Tell count on defense, off-ball order quality |

Plus **Stamina** (pool + regen rate) and **Height** (rebound, block).

### Skills (2–4 per card, triggered modifiers)

Skills modify *specific terms in specific formulas* — never vague buffs.

- **Corner Sniper** — +12% meter window in R4/R5 corner lanes
- **Rim Protector** — block check triggers on all R0/R1 shots, not just when reading Block
- **Deadeye** — contest make-multiplier penalty reduced 40%
- **Floor General** — +1 tell count for *your whole team* on defense
- **Motor** — +20 rebound score on offensive glass, no crash penalty
- **Heat Check** — after 2 makes in a row, +25% window until you miss
- **Ankle Breaker** — successful Burst applies Smothered-tier confusion: defender's next read is forced to Open
- **Iron Lungs** — stamina costs reduced 25%

### Collection
Rarities `Common → Rare → Epic → Legendary`. Duplicates level a card (stat growth,
skill unlocks). **Chemistry:** three cards sharing an archetype or team get a small
team-wide bonus, but archetype-stacking is a trap — a lineup of three Snipers has
no rebounder and loses every carom. Roster construction is the deckbuilding.

Archetypes: `Slasher, Sniper, Playmaker, Big, Lockdown, Two-Way`

---

## 10. Match Format

- **First to 21, win by 2**, hard cap at 10 minutes real time.
- Scoring: **2s and 3s** (R0–R3 = 2, R4–R5 = 3).
- Make it, take it is **off** — possession alternates. Cleaner for a turn game.
- Fouls: a failed Steal or Block rolls a foul check (`~18%`, lower with high IQ).
  Shooting foul → free throws. Keeps aggressive defense from being free.

*Alternate (FIBA 3x3 rules) mode: 1s and 2s, 12-second shot clock = 4 beats. Much
faster, worth testing.*

---

## 11. Why This Should Be Fun

The player is doing three things at once, all of them thinking:

1. **Spatial** — where do I move, and where will they guess?
2. **Informational** — how much can this defender actually see? (tell count)
3. **Execution** — can I hit the window I earned?

And the meter never cheats. Every bad shot was a bad shot you chose to take, with
the odds printed on the screen before you took it.

---

## 12. Open Questions / Next to Prototype

- **Beat pacing.** 5s lock-in might be too long once players know the game. Test 4s and 3s.
- **Tell count tuning.** The `/12` divisor is a guess. This single number decides whether the game is a read or a coin flip — it needs the most testing of anything here.
- **Is 40 spots too many?** Adjacency means you only ever choose between ~5. But the *defender* has to reason about 40. May want to collapse R5 to 5 spots.
- **Off-ball AI legibility.** If your Cut card does something you didn't expect, the game feels broken. Needs clear telegraphing.
- **Shot clock reset on offensive rebound** — 5 beats may still be too generous.
- **Asynchronous multiplayer?** Simultaneous lock-in wants real-time. A "ghost" mode versus a recorded opponent may be the practical shipping answer.
