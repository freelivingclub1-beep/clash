/**
 * The transport seam.
 *
 * Every input — human, bot, or (later) remote — reaches the simulation through
 * this interface as a confirmed `InputFrame`. The simulation itself has no
 * notion of who produced a command or how it arrived.
 *
 * The shape is deliberately the shape a lockstep server needs: commands are
 * submitted for a *future* tick, and the runner may not advance past a tick
 * whose frame has not been confirmed. Running locally that confirmation is
 * instant, but the code path is identical, so the artificial delay below is
 * doing real work — it is what makes the ghost-placement mechanic exercise the
 * same confirmation flow it will use against a real server.
 */

import type { Command, InputFrame } from '@sim/types';

export interface MatchTransport {
  /**
   * Queue a command. Returns the tick it is scheduled to land on, so callers
   * can show an unconfirmed preview until then.
   */
  submitCommand(command: Command): number;

  /**
   * The confirmed frame for `tick`, or null if it has not arrived yet. A null
   * return means the runner must stall rather than simulate ahead.
   */
  frameFor(tick: number): InputFrame | null;

  /** Ticks between submitting a command and it becoming eligible to run. */
  readonly inputDelayTicks: number;

  close(): void;
}

/**
 * In-process transport: commands are bucketed forward by `inputDelayTicks` and
 * confirmed immediately. Never stalls.
 */
export class LocalTransport implements MatchTransport {
  private readonly pending = new Map<number, Command[]>();
  private currentTick = 0;

  /**
   * Two ticks (~67ms) mirrors the frame bucketing a server would use. It is
   * small enough to feel instant and large enough that a bug in the
   * unconfirmed-preview path shows up locally instead of only against a server.
   */
  constructor(readonly inputDelayTicks = 2) {}

  submitCommand(command: Command): number {
    const targetTick = this.currentTick + this.inputDelayTicks;
    const bucket = this.pending.get(targetTick);
    if (bucket) bucket.push(command);
    else this.pending.set(targetTick, [command]);
    return targetTick;
  }

  frameFor(tick: number): InputFrame {
    this.currentTick = tick;
    const commands = this.pending.get(tick) ?? [];
    this.pending.delete(tick);
    return { tick, commands };
  }

  close(): void {
    this.pending.clear();
  }
}

/**
 * Records every frame that passes through another transport.
 *
 * A seed plus this command log is a complete, replayable match — which is what
 * makes the determinism guarantee testable rather than merely asserted.
 */
export class RecordingTransport implements MatchTransport {
  readonly frames: InputFrame[] = [];

  constructor(private readonly inner: MatchTransport) {}

  get inputDelayTicks(): number {
    return this.inner.inputDelayTicks;
  }

  submitCommand(command: Command): number {
    return this.inner.submitCommand(command);
  }

  frameFor(tick: number): InputFrame | null {
    const frame = this.inner.frameFor(tick);
    if (frame && frame.commands.length > 0) {
      this.frames.push({ tick: frame.tick, commands: [...frame.commands] });
    }
    return frame;
  }

  close(): void {
    this.inner.close();
  }
}

/** Replays a recorded log. Used by tests to re-run a match exactly. */
export class ReplayTransport implements MatchTransport {
  private readonly byTick = new Map<number, Command[]>();
  readonly inputDelayTicks = 0;

  constructor(frames: readonly InputFrame[]) {
    for (const frame of frames) this.byTick.set(frame.tick, [...frame.commands]);
  }

  submitCommand(): number {
    // A replay is closed to new input by definition.
    return -1;
  }

  frameFor(tick: number): InputFrame {
    return { tick, commands: this.byTick.get(tick) ?? [] };
  }

  close(): void {
    this.byTick.clear();
  }
}
