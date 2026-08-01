import { describe, it, expect } from 'vitest';
import { BUILTIN_CARDS, STARTER_DECK, BOT_DECK } from '@cards/data';
import { allCards, getCard, registerCardFromJson, clearRuntimeCards, isRuntimeCard } from '@cards/registry';
import { validateCard, makeCardId, emptyCardDraft } from '@cards/schema';
import { statAtLevel, healthAtLevel, derivedStats, BASELINE_LEVEL } from '@cards/scaling';

describe('card roster', () => {
  it('registers every built-in card', () => {
    expect(BUILTIN_CARDS.length).toBeGreaterThanOrEqual(20);
    expect(allCards().length).toBe(BUILTIN_CARDS.length);
  });

  it('gives every card a generated id matching its name and category', () => {
    for (const card of BUILTIN_CARDS) {
      expect(card.id).toBe(makeCardId(card.category, card.name));
    }
  });

  it('returns cards in a stable id-sorted order', () => {
    const first = allCards().map((c) => c.id);
    const second = allCards().map((c) => c.id);
    expect(first).toEqual(second);
    expect([...first].sort()).toEqual(first);
  });

  it('resolves both starter decks', () => {
    for (const deck of [STARTER_DECK, BOT_DECK]) {
      expect(deck).toHaveLength(9);
      for (const id of deck) expect(() => getCard(id)).not.toThrow();
      expect(getCard(deck[8]).category).toBe('TowerTroop');
      expect(getCard(deck[1]).isHero).toBe(true);
      expect(getCard(deck[0]).hasEvolution).toBe(true);
    }
  });
});

describe('card validation', () => {
  it('rejects a single-target card that also declares splash', () => {
    const result = validateCard({
      ...emptyCardDraft(),
      damageType: 'Single',
      splashRadius: 2,
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === 'splashRadius')).toBe(true);
  });

  it('rejects a splash card with no radius', () => {
    const result = validateCard({ ...emptyCardDraft(), damageType: 'AreaSplash', splashRadius: 0 });
    expect(result.ok).toBe(false);
  });

  it('rejects a building with no decay lifetime', () => {
    const draft = emptyCardDraft();
    const result = validateCard({
      ...draft,
      category: 'Building',
      id: makeCardId('Building', draft.name),
      lifetimeSeconds: 0,
    });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === 'lifetimeSeconds')).toBe(true);
  });

  it('rejects a hero that is not Champion rarity', () => {
    const result = validateCard({ ...emptyCardDraft(), isHero: true, rarity: 'Epic' });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === 'rarity')).toBe(true);
  });

  it('rejects a mismatched id', () => {
    const result = validateCard({ ...emptyCardDraft(), id: 'card_troop_wrong' });
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.path === 'id')).toBe(true);
  });

  it('accepts a valid draft and reports no issues', () => {
    const result = validateCard(emptyCardDraft());
    expect(result.issues).toEqual([]);
    expect(result.ok).toBe(true);
  });
});

describe('runtime cards from the Card Maker', () => {
  it('round-trips a card through JSON and can be cleared again', () => {
    const draft = { ...emptyCardDraft(), name: 'Test Golem', id: makeCardId('Troop', 'Test Golem') };
    const json = JSON.parse(JSON.stringify(draft));

    const result = registerCardFromJson(json, { runtime: true });
    expect(result.ok).toBe(true);
    expect(isRuntimeCard('card_troop_test_golem')).toBe(true);
    expect(getCard('card_troop_test_golem').name).toBe('Test Golem');

    clearRuntimeCards();
    expect(allCards().some((c) => c.id === 'card_troop_test_golem')).toBe(false);
    expect(allCards().length).toBe(BUILTIN_CARDS.length);
  });
});

describe('level scaling', () => {
  it('returns the authored value at the baseline level', () => {
    expect(statAtLevel(1000, BASELINE_LEVEL)).toBe(1000);
  });

  it('scales up and down monotonically across levels 1..16', () => {
    let previous = 0;
    for (let level = 1; level <= 16; level++) {
      const value = statAtLevel(1000, level);
      expect(value).toBeGreaterThan(previous);
      previous = value;
    }
    expect(statAtLevel(1000, 12)).toBe(1100);
    expect(statAtLevel(1000, 16)).toBeGreaterThan(1600);
    expect(statAtLevel(1000, 1)).toBeLessThan(400);
  });

  it('is deterministic across repeated calls', () => {
    const a = Array.from({ length: 16 }, (_, i) => statAtLevel(1766, i + 1, 1.1));
    const b = Array.from({ length: 16 }, (_, i) => statAtLevel(1766, i + 1, 1.1));
    expect(a).toEqual(b);
  });

  it('clamps out-of-range levels', () => {
    expect(statAtLevel(500, 0)).toBe(statAtLevel(500, 1));
    expect(statAtLevel(500, 99)).toBe(statAtLevel(500, 16));
  });

  it('derives per-level health for every card without throwing', () => {
    for (const card of BUILTIN_CARDS) {
      const stats = derivedStats(card);
      expect(stats.healthPerLevel).toHaveLength(16);
      expect(healthAtLevel(card, BASELINE_LEVEL)).toBe(card.baseHealth);
      expect(stats.tilesPerSecond).toBeGreaterThan(0);
    }
  });
});
