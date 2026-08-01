/**
 * Spells travel, and are announced when they land.
 *
 * They were always projectiles — the damage has always resolved on arrival —
 * but the `spell` event was pushed at *cast* time, so the bloom, the
 * shockwave and the screen shake all fired at the destination while the shot
 * was still in the air. The explosion arrived before the fireball did, which
 * is why a spell looked like it hit the instant you dropped it, and why the
 * throw that was already being simulated was invisible behind its own blast.
 *
 * The gameplay half of this was never broken, so a test that only checked
 * damage timing would have passed throughout. These check the announcement
 * too, because that is the half a player actually sees.
 */

import { describe, it, expect, vi } from 'vitest';
import '@cards/data';
import { STARTER_DECK, BOT_DECK } from '@cards/data';
import { getCard, selectableCards } from '@cards/registry';
import { createMatch, forceSpawn } from '@sim/state';
import { stepMatch } from '@sim/tick';
import { TICK_HZ } from '@sim/constants';
import { fx } from '@sim/math/fixed';
import type { Command, Entity, MatchState, SimEvent } from '@sim/types';

/*
 * The renderer half is mocked down to what these tests actually assert: that a
 * spell in flight results in draw calls. Everything below the sprite layer is
 * irrelevant to that and needs a real canvas to run.
 */
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
vi.mock('@render/effectSprites', async () => {
  const real = await vi.importActual<typeof import('@render/effectSprites')>(
    '@render/effectSprites',
  );
  return { ...real, effectSheet: () => null, warmEffects: () => {}, drawEffectFrame: () => {} };
});

const { drawEntities } = await import('@render/entities');

const newMatch = (seed = 31337): MatchState =>
  createMatch({ seed, players: [{ deck: STARTER_DECK }, { deck: BOT_DECK }] });

/**
 * Cast a spell by hand.
 *
 * Through `resolveCommands` rather than by poking the projectile system, so
 * the ordering under test is the one a real cast goes through.
 */
function cast(tileX: number, tileY: number): Command[] {
  return [{ type: 'deploy', team: 0, handIndex: 0, tileX, tileY }];
}

/** Give the caster the card and the aether to pay for it. */
function ready(state: MatchState, cardId: string): void {
  state.players[0].hand[0] = cardId;
  state.players[0].aetherPoints = 100000;
}

/** Step one tick and return the events it produced. */
function tick(state: MatchState, commands: readonly Command[] = []): SimEvent[] {
  stepMatch(state, commands);
  return [...state.events];
}

function target(state: MatchState): Entity {
  const e = forceSpawn(state, 1, 'card_troop_knight', 8, 20);
  e.deployTimer = 0;
  // Frozen so it cannot walk out from under the spell while it is in the air.
  e.freezeTicks = 600;
  return e;
}

/** Ticks until the spell is announced, or -1 if it never was. */
function ticksToLanding(cardId: string, seconds = 4): number {
  const state = newMatch();
  target(state);
  ready(state, cardId);
  const order = cast(8, 20);
  for (let i = 0; i < seconds * TICK_HZ; i++) {
    if (tick(state, i === 0 ? order : []).some((e) => e.type === 'spell' && e.cardId === cardId)) {
      return i;
    }
  }
  return -1;
}

describe('spell flight', () => {
  it('does not announce a fireball on the tick it is cast', () => {
    const state = newMatch();
    target(state);
    ready(state, 'card_spell_fireball');
    const events = tick(state, cast(8, 20));
    expect(events.some((e) => e.type === 'spell')).toBe(false);
  });

  it('does not damage on the tick it is cast either', () => {
    const state = newMatch();
    const victim = target(state);
    ready(state, 'card_spell_fireball');
    tick(state, cast(8, 20));
    expect(victim.hp).toBe(victim.maxHp);
  });

  it('puts something in the air on the way', () => {
    /*
     * The projectile is the thing the player is meant to watch. If a future
     * change resolved the spell directly it would still damage on schedule and
     * still announce at the end, and the throw would be gone again.
     */
    const state = newMatch();
    target(state);
    ready(state, 'card_spell_fireball');
    tick(state, cast(8, 20));
    const inFlight = state.entities.filter(
      (e) => e.alive && e.kind === 'projectile' && e.cardId === 'card_spell_fireball',
    );
    expect(inFlight).toHaveLength(1);
  });

  it('lands, damages and announces on the same tick', () => {
    const state = newMatch();
    const victim = target(state);
    ready(state, 'card_spell_fireball');
    const order = cast(8, 20);

    let landedAt = -1;
    let hpWhenAnnounced = victim.hp;
    for (let i = 0; i < 4 * TICK_HZ && landedAt < 0; i++) {
      const events = tick(state, i === 0 ? order : []);
      if (events.some((e) => e.type === 'spell')) {
        landedAt = i;
        hpWhenAnnounced = victim.hp;
      }
    }
    expect(landedAt).toBeGreaterThan(0);
    expect(hpWhenAnnounced).toBeLessThan(victim.maxHp);
  });

  it('takes roughly the flight time the card declares', () => {
    const card = getCard('card_spell_fireball');
    const expected = card.castTravelSeconds * TICK_HZ;
    const actual = ticksToLanding('card_spell_fireball');
    // Loose, because the projectile steps in whole ticks and snaps on arrival.
    expect(actual).toBeGreaterThan(expected * 0.7);
    expect(actual).toBeLessThan(expected * 1.4);
  });

  it('cracks a Zap almost immediately and lobs a Fireball', () => {
    /*
     * The reason flight time is per card rather than one constant. A Zap you
     * cannot react to and a Fireball you can are different cards; when every
     * spell flew the same fixed distance they were the same card at different
     * radii.
     */
    const zap = ticksToLanding('card_spell_zap');
    const fireball = ticksToLanding('card_spell_fireball');
    expect(zap).toBeGreaterThanOrEqual(0);
    expect(fireball).toBeGreaterThan(zap * 3);
  });

  it('throws from behind the caster rather than from the target', () => {
    // Blue casts from the low end of the board, so its spells must come in
    // from below the impact point — which is what makes the arc read as a
    // throw from your own side rather than something appearing overhead.
    const state = newMatch();
    target(state);
    ready(state, 'card_spell_fireball');
    tick(state, cast(8, 20));
    const shot = state.entities.find((e) => e.alive && e.kind === 'projectile');
    expect(shot).toBeDefined();
    expect((shot as Entity).y).toBeLessThan(fx(20));
  });

  it('gives every spell in the roster a flight time', () => {
    for (const card of selectableCards()) {
      if (card.category !== 'Spell') continue;
      expect(card.castTravelSeconds, card.name).toBeGreaterThan(0);
    }
  });
});

/** Counts the drawing the renderer is asked to do. */
function countingContext() {
  let ops = 0;
  const noop = () => { ops++; };
  const context = {
    fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, globalAlpha: 1,
    globalCompositeOperation: 'source-over', font: '', textAlign: 'left', textBaseline: 'alphabetic',
    save: () => {}, restore: () => {}, beginPath: () => {}, closePath: () => {},
    moveTo: () => {}, lineTo: () => {}, quadraticCurveTo: () => {}, bezierCurveTo: () => {},
    arcTo: () => {}, arc: () => {}, ellipse: () => {}, rect: () => {}, roundRect: () => {},
    translate: () => {}, rotate: () => {}, scale: () => {}, clip: () => {},
    measureText: () => ({ width: 10 }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    createRadialGradient: () => ({ addColorStop: () => {} }),
    setLineDash: () => {},
    fill: noop, stroke: noop, fillRect: noop, strokeRect: noop, clearRect: () => {},
    drawImage: noop, fillText: noop, strokeText: noop,
  };
  return { context, ops: () => ops };
}

const stubRunner = { alpha: 0, interpolate: (_id: number, x: number, y: number) => ({ x, y }) };

describe('the throw is drawn', () => {
  it('draws the shot while it is still in the air', () => {
    /*
     * The point of the whole change. Damage timing and event timing can both
     * be correct while nothing is on screen between the cast and the blast —
     * which is what a player would still call an instant hit.
     */
    const state = newMatch();
    target(state);
    ready(state, 'card_spell_fireball');
    tick(state, cast(8, 20));

    const before = countingContext();
    drawEntities(before.context as unknown as CanvasRenderingContext2D, state, stubRunner as never, 0);
    const withShot = before.ops();

    // Now remove the shot and draw the same board again.
    for (const e of state.entities) if (e.kind === 'projectile') e.alive = false;
    const after = countingContext();
    drawEntities(after.context as unknown as CanvasRenderingContext2D, state, stubRunner as never, 0);

    expect(withShot).toBeGreaterThan(after.ops());
  });

  it('keeps drawing it for most of the flight, not just the first tick', () => {
    const state = newMatch();
    target(state);
    ready(state, 'card_spell_fireball');
    const order = cast(8, 20);

    let framesWithShot = 0;
    for (let i = 0; i < 2 * TICK_HZ; i++) {
      tick(state, i === 0 ? order : []);
      if (state.entities.some((e) => e.alive && e.kind === 'projectile')) framesWithShot++;
    }
    // A full second of travel at thirty ticks a second.
    expect(framesWithShot).toBeGreaterThan(20);
  });
});
