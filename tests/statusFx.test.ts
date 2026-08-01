/**
 * Status tells are animations, and must stay animations.
 *
 * A frozen unit used to be a translucent blue rectangle laid over its sprite
 * and a poisoned one a green rectangle — legible, and completely inert. They
 * are drawn loops now, with the flat fills kept only as the fallback for the
 * moment before an effect sheet has decoded.
 *
 * That fallback is exactly why this file exists. If the animation path breaks,
 * the rectangles still appear, the status is still visible, and every existing
 * test still passes — the game simply looks the way it did before. So these
 * tests assert the animated path specifically: with a sheet available, a
 * status must reach `drawEffectFrame` and must *not* fall back.
 */

import { describe, it, expect, vi } from 'vitest';
import '@cards/data';
import { STARTER_DECK, BOT_DECK } from '@cards/data';
import { createMatch, forceSpawn } from '@sim/state';
import type { Entity, MatchState } from '@sim/types';

vi.mock('@render/sprites', async () => {
  const models = await import('@render/models');
  return {
    spriteFor: () => ({ source: {} as CanvasImageSource, width: 96, height: 96 }),
    blitSprite: () => {},
    blitFigure: () => {},
    modelFor: (card: { modelId: string }) =>
      models.modelSpec(card.modelId, {
        body: 'humanoid',
        head: 'none',
        weapon: 'none',
        accessory: 'none',
        scale: 1,
        build: 'normal',
        trim: 'sash',
      }),
  };
});
vi.mock('@render/textures', () => ({
  texturePattern: () => '#888',
  clearTextureCache: () => {},
}));

/** Effects played this frame, as `name:frame`. */
const played: string[] = [];

vi.mock('@render/effectSprites', async () => {
  const real = await vi.importActual<typeof import('@render/effectSprites')>(
    '@render/effectSprites',
  );
  return {
    ...real,
    // A decoded sheet is always available, which is the case these tests are
    // about; the null case is the one the production fallback covers.
    effectSheet: (name: string) => ({ name }),
    warmEffects: () => {},
    drawEffectFrame: (_ctx: unknown, sheet: { name: string }, frame: number) => {
      played.push(`${sheet.name}:${frame}`);
    },
  };
});

const { drawEntities } = await import('@render/entities');

function recordingContext() {
  const fills: string[] = [];
  const context = {
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    save: () => {},
    restore: () => {},
    beginPath: () => {},
    closePath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    quadraticCurveTo: () => {},
    bezierCurveTo: () => {},
    arcTo: () => {},
    arc: () => {},
    ellipse: () => {},
    rect: () => {},
    roundRect: () => {},
    fill: () => {},
    stroke: () => {},
    translate: () => {},
    rotate: () => {},
    scale: () => {},
    clip: () => {},
    drawImage: () => {},
    fillText: () => {},
    strokeText: () => {},
    measureText: () => ({ width: 10 }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    fillRect: () => fills.push(String(context.fillStyle)),
    strokeRect: () => {},
    clearRect: () => {},
    setLineDash: () => {},
  };
  return { context, fills };
}

/*
 * `alpha` matters here in a way it does not for a positional test.
 *
 * The animation clock is `state.tick + runner.alpha`. Leaving it off makes
 * that NaN, every frame index NaN, and every assertion of the form "an effect
 * called X was played" pass anyway — which is how this file first went green
 * with the loop frozen.
 */
const stubRunner = {
  alpha: 0,
  interpolate: (_id: number, x: number, y: number) => ({ x, y }),
};

const newMatch = (): MatchState =>
  createMatch({ seed: 808, players: [{ deck: STARTER_DECK }, { deck: BOT_DECK }] });

/** Draw one frame and report what was played and what was filled. */
function render(state: MatchState) {
  played.length = 0;
  const { context, fills } = recordingContext();
  drawEntities(
    context as unknown as CanvasRenderingContext2D,
    state,
    stubRunner as never,
    0,
  );
  return { played, fills };
}

function place(state: MatchState, cardId: string): Entity {
  const e = forceSpawn(state, 0, cardId, 8, 12);
  e.deployTimer = 0;
  return e;
}

describe('status tells', () => {
  it('plays a frost animation on a frozen unit rather than tinting it', () => {
    const state = newMatch();
    const unit = place(state, 'card_troop_knight');
    expect(render(state).played.some((p) => p.startsWith('freezing'))).toBe(false);

    unit.freezeTicks = 60;
    const { played: after, fills } = render(state);
    expect(after.some((p) => p.startsWith('freezing'))).toBe(true);
    // The flat blue wash must not also be painted — that is the fallback.
    expect(fills).not.toContain('rgba(140,220,255,0.35)');
  });

  it('plays a rot animation on a poisoned unit', () => {
    const state = newMatch();
    const unit = place(state, 'card_troop_knight');
    unit.poisonTicks = 60;
    const { played: after, fills } = render(state);
    expect(after.some((p) => p.startsWith('felspell'))).toBe(true);
    expect(fills).not.toContain('rgba(120,200,90,0.28)');
  });

  it('plays a rage animation on an enraged unit', () => {
    const state = newMatch();
    const unit = place(state, 'card_troop_knight');
    unit.rageTicks = 60;
    expect(render(state).played.some((p) => p.startsWith('magic8'))).toBe(true);
  });

  it('burns at the feet of a charging unit', () => {
    const state = newMatch();
    const unit = place(state, 'card_troop_knight');
    unit.charging = true;
    expect(render(state).played.some((p) => p.startsWith('firespin'))).toBe(true);
  });

  it('haloes an evolved unit', () => {
    const state = newMatch();
    const unit = place(state, 'card_troop_knight');
    unit.evolved = true;
    expect(render(state).played.some((p) => p.startsWith('protectioncircle'))).toBe(true);
  });

  it('advances the loop over time instead of holding one frame', () => {
    /*
     * A status lasting several seconds and showing one frame the whole way
     * through is the failure that looks like success: something is drawn, the
     * status is legible, and the animation is not running.
     */
    const state = newMatch();
    const unit = place(state, 'card_troop_knight');
    unit.freezeTicks = 300;

    const frames = new Set<string>();
    for (let i = 0; i < 40; i++) {
      state.tick = i * 2;
      for (const drawn of render(state).played) {
        if (drawn.startsWith('freezing')) frames.add(drawn);
      }
    }
    expect(frames.size).toBeGreaterThan(4);
    // And every one of them is a real frame index, not a NaN wearing a name.
    for (const drawn of frames) expect(Number.isInteger(Number(drawn.split(':')[1]))).toBe(true);
  });
});
