/**
 * The render loop.
 *
 * Owns requestAnimationFrame and drives `MatchRunner.advance` with real
 * elapsed time; the runner in turn decides how many 30Hz ticks that buys. The
 * display can therefore run at 60Hz, 120Hz or anything else without the
 * simulation rate changing — which is the whole point of decoupling them.
 *
 * React never re-renders per frame. It hands this class a mutable drag state
 * and subscribes to a coarse HUD snapshot instead, so a 120Hz canvas does not
 * mean 120 React renders a second.
 */

import type { MatchRunner } from '@game/match';
import type { Team } from '@sim/types';
import { AP_PER_AETHER } from '@sim/constants';
import { drawArena, drawDeployOverlay, drawPlacementGhost } from './arena';
import { drawEntities } from './entities';
import {
  type Viewport,
  applyViewport,
  computeViewport,
  LOGICAL_W,
  LOGICAL_H,
  FIELD_TOP,
  FIELD_HEIGHT,
} from './camera';
import { warmSprites, warmAtlases } from './sprites';
import { warmEffects } from './effectSprites';
import { VfxSystem } from './vfx';
import { tryGetCard } from '@cards/registry';
import type { CardDefinition } from '@cards/schema';
import type { MatchState } from '@sim/types';
import { audio, cueForEvent } from './audio';

export interface DragState {
  handIndex: number;
  tileX: number;
  tileY: number;
  legal: boolean;
  /** The card being placed, so the ghost can draw its actual figures. */
  cardId: string;
  flying: boolean;
  /** True for a tunneller, which may be dropped on any tile on the board. */
  anywhere: boolean;
}

export interface HudSnapshot {
  tick: number;
  aether: number;
  crownsBlue: number;
  crownsRed: number;
  phase: string;
  outcome: string;
  abilityReady: boolean;
  abilityCooldownSeconds: number;
  heroOnField: boolean;
  /**
   * Running elixir trade, in whole aether: what you have destroyed minus what
   * you have spent. Positive means you are ahead on trades.
   */
  aetherTrade: number;
}

export class BattleRenderer {
  private ctx: CanvasRenderingContext2D;
  private viewport: Viewport;
  private frameHandle = 0;
  private lastTimestamp = 0;
  private drag: DragState | null = null;
  private running = false;
  /** Particles, damage numbers and screen shake. Purely cosmetic. */
  readonly vfx = new VfxSystem();

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly runner: MatchRunner,
    private readonly viewTeam: Team,
    private readonly onHud?: (snapshot: HudSnapshot) => void,
  ) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2D canvas context unavailable');
    this.ctx = context;
    this.viewport = computeViewport(canvas.clientWidth, canvas.clientHeight, 1);
    this.resize();
  }

  setDrag(drag: DragState | null): void {
    this.drag = drag;
  }

  get currentViewport(): Viewport {
    return this.viewport;
  }

  resize(): void {
    const dpr = Math.min(globalThis.devicePixelRatio || 1, 2);
    const cssWidth = this.canvas.clientWidth || LOGICAL_W;
    const cssHeight = this.canvas.clientHeight || LOGICAL_H;
    this.canvas.width = Math.round(cssWidth * dpr);
    this.canvas.height = Math.round(cssHeight * dpr);
    this.viewport = computeViewport(cssWidth, cssHeight, dpr);
  }

  /**
   * Every card whose figure can appear this match: both decks, whatever those
   * cards spawn on death or on a timer, and the tower troops already standing.
   * Warming the whole registry instead would rasterise a hundred-odd unused
   * cards; this is the set that can actually reach the board.
   */
  private static warmSet(state: MatchState): CardDefinition[] {
    const ids = new Set<string>();
    for (const player of state.players) for (const id of player.deck) ids.add(id);
    for (const entity of state.entities) ids.add(entity.cardId);
    // A card's spawned children are named by `deathEffectParam`.
    for (const id of [...ids]) {
      const param = tryGetCard(id)?.deathEffectParam;
      if (param) ids.add(param);
    }
    const cards: CardDefinition[] = [];
    for (const id of ids) {
      const card = tryGetCard(id);
      if (card) cards.push(card);
    }
    return cards;
  }

  start(): void {
    if (this.running) return;

    /*
     * Rasterise every figure that can appear in this match before the first
     * frame, rather than paying for each card's walk and strike cycles inside
     * the frame that first draws it.
     */
    const warm = BattleRenderer.warmSet(this.runner.state);
    warmAtlases(warm);
    warmSprites(warm);
    warmEffects();

    this.running = true;
    this.lastTimestamp = 0;
    const frame = (timestamp: number): void => {
      if (!this.running) return;
      const delta = this.lastTimestamp === 0 ? 0 : timestamp - this.lastTimestamp;
      this.lastTimestamp = timestamp;

      this.runner.advance(delta);

      // Drain once per frame rather than reading state.events directly: a
      // frame may cover zero or two ticks, and events live for exactly one.
      const events = this.runner.drainEvents();
      if (events.length > 0) {
        this.vfx.consume(events, this.viewTeam);
        for (const event of events) {
          const cue = cueForEvent(event.type, event.type === 'hit' ? event.splash : undefined);
          if (cue) audio.play(cue);
        }
      }

      audio.tick(delta);
      this.vfx.update(delta);
      this.draw();
      this.emitHud();

      this.frameHandle = requestAnimationFrame(frame);
    };
    this.frameHandle = requestAnimationFrame(frame);
  }

  stop(): void {
    this.running = false;
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = 0;
  }

  /** Render a single frame without advancing time. Used for tests and pauses. */
  draw(): void {
    const { ctx } = this;
    const state = this.runner.state;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#12161f';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    applyViewport(ctx, this.viewport);

    // Screen shake displaces the whole scene, including the arena, so the
    // board itself lurches rather than the units sliding across a static one.
    const shake = this.vfx.shakeOffset();
    ctx.translate(shake.x, shake.y);

    drawArena(ctx, state.grid, this.viewTeam);

    if (this.drag) {
      drawDeployOverlay(
        ctx,
        state.grid,
        this.runner.localTeam,
        state.players[this.runner.localTeam].deployRights,
        this.drag.flying,
        this.viewTeam,
        this.drag.anywhere,
      );
    }

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, FIELD_TOP, LOGICAL_W, FIELD_HEIGHT);
    ctx.clip();

    drawEntities(ctx, state, this.runner, this.viewTeam);

    // Arcs first: a bolt belongs behind the figures it connects, not over them.
    this.vfx.drawBolts(ctx);
    this.vfx.drawParticles(ctx);

    if (this.drag) {
      drawPlacementGhost(
        ctx,
        Math.floor(this.drag.tileX),
        Math.floor(this.drag.tileY),
        this.drag.legal,
        this.drag.cardId,
        this.viewTeam,
        this.runner.localTeam,
      );
    }

    // Damage numbers last, so nothing can occlude them.
    this.vfx.drawNumbers(ctx);
    ctx.restore();
  }

  private emitHud(): void {
    if (!this.onHud) return;
    const state = this.runner.state;
    const local = state.players[this.runner.localTeam];
    this.onHud({
      tick: state.tick,
      aether: local.aetherPoints,
      crownsBlue: state.players[0].crowns,
      crownsRed: state.players[1].crowns,
      phase: state.phase,
      outcome: state.outcome,
      abilityReady: local.heroAbilityCooldown === 0 && local.heroEntityId !== -1,
      abilityCooldownSeconds: Math.ceil(local.heroAbilityCooldown / 30),
      heroOnField: local.heroEntityId !== -1,
      aetherTrade: Math.round((local.aetherDestroyed - local.aetherSpent) / AP_PER_AETHER),
    });
  }
}
