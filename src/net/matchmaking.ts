/**
 * Matchmaking (spec §5).
 *
 * The queue runs locally against a synthesised bot opponent, but the *rules*
 * are the real ones: the ±50 trophy bucket widening to ±150 after five
 * seconds, and the hard ±2 King Tower level gate. A server implementation
 * swaps in behind `MatchmakingService` without the caller changing.
 */

import { BOT_DECK } from '@cards/data';
import { getCard } from '@cards/registry';
import { createRng, nextRange, type Rng } from '@sim/math/rng';
import type { MatchConfig } from '@sim/state';

export interface QueueTicket {
  playerId: string;
  name: string;
  trophies: number;
  kingTowerLevel: number;
  /** Nine card ids in deck-slot order. */
  deck: string[];
  /** Card id -> level. */
  cardLevels: Record<string, number>;
}

export interface OpponentProfile {
  playerId: string;
  name: string;
  trophies: number;
  kingTowerLevel: number;
  deck: string[];
  cardLevels: Record<string, number>;
  isBot: boolean;
}

export interface MatchmakingResult {
  matchConfig: MatchConfig;
  opponent: OpponentProfile;
  /** How wide the trophy window had to open before a match was found. */
  trophyWindow: number;
  waitedSeconds: number;
}

export interface MatchmakingService {
  findMatch(ticket: QueueTicket, waitedSeconds?: number): Promise<MatchmakingResult>;
}

/** Spec §5: open at ±50, widen to ±150 once five seconds have elapsed. */
export const INITIAL_TROPHY_WINDOW = 50;
export const WIDENED_TROPHY_WINDOW = 150;
export const WINDOW_WIDEN_AFTER_SECONDS = 5;

/** Spec §5: never pair players more than two King Tower levels apart. */
export const MAX_KING_TOWER_DELTA = 2;

export function trophyWindowFor(waitedSeconds: number): number {
  return waitedSeconds >= WINDOW_WIDEN_AFTER_SECONDS
    ? WIDENED_TROPHY_WINDOW
    : INITIAL_TROPHY_WINDOW;
}

/** Whether two players are allowed to meet. Applies to real matchmaking too. */
export function isEligiblePairing(
  a: Pick<QueueTicket, 'trophies' | 'kingTowerLevel'>,
  b: Pick<QueueTicket, 'trophies' | 'kingTowerLevel'>,
  waitedSeconds: number,
): boolean {
  if (Math.abs(a.kingTowerLevel - b.kingTowerLevel) > MAX_KING_TOWER_DELTA) return false;
  return Math.abs(a.trophies - b.trophies) <= trophyWindowFor(waitedSeconds);
}

/** Average level across a deck — the third component of the queue token. */
export function deckLevelAverage(deck: string[], cardLevels: Record<string, number>): number {
  if (deck.length === 0) return 0;
  const total = deck.reduce((sum, id) => sum + (cardLevels[id] ?? 11), 0);
  return Math.round((total / deck.length) * 10) / 10;
}

const BOT_NAMES = [
  'IronBarbarian',
  'HogCommander',
  'ElixirGolem',
  'ArenaWraith',
  'CrownChaser',
  'BridgeSpammer',
  'TowerTilter',
  'LadderLegend',
];

/**
 * Builds an opponent inside the legal window rather than picking a fixed one,
 * so the level-gating and trophy rules are actually exercised in normal play.
 */
function synthesiseOpponent(ticket: QueueTicket, window: number, rng: Rng): OpponentProfile {
  const trophyDelta = nextRange(rng, -window, window);
  const trophies = Math.max(0, ticket.trophies + trophyDelta);

  const levelDelta = nextRange(rng, -MAX_KING_TOWER_DELTA, MAX_KING_TOWER_DELTA);
  const kingTowerLevel = Math.min(16, Math.max(1, ticket.kingTowerLevel + levelDelta));

  // Bot card levels track its King Tower level, as a real ladder opponent's do.
  const cardLevels: Record<string, number> = {};
  for (const cardId of BOT_DECK) {
    const card = getCard(cardId);
    // Champions and legendaries sit lower on the ladder than commons.
    const rarityOffset =
      card.rarity === 'Champion' || card.rarity === 'Legendary'
        ? -2
        : card.rarity === 'Epic'
          ? -1
          : 0;
    cardLevels[cardId] = Math.min(16, Math.max(1, kingTowerLevel + rarityOffset));
  }

  return {
    playerId: `bot_${nextRange(rng, 100000, 999999)}`,
    name: BOT_NAMES[nextRange(rng, 0, BOT_NAMES.length - 1)],
    trophies,
    kingTowerLevel,
    deck: [...BOT_DECK],
    cardLevels,
    isBot: true,
  };
}

export class LocalBotMatchmaker implements MatchmakingService {
  constructor(private readonly seedSource: () => number) {}

  async findMatch(ticket: QueueTicket, waitedSeconds = 0): Promise<MatchmakingResult> {
    const seed = this.seedSource();
    const rng = createRng(seed);
    const window = trophyWindowFor(waitedSeconds);

    let opponent = synthesiseOpponent(ticket, window, rng);
    // Honour the same gate a server would apply before confirming the pairing.
    let attempts = 0;
    while (!isEligiblePairing(ticket, opponent, waitedSeconds) && attempts < 16) {
      opponent = synthesiseOpponent(ticket, window, rng);
      attempts++;
    }

    const matchConfig: MatchConfig = {
      seed,
      players: [
        {
          deck: ticket.deck,
          levels: ticket.cardLevels,
          kingTowerLevel: ticket.kingTowerLevel,
        },
        {
          deck: opponent.deck,
          levels: opponent.cardLevels,
          kingTowerLevel: opponent.kingTowerLevel,
        },
      ],
    };

    return { matchConfig, opponent, trophyWindow: window, waitedSeconds };
  }
}
