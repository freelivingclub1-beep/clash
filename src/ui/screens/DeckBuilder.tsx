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
import { groupByRole, ROLE_BLURBS } from '@cards/roles';
import { CardFace } from '../CardFace';

export interface DeckBuilderProps {
  profile: PlayerProfile;
  /** Called on every change. There is no save step — edits persist as made. */
  onChange: (deck: string[]) => void;
  onDone: () => void;
  onBack: () => void;
}

export function DeckBuilder({ profile, onChange, onDone, onBack }: DeckBuilderProps) {
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
      // Persisted immediately: a deck half-edited when the app is closed
      // should come back exactly as it was left.
      onChange(next);
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
                onClick={() => setSelectedSlot(selectedSlot === slot.index ? null : slot.index)}
              >
                {card && <CardFace card={card} showName={false} />}
                <span className="role">{slot.label}</span>
                {card ? (
                  <span className="slot-caption">
                    <strong>{card.name}</strong>
                    <span>
                      {card.aetherCost} · lvl {entry?.level ?? 11}
                    </span>
                  </span>
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
            {/* Grouped by role rather than listed flat: seventy cards in one
                grid is a wall, and the choice a player is actually making is
                "which of my win conditions", not "which of my cards". */}
            {groupByRole(options).map((group) => (
              <div key={group.role} className="role-group">
                <div className="role-heading">
                  <strong>{group.role.replace(/([a-z])([A-Z])/g, '$1 $2')}</strong>
                  <span className="muted">{ROLE_BLURBS[group.role]}</span>
                </div>
                <div className="collection-grid">
                  {group.cards.map((card) => (
                    <div key={card.id} className="deck-slot filled" onClick={() => assign(card.id)}>
                      <CardFace card={card} showName={false} />
                      <span className="slot-caption">
                        <strong>{card.name}</strong>
                        <span>{card.aetherCost}</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </>
        )}

        <div className="row">
          <button className="button" onClick={onDone}>
            Done
          </button>
          <span className="muted">
            {validation.ok ? 'Deck saved automatically.' : 'Fix the issues above to battle.'}
          </span>
        </div>
      </div>
    </div>
  );
}
