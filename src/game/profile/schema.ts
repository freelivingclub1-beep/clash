/**
 * Player persistence schema (spec §5).
 *
 * Mirrors the backend's relational hierarchy — account core, wallet, card
 * collection, deck — as one validated document. Zod is used here for the same
 * reason it is used for cards: the stored shape and the TypeScript type cannot
 * drift, and a corrupt or outdated localStorage blob is caught on read rather
 * than crashing the game three screens later.
 */

import { z } from 'zod';
import { MIN_LEVEL, MAX_LEVEL } from '@cards/scaling';
import { STARTER_DECK } from '@cards/data';

/** Evolution shards needed to unlock an evolution, per spec §5. */
export const MAX_EVOLUTION_SHARDS = 6;

export const walletSchema = z.object({
  gold: z.number().int().min(0).default(1000),
  gems: z.number().int().min(0).default(100),
  /** Elite Wild Cards. */
  eliteWildCards: z.number().int().min(0).default(0),
  evolutionShards: z.number().int().min(0).default(0),
  heroShards: z.number().int().min(0).default(0),
});

export const collectionEntrySchema = z.object({
  cardId: z.string(),
  level: z.number().int().min(MIN_LEVEL).max(MAX_LEVEL).default(11),
  /** Total duplicates owned, which is what funds the next upgrade. */
  duplicates: z.number().int().min(0).default(0),
  evolutionShardsInvested: z.number().int().min(0).max(MAX_EVOLUTION_SHARDS).default(0),
});

/**
 * One finished match. Kept short and capped in the repository, because a
 * profile is a single localStorage blob and an unbounded history would grow
 * it without limit.
 */
export const battleLogEntrySchema = z.object({
  outcome: z.enum(['win', 'loss', 'draw']),
  crownsFor: z.number().int().min(0).max(3).default(0),
  crownsAgainst: z.number().int().min(0).max(3).default(0),
  opponentName: z.string().default('Opponent'),
  trophyDelta: z.number().int().default(0),
  /** Seconds of match time played. */
  durationSeconds: z.number().int().min(0).default(0),
  cardsPlayed: z.number().int().min(0).default(0),
  towerDamageDealt: z.number().int().min(0).default(0),
});

export const MAX_BATTLE_LOG = 20;

export const playerProfileSchema = z.object({
  schemaVersion: z.literal(1).default(1),

  // --- account core --------------------------------------------------------
  userId: z.string().min(1),
  name: z.string().min(1).max(24).default('Player'),
  trophies: z.number().int().min(0).default(4000),
  kingTowerLevel: z.number().int().min(MIN_LEVEL).max(MAX_LEVEL).default(11),
  currentArena: z.number().int().min(1).max(24).default(1),

  // --- wallet --------------------------------------------------------------
  wallet: walletSchema.default({}),

  // --- collection ----------------------------------------------------------
  collection: z.array(collectionEntrySchema).default([]),

  // --- active deck ---------------------------------------------------------
  deck: z.array(z.string()).length(9).default([...STARTER_DECK]),

  // --- record --------------------------------------------------------------
  wins: z.number().int().min(0).default(0),
  losses: z.number().int().min(0).default(0),
  battleLog: z.array(battleLogEntrySchema).max(MAX_BATTLE_LOG).default([]),
});

export type BattleLogEntry = z.infer<typeof battleLogEntrySchema>;

export type Wallet = z.infer<typeof walletSchema>;
export type CollectionEntry = z.infer<typeof collectionEntrySchema>;
export type PlayerProfile = z.infer<typeof playerProfileSchema>;

/** An unlocked evolution requires the full shard investment. */
export function hasEvolutionUnlocked(entry: CollectionEntry | undefined): boolean {
  return (entry?.evolutionShardsInvested ?? 0) >= MAX_EVOLUTION_SHARDS;
}

export function cardLevelMap(profile: PlayerProfile): Record<string, number> {
  const levels: Record<string, number> = {};
  for (const entry of profile.collection) levels[entry.cardId] = entry.level;
  return levels;
}

export function collectionEntry(
  profile: PlayerProfile,
  cardId: string,
): CollectionEntry | undefined {
  return profile.collection.find((entry) => entry.cardId === cardId);
}

/** Arena unlocked by a trophy count. Thresholds widen as they climb. */
export function arenaForTrophies(trophies: number): number {
  const arena = Math.floor(trophies / 400) + 1;
  return Math.min(24, Math.max(1, arena));
}
