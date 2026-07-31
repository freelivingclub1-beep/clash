/**
 * Battle HUD components.
 *
 * These are plain DOM over the canvas rather than drawn into it: buttons,
 * drag targets and text are things browsers already do well, and keeping them
 * in React means the HUD does not have to be re-implemented for accessibility
 * or for larger text settings.
 */

import { type CardDefinition } from '@cards/schema';
import { tryGetCard } from '@cards/registry';
import { EP_PER_ELIXIR, MAX_ELIXIR_POINTS, TICK_HZ } from '@sim/constants';
import { REGULATION_END_TICK, MATCH_END_TICK } from '@sim/constants';

// ---------------------------------------------------------------------------
// Timer & crowns
// ---------------------------------------------------------------------------

function formatClock(seconds: number): string {
  const clamped = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(clamped / 60);
  return `${minutes}:${String(clamped % 60).padStart(2, '0')}`;
}

export function MatchTimer({ tick, phase }: { tick: number; phase: string }) {
  const overtime = phase === 'overtime';
  // Regulation counts down to 3:00; overtime counts down to the 5:00 cap.
  const remainingTicks = overtime ? MATCH_END_TICK - tick : REGULATION_END_TICK - tick;

  return (
    <div className={`timer${overtime ? ' overtime' : ''}`}>
      <span className="phase">{overtime ? 'Overtime' : 'Time Left'}</span>
      {formatClock(remainingTicks / TICK_HZ)}
    </div>
  );
}

export function CrownCounter({ crowns, side }: { crowns: number; side: 'blue' | 'red' }) {
  return (
    <div className="crowns" style={{ color: side === 'blue' ? 'var(--blue)' : 'var(--red)' }}>
      {[0, 1, 2].map((i) => (
        <span key={i} className={`crown-pip${i < crowns ? ' filled' : ''}`} />
      ))}
      <span>{crowns}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Elixir
// ---------------------------------------------------------------------------

export function ElixirBar({ points, multiplier }: { points: number; multiplier: number }) {
  const elixir = points / EP_PER_ELIXIR;
  return (
    <div className="elixir-row">
      <span className="elixir-value">{elixir.toFixed(1)}</span>
      <div className="elixir-bar">
        {Array.from({ length: 10 }, (_, i) => {
          // Each cell is one whole elixir; the active one fills fractionally.
          const fill = Math.max(0, Math.min(1, elixir - i));
          return (
            <div key={i} className="elixir-cell">
              <div className="elixir-fill" style={{ width: `${fill * 100}%` }} />
            </div>
          );
        })}
      </div>
      {multiplier > 1 && (
        <span className="elixir-value" style={{ color: 'var(--gold)' }}>
          x{multiplier}
        </span>
      )}
    </div>
  );
}

export const MAX_ELIXIR_DISPLAY = MAX_ELIXIR_POINTS / EP_PER_ELIXIR;

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------

export interface CardTileProps {
  card: CardDefinition | undefined;
  affordable?: boolean;
  dragging?: boolean;
  evolutionReady?: boolean;
  onPointerDown?: (event: React.PointerEvent<HTMLDivElement>) => void;
}

export function CardTile({
  card,
  affordable = true,
  dragging = false,
  evolutionReady = false,
  onPointerDown,
}: CardTileProps) {
  if (!card) return <div className="card-tile" />;

  const className = [
    'card-tile',
    affordable ? 'playable' : 'unaffordable',
    dragging ? 'dragging' : '',
    evolutionReady ? 'evo-ready' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={className} onPointerDown={onPointerDown}>
      <div className="card-art" style={{ background: card.tint }}>
        {card.name}
      </div>
      {evolutionReady && <span className="evo-badge">EVO</span>}
      <span className="card-cost">{card.elixirCost}</span>
    </div>
  );
}

export function NextCard({ cardId }: { cardId: string | undefined }) {
  return (
    <div className="next-card">
      <span className="label">Next</span>
      <CardTile card={cardId ? tryGetCard(cardId) : undefined} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hero ability
// ---------------------------------------------------------------------------

export interface AbilityButtonProps {
  heroCardId: string | undefined;
  onField: boolean;
  cooldownSeconds: number;
  affordable: boolean;
  onActivate: () => void;
}

export function AbilityButton({
  heroCardId,
  onField,
  cooldownSeconds,
  affordable,
  onActivate,
}: AbilityButtonProps) {
  const hero = heroCardId ? tryGetCard(heroCardId) : undefined;
  if (!hero) return null;

  const ready = onField && cooldownSeconds <= 0 && affordable;
  const label = !onField ? 'No Hero' : cooldownSeconds > 0 ? `${cooldownSeconds}s` : 'Ability';

  return (
    <button
      className="ability-button"
      disabled={!ready}
      onClick={onActivate}
      title={`${hero.name}: ${hero.abilityActionHook}`}
    >
      <span>{label}</span>
      {onField && cooldownSeconds <= 0 && <span className="cost">{hero.abilityElixirCost}</span>}
    </button>
  );
}
