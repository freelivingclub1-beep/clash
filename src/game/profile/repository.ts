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
import { migrateProfile } from './migrate';

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

  /** Set when the last load had to repair the stored document. */
  lastMigration: { migratedFrom: number | null; salvaged: boolean; lostFields: string[] } | null =
    null;

  async load(): Promise<PlayerProfile> {
    const raw = this.storage?.getItem(STORAGE_KEY);
    if (!raw) return this.reset();

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(raw);
    } catch {
      // Genuinely unreadable bytes are the only case that starts over.
      return this.reset();
    }

    // Migrate and salvage rather than discard. A save file is the only record
    // of a player's progression; throwing it away because a field was added
    // in a later build is not an acceptable failure mode.
    const result = migrateProfile(parsedJson, createDefaultProfile());
    this.lastMigration = {
      migratedFrom: result.migratedFrom,
      salvaged: result.salvaged,
      lostFields: result.lostFields,
    };

    const reconciled = this.reconcile(result.profile);
    // Write the upgraded document straight back, so the repair happens once
    // rather than on every load.
    if (result.migratedFrom !== null || result.salvaged) await this.save(reconciled);
    return reconciled;
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

/** Gold, gems and shards a result awards. Surfaced by the summary screen. */
export interface MatchRewards {
  gold: number;
  gems: number;
  evolutionShards: number;
}

export function rewardsFor(outcome: 'blue' | 'red' | 'draw', localTeam: 0 | 1, winsAfter: number): MatchRewards {
  const won = (outcome === 'blue' && localTeam === 0) || (outcome === 'red' && localTeam === 1);
  if (outcome === 'draw') return { gold: 12, gems: 0, evolutionShards: 0 };
  if (!won) return { gold: 10, gems: 0, evolutionShards: 0 };
  return { gold: 40, gems: winsAfter % 3 === 0 ? 1 : 0, evolutionShards: 1 };
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

  // Rewards. Without these the wallet never changes, so "your gems are saved"
  // would be technically true and practically meaningless.
  const goldReward = outcome === 'draw' ? 12 : localWon ? 40 : 10;
  profile.wallet.gold += goldReward;
  if (localWon) {
    profile.wallet.evolutionShards += 1;
    // A gem every third win, so the premium currency trickles rather than
    // inflating — it is the one balance that should feel slow.
    if (profile.wins % 3 === 0) profile.wallet.gems += 1;
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
