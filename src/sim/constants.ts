/**
 * Arena geometry, clock, and economy constants.
 *
 * Everything here is expressed in the sim's own units — ticks, tiles, elixir
 * points — never seconds or pixels. Conversion to wall-clock and screen space
 * happens exclusively on the render side.
 */

import { type Fx, fx, fxDiv } from './math/fixed';
import { type SpeedClass, SPEED_TILES_PER_MIN } from '@cards/schema';

export type { SpeedClass };

// ---------------------------------------------------------------------------
// Clock
// ---------------------------------------------------------------------------

export const TICK_HZ = 30;
export const TICK_MS = 1000 / TICK_HZ; // 33.333… — render-side only
export const secondsToTicks = (s: number): number => Math.round(s * TICK_HZ);

/** 3:00 of regulation play. */
export const REGULATION_END_TICK = secondsToTicks(180); // 5400
/** Regulation + 2:00 of sudden-death overtime. */
export const MATCH_END_TICK = secondsToTicks(300); // 9000

/** Elixir rate boundaries, per spec §5: 1x until 2:00, 2x until 4:00, 3x after. */
export const DOUBLE_ELIXIR_TICK = secondsToTicks(120); // 3600
export const TRIPLE_ELIXIR_TICK = secondsToTicks(240); // 7200

// ---------------------------------------------------------------------------
// Elixir
// ---------------------------------------------------------------------------

/**
 * Elixir is counted in integer "elixir points" rather than a fraction, so the
 * bar can never drift.
 *
 * The three rates in the spec are 1 elixir per 2.8s / 1.4s / 0.7s, which at
 * 30Hz is exactly 84 / 42 / 21 ticks. Defining 1 elixir as 84 points makes the
 * per-tick gain the integers 1, 2 and 4 — no remainder, no accumulator.
 */
export const EP_PER_ELIXIR = 84;
export const MAX_ELIXIR = 10;
export const MAX_ELIXIR_POINTS = MAX_ELIXIR * EP_PER_ELIXIR; // 840
export const EP_GAIN_SINGLE = 1;
export const EP_GAIN_DOUBLE = 2;
export const EP_GAIN_TRIPLE = 4;

/** Both players open the match with 5 elixir, as in the reference game. */
export const STARTING_ELIXIR_POINTS = 5 * EP_PER_ELIXIR;

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

export const GRID_W = 18;
export const GRID_H = 32;

/** Rows 15 and 16 are water. Everything below is blue's half. */
export const RIVER_ROW_LOW = 15;
export const RIVER_ROW_HIGH = 16;

/** Columns where the two bridges cross; every other river column is blocked. */
export const BRIDGE_COLUMNS: readonly number[] = [4, 5, 13, 14];

/** X < LANE_SPLIT targets the left princess tower, X >= it targets the right. */
export const LANE_SPLIT_X = 9;

// ---------------------------------------------------------------------------
// Movement
// ---------------------------------------------------------------------------

const TICKS_PER_MINUTE = TICK_HZ * 60; // 1800

/** Tiles travelled per tick, in Q16.16. */
export function speedClassToFx(speed: SpeedClass): Fx {
  return fxDiv(fx(SPEED_TILES_PER_MIN[speed]), fx(TICKS_PER_MINUTE));
}

// ---------------------------------------------------------------------------
// Combat / steering tuning
// ---------------------------------------------------------------------------

/** Targets are re-queried every 3 ticks, staggered by entity id (spec §2). */
export const TARGET_REACQUIRE_INTERVAL = 3;

/** A locked target is dropped once it exceeds sightRange * this factor. */
export const TARGET_LOSE_RANGE_FACTOR: Fx = fx(1.4);

/** Boids separation strength, scaled per-entity by inverse mass. */
export const SEPARATION_STRENGTH: Fx = fx(0.35);

/** Default collision radius for a single troop, in tiles. */
export const DEFAULT_BODY_RADIUS: Fx = fx(0.4);

/** Projectile travel speed in tiles per tick. */
export const PROJECTILE_SPEED: Fx = fxDiv(fx(9), fx(TICK_HZ));

// ---------------------------------------------------------------------------
// Deployment
// ---------------------------------------------------------------------------

/** Ticks between dropping a card and the troops becoming active. */
export const DEPLOY_DELAY_TICKS = secondsToTicks(1);

/** Rows a player may deploy on before any enemy princess tower has fallen. */
export const DEPLOY_ROWS_BLUE = { min: 0, max: 14 };
export const DEPLOY_ROWS_RED = { min: 17, max: 31 };

/** Once an enemy princess tower falls, that lane opens up this far forward. */
export const DEPLOY_ROWS_BLUE_EXTENDED_MAX = 21;
export const DEPLOY_ROWS_RED_EXTENDED_MIN = 10;
