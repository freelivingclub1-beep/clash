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
  onExit: (outcome: 'blue' | 'red' | 'draw' | 'ongoing') => void;
}

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
        runner.submitDeploy(active.handIndex, tileX, tileY);
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
          onActivate={() => runner.submitAbility()}
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

      {finished && (
        <div className="result-overlay">
          <div className={`headline ${hud.outcome === 'draw' ? '' : localWon ? 'win' : 'loss'}`}>
            {hud.outcome === 'draw' ? 'Draw' : localWon ? 'Victory' : 'Defeat'}
          </div>
          <div className="muted">
            {hud.crownsBlue} – {hud.crownsRed} crowns
          </div>
          <button className="button" onClick={() => onExit(hud.outcome as 'blue' | 'red' | 'draw')}>
            Continue
          </button>
        </div>
      )}
    </div>
  );
}
