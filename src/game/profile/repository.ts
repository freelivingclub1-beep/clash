/**
 * Profile persistence.
 *
 * `ProfileRepository` is the seam a Postgres or Mongo implementation slots
 * into. Everything above this interface — the deck builder, the collection
 * screen, matchmaking — is written against it, not against localStorage.
 *
 * The interface is async even though the local implementation resolves
 * immediately, because a server-backed one will not, and retrofitting async
 * through the call sites later would touch every screen.
 */

import { selectableCards } from '@cards/registry';
import { STARTER_DECK } from '@cards/data';
import {
  type PlayerProfile,
  type CollectionEntry,
  type BattleLogEntry,
  playerProfileSchema,
  arenaForTrophies,
  MAX_BATTLE_LOG,
  MAX_EVOLUTION_SHARDS,
} from './schema';

export interface ProfileRepository {
  load(): Promise<PlayerProfile>;
  save(profile: PlayerProfile): Promise<void>;
  reset(): Promise<PlayerProfile>;
}

const STORAGE_KEY = 'clash.profile.v1';

/**
 * A starting collection: every selectable card owned at level 11, the balance
 * baseline. A real game would gate this behind arena unlocks and chest drops;
 * for a vertical slice, an unrestricted collection is what makes the deck
 * builder and Card Maker worth using.
 */
export function createDefaultProfile(userId = 'local-player'): PlayerProfile {
  const collection: CollectionEntry[] = selectableCards().map((card) => ({
    cardId: card.id,
    level: 11,
    duplicates: 0,
    // Evolution-capable cards start with their evolution already unlocked so
    // the mechanic is reachable without grinding shards.
    evolutionShardsInvested: card.hasEvolution ? MAX_EVOLUTION_SHARDS : 0,
  }));

  return playerProfileSchema.parse({
    userId,
    name: 'Player',
    trophies: 4000,
    kingTowerLevel: 11,
    currentArena: arenaForTrophies(4000),
    collection,
    deck: [...STARTER_DECK],
  });
}

export class LocalStorageProfileRepository implements ProfileRepository {
  constructor(private readonly storage: Storage | undefined = globalThis.localStorage) {}

  async load(): Promise<PlayerProfile> {
    const raw = this.storage?.getItem(STORAGE_KEY);
    if (!raw) return this.reset();

    try {
      const parsed = playerProfileSchema.safeParse(JSON.parse(raw));
      // A stored profile from an older build is discarded rather than patched:
      // silently half-migrating a save is worse than starting clean.
      if (!parsed.success) return this.reset();
      return this.reconcile(parsed.data);
    } catch {
      return this.reset();
    }
  }

  async save(profile: PlayerProfile): Promise<void> {
    this.storage?.setItem(STORAGE_KEY, JSON.stringify(profile));
  }

  async reset(): Promise<PlayerProfile> {
    const profile = createDefaultProfile();
    await this.save(profile);
    return profile;
  }

  /**
   * Add collection entries for cards that did not exist when the profile was
   * saved — which happens every time a card is authored in the Card Maker.
   */
  private reconcile(profile: PlayerProfile): PlayerProfile {
    const known = new Set(profile.collection.map((entry) => entry.cardId));
    for (const card of selectableCards()) {
      if (known.has(card.id)) continue;
      profile.collection.push({
        cardId: card.id,
        level: 11,
        duplicates: 0,
        evolutionShardsInvested: card.hasEvolution ? MAX_EVOLUTION_SHARDS : 0,
      });
    }
    profile.currentArena = arenaForTrophies(profile.trophies);
    return profile;
  }
}

/** In-memory implementation for tests and for server-side rendering. */
export class InMemoryProfileRepository implements ProfileRepository {
  private profile: PlayerProfile = createDefaultProfile();

  async load(): Promise<PlayerProfile> {
    return this.profile;
  }

  async save(profile: PlayerProfile): Promise<void> {
    this.profile = profile;
  }

  async reset(): Promise<PlayerProfile> {
    this.profile = createDefaultProfile();
    return this.profile;
  }
}

/** Everything the post-match screen and the battle log need from a match. */
export interface MatchSummary {
  outcome: 'blue' | 'red' | 'draw';
  localTeam: 0 | 1;
  crownsFor: number;
  crownsAgainst: number;
  opponentName: string;
  durationSeconds: number;
  cardsPlayed: number;
  towerDamageDealt: number;
}

/**
 * Apply a match result to a profile: trophies, record, and the battle log.
 *
 * A draw still gets logged. It moves no trophies, but a history that silently
 * omits draws makes the win/loss counts look wrong next to it.
 */
export function applyMatchResult(
  profile: PlayerProfile,
  outcome: 'blue' | 'red' | 'draw',
  localTeam: 0 | 1,
  summary?: Partial<MatchSummary>,
): PlayerProfile {
  const localWon = (outcome === 'blue' && localTeam === 0) || (outcome === 'red' && localTeam === 1);
  const delta = outcome === 'draw' ? 0 : localWon ? 30 : -29;

  if (outcome !== 'draw') {
    profile.trophies = Math.max(0, profile.trophies + delta);
    profile.currentArena = arenaForTrophies(profile.trophies);
    if (localWon) profile.wins++;
    else profile.losses++;
  }

  const entry: BattleLogEntry = {
    outcome: outcome === 'draw' ? 'draw' : localWon ? 'win' : 'loss',
    crownsFor: summary?.crownsFor ?? 0,
    crownsAgainst: summary?.crownsAgainst ?? 0,
    opponentName: summary?.opponentName ?? 'Opponent',
    trophyDelta: delta,
    durationSeconds: summary?.durationSeconds ?? 0,
    cardsPlayed: summary?.cardsPlayed ?? 0,
    towerDamageDealt: summary?.towerDamageDealt ?? 0,
  };
  // Newest first, oldest evicted — a fixed-size window, not a growing log.
  profile.battleLog = [entry, ...profile.battleLog].slice(0, MAX_BATTLE_LOG);

  return profile;
}
