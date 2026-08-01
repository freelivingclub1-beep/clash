/**
 * Aether generation and the match clock.
 *
 * Aether is integer "aether points" — 84 to the aether — chosen so the spec's
 * 2.8s / 1.4s / 0.7s rates land on exactly 1, 2 and 4 points per tick at 30Hz.
 * No accumulator, no remainder, no drift over a five-minute match.
 */

import {
  DOUBLE_AETHER_TICK,
  TRIPLE_AETHER_TICK,
  AP_GAIN_SINGLE,
  AP_GAIN_DOUBLE,
  AP_GAIN_TRIPLE,
  MAX_AETHER_POINTS,
  REGULATION_END_TICK,
  MATCH_END_TICK,
} from '../constants';
import { BLUE, RED } from '../nav/grid';
import { kingTowerAlive, lowestTowerHealth } from './towers';
import type { MatchState } from '../types';

/** Aether points generated per tick at the current point in the match. */
export function aetherGainAtTick(tick: number): number {
  if (tick >= TRIPLE_AETHER_TICK) return AP_GAIN_TRIPLE;
  if (tick >= DOUBLE_AETHER_TICK) return AP_GAIN_DOUBLE;
  return AP_GAIN_SINGLE;
}

/** Human-readable multiplier, for the HUD. */
export function aetherMultiplierAtTick(tick: number): 1 | 2 | 3 {
  if (tick >= TRIPLE_AETHER_TICK) return 3;
  if (tick >= DOUBLE_AETHER_TICK) return 2;
  return 1;
}

export function aetherTick(state: MatchState): void {
  if (state.phase === 'finished') return;
  const gain = aetherGainAtTick(state.tick);

  for (const player of state.players) {
    // Generation above the cap is discarded permanently, not banked.
    player.aetherPoints = Math.min(MAX_AETHER_POINTS, player.aetherPoints + gain);
  }
}

export function matchClock(state: MatchState): void {
  if (state.phase === 'finished') return;

  const blueKing = kingTowerAlive(state, BLUE);
  const redKing = kingTowerAlive(state, RED);

  // A king tower falling ends the match immediately, at any point.
  if (!blueKing || !redKing) {
    state.phase = 'finished';
    state.outcome = !blueKing && !redKing ? 'draw' : !blueKing ? 'red' : 'blue';
    return;
  }

  const blueCrowns = state.players[BLUE].crowns;
  const redCrowns = state.players[RED].crowns;

  if (state.tick < REGULATION_END_TICK) {
    state.phase = 'regulation';
    return;
  }

  // Regulation is over. A crown lead settles it; otherwise we go to overtime.
  if (state.tick === REGULATION_END_TICK && blueCrowns !== redCrowns) {
    state.phase = 'finished';
    state.outcome = blueCrowns > redCrowns ? 'blue' : 'red';
    return;
  }

  state.phase = 'overtime';

  // Sudden death: in overtime the first crown taken wins it outright.
  if (blueCrowns !== redCrowns) {
    state.phase = 'finished';
    state.outcome = blueCrowns > redCrowns ? 'blue' : 'red';
    return;
  }

  if (state.tick >= MATCH_END_TICK) {
    state.phase = 'finished';
    // Final tiebreak: whichever side's weakest standing tower is healthier.
    const blueLowest = lowestTowerHealth(state, BLUE);
    const redLowest = lowestTowerHealth(state, RED);
    state.outcome = blueLowest === redLowest ? 'draw' : blueLowest > redLowest ? 'blue' : 'red';
  }
}
