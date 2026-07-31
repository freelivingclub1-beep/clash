/**
 * The battle screen.
 *
 * React owns the HUD and the drag gesture; the canvas renderer owns the field
 * and the frame loop. They meet at two narrow points: a mutable drag state
 * pushed into the renderer, and a coarse HUD snapshot pushed back out. Nothing
 * re-renders React per animation frame.
 *
 * Card placement is a drag, not a tap, because the deploy tile has to be
 * chosen precisely and a thumb hides it — so the ghost preview is drawn on the
 * field under the finger and the drop is committed on release.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { tryGetCard } from '@cards/registry';
import { MatchRunner } from '@game/match';
import { BotController } from '@net/bot/botAI';
import { LocalTransport } from '@net/transport';
import { BattleRenderer, type DragState, type HudSnapshot } from '@render/loop';
import { audio } from '@render/audio';
import { TOWER_LAYOUTS } from '@sim/nav/grid';
import type { MatchSummary } from '@game/profile/repository';
import { clientToTile } from '@render/camera';
import { canDeployAt } from '@sim/nav/grid';
import { AP_PER_AETHER } from '@sim/constants';
import { aetherMultiplierAtTick } from '@sim/systems/clock';
import { heroCardIn } from '@game/deck';
import type { MatchConfig } from '@sim/state';
import type { Team } from '@sim/types';
import {
  AbilityButton,
  CardTile,
  CrownCounter,
  AetherBar,
  MatchTimer,
  NextCard,
} from '../battle/Hud';

export interface BattleProps {
  config: MatchConfig;
  localTeam: Team;
  opponentName: string;
  onExit: (outcome: 'blue' | 'red' | 'draw' | 'ongoing', summary?: MatchSummary) => void;
}

/** Ticks of "3 - 2 - 1 - GO" before the board becomes interactive. */
const COUNTDOWN_MS = 3200;

const EMPTY_HUD: HudSnapshot = {
  tick: 0,
  aether: 0,
  crownsBlue: 0,
  crownsRed: 0,
  phase: 'regulation',
  outcome: 'ongoing',
  abilityReady: false,
  abilityCooldownSeconds: 0,
  heroOnField: false,
};

export function Battle({ config, localTeam, opponentName, onExit }: BattleProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<BattleRenderer | null>(null);
  const dragRef = useRef<{ handIndex: number } | null>(null);

  const [hud, setHud] = useState<HudSnapshot>(EMPTY_HUD);
  const [dragging, setDragging] = useState<number | null>(null);
  const [countdown, setCountdown] = useState(3);

  // The runner outlives renders; building it once keeps the match from being
  // silently restarted by an unrelated re-render.
  const runner = useMemo(
    () =>
      new MatchRunner({
        config,
        localTeam,
        transport: new LocalTransport(2),
        bot: new BotController({
          team: (localTeam === 0 ? 1 : 0) as Team,
          seed: config.seed,
          aggression: 0.7,
        }),
      }),
    [config, localTeam],
  );

  const heroCardId = useMemo(
    () => heroCardIn([...config.players[localTeam].deck]),
    [config, localTeam],
  );

  // --- renderer lifecycle --------------------------------------------------

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const lastRef = { value: '' };
    const renderer = new BattleRenderer(canvas, runner, localTeam, (snapshot) => {
      // Only push into React when something the HUD shows actually changed.
      const key = `${snapshot.aether}|${snapshot.crownsBlue}|${snapshot.crownsRed}|${snapshot.phase}|${snapshot.outcome}|${snapshot.abilityCooldownSeconds}|${snapshot.heroOnField}|${Math.floor(snapshot.tick / 15)}`;
      if (key === lastRef.value) return;
      lastRef.value = key;
      setHud(snapshot);
    });

    rendererRef.current = renderer;
    renderer.start();

    const onResize = () => renderer.resize();
    globalThis.addEventListener('resize', onResize);

    return () => {
      globalThis.removeEventListener('resize', onResize);
      renderer.stop();
      rendererRef.current = null;
    };
  }, [runner, localTeam]);

  useEffect(() => () => runner.dispose(), [runner]);

  /**
   * Match intro. The simulation is already running underneath — both players
   * bank aether during the count, exactly as in the reference game — so this
   * is presentation only and never gates the tick loop.
   */
  useEffect(() => {
    const steps = [3, 2, 1, 0];
    const timers = steps.map((value, index) =>
      globalThis.setTimeout(() => {
        setCountdown(value);
        audio.play(value === 0 ? 'ability' : 'countdown');
      }, index * (COUNTDOWN_MS / steps.length)),
    );
    return () => timers.forEach((timer) => globalThis.clearTimeout(timer));
  }, []);

  // Browsers refuse to start an AudioContext outside a user gesture, so the
  // first touch anywhere on the battle screen is what unlocks sound.
  useEffect(() => {
    if (hud.outcome === 'ongoing') return;
    const won =
      (hud.outcome === 'blue' && localTeam === 0) || (hud.outcome === 'red' && localTeam === 1);
    audio.play(hud.outcome === 'draw' ? 'uiTap' : won ? 'victory' : 'defeat');
  }, [hud.outcome, localTeam]);

  useEffect(() => {
    const unlock = () => audio.unlock();
    globalThis.addEventListener('pointerdown', unlock, { once: true });
    return () => globalThis.removeEventListener('pointerdown', unlock);
  }, []);

  // --- drag to deploy ------------------------------------------------------

  const tileFromEvent = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      const renderer = rendererRef.current;
      if (!canvas || !renderer) return null;
      const rect = canvas.getBoundingClientRect();
      return clientToTile(clientX, clientY, rect, renderer.currentViewport, localTeam);
    },
    [localTeam],
  );

  const updateGhost = useCallback(
    (handIndex: number, clientX: number, clientY: number) => {
      const renderer = rendererRef.current;
      const tile = tileFromEvent(clientX, clientY);
      if (!renderer || !tile) return;

      const cardId = runner.state.players[localTeam].hand[handIndex];
      const card = tryGetCard(cardId);
      if (!card) return;

      const tileX = Math.floor(tile.tx);
      const tileY = Math.floor(tile.ty);
      // Spells ignore territory; everything else must pass the deploy rules.
      const legal =
        card.category === 'Spell'
          ? tileX >= 0 && tileX < 18 && tileY >= 0 && tileY < 32
          : canDeployAt(
              runner.state.grid,
              localTeam,
              tileX,
              tileY,
              runner.state.players[localTeam].deployRights,
              card.isFlying,
            );

      const drag: DragState = {
        handIndex,
        tileX,
        tileY,
        legal,
        tint: card.tint,
        flying: card.isFlying,
      };
      renderer.setDrag(drag);
    },
    [localTeam, runner, tileFromEvent],
  );

  const startDrag = useCallback(
    (handIndex: number) => (event: React.PointerEvent<HTMLDivElement>) => {
      const cardId = runner.state.players[localTeam].hand[handIndex];
      const card = tryGetCard(cardId);
      if (!card) return;
      if (runner.state.players[localTeam].aetherPoints < card.aetherCost * AP_PER_AETHER) return;

      dragRef.current = { handIndex };
      setDragging(handIndex);
      updateGhost(handIndex, event.clientX, event.clientY);

      const onMove = (moveEvent: PointerEvent) => {
        if (!dragRef.current) return;
        updateGhost(dragRef.current.handIndex, moveEvent.clientX, moveEvent.clientY);
      };

      const onUp = (upEvent: PointerEvent) => {
        globalThis.removeEventListener('pointermove', onMove);
        globalThis.removeEventListener('pointerup', onUp);
        globalThis.removeEventListener('pointercancel', onUp);

        const active = dragRef.current;
        dragRef.current = null;
        setDragging(null);
        rendererRef.current?.setDrag(null);
        if (!active) return;

        const tile = tileFromEvent(upEvent.clientX, upEvent.clientY);
        if (!tile) return;
        const tileX = Math.floor(tile.tx);
        const tileY = Math.floor(tile.ty);
        if (tileX < 0 || tileX > 17 || tileY < 0 || tileY > 31) return;

        // The simulation re-validates this; an illegal drop is simply dropped.
        const card = tryGetCard(runner.state.players[localTeam].hand[active.handIndex]);
        runner.submitDeploy(active.handIndex, tileX, tileY);
        audio.play('deploy');
        if (card) rendererRef.current?.vfx.deployBurst(tileX, tileY, card.tint, localTeam);
      };

      globalThis.addEventListener('pointermove', onMove);
      globalThis.addEventListener('pointerup', onUp);
      globalThis.addEventListener('pointercancel', onUp);
    },
    [localTeam, runner, tileFromEvent, updateGhost],
  );

  // --- derived HUD data ----------------------------------------------------

  const player = runner.state.players[localTeam];
  const multiplier = aetherMultiplierAtTick(hud.tick);
  const finished = hud.outcome !== 'ongoing';
  const localWon =
    (hud.outcome === 'blue' && localTeam === 0) || (hud.outcome === 'red' && localTeam === 1);
  const crownsFor = localTeam === 0 ? hud.crownsBlue : hud.crownsRed;
  const crownsAgainst = localTeam === 0 ? hud.crownsRed : hud.crownsBlue;

  // Damage the local player has put into enemy towers, summed from the towers
  // themselves rather than tracked incrementally — the entities are the record.
  const towerDamageDealt = runner.state.entities
    .filter((e) => e.towerIndex >= 0 && TOWER_LAYOUTS[e.towerIndex].team !== localTeam)
    .reduce((sum, tower) => sum + (tower.maxHp - tower.hp), 0);

  return (
    <div className="stage">
      <canvas ref={canvasRef} className="battle-canvas" />

      <div className="battle-overlay">
        <header className="battle-header">
          <CrownCounter crowns={hud.crownsRed} side="red" />
          <MatchTimer tick={hud.tick} phase={hud.phase} />
          <div style={{ textAlign: 'right' }}>
            <div className="muted">{opponentName}</div>
            <CrownCounter crowns={hud.crownsBlue} side="blue" />
          </div>
        </header>

        <div className="battle-spacer" />

        <AbilityButton
          heroCardId={heroCardId}
          onField={hud.heroOnField}
          cooldownSeconds={hud.abilityCooldownSeconds}
          affordable={
            !!heroCardId &&
            player.aetherPoints >= (tryGetCard(heroCardId)?.abilityAetherCost ?? 99) * AP_PER_AETHER
          }
          onActivate={() => {
            audio.unlock();
            runner.submitAbility();
          }}
        />

        <div className="battle-hud">
          <AetherBar points={hud.aether} multiplier={multiplier} />
          <div className="hand-row">
            <NextCard cardId={player.queue[0]} />
            <div className="hand-cards">
              {player.hand.map((cardId, index) => {
                const card = tryGetCard(cardId);
                return (
                  <CardTile
                    key={`${cardId}-${index}`}
                    card={card}
                    affordable={
                      !!card && player.aetherPoints >= card.aetherCost * AP_PER_AETHER
                    }
                    dragging={dragging === index}
                    evolutionReady={player.evoReady.get(cardId) === true}
                    onPointerDown={startDrag(index)}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {countdown > 0 && (
        <div className="countdown-overlay">
          <span className="count">{countdown}</span>
        </div>
      )}

      {finished && (
        <div className="result-overlay">
          <div className={`headline ${hud.outcome === 'draw' ? '' : localWon ? 'win' : 'loss'}`}>
            {hud.outcome === 'draw' ? 'Draw' : localWon ? 'Victory' : 'Defeat'}
          </div>
          <div className="crown-result">
            {[0, 1, 2].map((i) => (
              <span key={i} className={`crown-big${i < crownsFor ? ' filled' : ''}`}>
                ★
              </span>
            ))}
          </div>
          <div className="panel result-stats">
            <div className="stat-line">
              <span className="label">Crowns</span>
              <span>
                {crownsFor} – {crownsAgainst}
              </span>
            </div>
            <div className="stat-line">
              <span className="label">Cards played</span>
              <span>{player.cardsPlayed}</span>
            </div>
            <div className="stat-line">
              <span className="label">Aether spent</span>
              <span>{Math.round(player.aetherSpent / 84)}</span>
            </div>
            <div className="stat-line">
              <span className="label">Tower damage dealt</span>
              <span>{towerDamageDealt}</span>
            </div>
            <div className="stat-line">
              <span className="label">Match length</span>
              <span>
                {Math.floor(runner.state.tick / 30 / 60)}:
                {String(Math.floor(runner.state.tick / 30) % 60).padStart(2, '0')}
              </span>
            </div>
          </div>
          <button
            className="button"
            onClick={() =>
              onExit(hud.outcome as 'blue' | 'red' | 'draw', {
                outcome: hud.outcome as 'blue' | 'red' | 'draw',
                localTeam,
                crownsFor,
                crownsAgainst,
                opponentName,
                durationSeconds: Math.floor(runner.state.tick / 30),
                cardsPlayed: player.cardsPlayed,
                towerDamageDealt,
              })
            }
          >
            Continue
          </button>
        </div>
      )}
    </div>
  );
}
