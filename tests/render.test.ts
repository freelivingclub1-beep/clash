/**
 * Render-layer tests.
 *
 * The canvas work is verified in a browser during development, but a browser
 * only ever shows the frames a real match happens to produce — the run that was
 * meant to prove the ramp tell ended with the pack dying at the bridge before
 * it had built a single stack. A recording context makes the same question
 * answerable on demand: given an entity in a known state, what gets drawn?
 *
 * `./sprites` is stubbed because figure rasterisation needs a real canvas; the
 * overlays under test draw with plain rectangle and ellipse calls that the
 * stub records faithfully.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import '@cards/data';
import { STARTER_DECK, BOT_DECK } from '@cards/data';
import { createMatch, forceSpawn } from '@sim/state';
import { BLUE, RED } from '@sim/nav/grid';
import { DAMAGE_RAMP_STACK_CAP } from '@sim/constants';
import type { Entity, MatchState } from '@sim/types';

vi.mock('@render/sprites', () => ({
  spriteFor: () => ({ source: {} as CanvasImageSource, width: 64, height: 96 }),
}));
vi.mock('@render/textures', () => ({
  texturePattern: () => '#888',
  clearTextureCache: () => {},
}));

const { drawEntities } = await import('@render/entities');

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
  fill: string;
}

/** A CanvasRenderingContext2D stand-in that records the fills it is asked for. */
function recordingContext() {
  const rects: Rect[] = [];
  const roundRects: Rect[] = [];
  const context = {
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    arc: () => {},
    ellipse: () => {},
    rect: () => {},
    roundRect: (x: number, y: number, w: number, h: number) => {
      roundRects.push({ x, y, w, h, fill: String(context.fillStyle) });
    },
    fill: () => {},
    stroke: () => {},
    closePath: () => {},
    translate: () => {},
    rotate: () => {},
    scale: () => {},
    clip: () => {},
    drawImage: () => {},
    fillText: () => {},
    strokeText: () => {},
    measureText: () => ({ width: 10 }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    fillRect: (x: number, y: number, w: number, h: number) => {
      rects.push({ x, y, w, h, fill: String(context.fillStyle) });
    },
    strokeRect: () => {},
    clearRect: () => {},
    setLineDash: () => {},
  };
  return { context, rects, roundRects };
}

/** A MatchRunner stand-in: no interpolation, positions used as-is. */
const stubRunner = {
  interpolate: (_id: number, x: number, y: number) => ({ x, y }),
};

const newMatch = (): MatchState =>
  createMatch({ seed: 606, players: [{ deck: STARTER_DECK }, { deck: BOT_DECK }] });

function render(state: MatchState) {
  const { context, rects, roundRects } = recordingContext();
  drawEntities(
    context as unknown as CanvasRenderingContext2D,
    state,
    stubRunner as never,
    BLUE,
  );
  return Object.assign(rects, { roundRects });
}

/** Warm hues only: the ramp bar is the sole amber-to-red rectangle drawn. */
const isRampBar = (rect: Rect) =>
  rect.h === 4 && (rect.fill === '#ff4d3d' || rect.fill.startsWith('rgb(255,'));

describe('ramp tell', () => {
  let state: MatchState;
  let hound: Entity;

  beforeEach(() => {
    state = newMatch();
    hound = forceSpawn(state, BLUE, 'card_troop_elite_hounds', 8, 12);
    hound.deployTimer = 0;
  });

  it('draws nothing before the first bite lands', () => {
    expect(hound.passiveCharges).toBe(0);
    expect(render(state).filter(isRampBar)).toHaveLength(0);
  });

  it('draws the bar once the ramp is building', () => {
    hound.passiveCharges = 3;
    const bars = render(state).filter(isRampBar);
    expect(bars).toHaveLength(1);
    expect(bars[0].w).toBeGreaterThan(0);
  });

  it('widens the bar as the ramp climbs', () => {
    hound.passiveCharges = 2;
    const early = render(state).filter(isRampBar)[0];
    hound.passiveCharges = 8;
    const late = render(state).filter(isRampBar)[0];
    expect(late.w).toBeGreaterThan(early.w);
  });

  it('turns red and stops growing at the cap', () => {
    hound.passiveCharges = DAMAGE_RAMP_STACK_CAP;
    const capped = render(state).filter(isRampBar)[0];
    expect(capped.fill).toBe('#ff4d3d');

    // The bar tracks the cap, so an out-of-range value cannot overrun it.
    hound.passiveCharges = DAMAGE_RAMP_STACK_CAP * 3;
    expect(render(state).filter(isRampBar)[0].w).toBe(capped.w);
  });

  it('sits clear of the health bar rather than on top of it', () => {
    hound.passiveCharges = 5;
    hound.hp = Math.round(hound.maxHp / 2);
    const rects = render(state);
    const ramp = rects.filter(isRampBar)[0];
    // Health bars are 8 high and share the figure's left edge; other entities
    // draw their own, so match on x to pick out this hound's.
    const health = rects.filter((r) => r.h === 8 && Math.abs(r.x - ramp.x) < 1);
    expect(health.length).toBeGreaterThan(0);
    // Strictly above, and clear of the bar's 2px border.
    for (const bar of health) expect(ramp.y + 4).toBeLessThan(bar.y - 2);
  });

  it('is drawn only for cards that actually ramp', () => {
    const knight = forceSpawn(state, RED, 'card_troop_knight', 8, 14);
    knight.deployTimer = 0;
    // Same storage, different passive: a Knight carries no ramp to show.
    knight.passiveCharges = 7;
    expect(render(state).filter(isRampBar)).toHaveLength(0);
  });
});

describe('armour plate', () => {
  const newHound = () => {
    const state = newMatch();
    const hound = forceSpawn(state, BLUE, 'card_troop_elite_hounds', 8, 12);
    hound.deployTimer = 0;
    return { state, hound };
  };

  it('draws a plate on the body while the armour holds', () => {
    const { state, hound } = newHound();
    expect(hound.shield).toBeGreaterThan(0);
    expect(render(state).roundRects.length).toBeGreaterThan(0);
  });

  it('takes the plate off the instant the armour breaks', () => {
    const { state, hound } = newHound();
    hound.shield = 0;
    expect(render(state).roundRects).toHaveLength(0);
  });

  it('plates each body separately, so a scrum reads at a glance', () => {
    const { state, hound } = newHound();
    const second = forceSpawn(state, BLUE, 'card_troop_elite_hounds', 9, 12);
    second.deployTimer = 0;

    expect(render(state).roundRects).toHaveLength(2);
    hound.shield = 0;
    // One hound down to bare health, one still plated — the whole point.
    expect(render(state).roundRects).toHaveLength(1);
  });

  it('sits on the figure rather than around it', () => {
    const { state } = newHound();
    const plate = render(state).roundRects[0];
    // Narrower than the figure and short: a strapped-on band, not a bubble.
    expect(plate.h).toBeLessThan(plate.w);
    expect(plate.w).toBeGreaterThan(0);
  });

  it('is worn by any shielded unit, not just the hounds', () => {
    const state = newMatch();
    const guard = forceSpawn(state, BLUE, 'card_troop_spear_guards', 8, 12);
    guard.deployTimer = 0;
    expect(guard.shield).toBeGreaterThan(0);
    expect(render(state).roundRects).toHaveLength(1);
  });
});
