/**
 * Profile migration and salvage.
 *
 * The previous behaviour was to discard any stored profile that failed to
 * parse and hand back a fresh one. For a save file that is the *only* record
 * of a player's progression, that is the worst possible failure mode: a single
 * added schema field would silently delete every trophy, card level and gem
 * anyone had earned.
 *
 * This module replaces that with two layers:
 *
 *   1. **Migration** — a stored profile declares its `schemaVersion`, and each
 *      step upgrades it to the next. Old saves are carried forward, not reset.
 *   2. **Salvage** — if the document still does not validate after migration
 *      (hand-edited, truncated by a full disk, corrupted by a crashed write),
 *      every field is recovered *individually* onto a fresh profile. A broken
 *      `collection` array costs the collection, not the trophies.
 *
 * Only the completely unrecoverable case — not an object at all — starts over.
 */

import {
  type PlayerProfile,
  playerProfileSchema,
  walletSchema,
  collectionEntrySchema,
  battleLogEntrySchema,
  settingsSchema,
  CURRENT_SCHEMA_VERSION,
} from './schema';

export interface MigrationResult {
  profile: PlayerProfile;
  /** Version the stored document declared, or null if there was none. */
  migratedFrom: number | null;
  /** True when at least one field had to be recovered rather than parsed. */
  salvaged: boolean;
  /** Field paths that could not be recovered and fell back to defaults. */
  lostFields: string[];
}

type Loose = Record<string, unknown>;

const isObject = (value: unknown): value is Loose =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

// ---------------------------------------------------------------------------
// Version steps
// ---------------------------------------------------------------------------

/**
 * Each entry upgrades a document *from* its index version to the next.
 *
 * Steps must be additive and tolerant: they run against documents written by
 * builds that no longer exist, so they can assume nothing beyond what the
 * previous version's schema guaranteed.
 */
const STEPS: Record<number, (doc: Loose) => Loose> = {
  // v1 -> v2: battle log, wallet and settings became first-class.
  1: (doc) => ({
    ...doc,
    battleLog: Array.isArray(doc.battleLog) ? doc.battleLog : [],
    wallet: isObject(doc.wallet) ? doc.wallet : {},
    settings: isObject(doc.settings) ? doc.settings : {},
    schemaVersion: 2,
  }),
};

function applySteps(doc: Loose, from: number): Loose {
  let current = doc;
  for (let version = from; version < CURRENT_SCHEMA_VERSION; version++) {
    const step = STEPS[version];
    if (!step) break;
    current = step(current);
  }
  return { ...current, schemaVersion: CURRENT_SCHEMA_VERSION };
}

// ---------------------------------------------------------------------------
// Salvage
// ---------------------------------------------------------------------------

/** Keep `value` if it satisfies `parse`, otherwise record the loss. */
function recover<T>(
  lost: string[],
  path: string,
  value: unknown,
  parse: (input: unknown) => { success: boolean; data?: T },
  fallback: T,
): T {
  if (value === undefined) return fallback;
  const result = parse(value);
  if (result.success && result.data !== undefined) return result.data;
  lost.push(path);
  return fallback;
}

const scalar =
  <T>(guard: (v: unknown) => boolean, coerce: (v: unknown) => T) =>
  (input: unknown) =>
    guard(input) ? { success: true, data: coerce(input) } : { success: false };

const asInt = scalar<number>(
  (v) => typeof v === 'number' && Number.isFinite(v),
  (v) => Math.round(v as number),
);
const asString = scalar<string>((v) => typeof v === 'string' && v.length > 0, (v) => v as string);

/**
 * Rebuild a profile field by field from a document that does not validate.
 *
 * Arrays are recovered element-wise rather than wholesale, so one malformed
 * collection entry or battle-log row does not cost the whole array.
 */
function salvageProfile(doc: Loose, base: PlayerProfile, lost: string[]): PlayerProfile {
  const collection = Array.isArray(doc.collection)
    ? doc.collection
        .map((entry) => collectionEntrySchema.safeParse(entry))
        .filter((r) => r.success)
        .map((r) => (r as { data: PlayerProfile['collection'][number] }).data)
    : [];
  if (Array.isArray(doc.collection) && collection.length !== doc.collection.length) {
    lost.push(`collection (${doc.collection.length - collection.length} entries)`);
  }

  const battleLog = Array.isArray(doc.battleLog)
    ? doc.battleLog
        .map((entry) => battleLogEntrySchema.safeParse(entry))
        .filter((r) => r.success)
        .map((r) => (r as { data: PlayerProfile['battleLog'][number] }).data)
    : [];

  const deckValid =
    Array.isArray(doc.deck) && doc.deck.length === 9 && doc.deck.every((id) => typeof id === 'string');
  if (Array.isArray(doc.deck) && !deckValid) lost.push('deck');

  return {
    ...base,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    userId: recover(lost, 'userId', doc.userId, asString, base.userId),
    name: recover(lost, 'name', doc.name, asString, base.name),
    trophies: Math.max(0, recover(lost, 'trophies', doc.trophies, asInt, base.trophies)),
    kingTowerLevel: Math.min(
      16,
      Math.max(1, recover(lost, 'kingTowerLevel', doc.kingTowerLevel, asInt, base.kingTowerLevel)),
    ),
    currentArena: Math.min(
      24,
      Math.max(1, recover(lost, 'currentArena', doc.currentArena, asInt, base.currentArena)),
    ),
    wins: Math.max(0, recover(lost, 'wins', doc.wins, asInt, base.wins)),
    losses: Math.max(0, recover(lost, 'losses', doc.losses, asInt, base.losses)),
    wallet: recover(
      lost,
      'wallet',
      doc.wallet,
      (v) => walletSchema.safeParse(v),
      base.wallet,
    ),
    settings: recover(
      lost,
      'settings',
      doc.settings,
      (v) => settingsSchema.safeParse(v),
      base.settings,
    ),
    collection: collection.length > 0 ? collection : base.collection,
    battleLog: battleLog.slice(0, 20),
    deck: deckValid ? (doc.deck as string[]) : base.deck,
  };
}

// ---------------------------------------------------------------------------

/**
 * Turn whatever was in storage into a usable profile, losing as little as
 * possible. `fresh` supplies defaults for anything unrecoverable.
 */
export function migrateProfile(raw: unknown, fresh: PlayerProfile): MigrationResult {
  if (!isObject(raw)) {
    return { profile: fresh, migratedFrom: null, salvaged: false, lostFields: [] };
  }

  const declared = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 1;
  const upgraded = applySteps(raw, declared);

  const parsed = playerProfileSchema.safeParse(upgraded);
  if (parsed.success) {
    return {
      profile: parsed.data,
      migratedFrom: declared === CURRENT_SCHEMA_VERSION ? null : declared,
      salvaged: false,
      lostFields: [],
    };
  }

  const lostFields: string[] = [];
  const salvaged = salvageProfile(upgraded, fresh, lostFields);
  // The salvaged document is built from validated pieces, so this parse is a
  // belt-and-braces check rather than an expected failure path.
  const revalidated = playerProfileSchema.safeParse(salvaged);

  return {
    profile: revalidated.success ? revalidated.data : fresh,
    migratedFrom: declared,
    salvaged: true,
    lostFields,
  };
}
