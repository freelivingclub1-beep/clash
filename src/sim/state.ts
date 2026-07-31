/**
 * Match construction.
 *
 * A match is fully determined by its `MatchConfig` — seed, decks, card levels.
 * Given the same config and the same command stream, two runs produce
 * byte-identical state, which is what the determinism tests assert and what a
 * lockstep server would depend on.
 */

import { getCard } from '@cards/registry';
import { fx } from './math/fixed';
import { createRng, shuffle, type Rng } from './math/rng';
import { STARTING_AETHER_POINTS, AP_PER_AETHER } from './constants';
import {
  type Team,
  BLUE,
  RED,
  createArenaGrid,
  setOccupied,
  TOWER_LAYOUTS,
} from './nav/grid';
import { FlowFieldCache } from './nav/flowfield';
import { spawnTower, spawnTroop } from './entities';
import { type MatchState, type PlayerState, NO_TARGET } from './types';

/** Deck slot roles, per spec §3. */
export const DECK_SLOTS = {
  EVOLUTION: 0,
  HERO: 1,
  WILD: 2,
  TOWER_TROOP: 8,
} as const;

export const BATTLE_DECK_SIZE = 8;
export const FULL_DECK_SIZE = 9;
export const HAND_SIZE = 4;

export interface MatchPlayerConfig {
  /** Nine card ids in deck-slot order. */
  deck: string[];
  /** Card id -> level. Missing entries default to 11. */
  levels?: Record<string, number>;
  kingTowerLevel?: number;
}

export interface MatchConfig {
  seed: number;
  players: [MatchPlayerConfig, MatchPlayerConfig];
}

function levelFor(config: MatchPlayerConfig, cardId: string): number {
  return config.levels?.[cardId] ?? 11;
}

function createPlayerState(team: Team, config: MatchPlayerConfig, shuffleRng: Rng): PlayerState {
  const battleCards = config.deck.slice(0, BATTLE_DECK_SIZE);
  const towerTroopCardId = config.deck[DECK_SLOTS.TOWER_TROOP];

  const levels = new Map<string, number>();
  for (const id of config.deck) levels.set(id, levelFor(config, id));

  // The cycle is shuffled once at match start from the seeded stream, so both
  // clients (and a future server) deal identical hands.
  const cycle = shuffle(shuffleRng, [...battleCards]);

  // Only the evolution slot, plus the wild slot when it holds an evolution
  // card, may ever produce an evolved unit.
  const evolutionSlots: string[] = [];
  const evoSlotCard = config.deck[DECK_SLOTS.EVOLUTION];
  if (evoSlotCard && getCard(evoSlotCard).hasEvolution) evolutionSlots.push(evoSlotCard);
  const wildCard = config.deck[DECK_SLOTS.WILD];
  if (wildCard && getCard(wildCard).hasEvolution && !evolutionSlots.includes(wildCard)) {
    evolutionSlots.push(wildCard);
  }

  const evoCounters = new Map<string, number>();
  const evoReady = new Map<string, boolean>();
  for (const id of evolutionSlots) {
    evoCounters.set(id, getCard(id).evoCycleRequirement);
    evoReady.set(id, false);
  }

  return {
    team,
    aetherPoints: STARTING_AETHER_POINTS,
    deck: battleCards,
    towerTroopCardId,
    levels,
    hand: cycle.slice(0, HAND_SIZE),
    queue: cycle.slice(HAND_SIZE),
    evolutionSlots,
    evoCounters,
    evoReady,
    heroEntityId: NO_TARGET,
    heroAbilityCooldown: 0,
    crowns: 0,
    deployRights: { laneOpen: [false, false] },
    aetherSpent: 0,
    aetherDestroyed: 0,
    cardsPlayed: 0,
  };
}

export const KING_TOWER_CARD_ID = 'card_towertroop_king_tower';

export function createMatch(config: MatchConfig): MatchState {
  // Two streams from one seed. Offsetting the sim stream keeps it independent
  // of the shuffle stream so bot decisions can never perturb card order.
  const shuffleRng = createRng(config.seed);
  const simRng = createRng((config.seed ^ 0x9e3779b9) | 0);

  const grid = createArenaGrid();
  const state: MatchState = {
    tick: 0,
    phase: 'regulation',
    outcome: 'ongoing',
    grid,
    flowFields: new FlowFieldCache(grid),
    entities: [],
    nextEntityId: 1,
    needsCompaction: false,
    players: [
      createPlayerState(BLUE, config.players[0], shuffleRng),
      createPlayerState(RED, config.players[1], shuffleRng),
    ],
    shuffleRng,
    simRng,
    events: [],
  };

  // Towers occupy their footprints before any flow field is built, so units
  // path around them from the first tick.
  for (const layout of TOWER_LAYOUTS) setOccupied(grid, layout.footprint, true);

  for (let towerIndex = 0; towerIndex < TOWER_LAYOUTS.length; towerIndex++) {
    const layout = TOWER_LAYOUTS[towerIndex];
    const player = config.players[layout.team];
    if (layout.kind === 'king') {
      spawnTower(state, towerIndex, KING_TOWER_CARD_ID, player.kingTowerLevel ?? 11);
    } else {
      const cardId = player.deck[DECK_SLOTS.TOWER_TROOP];
      spawnTower(state, towerIndex, cardId, levelFor(player, cardId));
    }
  }

  state.events.length = 0;
  return state;
}

// ---------------------------------------------------------------------------
// Small read helpers shared by the systems, the HUD and the bot
// ---------------------------------------------------------------------------

/** Aether as a display number, e.g. 7.35. */
export function aetherOf(player: PlayerState): number {
  return player.aetherPoints / AP_PER_AETHER;
}

export function canAfford(player: PlayerState, aetherCost: number): boolean {
  return player.aetherPoints >= aetherCost * AP_PER_AETHER;
}

export function spendAether(player: PlayerState, aetherCost: number): void {
  const cost = aetherCost * AP_PER_AETHER;
  player.aetherPoints -= cost;
  player.aetherSpent += cost;
}

/**
 * Advance the hand after playing slot `handIndex`: the next queued card fills
 * the vacated slot and the played card goes to the back of the cycle. Slot
 * positions stay stable, matching how the reference game's hand behaves.
 */
export function cycleHand(player: PlayerState, handIndex: number): void {
  const played = player.hand[handIndex];
  const incoming = player.queue.shift();
  if (incoming === undefined) return;
  player.hand[handIndex] = incoming;
  player.queue.push(played);
}

export function tileCenter(tileX: number, tileY: number): { x: number; y: number } {
  return { x: fx(tileX + 0.5), y: fx(tileY + 0.5) };
}

/** Test/bot helper: drop a card straight onto the field with no cost checks. */
export function forceSpawn(
  state: MatchState,
  team: Team,
  cardId: string,
  tileX: number,
  tileY: number,
  evolved = false,
) {
  const center = tileCenter(tileX, tileY);
  const level = state.players[team].levels.get(cardId) ?? 11;
  return spawnTroop(state, cardId, level, evolved, team, center.x, center.y);
}

export { BLUE, RED };
