/**
 * Effects driven by simulation events.
 *
 * `VfxSystem` keeps its particle pool private, which is right — nothing outside
 * it should be poking at particles — so these tests assert what the pool is
 * *for*: what ends up on the canvas, and for how long. Driving it through
 * `consume` and a recording context checks the same thing a player sees.
 */

import { describe, it, expect } from 'vitest';
import { VfxSystem } from '@render/vfx';
import { fx } from '@sim/math/fixed';
import type { SimEvent } from '@sim/types';

/** Counts the shapes drawn, which is the only observable a particle has. */
function recordingContext() {
  const calls: Array<{ kind: string; colour: string }> = [];
  const context = {
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    globalAlpha: 1,
    beginPath: () => {},
    arc: () => {},
    ellipse: () => {},
    stroke: () => calls.push({ kind: 'stroke', colour: String(context.strokeStyle) }),
    fill: () => calls.push({ kind: 'fill', colour: String(context.fillStyle) }),
    fillRect: () => calls.push({ kind: 'fillRect', colour: String(context.fillStyle) }),
  };
  return { context, calls };
}

function drawnShapes(vfx: VfxSystem): number {
  const { context, calls } = recordingContext();
  vfx.drawParticles(context as unknown as CanvasRenderingContext2D);
  return calls.length;
}

const shieldBreak = (): SimEvent => ({
  type: 'shieldBreak',
  entityId: 1,
  team: 0,
  x: fx(8),
  y: fx(12),
});

describe('armour break', () => {
  it('throws the plate off as debris', () => {
    const vfx = new VfxSystem();
    expect(drawnShapes(vfx)).toBe(0);
    vfx.consume([shieldBreak()], 0);
    expect(drawnShapes(vfx)).toBeGreaterThan(5);
  });

  it('clears the debris quickly rather than leaving it lying about', () => {
    /*
     * The requirement is explicit: armour that pops off must not stay on the
     * ground. Debris outliving the moment it belongs to becomes litter you
     * have to read past during the next exchange, which is the opposite of
     * what a tell is for.
     */
    const vfx = new VfxSystem();
    vfx.consume([shieldBreak()], 0);

    // Advanced a frame at a time: `update` clamps a single delta to 64ms so a
    // backgrounded tab cannot teleport every particle on the first frame back.
    const advance = (ms: number) => {
      for (let elapsed = 0; elapsed < ms; elapsed += 16) vfx.update(16);
    };

    // Still visible a fifth of a second in — it has to be seen at all.
    advance(180);
    expect(drawnShapes(vfx)).toBeGreaterThan(0);

    // Gone within half a second of the hit landing.
    advance(340);
    expect(drawnShapes(vfx)).toBe(0);
  });

  it('does not shake the screen for a plate coming off', () => {
    // A tower falling shakes; one unit losing its armour must not, or a swarm
    // of shielded bodies turns a fight into an earthquake.
    const vfx = new VfxSystem();
    vfx.consume([shieldBreak()], 0);
    const offset = vfx.shakeOffset();
    expect(offset.x).toBe(0);
    expect(offset.y).toBe(0);
  });
});
