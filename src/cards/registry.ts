/**
 * The card registry.
 *
 * Holds the built-in roster plus anything authored at runtime in the Card Maker
 * Studio, so a freshly designed card is immediately playable in a test match
 * without a rebuild.
 *
 * `allCards()` always returns id-sorted results: card order feeds deck
 * construction and deck construction feeds the seeded shuffle, so an unstable
 * iteration order here would desynchronise the whole match.
 */

import { type CardDefinition, type CardCategory, validateCard } from './schema';

const registry = new Map<string, CardDefinition>();
/** Ids that came from the Card Maker rather than the built-in roster. */
const runtimeIds = new Set<string>();

export function registerCard(card: CardDefinition, opts: { runtime?: boolean } = {}): CardDefinition {
  registry.set(card.id, card);
  if (opts.runtime) runtimeIds.add(card.id);
  else runtimeIds.delete(card.id);
  return card;
}

/** Validate then register. Used by the Card Maker and by JSON import. */
export function registerCardFromJson(input: unknown, opts: { runtime?: boolean } = {}) {
  const result = validateCard(input);
  if (result.ok && result.card) registerCard(result.card, opts);
  return result;
}

export function tryGetCard(id: string): CardDefinition | undefined {
  return registry.get(id);
}

export function getCard(id: string): CardDefinition {
  const card = registry.get(id);
  if (!card) throw new Error(`Unknown card id: ${id}`);
  return card;
}

export function hasCard(id: string): boolean {
  return registry.has(id);
}

export function isRuntimeCard(id: string): boolean {
  return runtimeIds.has(id);
}

export function allCards(): CardDefinition[] {
  return [...registry.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export function cardsByCategory(category: CardCategory): CardDefinition[] {
  return allCards().filter((c) => c.category === category);
}

/** Everything a player can actually put in a deck or collection. */
export function selectableCards(): CardDefinition[] {
  return allCards().filter((c) => c.selectable);
}

/** Cards eligible for battle deck slots 1-8 (everything but tower troops). */
export function battleCards(): CardDefinition[] {
  return selectableCards().filter((c) => c.category !== 'TowerTroop');
}

export function towerTroopCards(): CardDefinition[] {
  return selectableCards().filter((c) => c.category === 'TowerTroop');
}

export function evolutionCards(): CardDefinition[] {
  return selectableCards().filter((c) => c.hasEvolution);
}

export function heroCards(): CardDefinition[] {
  return selectableCards().filter((c) => c.isHero);
}

/** Test-only: drop runtime cards and restore the built-in roster exactly. */
export function clearRuntimeCards(): void {
  for (const id of runtimeIds) registry.delete(id);
  runtimeIds.clear();
}
