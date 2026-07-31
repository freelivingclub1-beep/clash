/**
 * Level scaling for card stats.
 *
 * Every card's authored numbers are its level-11 values (the balance baseline).
 * Levels run 1..16 and each step multiplies by the card's `scalingMultiplier`,
 * 1.10 by default.
 *
 * The multiplier chain is evaluated in integer arithmetic over a fixed
 * denominator rather than with `Math.pow`, so a stat computed on the client and
 * a stat computed on a future server are byte-identical. Tables are memoised
 * per multiplier because a match only ever touches a handful of distinct ones.
 */

import { type CardDefinition, SPEED_TILES_PER_MIN } from './schema';

export const BASELINE_LEVEL = 11;
export const MIN_LEVEL = 1;
export const MAX_LEVEL = 16;

const DEN = 1_000_000;
const tableCache = new Map<number, number[]>();

/**
 * Multiplier numerators (over DEN) indexed by level, for a given per-level
 * multiplier expressed in per-mille (1.10 -> 1100).
 */
function multiplierTable(perMille: number): number[] {
  const cached = tableCache.get(perMille);
  if (cached) return cached;

  const table = new Array<number>(MAX_LEVEL + 1).fill(0);
  table[BASELINE_LEVEL] = DEN;

  for (let level = BASELINE_LEVEL + 1; level <= MAX_LEVEL; level++) {
    table[level] = Math.round((table[level - 1] * perMille) / 1000);
  }
  for (let level = BASELINE_LEVEL - 1; level >= MIN_LEVEL; level--) {
    table[level] = Math.round((table[level + 1] * 1000) / perMille);
  }

  tableCache.set(perMille, table);
  return table;
}

export function clampLevel(level: number): number {
  if (level < MIN_LEVEL) return MIN_LEVEL;
  if (level > MAX_LEVEL) return MAX_LEVEL;
  return Math.round(level);
}

/** Scale a level-11 stat to `level`. Returns an integer. */
export function statAtLevel(baseAtLevel11: number, level: number, scalingMultiplier = 1.1): number {
  const lvl = clampLevel(level);
  if (lvl === BASELINE_LEVEL) return Math.round(baseAtLevel11);
  const perMille = Math.round(scalingMultiplier * 1000);
  const table = multiplierTable(perMille);
  return Math.round((baseAtLevel11 * table[lvl]) / DEN);
}

export function healthAtLevel(card: CardDefinition, level: number): number {
  return statAtLevel(card.baseHealth, level, card.scalingMultiplier);
}

export function damageAtLevel(card: CardDefinition, level: number): number {
  return statAtLevel(card.damage, level, card.scalingMultiplier);
}

export function shieldAtLevel(card: CardDefinition, level: number): number {
  return statAtLevel(card.shieldHealth, level, card.scalingMultiplier);
}

// ---------------------------------------------------------------------------
// Derived stats — surfaced by the Card Maker's live preview and the deck UI
// ---------------------------------------------------------------------------

export interface DerivedStats {
  dps: number;
  healthPerLevel: number[];
  damagePerLevel: number[];
  tilesPerSecond: number;
  /** Total damage per hit across all spawned entities. */
  swarmDamagePerHit: number;
  /** Combined health of every entity the card spawns, at the baseline level. */
  swarmHealth: number;
  /** Elixir spent per point of combined health — lower is more efficient. */
  elixirPerThousandHealth: number;
}

export function derivedStats(card: CardDefinition): DerivedStats {
  const healthPerLevel: number[] = [];
  const damagePerLevel: number[] = [];
  for (let level = MIN_LEVEL; level <= MAX_LEVEL; level++) {
    healthPerLevel.push(healthAtLevel(card, level));
    damagePerLevel.push(damageAtLevel(card, level));
  }

  const dps = card.hitSpeed > 0 ? card.damage / card.hitSpeed : 0;
  const swarmHealth = card.baseHealth * card.spawnCount;

  return {
    dps: Math.round(dps * 10) / 10,
    healthPerLevel,
    damagePerLevel,
    tilesPerSecond: Math.round((SPEED_TILES_PER_MIN[card.speedClass] / 60) * 100) / 100,
    swarmDamagePerHit: card.damage * card.spawnCount,
    swarmHealth,
    elixirPerThousandHealth:
      swarmHealth > 0 ? Math.round((card.elixirCost / (swarmHealth / 1000)) * 100) / 100 : 0,
  };
}
