/**
 * The canonical card definition.
 *
 * This one Zod schema is the only description of a card in the project. The
 * simulation reads it, the Card Maker Studio renders a form from it, the JSON
 * import/export round-trips through it, and the TypeScript types are inferred
 * from it. There is deliberately no hand-written duplicate type to drift.
 *
 * Section letters below map 1:1 onto the Card Maker sections in the spec (§4).
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export const RARITIES = ['Common', 'Rare', 'Epic', 'Legendary', 'Champion'] as const;
export const CARD_CATEGORIES = ['Troop', 'Building', 'Spell', 'TowerTroop'] as const;
export const SPEED_CLASSES = ['VerySlow', 'Slow', 'Medium', 'Fast', 'VeryFast'] as const;
export const TARGET_PRIORITIES = ['Ground', 'AirAndGround', 'Buildings', 'AirOnly'] as const;
export const DAMAGE_TYPES = ['Single', 'AreaSplash', 'ConeSplash', 'PiercingLine'] as const;
export const STATUS_EFFECTS = [
  'None',
  'Freeze',
  'Slow',
  'Stun',
  'Knockback',
  'Poison',
  'ElectroReset',
  'Heal',
  'Rage',
] as const;
export const DEATH_EFFECTS = ['None', 'SpawnDeathUnit', 'DeathBomb', 'DeathSpell'] as const;
export const ABILITY_HOOKS = [
  'ChargeDash',
  'AreaTaunt',
  'ThrowUnit',
  'SpawnMinions',
  'Invisibility',
  'HeavySlam',
] as const;
export const ABILITY_TARGET_FILTERS = ['Self', 'NearestEnemy', 'BroadArea', 'HighestHpUnit'] as const;

export type Rarity = (typeof RARITIES)[number];
export type CardCategory = (typeof CARD_CATEGORIES)[number];
export type SpeedClass = (typeof SPEED_CLASSES)[number];
export type TargetPriority = (typeof TARGET_PRIORITIES)[number];
export type DamageType = (typeof DAMAGE_TYPES)[number];
export type StatusEffectKind = (typeof STATUS_EFFECTS)[number];
export type DeathEffectKind = (typeof DEATH_EFFECTS)[number];
export type AbilityHook = (typeof ABILITY_HOOKS)[number];
export type AbilityTargetFilter = (typeof ABILITY_TARGET_FILTERS)[number];

/**
 * Spec §4C movement classes, in tiles per minute. This lives beside the card
 * schema rather than in the sim so that the dependency only ever points one
 * way: sim -> cards, never back.
 */
export const SPEED_TILES_PER_MIN: Record<SpeedClass, number> = {
  VerySlow: 45,
  Slow: 60,
  Medium: 90,
  Fast: 120,
  VeryFast: 150,
};

/** Card ids are derived, never typed by hand: `card_<category>_<slug>`. */
export function makeCardId(category: CardCategory, name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `card_${category.toLowerCase()}_${slug}`;
}

// ---------------------------------------------------------------------------
// Section schemas
// ---------------------------------------------------------------------------

/** A — identification & metadata. */
const identitySchema = z.object({
  name: z.string().min(1).max(32),
  id: z.string().regex(/^card_[a-z]+_[a-z0-9_]+$/),
  rarity: z.enum(RARITIES),
  category: z.enum(CARD_CATEGORIES),
  aetherCost: z.number().int().min(1).max(10),
  unlockArena: z.number().int().min(1).max(24),
  description: z.string().max(400).default(''),
  /**
   * False for cards that exist only as engine fixtures — the King Tower's
   * stat block, for instance — so they resolve by id like anything else but
   * never appear in the deck builder or collection.
   */
  selectable: z.boolean().default(true),
});

/** B — asset & render configuration. */
const assetsSchema = z.object({
  spriteKey: z.string().default(''),
  spawnSoundKey: z.string().default(''),
  attackSoundKey: z.string().default(''),
  deployVfxId: z.string().default(''),
  /** Placeholder art tint until real sprite sheets are wired in. */
  tint: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#c8d4e2'),
});

/** C — entity attributes & health. */
const entitySchema = z.object({
  /** Health at level 11, the balance baseline for every card. */
  baseHealth: z.number().int().min(0).max(100000),
  scalingMultiplier: z.number().min(1).max(1.5).default(1.1),
  shieldHealth: z.number().int().min(0).max(20000).default(0),
  spawnCount: z.number().int().min(1).max(20).default(1),
  massWeight: z.number().int().min(1).max(100).default(20),
  speedClass: z.enum(SPEED_CLASSES).default('Medium'),
  /** Flying units ignore the river mask and all ground collision. */
  isFlying: z.boolean().default(false),
  /** Buildings only: ticks of life before self-destruction. */
  lifetimeSeconds: z.number().min(0).max(120).default(0),
  /** Body radius in tiles, drives separation and collision push-out. */
  bodyRadius: z.number().min(0.1).max(3).default(0.4),
});

/** D — offensive & combat mechanics. */
const combatSchema = z.object({
  targetPriority: z.enum(TARGET_PRIORITIES).default('Ground'),
  attackRange: z.number().min(0).max(11.5).default(0.8),
  sightRange: z.number().min(0).max(14).default(5.5),
  hitSpeed: z.number().min(0.1).max(10).default(1.2),
  damage: z.number().int().min(0).max(10000).default(0),
  damageType: z.enum(DAMAGE_TYPES).default('Single'),
  /**
   * Spec §4D caps splash at 3.0 tiles, but that bound describes a troop's
   * attack splash. A spell's area of effect is a different quantity — Arrows
   * covers 4 tiles by design — so the field allows up to 6 and the 3.0 ceiling
   * is re-imposed on non-spell cards in `superRefine` below.
   */
  splashRadius: z.number().min(0).max(6).default(0),
  firstAttackDelay: z.number().min(0).max(5).default(0.2),
  /** Ranged attacks spawn a travelling projectile; melee applies instantly. */
  usesProjectile: z.boolean().default(false),
});

/** E — special ability & effect hooks. */
const effectsSchema = z.object({
  onHitStatus: z.enum(STATUS_EFFECTS).default('None'),
  statusDuration: z.number().min(0).max(20).default(0),
  /** Fraction of normal speed while slowed; ignored for other statuses. */
  statusMagnitude: z.number().min(0).max(5).default(0.5),
  deathEffect: z.enum(DEATH_EFFECTS).default('None'),
  /** Spawned unit id for SpawnDeathUnit, or a radius for DeathBomb. */
  deathEffectParam: z.string().default(''),
  deathEffectDamage: z.number().int().min(0).max(5000).default(0),
  deathEffectCount: z.number().int().min(0).max(20).default(0),
  /**
   * A named always-on mechanic — reflect, parry, chain, aura and so on.
   * Each one carries an EPP price in `@cards/balance`, deducted from the stat
   * budget before health and damage are set, so a passive is never free.
   */
  passiveId: z.string().default('none'),
  /**
   * Tuning knob whose meaning is passive-specific. It may be a fraction (0.3
   * for a 30% reflect), a count (4 death-split copies) or a flat rate (60
   * health healed per second), so the range is deliberately wide.
   */
  passiveMagnitude: z.number().min(0).max(2000).default(0),
});

/** F — evolution engine (2026). */
const evolutionSchema = z.object({
  hasEvolution: z.boolean().default(false),
  evoCycleRequirement: z.number().int().min(1).max(3).default(2),
  evoHealthMultiplier: z.number().min(1).max(3).default(1.15),
  evoDamageMultiplier: z.number().min(1).max(3).default(1.1),
  /** Key into the evolution script registry; '' means stats-only evolution. */
  evoBehaviorScriptId: z.string().default(''),
});

/** G — hero / champion active ability. */
const heroSchema = z.object({
  isHero: z.boolean().default(false),
  abilityAetherCost: z.number().int().min(1).max(4).default(2),
  abilityCooldown: z.number().min(1).max(60).default(15),
  abilityActionHook: z.enum(ABILITY_HOOKS).default('ChargeDash'),
  abilityTargetFilter: z.enum(ABILITY_TARGET_FILTERS).default('Self'),
  abilityDamage: z.number().int().min(0).max(5000).default(0),
  abilityRadius: z.number().min(0).max(8).default(0),
  abilityDurationSeconds: z.number().min(0).max(20).default(0),
});

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

export const cardDefinitionSchema = identitySchema
  .merge(assetsSchema)
  .merge(entitySchema)
  .merge(combatSchema)
  .merge(effectsSchema)
  .merge(evolutionSchema)
  .merge(heroSchema)
  .superRefine((card, ctx) => {
    const fail = (path: string, message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

    if (card.id !== makeCardId(card.category, card.name)) {
      fail('id', `id must be the generated value "${makeCardId(card.category, card.name)}"`);
    }
    if (card.isHero && card.rarity !== 'Champion') {
      fail('rarity', 'Hero / Champion cards must have Champion rarity.');
    }
    if (card.category === 'Spell') {
      if (card.splashRadius <= 0 && card.onHitStatus === 'None') {
        fail('splashRadius', 'A spell needs either a splash radius or a status effect.');
      }
    } else if (card.baseHealth <= 0) {
      fail('baseHealth', 'Non-spell cards need positive base health.');
    }
    if (
      (card.damageType === 'AreaSplash' || card.damageType === 'ConeSplash') &&
      card.splashRadius <= 0
    ) {
      fail('splashRadius', 'Splash damage types require a splash radius above 0.');
    }
    if (card.category !== 'Spell' && card.splashRadius > 3) {
      fail('splashRadius', 'Troop and building splash is capped at 3.0 tiles (spec §4D).');
    }
    if (card.damageType === 'Single' && card.splashRadius > 0) {
      fail('splashRadius', 'Single-target damage must not define a splash radius.');
    }
    if (card.onHitStatus !== 'None' && card.statusDuration <= 0) {
      fail('statusDuration', 'A status effect needs a duration above 0.');
    }
    if (card.category === 'Building' && card.lifetimeSeconds <= 0) {
      fail('lifetimeSeconds', 'Buildings decay — set a lifetime above 0.');
    }
    if (card.deathEffect === 'SpawnDeathUnit' && card.deathEffectCount <= 0) {
      fail('deathEffectCount', 'SpawnDeathUnit needs a spawn count above 0.');
    }
    if (card.deathEffect === 'DeathBomb' && card.deathEffectDamage <= 0) {
      fail('deathEffectDamage', 'DeathBomb needs damage above 0.');
    }
    if (card.isFlying && card.category === 'Building') {
      fail('isFlying', 'Buildings cannot fly.');
    }
    if (card.passiveId !== 'none' && card.passiveMagnitude <= 0) {
      fail('passiveMagnitude', 'A passive needs a magnitude above 0.');
    }
  });

export type CardDefinition = z.infer<typeof cardDefinitionSchema>;

/** The un-refined object shape, used by the Card Maker to build empty drafts. */
export const cardDraftSchema = identitySchema
  .merge(assetsSchema)
  .merge(entitySchema)
  .merge(combatSchema)
  .merge(effectsSchema)
  .merge(evolutionSchema)
  .merge(heroSchema);

export type CardDraft = z.infer<typeof cardDraftSchema>;

export interface CardValidationIssue {
  path: string;
  message: string;
}

export interface CardValidationResult {
  ok: boolean;
  card?: CardDefinition;
  issues: CardValidationIssue[];
}

/** Validate a loose object into a card, collecting every issue rather than throwing. */
export function validateCard(input: unknown): CardValidationResult {
  const result = cardDefinitionSchema.safeParse(input);
  if (result.success) return { ok: true, card: result.data, issues: [] };
  return {
    ok: false,
    issues: result.error.issues.map((i) => ({
      path: i.path.join('.') || '(card)',
      message: i.message,
    })),
  };
}

/** Throwing variant, for the built-in roster where a failure is a build error. */
export function defineCard(input: unknown): CardDefinition {
  const result = validateCard(input);
  if (!result.ok || !result.card) {
    const detail = result.issues.map((i) => `  ${i.path}: ${i.message}`).join('\n');
    throw new Error(`Invalid card definition:\n${detail}`);
  }
  return result.card;
}

/** A blank draft with every default filled in — the Card Maker's starting state. */
export function emptyCardDraft(): CardDraft {
  return cardDraftSchema.parse({
    name: 'New Card',
    id: makeCardId('Troop', 'New Card'),
    rarity: 'Common',
    category: 'Troop',
    aetherCost: 3,
    unlockArena: 1,
    baseHealth: 600,
    damage: 100,
  });
}
