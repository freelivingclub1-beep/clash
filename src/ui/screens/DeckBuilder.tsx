/**
 * Deck builder.
 *
 * Slot roles come straight from `DECK_LAYOUT`, and each slot filters the
 * collection by its own `accepts` predicate — so the evolution slot only ever
 * offers evolution-capable cards and the tower troop slot only tower troops.
 * The player is guided into a legal deck rather than being told after the fact
 * that theirs is invalid.
 */

import { useMemo, useState } from 'react';
import { selectableCards, tryGetCard } from '@cards/registry';
import { DECK_LAYOUT, validateDeck } from '@game/deck';
import type { PlayerProfile } from '@game/profile/schema';
import { collectionEntry } from '@game/profile/schema';

export interface DeckBuilderProps {
  profile: PlayerProfile;
  onSave: (deck: string[]) => void;
  onBack: () => void;
}

export function DeckBuilder({ profile, onSave, onBack }: DeckBuilderProps) {
  const [deck, setDeck] = useState<string[]>([...profile.deck]);
  const [selectedSlot, setSelectedSlot] = useState<number | null>(null);

  const validation = useMemo(() => validateDeck(deck), [deck]);

  const options = useMemo(() => {
    if (selectedSlot === null) return [];
    const slot = DECK_LAYOUT[selectedSlot];
    return selectableCards().filter((card) => slot.accepts(card));
  }, [selectedSlot]);

  const assign = (cardId: string) => {
    if (selectedSlot === null) return;
    setDeck((previous) => {
      const next = [...previous];
      // If the card is already elsewhere in the deck, swap the two slots
      // rather than silently creating a duplicate the validator would reject.
      const existing = next.indexOf(cardId);
      if (existing !== -1 && existing !== selectedSlot) {
        next[existing] = next[selectedSlot];
      }
      next[selectedSlot] = cardId;
      return next;
    });
    setSelectedSlot(null);
  };

  return (
    <div className="stage">
      <div className="nav-bar">
        <button onClick={onBack}>← Back</button>
        <button className="active">Deck</button>
      </div>

      <div className="screen">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2>Battle Deck</h2>
          <span className="muted">Avg aether {validation.averageAether}</span>
        </div>

        <div className="deck-grid">
          {DECK_LAYOUT.map((slot) => {
            const card = tryGetCard(deck[slot.index] ?? '');
            const entry = card ? collectionEntry(profile, card.id) : undefined;
            return (
              <div
                key={slot.index}
                className={[
                  'deck-slot',
                  card ? 'filled' : '',
                  selectedSlot === slot.index ? 'selected' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                style={card ? { background: card.tint, color: '#10141c' } : undefined}
                onClick={() => setSelectedSlot(selectedSlot === slot.index ? null : slot.index)}
              >
                <span className="role">{slot.label}</span>
                {card ? (
                  <>
                    <strong>{card.name}</strong>
                    <span>
                      {card.aetherCost} · lvl {entry?.level ?? 11}
                    </span>
                  </>
                ) : (
                  <span className="muted">Empty</span>
                )}
              </div>
            );
          })}
        </div>

        {validation.issues.length > 0 && (
          <div className="panel">
            {validation.issues.map((issue) => (
              <div key={`${issue.slot}-${issue.message}`} className="error">
                {issue.message}
              </div>
            ))}
          </div>
        )}

        {selectedSlot !== null && (
          <>
            <h2>{DECK_LAYOUT[selectedSlot].label} — choose a card</h2>
            {options.length === 0 && (
              <div className="muted">
                No cards in your collection fit this slot. Author one in the Card Maker.
              </div>
            )}
            <div className="collection-grid">
              {options.map((card) => (
                <div
                  key={card.id}
                  className="deck-slot filled"
                  style={{ background: card.tint, color: '#10141c' }}
                  onClick={() => assign(card.id)}
                >
                  <strong>{card.name}</strong>
                  <span>{card.aetherCost}</span>
                </div>
              ))}
            </div>
          </>
        )}

        <div className="row">
          <button className="button" disabled={!validation.ok} onClick={() => onSave(deck)}>
            Save Deck
          </button>
          <button className="button secondary" onClick={() => setDeck([...profile.deck])}>
            Revert
          </button>
        </div>
      </div>
    </div>
  );
}
