/**
 * The face of a card, wherever a card is shown.
 *
 * One component for the battle hand, the deck builder, the collection and the
 * Card Maker preview, because a card that looks like one thing in your deck
 * and another thing in your hand is a card you have to learn twice.
 *
 * The face is the unit's own figure over its tint, with the name underneath.
 * Before this, card faces were a flat colour and a name — nothing anywhere in
 * the game told you what a card actually puts on the board until you played
 * it.
 */

import { forwardRef, type CSSProperties } from 'react';
import { type CardDefinition } from '@cards/schema';
import { atlasPortrait, portraitDataUrl, type AtlasPortrait } from '@render/sprites';

/** One atlas cell as a background, cropped by CSS rather than by a canvas. */
function atlasStyle(atlas: AtlasPortrait): CSSProperties {
  return {
    backgroundImage: `url(${atlas.url})`,
    backgroundSize: atlas.size,
    backgroundPosition: atlas.position,
  };
}

export interface CardFaceProps {
  card: CardDefinition;
  /** Suppresses the name strip where the surrounding UI already shows it. */
  showName?: boolean;
}

export function CardFace({ card, showName = true }: CardFaceProps) {
  /*
   * Spells get a blast glyph, not a figure.
   *
   * The model registry will happily hand a spell a fallback humanoid, and it
   * looked exactly as wrong as it sounds — Fireball and Zap sat in the hand as
   * two little swordsmen. A spell has no body on the board, so its face should
   * not claim one.
   */
  const isSpell = card.category === 'Spell';
  const atlas = isSpell ? null : atlasPortrait(card);
  const portrait = isSpell || atlas ? '' : portraitDataUrl(card);

  return (
    <div className={`card-face${isSpell ? ' spell' : ''}`} style={{ background: card.tint }}>
      {isSpell && <span className="spell-glyph" />}
      {atlas && <span className="card-portrait atlas" style={atlasStyle(atlas)} />}
      {/* Empty when no canvas was available to rasterise with; the tint and
          name still carry the card, exactly as they did before. */}
      {portrait && <img className="card-portrait" src={portrait} alt="" draggable={false} />}
      {showName && <span className="card-name">{card.name}</span>}
    </div>
  );
}

/**
 * The small round portrait that rides under the pointer during a drag.
 *
 * Deliberately not a card: a full card-shaped panel was tried and covered the
 * part of the board you were trying to read. This is just the figure, so you
 * can see what is about to land while the translucent troops on the field show
 * you where.
 */
/**
 * The figure that follows your finger while you drag a card out.
 *
 * Deliberately takes a ref rather than x/y props. Position changes at pointer
 * rate — up to 120Hz on a modern touchscreen — and routing that through React
 * state re-renders the whole battle tree on every pointermove, during the one
 * interaction where smoothness is most visible. The owner moves this element
 * directly with a transform instead, which stays on the compositor.
 */
export const DragPortrait = forwardRef<HTMLDivElement, { card: CardDefinition }>(
  function DragPortrait({ card }, ref) {
    const isSpell = card.category === 'Spell';
    const atlas = isSpell ? null : atlasPortrait(card);
    const portrait = isSpell || atlas ? '' : portraitDataUrl(card);
    return (
      <div
        ref={ref}
        className={`drag-portrait${isSpell ? ' spell' : ''}`}
        style={{ background: card.tint }}
      >
        {isSpell && <span className="spell-glyph" />}
        {atlas && <span className="card-portrait atlas" style={atlasStyle(atlas)} />}
        {portrait && <img src={portrait} alt="" draggable={false} />}
        <span className="drag-portrait-cost">{card.aetherCost}</span>
      </div>
    );
  },
);
