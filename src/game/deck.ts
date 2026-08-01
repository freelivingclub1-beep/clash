/**
 * Deck construction rules (spec §3).
 *
 * Nine slots, each with a role:
 *   0 Evolution   — must hold a card that has an evolution
 *   1 Hero        — must hold a Champion
 *   2 Wild        — either a second evolution or a second Champion
 *   3-7 Standard  — any ordinary troop, building or spell
 *   8 Tower Troop — the defender mounted on both princess towers
 *
 * Slots 0-7 form the eight-card battle cycle; slot 8 never enters it.
 */

import { type CardDefinition } from '@cards/schema';
import { tryGetCard } from '@cards/registry';
import { DECK_SLOTS, FULL_DECK_SIZE, BATTLE_DECK_SIZE } from '@sim/state';

export type SlotRole = 'evolution' | 'hero' | 'wild' | 'standard' | 'towerTroop';

export interface DeckSlot {
  index: number;
  role: SlotRole;
  label: string;
  /** What the slot will accept, for the deck builder's filtering. */
  accepts: (card: CardDefinition) => boolean;
}

const isBattleCard = (card: CardDefinition): boolean =>
  card.selectable && card.category !== 'TowerTroop';

export const DECK_LAYOUT: readonly DeckSlot[] = [
  {
    index: 0,
    role: 'evolution',
    label: 'Evolution',
    accepts: (card) => isBattleCard(card) && card.hasEvolution,
  },
  {
    index: 1,
    role: 'hero',
    label: 'Hero',
    accepts: (card) => isBattleCard(card) && card.isHero,
  },
  {
    index: 2,
    role: 'wild',
    label: 'Wild',
    accepts: (card) => isBattleCard(card) && (card.hasEvolution || card.isHero),
  },
  { index: 3, role: 'standard', label: 'Card 4', accepts: isBattleCard },
  { index: 4, role: 'standard', label: 'Card 5', accepts: isBattleCard },
  { index: 5, role: 'standard', label: 'Card 6', accepts: isBattleCard },
  { index: 6, role: 'standard', label: 'Card 7', accepts: isBattleCard },
  { index: 7, role: 'standard', label: 'Card 8', accepts: isBattleCard },
  {
    index: 8,
    role: 'towerTroop',
    label: 'Tower Troop',
    accepts: (card) => card.selectable && card.category === 'TowerTroop',
  },
];

export interface DeckIssue {
  slot: number;
  message: string;
}

export interface DeckValidation {
  ok: boolean;
  issues: DeckIssue[];
  /** Average aether across the eight battle cards, to one decimal. */
  averageAether: number;
}

export function validateDeck(deck: readonly string[]): DeckValidation {
  const issues: DeckIssue[] = [];

  if (deck.length !== FULL_DECK_SIZE) {
    issues.push({ slot: -1, message: `A deck holds exactly ${FULL_DECK_SIZE} cards.` });
    return { ok: false, issues, averageAether: 0 };
  }

  const seen = new Map<string, number>();
  let aetherTotal = 0;
  let battleCardCount = 0;

  for (const slot of DECK_LAYOUT) {
    const cardId = deck[slot.index];
    const card = cardId ? tryGetCard(cardId) : undefined;

    if (!card) {
      issues.push({ slot: slot.index, message: `${slot.label}: empty or unknown card.` });
      continue;
    }
    if (!slot.accepts(card)) {
      issues.push({
        slot: slot.index,
        message: `${slot.label}: ${card.name} cannot go in this slot.`,
      });
    }

    const previous = seen.get(cardId);
    if (previous !== undefined) {
      issues.push({
        slot: slot.index,
        message: `${card.name} is already in slot ${previous + 1}.`,
      });
    }
    seen.set(cardId, slot.index);

    if (slot.index < BATTLE_DECK_SIZE) {
      aetherTotal += card.aetherCost;
      battleCardCount++;
      // Champions are confined to the hero and wild slots.
      if (card.isHero && slot.role !== 'hero' && slot.role !== 'wild') {
        issues.push({
          slot: slot.index,
          message: `${card.name} is a Champion and belongs in the Hero or Wild slot.`,
        });
      }
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    averageAether: battleCardCount > 0 ? Math.round((aetherTotal / battleCardCount) * 10) / 10 : 0,
  };
}

/** Which battle-cycle cards in a deck are actually able to evolve. */
export function evolutionCardsIn(deck: readonly string[]): string[] {
  const result: string[] = [];
  for (const index of [DECK_SLOTS.EVOLUTION, DECK_SLOTS.WILD]) {
    const card = tryGetCard(deck[index] ?? '');
    if (card?.hasEvolution) result.push(card.id);
  }
  return result;
}

export function heroCardIn(deck: readonly string[]): string | undefined {
  for (const index of [DECK_SLOTS.HERO, DECK_SLOTS.WILD]) {
    const card = tryGetCard(deck[index] ?? '');
    if (card?.isHero) return card.id;
  }
  return undefined;
}

export function towerTroopIn(deck: readonly string[]): string | undefined {
  return tryGetCard(deck[DECK_SLOTS.TOWER_TROOP] ?? '')?.id;
}

export { DECK_SLOTS };
