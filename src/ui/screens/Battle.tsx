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
import { AP_PER_AETHER, TICK_HZ } from '@sim/constants';
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
  TradeMeter,
} from '../battle/Hud';
import { DragPortrait } from '../CardFace';

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
  aetherTrade: 0,
};

export function Battle({ config, localTeam, opponentName, onExit }: BattleProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<BattleRenderer | null>(null);
  const dragRef = useRef<{ handIndex: number } | null>(null);

  /*
   * Elements the render loop writes to directly, once a frame, without going
   * through React. These carry the values that change continuously — aether,
   * and the dragged card's position — which are exactly the values that make
   * React re-rendering per frame so expensive.
   */
  const liveRef = useRef<HTMLDivElement>(null);
  const aetherValueRef = useRef<HTMLSpanElement>(null);
  const dragPortraitRef = useRef<HTMLDivElement>(null);

  const [hud, setHud] = useState<HudSnapshot>(EMPTY_HUD);
  const [dragging, setDragging] = useState<number | null>(null);
  const [countdown, setCountdown] = useState(3);

  /** Move the drag portrait without re-rendering anything. */
  const moveDragPortrait = useCallback((x: number, y: number) => {
    const el = dragPortraitRef.current;
    if (el) el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
  }, []);

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
      /*
       * Continuous values go straight to the DOM, never through React.
       *
       * Aether rises every tick, so including it in the change key below meant
       * the key changed 30 times a second and the whole battle tree — timer,
       * crowns, ability button, four card tiles and their portraits —
       * reconciled at that rate. The `tick / 15` term that was meant to
       * throttle this was completely masked by it.
       */
      const aether = snapshot.aether / AP_PER_AETHER;
      liveRef.current?.style.setProperty('--aether', aether.toFixed(3));
      const valueEl = aetherValueRef.current;
      if (valueEl) {
        const text = aether.toFixed(1);
        // textContent writes are cheap, but a no-op write still invalidates.
        if (valueEl.textContent !== text) valueEl.textContent = text;
      }

      /*
       * React only hears about things that change the *shape* of the HUD.
       *
       * Affordability is what the raw aether number was really standing in for
       * — it is the only reason a card tile cares about aether at all — and it
       * changes a handful of times a match rather than thirty times a second.
       */
      const local = runner.state.players[localTeam];
      let affordMask = 0;
      for (let i = 0; i < local.hand.length; i++) {
        const card = tryGetCard(local.hand[i]);
        if (card && snapshot.aether >= card.aetherCost * AP_PER_AETHER) affordMask |= 1 << i;
      }

      const key =
        `${affordMask}|${local.hand.join(',')}|${local.queue[0] ?? ''}` +
        `|${snapshot.crownsBlue}|${snapshot.crownsRed}|${snapshot.phase}|${snapshot.outcome}` +
        `|${snapshot.abilityCooldownSeconds}|${snapshot.heroOnField}|${snapshot.aetherTrade}` +
        // The clock only ever renders whole seconds.
        `|${Math.floor(snapshot.tick / TICK_HZ)}`;
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
              card.deployAnywhere,
            );

      const drag: DragState = {
        handIndex,
        tileX,
        tileY,
        legal,
        cardId,
        flying: card.isFlying,
        anywhere: card.deployAnywhere,
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

      // Stops the browser starting a native drag or a text selection, which
      // on desktop swallowed the gesture before pointermove ever arrived.
      event.preventDefault();

      const element = event.currentTarget;
      const pointerId = event.pointerId;

      /*
       * Capture the pointer to this element.
       *
       * Without it every subsequent move and release had to be caught on
       * window, which is fragile: the browser is free to retarget or drop
       * those events, and on touch it did. Capture guarantees the whole
       * gesture is delivered here even if the finger leaves the element, the
       * canvas, or the page.
       */
      try {
        element.setPointerCapture(pointerId);
      } catch {
        // Capture is best-effort; the window fallback below still catches it.
      }

      dragRef.current = { handIndex };
      setDragging(handIndex);
      moveDragPortrait(event.clientX, event.clientY);
      updateGhost(handIndex, event.clientX, event.clientY);

      let settled = false;

      const cleanup = () => {
        element.removeEventListener('pointermove', onMove);
        element.removeEventListener('pointerup', onUp);
        element.removeEventListener('pointercancel', onCancel);
        globalThis.removeEventListener('pointerup', onUp);
        globalThis.removeEventListener('pointercancel', onCancel);
        try {
          element.releasePointerCapture(pointerId);
        } catch {
          // Already released, or never captured.
        }
        dragRef.current = null;
        setDragging(null);
        rendererRef.current?.setDrag(null);
      };

      function onMove(moveEvent: PointerEvent) {
        if (!dragRef.current) return;
        moveEvent.preventDefault();
        // Imperative: pointermove fires up to 120Hz on a touchscreen.
        moveDragPortrait(moveEvent.clientX, moveEvent.clientY);
        updateGhost(dragRef.current.handIndex, moveEvent.clientX, moveEvent.clientY);
      }

      /**
       * A cancelled gesture must never place a card.
       *
       * `pointercancel` was previously wired to the same handler as
       * `pointerup`, so when a touch browser took the gesture for scrolling it
       * fired a deploy at whatever coordinate the cancel carried — down in the
       * card hand, far outside the arena. The drop was silently rejected, which
       * is exactly the "I can tap the cards but nothing deploys" symptom.
       */
      function onCancel() {
        if (settled) return;
        settled = true;
        cleanup();
      }

      function onUp(upEvent: PointerEvent) {
        if (settled) return;
        settled = true;

        const active = dragRef.current;
        const tile = tileFromEvent(upEvent.clientX, upEvent.clientY);
        cleanup();
        if (!active || !tile) return;

        const tileX = Math.floor(tile.tx);
        const tileY = Math.floor(tile.ty);
        // Released over the HUD or off the board: treat it as putting the card
        // back, not as a failed play.
        if (tileX < 0 || tileX > 17 || tileY < 0 || tileY > 31) return;

        const played = tryGetCard(runner.state.players[localTeam].hand[active.handIndex]);
        runner.submitDeploy(active.handIndex, tileX, tileY);
        audio.play('deploy');
        if (played) rendererRef.current?.vfx.deployBurst(tileX, tileY, played.tint, localTeam);
      }

      element.addEventListener('pointermove', onMove);
      element.addEventListener('pointerup', onUp);
      element.addEventListener('pointercancel', onCancel);
      // Safety net: if the card unmounts mid-drag the capture is lost with it,
      // and without this the gesture would never finish.
      globalThis.addEventListener('pointerup', onUp);
      globalThis.addEventListener('pointercancel', onCancel);
    },
    [localTeam, runner, tileFromEvent, updateGhost],
  );

  // --- derived HUD data ----------------------------------------------------

  const player = runner.state.players[localTeam];
  const draggedCard = dragging === null ? undefined : tryGetCard(player.hand[dragging]);
  const multiplier = aetherMultiplierAtTick(hud.tick);
  const finished = hud.outcome !== 'ongoing';
  const localWon =
    (hud.outcome === 'blue' && localTeam === 0) || (hud.outcome === 'red' && localTeam === 1);
  const crownsFor = localTeam === 0 ? hud.crownsBlue : hud.crownsRed;
  const crownsAgainst = localTeam === 0 ? hud.crownsRed : hud.crownsBlue;

  /*
   * Damage the local player has put into enemy towers, summed from the towers
   * themselves rather than tracked incrementally — the entities are the record.
   *
   * Only computed once the match is over. This is a full entity-list scan and
   * it is read by nothing but the result overlay, so running it on every render
   * was pure waste.
   */
  const towerDamageDealt = !finished
    ? 0
    : runner.state.entities
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

        <div className="battle-hud" ref={liveRef}>
          <AetherBar valueRef={aetherValueRef} multiplier={multiplier} />
          {/* The running trade. A player cannot learn to make good trades
              without being told what their trades are — this is the number the
              whole skill of the genre is measured in, and it was nowhere. */}
          <TradeMeter trade={hud.aetherTrade} />
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

      {draggedCard && <DragPortrait ref={dragPortraitRef} card={draggedCard} />}

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
              <span>{Math.round(player.aetherSpent / AP_PER_AETHER)}</span>
            </div>
            <div className="stat-line">
              <span className="label">Aether destroyed</span>
              <span>{Math.round(player.aetherDestroyed / AP_PER_AETHER)}</span>
            </div>
            <div className="stat-line">
              <span className="label">Elixir trade</span>
              <span className={hud.aetherTrade >= 0 ? 'trade-up' : 'trade-down'}>
                {hud.aetherTrade >= 0 ? '+' : ''}
                {hud.aetherTrade}
              </span>
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
