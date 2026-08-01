/**
 * Match orchestration: the bridge between wall-clock time and the fixed 30Hz
 * simulation.
 *
 * The renderer runs as fast as the display allows; the simulation runs at
 * exactly 30 ticks per second and never at any other rate. This class owns the
 * accumulator that reconciles the two, and the previous-tick positions the
 * renderer interpolates against so 30Hz motion reads smoothly at 60 or 120Hz.
 *
 * Note the ordering inside `advance`: the bot submits through the transport
 * exactly as a human does, and the frame is pulled from the transport rather
 * than commands being handed straight to the simulation. Locally that is a
 * detour, but it is the same detour a remote match takes, so nothing here has
 * to change when a real server appears.
 */

import { createMatch, type MatchConfig } from '@sim/state';
import { stepMatch } from '@sim/tick';
import { TICK_MS } from '@sim/constants';
import type { MatchState, Command, Team, SimEvent } from '@sim/types';
import type { MatchTransport } from '@net/transport';
import { LocalTransport } from '@net/transport';
import type { BotController } from '@net/bot/botAI';

/** Never simulate more than this many ticks in one frame. */
const MAX_CATCHUP_TICKS = 6;

/** Cap on unread sim events, so a backgrounded tab cannot grow the buffer. */
const MAX_BUFFERED_EVENTS = 512;

export interface InterpolatedPosition {
  x: number;
  y: number;
}

export interface MatchRunnerOptions {
  config: MatchConfig;
  /** Which side the local human plays. */
  localTeam: Team;
  transport?: MatchTransport;
  bot?: BotController;
}

/** A locally submitted command that has not yet been confirmed by a frame. */
export interface PendingCommand {
  command: Command;
  confirmTick: number;
}

export class MatchRunner {
  readonly state: MatchState;
  readonly localTeam: Team;
  private readonly transport: MatchTransport;
  private readonly bot?: BotController;

  private accumulator = 0;
  /** Positions at the start of the current tick, for render interpolation. */
  private previous = new Map<number, InterpolatedPosition>();
  private pending: PendingCommand[] = [];
  private eventBuffer: SimEvent[] = [];

  constructor(options: MatchRunnerOptions) {
    this.state = createMatch(options.config);
    this.localTeam = options.localTeam;
    this.transport = options.transport ?? new LocalTransport();
    this.bot = options.bot;
    this.snapshotPositions();
  }

  /** 0..1 progress between the previous tick and the next one. */
  get alpha(): number {
    return Math.min(1, this.accumulator / TICK_MS);
  }

  get finished(): boolean {
    return this.state.phase === 'finished';
  }

  /** Commands submitted locally but not yet applied — the ghost previews. */
  get unconfirmed(): readonly PendingCommand[] {
    return this.pending;
  }

  /**
   * Advance by `deltaMs` of real time.
   *
   * Excess time beyond `MAX_CATCHUP_TICKS` is discarded rather than simulated:
   * after a long stall (a backgrounded tab) catching up fully would freeze the
   * page, and in a networked match the server is the clock anyway.
   */
  advance(deltaMs: number): void {
    if (this.finished) return;

    this.accumulator += Math.max(0, deltaMs);
    let steps = 0;

    while (this.accumulator >= TICK_MS && steps < MAX_CATCHUP_TICKS) {
      this.stepOnce();
      this.accumulator -= TICK_MS;
      steps++;
      if (this.finished) break;
    }

    if (steps === MAX_CATCHUP_TICKS) this.accumulator = 0;
  }

  /** Advance exactly one tick, ignoring wall-clock. Used by tests. */
  stepOnce(): void {
    const tick = this.state.tick;

    // The bot submits through the transport like any other participant.
    if (this.bot) {
      for (const command of this.bot.decide(this.state)) {
        this.transport.submitCommand(command);
      }
    }

    const frame = this.transport.frameFor(tick);
    // A null frame means the input for this tick has not been confirmed. The
    // simulation must not run ahead of confirmed input, so we stall.
    if (!frame) return;

    this.snapshotPositions();
    stepMatch(this.state, frame.commands);

    // Events live for exactly one tick, but a render frame may cover zero or
    // two ticks. Buffering them here means effects are never dropped on a
    // frame that happened not to advance the simulation, and never played
    // twice on one that advanced it twice.
    for (const event of this.state.events) this.eventBuffer.push(event);
    if (this.eventBuffer.length > MAX_BUFFERED_EVENTS) {
      this.eventBuffer.splice(0, this.eventBuffer.length - MAX_BUFFERED_EVENTS);
    }

    if (this.pending.length > 0) {
      this.pending = this.pending.filter((p) => p.confirmTick > tick);
    }
  }

  /**
   * Take every sim event since the last call. The renderer drains this once
   * per frame to drive particles, sound and screen shake.
   */
  drainEvents(): SimEvent[] {
    if (this.eventBuffer.length === 0) return [];
    const events = this.eventBuffer;
    this.eventBuffer = [];
    return events;
  }

  private snapshotPositions(): void {
    this.previous.clear();
    for (const entity of this.state.entities) {
      this.previous.set(entity.id, { x: entity.x, y: entity.y });
    }
  }

  /**
   * Where an entity should be drawn right now, interpolated between the last
   * two ticks. Falls back to the current position for anything spawned this
   * tick, which would otherwise streak in from (0, 0).
   */
  interpolate(entityId: number, currentX: number, currentY: number): InterpolatedPosition {
    const previous = this.previous.get(entityId);
    if (!previous) return { x: currentX, y: currentY };
    const alpha = this.alpha;
    return {
      x: previous.x + (currentX - previous.x) * alpha,
      y: previous.y + (currentY - previous.y) * alpha,
    };
  }

  // -------------------------------------------------------------------------
  // Local input
  // -------------------------------------------------------------------------

  submitDeploy(handIndex: number, tileX: number, tileY: number): number {
    const command: Command = { type: 'deploy', team: this.localTeam, handIndex, tileX, tileY };
    const confirmTick = this.transport.submitCommand(command);
    this.pending.push({ command, confirmTick });
    return confirmTick;
  }

  submitAbility(): number {
    const command: Command = { type: 'ability', team: this.localTeam };
    const confirmTick = this.transport.submitCommand(command);
    this.pending.push({ command, confirmTick });
    return confirmTick;
  }

  submitEmote(emoteId: number): number {
    return this.transport.submitCommand({ type: 'emote', team: this.localTeam, emoteId });
  }

  dispose(): void {
    this.transport.close();
    this.previous.clear();
    this.pending = [];
    this.eventBuffer = [];
  }
}
