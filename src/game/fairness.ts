/**
 * Automated fairness checks.
 *
 * The EPP audit in `@cards/balance` checks that a card's *stat line* costs what
 * it should. That is necessary and nowhere near sufficient: it cannot see what
 * a mechanic is actually worth in play. Elite Hounds passed the audit at 0.99
 * while solo-killing an undefended princess tower in nine seconds, because the
 * audit reads a printed damage of 45 and has no idea the card multiplies it.
 *
 * So these checks play the game instead of reading the numbers.
 *
 * A card is *not* overpowered because it wins a fight, or because a cheap card
 * beats an expensive one — a one-aether Skeletons pack behind a Mini PEKKA is
 * supposed to win, and placement and timing being decisive is the point of the
 * genre, not a bug in it. What is flagged here is narrower and harder to argue
 * with: a card that wins a lane on its own with no answer required, or a card
 * that beats things far above its cost *from the front*, where placement is not
 * doing the work.
 */

import { getCard, selectableCards } from '@cards/registry';
import { createMatch, forceSpawn } from '@sim/state';
import { stepMatch } from '@sim/tick';
import { AP_PER_AETHER, MAX_AETHER_POINTS, TICK_HZ } from '@sim/constants';
import { BLUE, RED, TOWER_LAYOUTS } from '@sim/nav/grid';
import type { CardDefinition } from '@cards/schema';
import type { Entity, MatchState } from '@sim/types';

/** Any deck works: these harnesses spawn directly and never draw a card. */
const FIXTURE_DECK = [
  'card_troop_knight',
  'card_troop_golden_knight',
  'card_troop_archers',
  'card_troop_hog_rider',
  'card_troop_musketeer',
  'card_building_cannon',
  'card_spell_fireball',
  'card_spell_zap',
  'card_towertroop_tower_princess',
];

function fixture(seed = 1): MatchState {
  return createMatch({ seed, players: [{ deck: FIXTURE_DECK }, { deck: FIXTURE_DECK }] });
}

/** Cards the harnesses can meaningfully play: troops and buildings, not spells. */
export function testableCards(): CardDefinition[] {
  return selectableCards().filter(
    (card) => card.category === 'Troop' || card.category === 'Building',
  );
}

// ---------------------------------------------------------------------------
// Tower clock
// ---------------------------------------------------------------------------

export interface TowerClock {
  cardId: string;
  name: string;
  aetherCost: number;
  /** Fraction of the princess tower still standing when the push ended, 0..1. */
  towerRemaining: number;
  /** True if the card destroyed the tower with no defence played at all. */
  soloKill: boolean;
  seconds: number;
}

/** Index of the RED right-hand princess tower, the one these pushes attack. */
const TARGET_TOWER = TOWER_LAYOUTS.findIndex(
  (t) => t.team === RED && t.kind === 'princess' && t.lane === 1,
);

/**
 * How much of an undefended princess tower a single play takes down.
 *
 * The push is placed just across the river with a clear run, which is close to
 * the best case a player can engineer for it, and the tower is the only thing
 * defending. Everything on the roster should leave *something* standing: a
 * four-cost that takes a tower alone is a card that wins games without the
 * player making a second decision.
 */
export function towerClock(cardId: string, timeoutSeconds = 45): TowerClock {
  const card = getCard(cardId);
  const state = fixture();

  // Spread the spawn set across a few tiles so bodies are not stacked inside
  // one another at spawn, which the separation pass would then have to unwind.
  const count = Math.max(1, card.spawnCount);
  for (let i = 0; i < count; i++) {
    const unit = forceSpawn(state, BLUE, cardId, 13 + (i % 3), 21 - Math.floor(i / 3));
    unit.deployTimer = 0;
  }

  const tower = state.entities.find((e) => e.kind === 'tower' && e.towerIndex === TARGET_TOWER);
  if (!tower) throw new Error('fixture is missing its target tower');
  const fullHealth = tower.hp;

  const limit = Math.round(timeoutSeconds * TICK_HZ);
  let tick = 0;
  for (; tick < limit; tick++) {
    stepMatch(state);
    if (!tower.alive) break;
    // The push is over when nothing it produced is left — which includes
    // anything a death-split or spawner passive put on the board.
    const survivors = state.entities.some((e) => e.alive && e.team === BLUE && e.kind !== 'tower');
    if (!survivors) break;
  }

  return {
    cardId,
    name: card.name,
    aetherCost: card.aetherCost,
    towerRemaining: tower.alive ? tower.hp / fullHealth : 0,
    soloKill: !tower.alive,
    seconds: Math.round((tick / TICK_HZ) * 10) / 10,
  };
}

// ---------------------------------------------------------------------------
// Duels
// ---------------------------------------------------------------------------

export interface DuelResult {
  winner: 'a' | 'b' | 'draw';
  /** Health left on the winning side, as a fraction of the side's total. */
  survivingFraction: number;
  /** Share of each side's starting health still standing when it ended. */
  aRemaining: number;
  bRemaining: number;
}

/** True when neither side can even hit the other, so a duel says nothing. */
export function duelIsMeaningful(a: CardDefinition, b: CardDefinition): boolean {
  const canHit = (attacker: CardDefinition, victim: CardDefinition): boolean => {
    if (attacker.damage <= 0) return false;
    if (attacker.targetPriority === 'Buildings') return victim.category === 'Building';
    if (attacker.targetPriority === 'AirOnly') return victim.isFlying;
    if (attacker.targetPriority === 'Ground') return !victim.isFlying;
    return true;
  };
  return canHit(a, b) && canHit(b, a);
}

function sideHealth(state: MatchState, team: Entity['team']): number {
  let total = 0;
  for (const entity of state.entities) {
    if (!entity.alive || entity.team !== team || entity.kind === 'tower') continue;
    total += entity.hp + entity.shield;
  }
  return total;
}

/**
 * A head-on fight in open ground, away from every tower.
 *
 * Head-on is the point. Placement and timing decide real games, and a card
 * that only wins when it is dropped behind something is well designed rather
 * than broken — so the harness deliberately removes those advantages and asks
 * the narrower question: what happens when the two cards simply meet?
 */
export function duel(aId: string, bId: string, timeoutSeconds = 30): DuelResult {
  const state = fixture(7);
  const a = getCard(aId);
  const b = getCard(bId);

  const spawnSide = (cardId: string, card: CardDefinition, team: 0 | 1, tileY: number) => {
    const count = Math.max(1, card.spawnCount);
    for (let i = 0; i < count; i++) {
      const unit = forceSpawn(state, team, cardId, 8 + (i % 3) - 1, tileY);
      unit.deployTimer = 0;
      // Pin the fight to mid-field: without this both sides walk off toward
      // their objective towers and the duel becomes a race, not a fight.
      unit.goalTowerIndex = -1;
    }
  };

  /*
   * Rows 10 and 12, not either side of the halfway line.
   *
   * The river occupies rows 15 and 16, so a duel staged across it was really a
   * test of who could shoot over water: every melee card "lost" to every
   * ranged card at full health because it never reached the fight at all.
   * Both sides now stand on the same dry ground, two tiles apart, clear of
   * every tower footprint.
   */
  spawnSide(aId, a, BLUE, 10);
  spawnSide(bId, b, RED, 12);

  const startA = sideHealth(state, BLUE);
  const startB = sideHealth(state, RED);

  const limit = Math.round(timeoutSeconds * TICK_HZ);
  let liveA = startA;
  let liveB = startB;
  for (let tick = 0; tick < limit; tick++) {
    stepMatch(state);
    liveA = sideHealth(state, BLUE);
    liveB = sideHealth(state, RED);
    if (liveA <= 0 || liveB <= 0) break;
  }

  // Health is capped at its start value so a card that heals itself cannot
  // report having taken negative damage.
  const aRemaining = Math.min(1, startA > 0 ? liveA / startA : 0);
  const bRemaining = Math.min(1, startB > 0 ? liveB / startB : 0);

  // A stalemate is not evidence of anything either way, so a near-tie is a
  // draw rather than a narrow win for whoever happened to be a point ahead.
  let winner: DuelResult['winner'] = 'draw';
  if (Math.abs(aRemaining - bRemaining) >= 0.1) winner = aRemaining > bRemaining ? 'a' : 'b';

  return {
    winner,
    survivingFraction: winner === 'a' ? aRemaining : winner === 'b' ? bRemaining : 0,
    aRemaining,
    bRemaining,
  };
}

// ---------------------------------------------------------------------------
// Trade value
// ---------------------------------------------------------------------------

/**
 * The benchmark panel every card is measured against.
 *
 * Deliberately archetypes rather than "the best cards": a cheap swarm, an
 * expensive swarm, a single-target bruiser, a splash bruiser, a glass shooter,
 * a durable body, an air splasher, a defensive building. A card is judged by
 * how it trades across that spread, not against any one opponent — which is
 * the whole point, because losing badly to one archetype and beating another
 * is a well-designed card, and doing neither is a problem.
 */
export const BENCHMARK_PANEL = [
  'card_troop_skeletons',
  'card_troop_barbarians',
  'card_troop_mini_pekka',
  'card_troop_valkyrie',
  'card_troop_musketeer',
  'card_troop_knight',
  'card_troop_baby_dragon',
  'card_building_cannon',
] as const;

export interface TradeValue {
  cardId: string;
  name: string;
  aetherCost: number;
  /**
   * Mean aether of value destroyed minus aether of value lost, per fight.
   *
   * The unit is aether, which is the currency the player actually reasons in:
   * +1.0 means this card typically comes out of a fight a whole aether ahead.
   */
  netAether: number;
  /** Number of panel opponents this card can meaningfully fight. */
  samples: number;
}

/**
 * How much aether-value a card wins or loses in a straight fight, on average.
 *
 * This is the "elixir trade" every player already reasons in, made
 * measurable: killing a five-cost with a two-cost is +3 whether or not you
 * survive, and losing a five-cost to a two-cost is -3. A card beating things
 * that cost more than it is *not* a fault — that is the trade the cheap card
 * exists to make. What the number catches is a card that comes out ahead
 * against everything, which is a card with no bad matchup and therefore no
 * decision attached to playing it.
 */
export function tradeValue(cardId: string, panel: readonly string[] = BENCHMARK_PANEL): TradeValue {
  const card = getCard(cardId);
  let total = 0;
  let samples = 0;

  for (const opponentId of panel) {
    if (opponentId === cardId) continue;
    const opponent = getCard(opponentId);
    if (!duelIsMeaningful(card, opponent)) continue;

    const result = duel(cardId, opponentId);
    const dealt = (1 - result.bRemaining) * opponent.aetherCost;
    const lost = (1 - result.aRemaining) * card.aetherCost;
    total += dealt - lost;
    samples++;
  }

  return {
    cardId,
    name: card.name,
    aetherCost: card.aetherCost,
    netAether: samples > 0 ? Math.round((total / samples) * 100) / 100 : 0,
    samples,
  };
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

export interface FairnessFlag {
  cardId: string;
  name: string;
  kind: 'tower-pressure-outlier' | 'trade-value-outlier' | 'trade-value-dead';
  detail: string;
}

/**
 * Minimum panel matchups before a trade-value number means anything.
 *
 * A buildings-only card can only fight the Cannon, and an air-only card only
 * the Baby Dragon; one data point is not a verdict, so those cards are
 * reported without a threshold rather than flagged on noise.
 */
export const MIN_TRADE_SAMPLES = 4;

/** Net aether per fight above which a card is winning too much, too broadly. */
export const TRADE_VALUE_CEILING = 2.6;

/**
 * Below this a card loses value against everything and is not worth a slot.
 *
 * Applied only to cards that are meant to fight at close quarters. The panel
 * is a head-on melee brawl, so a siege card that outranges a princess tower is
 * *supposed* to lose it badly — being useless in a straight fight is the price
 * it pays for its reach, and flagging that would be flagging the design.
 */
export const TRADE_VALUE_FLOOR = -2.2;

/** Reach beyond which the floor stops applying, per the note above. */
export const SIEGE_RANGE = 6.5;

/** Multiples of the median absolute deviation that count as a tower outlier. */
export const TOWER_OUTLIER_DEVIATIONS = 3;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Tower pressure per aether, for every card, with the outlier bar.
 *
 * The bar is computed from the roster rather than written down, so it moves as
 * cards are added and a new card is always judged against its actual peers.
 * Median absolute deviation rather than standard deviation because the
 * distribution has a hard ceiling — a card cannot take more than a whole tower
 * — and a handful of cards sit on it.
 */
export function towerPressure(cards = testableCards()): {
  rows: Array<TowerClock & { perAether: number }>;
  threshold: number;
} {
  const rows = cards
    .filter((card) => card.damage > 0)
    .map((card) => {
      const clock = towerClock(card.id);
      return { ...clock, perAether: (1 - clock.towerRemaining) / card.aetherCost };
    });

  const values = rows.map((row) => row.perAether);
  const centre = median(values);
  const deviation = median(values.map((value) => Math.abs(value - centre)));

  return { rows, threshold: centre + TOWER_OUTLIER_DEVIATIONS * deviation };
}

/**
 * Every fairness flag on the current roster.
 *
 * An empty array means the roster is clean, which is what the test asserts.
 * Each flag names the card and says exactly what it did, so acting on one does
 * not require re-deriving the finding.
 */
export function fairnessFlags(cards = testableCards()): FairnessFlag[] {
  const flags: FairnessFlag[] = [];

  const { rows, threshold } = towerPressure(cards);
  for (const row of rows) {
    if (row.perAether <= threshold) continue;
    flags.push({
      cardId: row.cardId,
      name: row.name,
      kind: 'tower-pressure-outlier',
      detail:
        `took ${Math.round((1 - row.towerRemaining) * 100)}% of an undefended princess tower ` +
        `for ${row.aetherCost} aether in ${row.seconds}s ` +
        `(${row.perAether.toFixed(3)} per aether, roster bar ${threshold.toFixed(3)})`,
    });
  }

  for (const card of cards) {
    if (card.damage <= 0) continue;
    const trade = tradeValue(card.id);
    if (trade.samples < MIN_TRADE_SAMPLES) continue;

    if (trade.netAether > TRADE_VALUE_CEILING) {
      flags.push({
        cardId: card.id,
        name: card.name,
        kind: 'trade-value-outlier',
        detail: `wins ${trade.netAether} aether per fight across the benchmark panel`,
      });
    } else if (trade.netAether < TRADE_VALUE_FLOOR && card.attackRange < SIEGE_RANGE) {
      flags.push({
        cardId: card.id,
        name: card.name,
        kind: 'trade-value-dead',
        detail: `loses ${Math.abs(trade.netAether)} aether per fight across the benchmark panel`,
      });
    }
  }

  return flags;
}

// ---------------------------------------------------------------------------
// Skilled elixir trades
// ---------------------------------------------------------------------------

/**
 * What one defensive play was worth, in aether.
 *
 * The engine now keeps this ledger itself — `aetherDestroyed` minus
 * `aetherSpent` — so this measures the number the player is actually shown
 * rather than a separate model of it.
 */
export interface TradeOutcome {
  /** Aether of value destroyed minus aether committed. */
  elixir: number;
  /** Tower health conceded while the exchange resolved, as a fraction of one tower. */
  conceded: number;
  /**
   * The whole exchange: elixir won, less what the leak cost.
   *
   * A defence is not scored in elixir alone. Killing a Hog Rider for a
   * two-aether profit is a *loss* if it connected three times first, and that
   * is the half of the exchange placement actually controls — the elixir
   * result of swarm-versus-tank is much the same wherever you drop it, but the
   * damage you concede getting there is not. `CONCEDE_WEIGHT` prices a whole
   * princess tower at the aether it would take to rebuild the tempo, so the
   * two halves are commensurable.
   */
  net: number;
  threatKilled: boolean;
  /** Fraction of the threat still standing when the exchange ended. */
  threatRemaining: number;
}

/** Aether a full princess tower's worth of conceded damage is charged at. */
const CONCEDE_WEIGHT = 10;

/**
 * Rows a defender might drop an answer on, from "right on top of the threat"
 * to "back at the tower". These are the placements a real player chooses
 * between, and the spread across them is what makes a card skill-expressive.
 */
const ANSWER_ROWS = [13, 11, 9, 7] as const;

/**
 * Play `answerId` against `threatId` at a given row and score the exchange.
 *
 * The threat always walks down the left lane from row 14, so a low row is a
 * late, defensive answer under the player's own tower and a high row is an
 * early one out in the open.
 */
export function defensiveTrade(threatId: string, answerId: string, row: number): TradeOutcome | null {
  const state = fixture(33);
  const threat = forceSpawn(state, RED, threatId, 3, 14);
  threat.deployTimer = 0;

  // The tower the threat is walking at. What it takes off this is the other
  // half of the trade, and the half that answers to placement.
  const defended = state.entities.filter((e) => e.kind === 'tower' && e.team === BLUE);
  const towerHpBefore = defended.reduce((sum, t) => sum + t.hp, 0);
  const towerMax = Math.max(1, ...defended.map((t) => t.maxHp));

  state.players[BLUE].hand[0] = answerId;
  state.players[BLUE].aetherPoints = MAX_AETHER_POINTS;
  stepMatch(state, [{ type: 'deploy', team: BLUE, handIndex: 0, tileX: 3, tileY: row }]);

  const answered = state.entities.some(
    (e) => e.alive && e.team === BLUE && e.cardId === answerId,
  );
  // The placement was illegal — not a bad trade, just not a trade.
  if (!answered) return null;

  const limit = Math.round(30 * TICK_HZ);
  for (let tick = 0; tick < limit; tick++) {
    stepMatch(state);
    const survivors = state.entities.some(
      (e) => e.alive && e.team === BLUE && e.cardId === answerId,
    );
    if (!threat.alive || !survivors) break;
  }

  const player = state.players[BLUE];
  const elixir = (player.aetherDestroyed - player.aetherSpent) / AP_PER_AETHER;
  const towerHpAfter = defended.reduce((sum, t) => sum + (t.alive ? t.hp : 0), 0);
  const conceded = Math.max(0, towerHpBefore - towerHpAfter) / towerMax;

  return {
    elixir,
    conceded,
    net: elixir - conceded * CONCEDE_WEIGHT,
    threatKilled: !threat.alive,
    threatRemaining: threat.alive ? threat.hp / threat.maxHp : 0,
  };
}

export interface SkillSpread {
  threatId: string;
  answerId: string;
  best: number;
  worst: number;
  /** How much the same two cards swing on placement alone. */
  spread: number;
}

/**
 * How much placement is worth for one matchup.
 *
 * This is the measurement the roster never had. `tradeValue` deliberately
 * strips placement out — it stages a head-on fight to ask whether a card is
 * broken — which means nothing in the project checked the opposite and more
 * important question: does *where* you put a card change what it is worth?
 *
 * A spread of zero is the bad case. It means the matchup resolves the same way
 * however carefully it is played, and a card that trades identically wherever
 * it lands is a card that plays itself.
 */
export function skillSpread(threatId: string, answerId: string): SkillSpread {
  const results = ANSWER_ROWS.map((row) => defensiveTrade(threatId, answerId, row)).filter(
    (r): r is TradeOutcome => r !== null,
  );
  const nets = results.map((r) => r.net);
  const best = nets.length ? Math.max(...nets) : 0;
  const worst = nets.length ? Math.min(...nets) : 0;
  return {
    threatId,
    answerId,
    best: Math.round(best * 10) / 10,
    worst: Math.round(worst * 10) / 10,
    spread: Math.round((best - worst) * 10) / 10,
  };
}

/**
 * Matchups the game is expected to reward skill in.
 *
 * Each pairs an expensive threat with a cheaper card that must beat it, so a
 * threat cannot quietly become unanswerable. What makes the list worth having
 * is that the answers are not interchangeable: which cheap card wins depends on
 * how the threat deals its damage, and getting that backwards is a losing play
 * rather than a slightly worse one.
 *
 * An earlier version of this list asserted that Goblins answer a Musketeer.
 * They do not, and they do not in the reference game either — she one-shots a
 * Goblin and out-paces the three of them. That it *appeared* to be merely a
 * near-miss was a symptom: the Musketeer was carrying 21% more health and
 * damage than she should have (see `@cards/clashReference`). A matchup table
 * asserting things the simulation disagrees with is only useful if the
 * disagreement is investigated rather than tuned away.
 */
export const SKILL_MATCHUPS: ReadonlyArray<{ threat: string; answer: string }> = [
  // Single-target bruisers die to bodies: they can only swing at one at a time.
  { threat: 'card_troop_mini_pekka', answer: 'card_troop_skeletons' },
  { threat: 'card_troop_giant', answer: 'card_troop_goblins' },
  { threat: 'card_troop_hog_rider', answer: 'card_troop_skeletons' },
  // Splash and one-shot damage invert that: a swarm fed to either is a
  // donation, so the cheap answer has to be a single tough body instead.
  { threat: 'card_troop_valkyrie', answer: 'card_troop_knight' },
  { threat: 'card_troop_musketeer', answer: 'card_troop_knight' },
  // A melee bruiser with no reach is answered from outside it.
  { threat: 'card_troop_ronin', answer: 'card_troop_archers' },
];
