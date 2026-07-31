/**
 * App shell and screen routing.
 *
 * A tiny explicit state machine rather than a router library: there are four
 * screens and the transitions between them carry real payloads (a match
 * config, a profile), which a URL-driven router would have to serialise for no
 * benefit on a phone.
 */

import { useCallback, useEffect, useState } from 'react';
import '@cards/data';
import { LocalBotMatchmaker, type OpponentProfile } from '@net/matchmaking';
import {
  LocalStorageProfileRepository,
  applyMatchResult,
} from '@game/profile/repository';
import { cardLevelMap, type PlayerProfile } from '@game/profile/schema';
import { validateDeck } from '@game/deck';
import type { MatchConfig } from '@sim/state';
import { Battle } from './screens/Battle';
import { CardMaker } from './screens/CardMaker';
import { DeckBuilder } from './screens/DeckBuilder';

type Screen =
  | { name: 'home' }
  | { name: 'deck' }
  | { name: 'cardmaker' }
  | { name: 'battle'; config: MatchConfig; opponent: OpponentProfile };

const repository = new LocalStorageProfileRepository();

/**
 * Match seeds come from the clock. This is the one place a non-deterministic
 * value is allowed in: it is captured once, before the match starts, and from
 * then on the entire simulation is a pure function of it.
 */
const newSeed = (): number => (Date.now() ^ (performance.now() * 1000)) | 0;

export function App() {
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    void repository.load().then(setProfile);
  }, []);

  const persist = useCallback(async (next: PlayerProfile) => {
    setProfile({ ...next });
    await repository.save(next);
  }, []);

  const findMatch = useCallback(async () => {
    if (!profile) return;
    setSearching(true);
    try {
      const matchmaker = new LocalBotMatchmaker(newSeed);
      const result = await matchmaker.findMatch({
        playerId: profile.userId,
        name: profile.name,
        trophies: profile.trophies,
        kingTowerLevel: profile.kingTowerLevel,
        deck: profile.deck,
        cardLevels: cardLevelMap(profile),
      });
      setScreen({ name: 'battle', config: result.matchConfig, opponent: result.opponent });
    } finally {
      setSearching(false);
    }
  }, [profile]);

  if (!profile) {
    return (
      <div className="app">
        <div className="stage">
          <div className="screen">
            <h1>Loading…</h1>
          </div>
        </div>
      </div>
    );
  }

  if (screen.name === 'battle') {
    return (
      <div className="app">
        <Battle
          config={screen.config}
          localTeam={0}
          opponentName={screen.opponent.name}
          onExit={(outcome, summary) => {
            if (outcome !== 'ongoing') {
              void persist(applyMatchResult({ ...profile }, outcome, 0, summary));
            }
            setScreen({ name: 'home' });
          }}
        />
      </div>
    );
  }

  if (screen.name === 'cardmaker') {
    return (
      <div className="app">
        <CardMaker onBack={() => setScreen({ name: 'home' })} />
      </div>
    );
  }

  if (screen.name === 'deck') {
    return (
      <div className="app">
        <DeckBuilder
          profile={profile}
          onBack={() => setScreen({ name: 'home' })}
          onSave={(deck) => {
            void persist({ ...profile, deck });
            setScreen({ name: 'home' });
          }}
        />
      </div>
    );
  }

  const deckValidation = validateDeck(profile.deck);

  return (
    <div className="app">
      <div className="stage">
        <div className="screen">
          <h1>Clash Arena</h1>
          <div className="panel">
            <div className="stat-line">
              <span className="label">Player</span>
              <span>{profile.name}</span>
            </div>
            <div className="stat-line">
              <span className="label">Trophies</span>
              <span>{profile.trophies}</span>
            </div>
            <div className="stat-line">
              <span className="label">Arena</span>
              <span>{profile.currentArena}</span>
            </div>
            <div className="stat-line">
              <span className="label">King Tower</span>
              <span>Level {profile.kingTowerLevel}</span>
            </div>
            <div className="stat-line">
              <span className="label">Record</span>
              <span>
                {profile.wins}W · {profile.losses}L
              </span>
            </div>
            <div className="stat-line">
              <span className="label">Deck average aether</span>
              <span>{deckValidation.averageAether}</span>
            </div>
          </div>

          {!deckValidation.ok && (
            <div className="panel">
              <div className="error">Your deck is not legal — fix it before battling.</div>
              {deckValidation.issues.map((issue) => (
                <div key={issue.message} className="error">
                  {issue.message}
                </div>
              ))}
            </div>
          )}

          <button
            className="button"
            disabled={searching || !deckValidation.ok}
            onClick={() => void findMatch()}
          >
            {searching ? 'Finding opponent…' : 'Battle'}
          </button>
          <button className="button secondary" onClick={() => setScreen({ name: 'deck' })}>
            Deck Builder
          </button>
          <button className="button secondary" onClick={() => setScreen({ name: 'cardmaker' })}>
            Card Maker Studio
          </button>
          {profile.battleLog.length > 0 && (
            <div className="panel">
              <h2 style={{ marginBottom: 6 }}>Recent Battles</h2>
              {profile.battleLog.slice(0, 5).map((entry, index) => (
                <div className="stat-line" key={index}>
                  <span
                    className="label"
                    style={{
                      color:
                        entry.outcome === 'win'
                          ? 'var(--ok)'
                          : entry.outcome === 'loss'
                            ? 'var(--danger)'
                            : 'var(--muted)',
                    }}
                  >
                    {entry.outcome.toUpperCase()} · {entry.opponentName}
                  </span>
                  <span>
                    {entry.crownsFor}–{entry.crownsAgainst}
                    {entry.trophyDelta !== 0 &&
                      ` (${entry.trophyDelta > 0 ? '+' : ''}${entry.trophyDelta})`}
                  </span>
                </div>
              ))}
            </div>
          )}

          <button
            className="button danger"
            onClick={() => void repository.reset().then(setProfile)}
          >
            Reset Progress
          </button>

          <div className="muted">
            Drag a card from your hand onto your half of the arena to deploy. Champions unlock the
            ability button once they are on the field.
          </div>
        </div>
      </div>
    </div>
  );
}
