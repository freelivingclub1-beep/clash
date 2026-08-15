# KENNEL
### Foundational design document — v0.1

---

## 1. The game in one paragraph

You build a dog. Not from a menu of breeds — from thirteen body sliders, two bloodlines, ten chapters of its life, and twelve traits of temperament. Then you keep it: feed it, train it, sleep it, praise it, and live with the animal that produces. Twice a day a course posts. You see eight facts about it and nothing more. You write four standing orders, enter your dog, and then you have no control at all. The race runs itself. Your dog either listens to you or doesn't, based on months of how you've treated it. You watch, you learn something, and you go change one thing.

**Genre:** asynchronous auto-racer / creature husbandry sim
**Session:** 4–10 minutes, 2–4 times a day
**Input during race:** none
**Core fantasy:** *I know my animal better than you know yours.*

---

## 2. Why it works

Every deep-customization game dies the same death: within two weeks the community solves it, everyone copies the top build, and the "infinite variety" becomes six templates. KENNEL is built specifically to be unsolvable, and the mechanisms are structural rather than cosmetic:

1. **No numbers are ever shown to the player.** You get descriptions and observations, never a stat sheet. There is nothing to screenshot, nothing to paste into a spreadsheet, nothing to copy.
2. **Every dog has a hidden nature.** Two players who match all their creation choices exactly get different animals, because the same history lands differently on a different nature.
3. **Dogs drift from experience.** Traits move ±1 on their own based on what actually happens. After 100 races, no two dogs share a history, and history is most of what the dog is.
4. **There are five ladders, not one.** A dog optimized for the Sprint ladder loses on the Long ladder. There is no global #1, so there is no global best build.
5. **The highest-status ladder rewards knowing your dog, not owning a good one.** (See §9, Reading.)

The result: a top player can honestly explain their entire strategy in a forum post and it will not help you, because the thing they know is *their* dog.

---

## 3. The loop

**Daily (4–8 min total)**
- Morning: feed, check condition, read the two posted courses
- Choose one to enter — entering both costs condition
- Write standing orders against the eight facts
- Race resolves; watch the replay (60–90 sec)
- Evening: assign tomorrow's training, adjust feed, rest or push

**Weekly**
- Regimen block ends — accumulated training resolves into permanent shifts
- Weekly trial on one of the five ladders
- Injury/recovery checkpoints

**Seasonal (6 weeks)**
- Ladder ranks reset. Scars, traits, superstitions, and bond do **not**.
- One trait slot unlocks
- Retirement window opens (see §11)

---

## 4. Layer one — FRAME

Thirteen sliders. Seven notches each. Every notch has a name, not a number, and every notch is supposed to be *felt* — if a player can't perceive the difference between two settings, the granularity is a lie.

You begin at `standard` on all thirteen. Your currency is **weight**. Moving toward the heavier/larger end costs mass; moving toward the lighter end refunds it. You have a mass budget determined by your bloodlines. Weight is real — it costs stamina on every gradient in the game — so a maxed-out dog is genuinely powerful and genuinely doomed on anything long.

| # | Slider | Notches (light → heavy) | Gains | Costs |
|---|---|---|---|---|
| 1 | **Chest depth** | slight · lean · light · standard · solid · deep · barrel | lung capacity, stamina ceiling | mass, heat retention |
| 2 | **Leg length** | stubby · short · low · standard · tall · long · rangy | top speed, stride, water crossing | stability, climbing, tight turns |
| 3 | **Back length** | compact · short · tight · standard · long · stretched · serpent | agility, turn radius | power transfer, injury risk over distance |
| 4 | **Paw spread** | pin · narrow · tight · standard · broad · wide · splayed | snow, sand, mud | speed on rock, pad wear |
| 5 | **Skull width** | fine · narrow · slim · standard · broad · wide · blocky | nerve, contest, impact tolerance | heat shedding, mass |
| 6 | **Muzzle length** | snub · short · brief · standard · long · reach · needle | cooling, scent range | cold-air intake, fragility |
| 7 | **Ear carriage** | pinned · tight · low · standard · lifted · high · erect | hearing orders in noise/wind | frostbite, injury in scrub |
| 8 | **Coat length** | bare · thin · short · standard · full · long · shag | cold protection | heat, water weight, burr snag |
| 9 | **Coat density** | sparse · light · open · standard · close · dense · plush | wind, rain shedding | heat, drying time |
| 10 | **Tail set** | docked · low · dropped · standard · level · high · flag | balance on ledge, turning | wind drag, visibility to rivals |
| 11 | **Bone** | fine · light · slim · standard · heavy · thick · dense | durability, injury resistance | mass, acceleration |
| 12 | **Shoulder slope** | upright · steep · forward · standard · laid · open · flat | stride reach, flat speed | climbing power |
| 13 | **Hip angle** | flat · shallow · low · standard · set · deep · cocked | climbing drive, acceleration | flat-ground top speed |

**Math:** 7^13 ≈ 96.9 billion frames. Budget-constrained, still in the hundreds of millions of *viable* ones. And unlike a random number, each is describable in a sentence: *"rangy, barrel-chested, thin-coated, fine-boned — a hot-weather flat sprinter that will die in the mountains."*

**This is also your art solution.** See §14.

---

## 5. Layer two — BLOOD

Pick **two** of twenty lineages. Each is a gift with a real cost. They also set your mass budget and cap certain Mind traits.

| Lineage | Gift | Cost |
|---|---|---|
| Ice-blood | No cold penalty; gains in snow | Severe heat penalty |
| Deep-lung | +stamina ceiling | Slow recovery between races |
| Iron-gut | Digests anything; no bad-feed events | Gains weight fast; must be managed |
| Night-eye | No darkness penalty | Dazzled at dawn starts and high noon |
| Silent-foot | Surefooted on rock and ledge | Poor traction in mud |
| Quick-heal | Injuries resolve in days not weeks | Scars never set — loses all scar bonuses |
| Heat-shed | Excellent cooling | Cannot exceed `short` coat length |
| Thick-pad | No pad wear on rock or gravel | Reduced grip on ice |
| Wolf-strain | Raises Want and Spite ceilings to 6 | Hard obedience penalty; bond builds slowly |
| Water-hair | Swims strongly; sheds water instantly | Heavy and slow while wet |
| High-nose | Detects caches, shortcuts, hazards early | Easily distracted; may divert |
| Long-wind | Extremely consistent pace | No sprint gear at all |
| Storm-born | Ignores wind and rain | Unsettled in dead calm and silence |
| Ash-lung | Immune to smoke, dust, altitude | Weak in humidity |
| Hare-heart | Explosive burst; best acceleration in game | Panics under contest; Nerve capped at 2 |
| Bear-frame | +40% mass budget | Heat; poor acceleration |
| Old-blood | Ages at half rate; long career | Learns at half rate |
| Ghost-mark | Rivals don't contest or crowd it | Cannot draft behind others |
| Glass-back | Highest agility in game | Long-course injury risk doubled |
| Root-hold | Best climber; unshakeable on gradient | Slowest flat speed in game |

190 possible pairings, and combinations interact — Ice-blood + Heat-shed is a contradiction you're allowed to build and will regret in one specific season.

---

## 6. Layer three — HISTORY

Ten chapters. You author the dog's life before you met it. Every option is written in plain language and its meaning is *inferable but not stated*.

1. **Born** — mountain kennel · city street · river barge · working farm · abandoned · a hunter's line · nobody knows
2. **The litter** — runt of nine · only pup · raised with cats · hand-fed by a person · one of two · fought for everything
3. **First winter** — starved · sheltered · lost for a week · worked through it · sick · unusually mild
4. **First fear** — deep water · loud men · open sky · being alone · fire · other dogs · nothing yet
5. **Fed on** — fish · red meat · scraps · milk too long · whatever it caught · grain · irregularly
6. **Taught by** — a patient hand · a harsh one · another dog · nobody · a child · many hands
7. **First scar** — a fight it won · a fight it lost · an accident · a trap · a fall · unmarked
8. **What it loves** — running · winning · you · food · being watched · the cold · quiet
9. **What it lost** — a littermate · a home · a previous handler · a race it should have won · nothing yet
10. **First race** — won easily · won barely · lost badly · didn't finish · was pulled out · never raced

7^10 ≈ 282 million histories. Combined with Frame and Blood: past **10^18**.

History does two things. It sets starting Mind values (invisibly), and it plants **hooks** — conditions in the world that trigger specially for this dog. A dog whose first fear was deep water reacts to every river crossing for the rest of its life until you train it out, and *training it out is a real project.*

---

## 7. Layer four — MIND

Twelve axes. Five notches (`absent · slight · steady · strong · consuming`). Budget: **36 points across 12 traits**, average 3. You cannot build a dog that is high everything, and you shouldn't want to — that dog has no personality and no edge.

| Trait | High means | Failure mode |
|---|---|---|
| **Greed** | takes every cache, every shortcut | overreaches, gets caught out, ignores "hold back" |
| **Nerve** | unshaken by contest, crowds, weather | — (but expensive) |
| **Patience** | paces itself perfectly | won't chase when it should |
| **Loyalty** | obeys orders through pain | follows a bad order off a cliff |
| **Curiosity** | finds unmarked routes, scouts well | diverts mid-race |
| **Spite** | targets whoever beat it last | tunnels on a rival, forgets the race |
| **Pride** | never quits, never yields position | refuses shortcuts as beneath it |
| **Caution** | avoids injury, reads hazards | slow at every crossing |
| **Focus** | ignores distraction | misses opportunity |
| **Temper** | contests aggressively | fouls, gets penalized, exhausts itself |
| **Trust** | acts on your orders instantly | doesn't self-correct when you're wrong |
| **Want** | pushes past exhaustion | runs itself into injury |

**Mind drifts.** Every race and every training block can move a trait ±1 based on what happened. Win three close finishes and Pride rises. Get passed late repeatedly and Nerve falls. **You set the starting point; the dog finishes the sentence.** This is the single most important system in the game, because it means a dog is a record of its own life and is therefore literally uncopyable.

Drift is bounded: ±2 from your set value in either direction, so a dog remains recognizably the dog you built. Blood can raise or lower ceilings.

---

## 8. The ongoing layers

### Upkeep (daily)
- **Diet composition** — protein / fat / grain / raw ratios. Affects weight, coat, recovery, gut.
- **Feed timing** — a dog fed at dawn for six weeks races better at dawn. This is a *build choice disguised as a chore.*
- **Weight target** — you're managing a real number that fights you. Racing weight vs. reserve.
- **Sleep window** — sets its waking hours. Dogs are sharper in their window.
- **Rest days** — condition regenerates. Skipping them accumulates fatigue debt invisibly until an injury.
- **Water discipline** — pre-race hydration vs. weight.

### Training (weekly regimen, pick 5 of ~30)
Hill repeats · cold soaks · blind runs · weighted drags · crowd exposure · water work · night runs · scent trails · obedience drills · sparring · fasting runs · ledge work · sand work · pack running · solo isolation · gate starts · downhill braking · long slow distance · sprint intervals · recovery swims · noise conditioning · heat acclimation · altitude days · fear work · trust falls · rope work · tracking · pull work · balance beam · rest

Each exercise: builds one thing, wears another, and nudges Mind. **Overtraining produces a permanent injury** that changes the dog forever. This is the primary way players lose good dogs, and it should be the primary source of regret in the game.

### Kit (per race)
Collar · harness · pads · coat · weights · blinders · bell · muzzle. Small effects individually; they interact with weather and Mind. Blinders on a Curiosity-5 dog is a real strategy.

### Bond (permanent, slow)
You cannot set obedience. You earn it. Every interaction — praise, discipline, indulgence, distance, consistency — moves it, and **consistency matters more than kindness.** A harsh but perfectly consistent handler gets a more obedient dog than a warm erratic one. Bond is the multiplier on every order you ever give.

---

## 9. The race

### The eight facts
Before entering, you see the course as an illustration plus exactly **eight facts**, drawn from these categories:

`LENGTH` · `TERRAIN×2` · `WEATHER` · `HAZARD` · `FEATURE` · `FIELD` · `START`

Example posting:
> **THE NARROWS** — 11 km · steep second half · one river crossing · cold, wind from north · narrow ledge at km 7 · food cache at km 3 · 12-dog field, bunched gate · dawn start

You do **not** learn: the order of the segments, the exact placement of hazards, the other dogs, or the true severity of anything. You're reasoning under real uncertainty with real information — which is the exact skill the game is testing.

### Standing orders
Write **four** conditional instructions. Syntax is natural but structured:

- `IF behind at the ridge → PUSH`
- `IF raining at the crossing → TAKE THE LONG WAY`
- `IF a dog passes after km 8 → CHASE`
- `IF stamina low at the ledge → HOLD BACK`

### Obedience resolution
When an order's condition fires, the dog rolls to obey:

```
P(obey) = BOND × ORDER_ALIGNMENT × CONDITION_MODIFIER
```

- **BOND** — your months of handling, 0.4 to 0.95
- **ORDER_ALIGNMENT** — how much this order fights the dog's nature. Telling a Greed-5 dog to skip a cache: ×0.4. Telling a Pride-5 dog to yield position: ×0.3. Telling a Want-5 dog to hold back when it smells a win: ×0.35.
- **CONDITION_MODIFIER** — pain, exhaustion, and rival proximity all degrade compliance.

**This is the emotional core of the game.** A perfect read that your dog ignores is a different kind of loss than a bad read, and players will feel the difference immediately.

### Simulation
The race is a deterministic tick-based sim, seeded, resolved **server-side in milliseconds**, then replayed on the client. Per tick (≈1 sec race time), per dog:

```
speed      = base(frame, mass) × terrain_mult(frame, blood) × gradient(hip, shoulder)
                × condition × morale × obedience_state
stamina   -= drain(mass, gradient, speed, chest, blood)
heat      += gain(effort, coat, ambient) - shed(muzzle, skull, blood)
morale    += f(position vs rivals, spite triggers, hooks, superstitions)
```

Decision points (forks, caches, hazards, contests) resolve against Mind + active orders + obedience roll.

**Critical architectural consequence:** because the race is a deterministic log, the visuals are a *replay layer* completely decoupled from game logic. You can ship the entire game with text-only race reports and add animation later without touching a line of simulation code. This is the answer to your visuals problem — build the sim first, always.

---

## 10. What the dog does to itself

The layers above are what you author. These are what the dog authors, and they're what makes players tell stories about their animals unprompted:

- **Superstitions** — after a memorable win, the dog may form an association ("won at dawn once → runs harder at dawn"). Real mechanical effect. You can reinforce it or spend weeks breaking it.
- **Scars** — permanent marks from significant losses and injuries, each carrying a small permanent shift. Your dog's body becomes its résumé, visible in the silhouette.
- **Developed fears** — beaten at the same river three times and it develops a thing about water. Now that's on your sheet and you never chose it.
- **Rivalries** — the game notices when two specific dogs keep finishing near each other and marks them as rivals. Spite triggers on rivals only.
- **Vices** — hoarding, overeating, false starts. Each gives a genuine bonus. Removing one costs weeks.
- **Aging** — dogs peak, plateau, and decline over roughly 8–14 real months depending on Blood and how hard you ran them.

---

## 11. Ranking

**Five ladders. No global #1.** A dog built for one loses on the others, which is the structural guarantee of build diversity.

1. **SPRINT** — sub-3 km, flat, explosive
2. **LONG** — 20 km+, endurance and pacing
3. **CLIMB** — gradient and altitude
4. **ROUGH** — hazards, ledges, water, weather
5. **READING** — see below

### The Reading ladder
The prestige ladder, and the one I'd build the whole game's identity around.

Before any race, you may **commit a prediction** about your own dog: *finishes top 3* · *takes the cache* · *ignores order 2* · *balks at the crossing* · *fades after km 8*. You score on **accuracy, not victory.**

Why this is the right answer to your original question about skill vs. luck:
- A single race is noisy. Prediction accuracy across 100 races is not.
- The skill it measures is *exactly* the one you wanted to reward — obsessive familiarity with your own animal.
- A weak dog and a strong dog can rank identically, so nobody is forced to converge on an optimal build.
- It is fundamentally unshareable. Nobody can predict your dog for you.

### Other scoring
- **Rivals** — the game assigns you one rival with an oddly compatible dog. Their results affect your standing.
- **Legacy** — you score when dogs descended from yours perform well.
- **Retirement** — retire a dog voluntarily and permanently unlock one trait, kit slot, or lineage for every future dog. **The only way to get certain depth is to let one go.** Retired dogs stay viewable forever, with their full record and their scars.

---

## 12. New player experience

Nine layers will drown a new player. The unlock curve solves it:

**Minute 0–3:** Frame and Blood only. Thirteen sliders is a genuinely satisfying character creator on its own, and it's visual — you're shaping a silhouette in real time.
**Minute 3–6:** History. Ten chapters, seven options each, written as a story. Feels like fiction, not a build.
**Minute 6–8:** Mind, presented as five questions rather than twelve sliders. ("When it wants something it can't have, does it wait or take it?") The twelve-axis view unlocks later.
**First race:** Two standing orders, not four.
**Day 3:** Feed and rest.
**Day 7:** Training regimen.
**Day 14:** Full Mind view, kit, third and fourth orders.
**Day 30:** Reading ladder, breeding, retirement.

**The rule:** depth arrives as a reward for attachment, never as a wall on day one.

---

## 13. Monetization

The game's entire value proposition is that dogs cannot be bought or copied. Break that and you have nothing.

**Sell:** kennel slots (raise more than one dog), cosmetic yard/collar/name-plate, race replay exports, extended history archives for retired dogs, season pass with cosmetic + one extra weekly trial entry.

**Never sell:** stats, traits, training speed, condition recovery, order slots, prediction rerolls, or anything that touches Bond. There is no gacha here. The moment a player can buy a better dog, the "I know my animal" fantasy is dead and the game has no reason to exist.

---

## 14. Visuals — solving your biggest problem

**Procedural silhouettes.** The thirteen Frame sliders drive a vector outline directly. Chest depth is a curve control point. Leg length is a bone length. Coat length is an offset on the outline with noise. That means:

- Every dog in the game looks visibly unique with **zero hand-drawn art**
- Your customization is *visible*, which is most of its emotional payload
- Scars, coat, weight, and age all render as modifications to the same outline
- It scales to any device and any resolution for free

**Art direction:** dogs as solid dark silhouettes against wide colored skies. Terrain as a single elevation line. Weather as color grade and particle. Think a moving woodcut — Firewatch's palette on a side-scrolling elevation profile. This is achievable by one person and it will look better than a mid-budget 3D attempt.

**Race view:** side-scrolling elevation profile with the field as silhouettes on the line. Camera drifts to whoever's contesting. Order triggers surface as one line of text. Total asset requirement: one procedural dog, ~12 terrain tiles, weather shaders, UI.

---

## 15. Build order

**Phase 1 — the sim, headless, no UI.** Frame, Blood, Mind, the race tick loop, obedience resolution. Output plain text race reports. If a text-only race report is not compelling to read, no amount of art will save the game. *This is the go/no-kill gate.*

**Phase 2 — creation flow + drift.** History, Mind drift, scars, superstitions. Test whether two identical creations actually diverge over 50 simulated races. Measurable target: >80% of matched pairs behaviorally distinguishable by race 40.

**Phase 3 — the silhouette renderer.** Frame sliders → vector dog. Static first.

**Phase 4 — daily loop.** Feed, train, rest, condition, two posted courses a day.

**Phase 5 — the replay layer.** Elevation profile, camera, order callouts.

**Phase 6 — ladders, prediction, rivals, retirement.**

**Phase 7 — soft launch, one region, 500 players, one season.**

---

## 16. What kills this game

Listed honestly, in order of likelihood:

1. **The race isn't fun to watch.** 90 seconds of no input is a lot to ask. Mitigation: order triggers must land as dramatic beats, races must be under 90 seconds, and the first 10 seconds must contain a real decision.
2. **Players feel helpless rather than invested.** The line between "my prep is playing for me" and "I'm not playing" is thin. Mitigation: every loss must have a legible cause the player can point at and fix tomorrow.
3. **No-numbers frustrates instead of intriguing.** Some players will bounce hard. Mitigation: observations must be specific and consistent enough that inference genuinely works. Vague flavor text kills it; "hesitated 2 seconds at the water, second time this month" does not.
4. **Not enough concurrent players for rivals and fields to feel alive.** Mitigation: AI dogs from retired player builds fill fields invisibly. Never disclose which is which.
5. **Someone datamines the client and posts a stat calculator.** Mitigation: all simulation server-side, always. The client receives only a replay log. This is a non-negotiable architecture decision from day one.

---

*The pitch, one more time, for when you're explaining it to someone in a hallway:*
**You raise a dog, you can't control it in the race, and the whole game is finding out whether you understood it.**
