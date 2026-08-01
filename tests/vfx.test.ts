/**
 * Effects driven by simulation events.
 *
 * `VfxSystem` keeps its particle pool private, which is right — nothing outside
 * it should be poking at particles — so these tests assert what the pool is
 * *for*: what ends up on the canvas, and for how long. Driving it through
 * `consume` and a recording context checks the same thing a player sees.
 */

import { describe, it, expect, vi } from 'vitest';
import { fx } from '@sim/math/fixed';
import type { SimEvent } from '@sim/types';

/*
 * The drawn effects are real PNGs loaded through `Image`, which does not exist
 * here. The mock stands in a decoded sheet so the sprite pass runs — otherwise
 * every `playEffect` would silently draw nothing and these tests would pass
 * whether or not the animations were wired up at all.
 */
const effectDraws: string[] = [];
vi.mock('@render/effectSprites', async () => {
  const real = await vi.importActual<typeof import('@render/effectSprites')>(
    '@render/effectSprites',
  );
  return {
    ...real,
    effectSheet: (name: string) => ({ name, complete: true, naturalWidth: 1600 }),
    warmEffects: () => {},
    drawEffectFrame: (
      _ctx: unknown,
      sheet: { name: string },
      frame: number,
    ) => {
      effectDraws.push(`${sheet.name}:${frame}`);
    },
  };
});

/*
 * Two particle shapes bake themselves into an offscreen canvas the first time
 * they are drawn. There is no DOM here, so this stands in one that records
 * nothing — enough for the bakery to run, which is all these tests need from
 * it. Without this, asserting on an impact would fail on the smoke rather
 * than on anything to do with the effect under test.
 */
const stubCanvas = () => ({
  width: 0,
  height: 0,
  getContext: () => ({
    fillStyle: '#000',
    globalAlpha: 1,
    createRadialGradient: () => ({ addColorStop: () => {} }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    fillRect: () => {},
    beginPath: () => {},
    arc: () => {},
    fill: () => {},
    save: () => {},
    restore: () => {},
    translate: () => {},
    scale: () => {},
    rotate: () => {},
    drawImage: () => {},
  }),
});
vi.stubGlobal('document', { createElement: stubCanvas });

const { VfxSystem } = await import('@render/vfx');

/** Counts the shapes drawn, which is the only observable a particle has. */
function recordingContext() {
  const calls: Array<{ kind: string; colour: string }> = [];
  const context = {
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    globalAlpha: 1,
    // The particle pass sets a blend mode, so it brackets itself in
    // save/restore rather than leaving `lighter` set for the rest of the frame.
    globalCompositeOperation: 'source-over',
    save: () => {},
    restore: () => {},
    drawImage: () => {},
    beginPath: () => {},
    closePath: () => {},
    arc: () => {},
    ellipse: () => {},
    moveTo: () => {},
    lineTo: () => {},
    quadraticCurveTo: () => {},
    bezierCurveTo: () => {},
    arcTo: () => {},
    rect: () => {},
    roundRect: () => {},
    translate: () => {},
    rotate: () => {},
    scale: () => {},
    setLineDash: () => {},
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    stroke: () => calls.push({ kind: 'stroke', colour: String(context.strokeStyle) }),
    fill: () => calls.push({ kind: 'fill', colour: String(context.fillStyle) }),
    fillRect: () => calls.push({ kind: 'fillRect', colour: String(context.fillStyle) }),
  };
  return { context, calls };
}

type Vfx = InstanceType<typeof VfxSystem>;

function drawnShapes(vfx: Vfx): number {
  const { context, calls } = recordingContext();
  vfx.drawParticles(context as unknown as CanvasRenderingContext2D);
  return calls.length;
}

/** The drawn animations played in one frame, as `name:frame` pairs. */
function drawnEffects(vfx: Vfx): string[] {
  effectDraws.length = 0;
  const { context } = recordingContext();
  vfx.drawParticles(context as unknown as CanvasRenderingContext2D);
  return [...effectDraws];
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

describe('drawn effects', () => {
  const hit = (splash: boolean): SimEvent => ({
    type: 'hit',
    cardId: 'knight',
    x: fx(8),
    y: fx(12),
    damage: 100,
    splash,
  });

  it('plays an authored animation on every impact, not only particles', () => {
    const vfx = new VfxSystem();
    expect(drawnEffects(vfx)).toHaveLength(0);
    vfx.consume([hit(false)], 0);
    expect(drawnEffects(vfx).length).toBeGreaterThan(0);
  });

  it('advances the animation over its life rather than holding one frame', () => {
    /*
     * The whole point of a sprite strip is that it moves. An off-by-one in the
     * frame maths would still draw something on every frame, so asserting
     * "an effect was drawn" is not enough — the frame index has to climb.
     */
    const vfx = new VfxSystem();
    vfx.consume([hit(true)], 0);

    const frames = new Set<number>();
    for (let elapsed = 0; elapsed < 500; elapsed += 32) {
      for (const drawn of drawnEffects(vfx)) frames.add(Number(drawn.split(':')[1]));
      vfx.update(32);
    }
    expect(frames.size).toBeGreaterThan(4);
    expect(Math.max(...frames)).toBeGreaterThan(6);
  });

  it('stops playing once the effect has run out', () => {
    const vfx = new VfxSystem();
    vfx.consume([hit(false)], 0);
    for (let elapsed = 0; elapsed < 2000; elapsed += 32) vfx.update(32);
    expect(drawnEffects(vfx)).toHaveLength(0);
  });

  it('scales a spell to its own radius instead of using the impact size', () => {
    // A spell covers tiles; an impact covers a body. Reusing one size for both
    // is what made a five-aether cast look like a sword swing with extra
    // sparks. There is no size in the recorded name, so this checks that a
    // spell plays *more* drawn animations than a plain hit does.
    const vfx = new VfxSystem();
    vfx.consume([hit(false)], 0);
    const fromHit = drawnEffects(vfx).length;

    const fresh = new VfxSystem();
    fresh.consume(
      [{ type: 'spell', cardId: 'fireball', team: 0, x: fx(8), y: fx(12), radius: fx(2.5) }],
      0,
    );
    expect(drawnEffects(fresh).length).toBeGreaterThan(fromHit);
  });
});
