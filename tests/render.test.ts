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
import { fireProjectileFrom, resolveStats } from '@sim/entities';
import { BLUE, RED } from '@sim/nav/grid';
import { DAMAGE_RAMP_STACK_CAP } from '@sim/constants';
import type { Entity, MatchState } from '@sim/types';

vi.mock('@render/sprites', async () => {
  // `modelFor` is pure data lookup and is what projectile looks are keyed off,
  // so it is passed through; only rasterisation needs a real canvas.
  const models = await import('@render/models');
  return {
    spriteFor: () => ({ source: {} as CanvasImageSource, width: 64, height: 96 }),
    modelFor: (card: { modelId: string }) =>
      models.modelSpec(card.modelId, { body: 'humanoid', head: 'none', weapon: 'none', accessory: 'none', scale: 1 }),
  };
});
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
  const ops: string[] = [];
  const dashes: number[][] = [];
  const context = {
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    globalAlpha: 1,
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    save: () => ops.push('save'),
    restore: () => ops.push('restore'),
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
    translate: (x: number, y: number) => ops.push(`translate:${Math.round(x)},${Math.round(y)}`),
    rotate: (a: number) => ops.push(`rotate:${a.toFixed(3)}`),
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
    setLineDash: (pattern: number[]) => {
      if (pattern.length) dashes.push(pattern);
      ops.push(`dash:${pattern.length}`);
    },
  };
  return { context, rects, roundRects, ops, dashes };
}

/** A MatchRunner stand-in: no interpolation, positions used as-is. */
const stubRunner = {
  interpolate: (_id: number, x: number, y: number) => ({ x, y }),
};

const newMatch = (): MatchState =>
  createMatch({ seed: 606, players: [{ deck: STARTER_DECK }, { deck: BOT_DECK }] });

function render(state: MatchState) {
  const { context, rects, roundRects, ops, dashes } = recordingContext();
  drawEntities(
    context as unknown as CanvasRenderingContext2D,
    state,
    stubRunner as never,
    BLUE,
  );
  return Object.assign(rects, { roundRects, ops, dashes });
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

describe('projectiles', () => {
  /** A shot in mid-flight from `from` toward `to`, at `progress` along it. */
  const shotInFlight = (cardId: string, progress: number) => {
    const state = newMatch();
    const shooter = forceSpawn(state, BLUE, cardId, 8, 10);
    shooter.deployTimer = 0;
    const victim = forceSpawn(state, RED, 'card_troop_knight', 8, 14);
    victim.deployTimer = 0;

    const stats = resolveStats(cardId, shooter.level, false);
    const shot = fireProjectileFrom(state, shooter, victim, 100, stats.splashRadius, false);
    shot.x = shooter.x + Math.round((victim.x - shooter.x) * progress);
    shot.y = shooter.y + Math.round((victim.y - shooter.y) * progress);
    shot.faceX = victim.x - shooter.x;
    shot.faceY = victim.y - shooter.y;
    return { state, shot };
  };

  it('points a flat shot along its heading', () => {
    const { state } = shotInFlight('card_troop_archers', 0.5);
    const rotations = render(state)
      .ops.filter((op) => op.startsWith('rotate:'))
      .map((op) => Number(op.slice(7)));
    expect(rotations.length).toBeGreaterThan(0);
    // Firing straight down the board: every rotation is the same heading, not
    // a tumble, and not zero.
    expect(new Set(rotations.map((r) => r.toFixed(3))).size).toBe(1);
    expect(Math.abs(rotations[0])).toBeGreaterThan(0.1);
  });

  it('tumbles a lobbed shot instead of pointing it', () => {
    const early = shotInFlight('card_troop_bomber', 0.2);
    const late = shotInFlight('card_troop_bomber', 0.8);
    const angleOf = (r: ReturnType<typeof render>) =>
      Number(r.ops.filter((op) => op.startsWith('rotate:')).at(-1)?.slice(7));
    expect(angleOf(render(early.state))).not.toBe(angleOf(render(late.state)));
  });

  it('shows a lobbed shot where it is going to land', () => {
    // The dashed impact ring is the only way to read a Bomber's shot before it
    // arrives, which is the entire reason it is drawn.
    const { state } = shotInFlight('card_troop_bomber', 0.4);
    expect(render(state).dashes.length).toBeGreaterThan(0);
  });

  it('draws no impact ring for a flat shot', () => {
    const { state } = shotInFlight('card_troop_archers', 0.4);
    expect(render(state).dashes).toHaveLength(0);
  });

  it('grows the trail as the shot travels', () => {
    const near = render(shotInFlight('card_troop_archers', 0.02).state);
    const far = render(shotInFlight('card_troop_archers', 0.9).state);
    const bodies = (r: ReturnType<typeof render>) => r.ops.filter((op) => op.startsWith('rotate:')).length;
    // A shot that has only just left the bow must not arrive with a full trail
    // already stretched out behind it.
    expect(bodies(near)).toBeLessThan(bodies(far));
  });
});
