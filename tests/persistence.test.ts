import { describe, it, expect, beforeEach, vi } from 'vitest';
import '@cards/data';
import {
  LocalStorageProfileRepository,
  InMemoryProfileRepository,
  createDefaultProfile,
  applyMatchResult,
  rewardsFor,
} from '@game/profile/repository';
import { ProfileStore } from '@game/profile/store';
import { migrateProfile } from '@game/profile/migrate';
import { playerProfileSchema, CURRENT_SCHEMA_VERSION } from '@game/profile/schema';
import { validateDeck } from '@game/deck';
import { STARTER_DECK } from '@cards/data';

/** Minimal in-memory Storage, so the localStorage path is exercised for real. */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return [...this.map.keys()][index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

const KEY = 'clash.profile.v1';

// ---------------------------------------------------------------------------

describe('migration', () => {
  it('carries a version-1 save forward instead of wiping it', () => {
    const legacy = {
      schemaVersion: 1,
      userId: 'veteran',
      name: 'Veteran',
      trophies: 6120,
      kingTowerLevel: 14,
      currentArena: 16,
      collection: [{ cardId: 'card_troop_knight', level: 14, duplicates: 30, evolutionShardsInvested: 6 }],
      deck: [...STARTER_DECK],
      wins: 210,
      losses: 190,
      // No wallet, no battleLog, no settings — those arrived in version 2.
    };

    const result = migrateProfile(legacy, createDefaultProfile());

    expect(result.salvaged).toBe(false);
    expect(result.migratedFrom).toBe(1);
    expect(result.profile.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    // The things a player would be furious to lose.
    expect(result.profile.trophies).toBe(6120);
    expect(result.profile.wins).toBe(210);
    expect(result.profile.kingTowerLevel).toBe(14);
    expect(result.profile.collection[0].level).toBe(14);
    // And the new fields exist with sane defaults.
    expect(result.profile.wallet.gold).toBeGreaterThanOrEqual(0);
    expect(result.profile.battleLog).toEqual([]);
    expect(result.profile.settings.soundEnabled).toBe(true);
  });

  it('salvages field by field when the document does not validate', () => {
    const corrupt = {
      schemaVersion: 2,
      userId: 'salvage-me',
      name: 'Survivor',
      trophies: 5000,
      kingTowerLevel: 13,
      wins: 77,
      losses: 12,
      wallet: { gold: 9999, gems: 42, eliteWildCards: 3, evolutionShards: 5, heroShards: 2 },
      // Deliberately broken: wrong type entirely.
      collection: 'not-an-array',
      deck: ['too', 'short'],
      battleLog: [{ outcome: 'nonsense' }],
    };

    const result = migrateProfile(corrupt, createDefaultProfile());

    expect(result.salvaged).toBe(true);
    // Scalars survive even though two arrays did not.
    expect(result.profile.trophies).toBe(5000);
    expect(result.profile.wins).toBe(77);
    expect(result.profile.wallet.gems).toBe(42);
    expect(result.profile.wallet.gold).toBe(9999);
    // The unrecoverable parts fall back and are reported rather than hidden.
    expect(result.lostFields).toContain('deck');
    expect(validateDeck(result.profile.deck).ok).toBe(true);
    expect(playerProfileSchema.safeParse(result.profile).success).toBe(true);
  });

  it('drops only the malformed rows of an array, not the whole array', () => {
    const partly = {
      schemaVersion: 2,
      userId: 'x',
      name: 'X',
      trophies: 100,
      deck: [...STARTER_DECK],
      collection: [
        { cardId: 'card_troop_knight', level: 12, duplicates: 0, evolutionShardsInvested: 0 },
        { cardId: 'card_troop_archers', level: 999, duplicates: 0, evolutionShardsInvested: 0 },
        { cardId: 'card_troop_giant', level: 11, duplicates: 5, evolutionShardsInvested: 0 },
      ],
    };

    const result = migrateProfile(partly, createDefaultProfile());
    expect(result.salvaged).toBe(true);
    // Two valid entries kept, the out-of-range one discarded.
    expect(result.profile.collection).toHaveLength(2);
    expect(result.profile.collection.map((e) => e.cardId)).toEqual([
      'card_troop_knight',
      'card_troop_giant',
    ]);
  });

  it('starts fresh only when the document is not an object at all', () => {
    const fresh = createDefaultProfile();
    for (const junk of [null, undefined, 42, 'string', []]) {
      const result = migrateProfile(junk, fresh);
      expect(result.salvaged).toBe(false);
      expect(result.profile.trophies).toBe(fresh.trophies);
    }
  });

  it('leaves an already-current profile untouched', () => {
    const current = createDefaultProfile();
    current.trophies = 4321;
    const result = migrateProfile(JSON.parse(JSON.stringify(current)), createDefaultProfile());
    expect(result.migratedFrom).toBeNull();
    expect(result.salvaged).toBe(false);
    expect(result.profile.trophies).toBe(4321);
  });
});

// ---------------------------------------------------------------------------

describe('repository durability', () => {
  let storage: MemoryStorage;
  let repository: LocalStorageProfileRepository;

  beforeEach(() => {
    storage = new MemoryStorage();
    repository = new LocalStorageProfileRepository(storage);
  });

  it('round-trips a full profile', async () => {
    const profile = await repository.load();
    profile.trophies = 5555;
    profile.wallet.gems = 17;
    await repository.save(profile);

    const reloaded = await new LocalStorageProfileRepository(storage).load();
    expect(reloaded.trophies).toBe(5555);
    expect(reloaded.wallet.gems).toBe(17);
  });

  it('recovers a version-1 save from storage and rewrites it upgraded', async () => {
    storage.setItem(
      KEY,
      JSON.stringify({
        schemaVersion: 1,
        userId: 'old',
        name: 'Old',
        trophies: 3300,
        kingTowerLevel: 12,
        currentArena: 9,
        collection: [],
        deck: [...STARTER_DECK],
        wins: 5,
        losses: 4,
      }),
    );

    const loaded = await repository.load();
    expect(loaded.trophies).toBe(3300);
    expect(repository.lastMigration?.migratedFrom).toBe(1);

    // The repair is written back, so the next load is a clean parse.
    const stored = JSON.parse(storage.getItem(KEY) as string);
    expect(stored.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('does not lose trophies to a truncated save file', async () => {
    storage.setItem(KEY, '{"schemaVersion":2,"userId":"a","name":"A","trophies":7200,"deck":[1,2]');
    // Unparseable JSON is the one unrecoverable case.
    const loaded = await repository.load();
    expect(loaded.trophies).toBe(createDefaultProfile().trophies);

    // But a *parseable* document with bad fields keeps the trophies.
    storage.setItem(KEY, '{"schemaVersion":2,"userId":"a","name":"A","trophies":7200,"deck":[1,2]}');
    const salvaged = await new LocalStorageProfileRepository(storage).load();
    expect(salvaged.trophies).toBe(7200);
  });
});

// ---------------------------------------------------------------------------

describe('autosaving store', () => {
  let repository: InMemoryProfileRepository;
  let store: ProfileStore;
  let saves: number;

  beforeEach(async () => {
    vi.useFakeTimers();
    repository = new InMemoryProfileRepository();
    saves = 0;
    const originalSave = repository.save.bind(repository);
    repository.save = async (profile) => {
      saves++;
      return originalSave(profile);
    };
    store = new ProfileStore(repository);
    await store.load();
  });

  it('persists a mutation without any explicit save call', async () => {
    store.update((draft) => void (draft.trophies = 6000));
    expect(store.hasUnsavedChanges).toBe(true);

    await vi.advanceTimersByTimeAsync(400);
    expect(store.hasUnsavedChanges).toBe(false);
    expect((await repository.load()).trophies).toBe(6000);
  });

  it('coalesces a burst of mutations into a single write', async () => {
    for (let i = 0; i < 25; i++) store.update((draft) => void (draft.wallet.gold = i));

    await vi.advanceTimersByTimeAsync(400);
    // One write for 25 edits, not 25 writes.
    expect(saves).toBe(1);
    expect((await repository.load()).wallet.gold).toBe(24);
  });

  it('flushes synchronously when asked, losing nothing in flight', async () => {
    store.update((draft) => void (draft.wallet.gems = 9));
    await store.flush();
    expect(store.hasUnsavedChanges).toBe(false);
    expect((await repository.load()).wallet.gems).toBe(9);
  });

  it('publishes a new object identity so subscribers re-render', () => {
    const seen: unknown[] = [];
    store.subscribe((profile) => seen.push(profile));
    const before = seen.length;
    store.update((draft) => void (draft.name = 'Renamed'));
    expect(seen.length).toBe(before + 1);
    expect(seen[seen.length - 1]).not.toBe(seen[before - 1]);
  });

  it('does not write when nothing changed', async () => {
    await vi.advanceTimersByTimeAsync(1000);
    const baseline = saves;
    await store.flush();
    expect(saves).toBe(baseline);
  });

  it('keeps a deck edit made moments before the app is closed', async () => {
    const swapped = [...STARTER_DECK];
    swapped[3] = 'card_troop_valkyrie';
    store.update((draft) => void (draft.deck = swapped));

    // No timers run — simulating the tab being killed immediately.
    await store.flush();

    const reloaded = await repository.load();
    expect(reloaded.deck[3]).toBe('card_troop_valkyrie');
  });
});

// ---------------------------------------------------------------------------

describe('progression rewards', () => {
  it('pays out gold on every result and gems only on wins', () => {
    expect(rewardsFor('blue', 0, 1).gold).toBe(40);
    expect(rewardsFor('red', 0, 1).gold).toBe(10);
    expect(rewardsFor('draw', 0, 1).gold).toBe(12);
    expect(rewardsFor('red', 0, 1).gems).toBe(0);
    expect(rewardsFor('blue', 0, 3).gems).toBe(1);
    expect(rewardsFor('blue', 0, 4).gems).toBe(0);
  });

  it('actually moves the wallet when a match is applied', () => {
    const profile = createDefaultProfile();
    const goldBefore = profile.wallet.gold;
    const shardsBefore = profile.wallet.evolutionShards;

    applyMatchResult(profile, 'blue', 0, { crownsFor: 3 });

    expect(profile.wallet.gold).toBeGreaterThan(goldBefore);
    expect(profile.wallet.evolutionShards).toBeGreaterThan(shardsBefore);
  });

  it('still pays something for a loss, so a session always progresses', () => {
    const profile = createDefaultProfile();
    const before = profile.wallet.gold;
    applyMatchResult(profile, 'red', 0, {});
    expect(profile.wallet.gold).toBeGreaterThan(before);
    expect(profile.trophies).toBeLessThan(createDefaultProfile().trophies);
  });

  it('accumulates across a run of matches', () => {
    const profile = createDefaultProfile();
    for (let i = 0; i < 9; i++) applyMatchResult(profile, 'blue', 0, {});
    expect(profile.wins).toBe(9);
    expect(profile.wallet.gems).toBeGreaterThanOrEqual(3);
    expect(profile.wallet.gold).toBeGreaterThanOrEqual(360);
  });
});
