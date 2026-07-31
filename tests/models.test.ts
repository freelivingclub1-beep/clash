import { describe, it, expect } from 'vitest';
import '@cards/data';
import { BUILTIN_CARDS } from '@cards/data';
import { selectableCards, getCard } from '@cards/registry';
import { MODELS, knownModelIds } from '@render/models';
import { PASSIVE_EPP_COST } from '@cards/balance';
import { hasPassive } from '@sim/scripts/passives';
import { createMatch, forceSpawn } from '@sim/state';
import { stepMatch, stepMatchBy, hashMatchState } from '@sim/tick';
import { STARTER_DECK, BOT_DECK } from '@cards/data';
import { BLUE, RED, isRiverTile } from '@sim/nav/grid';
import { AP_PER_AETHER, TICK_HZ } from '@sim/constants';
import { fxToFloat } from '@sim/math/fixed';
import { applyDamage } from '@sim/entities';
import type { Command, MatchState } from '@sim/types';

const newMatch = (): MatchState =>
  createMatch({ seed: 3131, players: [{ deck: STARTER_DECK }, { deck: BOT_DECK }] });

const play = (state: MatchState, cardId: string, tileX = 8, tileY = 10) => {
  state.players[BLUE].hand[0] = cardId;
  state.players[BLUE].aetherPoints = 10 * AP_PER_AETHER;
  const command: Command = { type: 'deploy', team: BLUE, handIndex: 0, tileX, tileY };
  stepMatch(state, [command]);
  return state.entities.filter((e) => e.alive && e.cardId === cardId);
};

// ---------------------------------------------------------------------------

describe('character models', () => {
  /**
   * The whole reason the model system exists: figures used to be derived from
   * stats, so every melee tank drew identically and a mixed board read as one
   * repeated unit. Two cards sharing a model is a regression, not a detail.
   */
  it('gives every selectable card its own model', () => {
    const seen = new Map<string, string>();
    const collisions: string[] = [];

    for (const card of selectableCards()) {
      if (card.category === 'Spell') continue; // spells have no figure
      const previous = seen.get(card.modelId);
      if (previous) collisions.push(`${card.name} shares "${card.modelId}" with ${previous}`);
      seen.set(card.modelId, card.name);
    }
    expect(collisions).toEqual([]);
  });

  it('resolves every referenced model in the registry', () => {
    const missing = BUILTIN_CARDS.filter(
      (card) => card.category !== 'Spell' && !MODELS[card.modelId],
    ).map((card) => `${card.name} -> "${card.modelId}"`);
    expect(missing).toEqual([]);
  });

  it('never leaves a non-spell card without a model id', () => {
    for (const card of BUILTIN_CARDS) {
      if (card.category === 'Spell') continue;
      expect(card.modelId, `${card.name}`).not.toBe('');
    }
  });

  it('builds each model from a distinct combination of parts', () => {
    const signatures = new Map<string, string>();
    const duplicates: string[] = [];
    for (const id of knownModelIds()) {
      const spec = MODELS[id];
      const signature = `${spec.body}|${spec.head}|${spec.weapon}|${spec.accessory}`;
      const previous = signatures.get(signature);
      if (previous) duplicates.push(`${id} is identical to ${previous}`);
      signatures.set(signature, id);
    }
    expect(duplicates).toEqual([]);
  });

  it('covers a wide spread of body plans rather than reskinning one', () => {
    const plans = new Set(knownModelIds().map((id) => MODELS[id].body));
    expect(plans.size).toBeGreaterThanOrEqual(10);
  });
});

// ---------------------------------------------------------------------------

describe('targeting spread', () => {
  const troops = () => BUILTIN_CARDS.filter((c) => c.category !== 'Spell');

  it('uses all four target priorities across the roster', () => {
    const used = new Set(troops().map((c) => c.targetPriority));
    expect([...used].sort()).toEqual(['AirAndGround', 'AirOnly', 'Buildings', 'Ground']);
  });

  it('has at least two dedicated anti-air cards', () => {
    const airOnly = troops().filter((c) => c.targetPriority === 'AirOnly');
    expect(airOnly.length).toBeGreaterThanOrEqual(2);
  });

  it('has building-targeting win conditions and flying troops to answer', () => {
    expect(troops().filter((c) => c.targetPriority === 'Buildings').length).toBeGreaterThanOrEqual(3);
    expect(troops().filter((c) => c.isFlying).length).toBeGreaterThanOrEqual(4);
  });

  /**
   * Asserted in a running match rather than on the card data: an air-only
   * card that still damaged ground would be a targeting bug, and the card
   * definition alone cannot prove it does not.
   */
  it('an air-only card cannot damage a ground troop', () => {
    const state = newMatch();
    const talons = play(state, 'card_troop_sky_talon', 8, 12);
    expect(talons.length).toBe(1);
    stepMatchBy(state, TICK_HZ + 2);

    const groundVictim = forceSpawn(state, RED, 'card_troop_knight', 8, 13);
    groundVictim.deployTimer = 0;
    // Pinned in place: left free it walks down-field into blue's own tower
    // range, and the tower's damage would be misread as the Talon's.
    groundVictim.speed = 0;
    const before = groundVictim.hp;

    stepMatchBy(state, 120);
    expect(groundVictim.hp).toBe(before);
    // And the Talon must never even acquire it as a target.
    expect(talons[0].targetId).not.toBe(groundVictim.id);
  });

  it('an air-only card does damage a flying troop', () => {
    const state = newMatch();
    play(state, 'card_troop_sky_talon', 8, 12);
    stepMatchBy(state, TICK_HZ + 2);

    const flyer = forceSpawn(state, RED, 'card_troop_minions', 8, 13);
    flyer.deployTimer = 0;
    const before = flyer.hp;

    stepMatchBy(state, 120);
    expect(flyer.hp).toBeLessThan(before);
  });

  it('a ground-only card cannot damage a flier', () => {
    const state = newMatch();
    play(state, 'card_troop_bastion_turtle', 8, 12);
    stepMatchBy(state, TICK_HZ + 2);

    const flyer = forceSpawn(state, RED, 'card_troop_minions', 8, 13);
    flyer.deployTimer = 0;
    flyer.targetId = -1;
    const before = flyer.hp;

    stepMatchBy(state, 90);
    expect(flyer.hp).toBe(before);
  });
});

// ---------------------------------------------------------------------------

describe('second-wave passives', () => {
  it('prices every passive the new cards name', () => {
    for (const card of BUILTIN_CARDS) {
      if (card.passiveId === 'none') continue;
      expect(hasPassive(card.passiveId), `${card.name}`).toBe(true);
      expect(PASSIVE_EPP_COST[card.passiveId], `${card.name} price`).toBeGreaterThan(0);
    }
  });

  it('Powder Cart detonates and destroys itself on contact', () => {
    const state = newMatch();
    const carts = play(state, 'card_troop_powder_cart', 8, 12);
    expect(carts.length).toBe(1);
    const cart = carts[0];
    cart.deployTimer = 0;

    // Give it a building to charge, since it targets buildings only.
    const target = forceSpawn(state, RED, 'card_building_cannon', 8, 13);
    target.deployTimer = 0;
    const targetBefore = target.hp;

    stepMatchBy(state, 200);
    expect(target.hp).toBeLessThan(targetBefore);
    // The cart is consumed by its own attack.
    expect(state.entities.some((e) => e.alive && e.id === cart.id)).toBe(false);
  });

  it('Marsh Walker crosses the river away from a bridge', () => {
    const state = newMatch();
    // Dropped mid-map, far from either bridge column.
    const walkers = play(state, 'card_troop_marsh_walker', 9, 14);
    expect(walkers.length).toBe(1);
    const walker = walkers[0];
    expect(walker.ignoresTerrain).toBe(true);

    let crossedOffBridge = false;
    for (let i = 0; i < 900 && !crossedOffBridge; i++) {
      stepMatch(state);
      const tx = Math.floor(fxToFloat(walker.x));
      const ty = Math.floor(fxToFloat(walker.y));
      // Standing on a tile that is water proves it is not using a bridge.
      if (walker.alive && isRiverTile(state.grid, tx, ty)) crossedOffBridge = true;
    }
    expect(crossedOffBridge).toBe(true);
  });

  it('Mirror Shade splits off one weakened copy, and the copy does not split', () => {
    const state = newMatch();
    const shades = play(state, 'card_troop_mirror_shade', 8, 12);
    const shade = shades[0];
    shade.deployTimer = 0;

    applyDamage(state, shade, 100);
    const copies = state.entities.filter((e) => e.alive && e.cardId === 'card_troop_mirror_shade');
    expect(copies.length).toBe(2);

    const copy = copies.find((e) => e.id !== shade.id)!;
    expect(copy.maxHp).toBeLessThan(shade.maxHp);
    expect(copy.passiveCharges).toBe(0);

    // Damaging either again must not produce a third body.
    applyDamage(state, shade, 100);
    applyDamage(state, copy, 100);
    expect(
      state.entities.filter((e) => e.alive && e.cardId === 'card_troop_mirror_shade').length,
    ).toBe(2);
  });

  it('Bastion Turtle takes less damage from the front than from behind', () => {
    const state = newMatch();
    const turtle = play(state, 'card_troop_bastion_turtle', 8, 12)[0];
    turtle.deployTimer = 0;

    // Facing "up-field" toward higher Y, which is where blue advances.
    turtle.faceX = 0;
    turtle.faceY = 65536;

    const front = forceSpawn(state, RED, 'card_troop_knight', 8, 14);
    front.deployTimer = 0;
    const behind = forceSpawn(state, RED, 'card_troop_knight', 8, 10);
    behind.deployTimer = 0;

    turtle.hp = turtle.maxHp;
    applyDamage(state, turtle, 400, front);
    const frontalLoss = turtle.maxHp - turtle.hp;

    turtle.hp = turtle.maxHp;
    applyDamage(state, turtle, 400, behind);
    const rearLoss = turtle.maxHp - turtle.hp;

    expect(frontalLoss).toBeLessThan(rearLoss);
  });

  it('Longshot grows its maximum health while it survives', () => {
    const state = newMatch();
    const longshot = play(state, 'card_troop_longshot', 8, 12)[0];
    longshot.deployTimer = 0;
    const startingMax = longshot.maxHp;

    stepMatchBy(state, TICK_HZ * 3);
    expect(longshot.maxHp).toBeGreaterThan(startingMax);
  });

  it('Sand Burrower is untargetable while travelling', () => {
    const state = newMatch();
    const burrower = play(state, 'card_troop_sand_burrower', 8, 12)[0];
    stepMatchBy(state, TICK_HZ + 10);
    // It is marching at the enemy tower with nothing in sight, so it is under.
    expect(burrower.invisibleTicks).toBeGreaterThan(0);
  });

  it('Brood Nest produces skeletons over time', () => {
    const state = newMatch();
    play(state, 'card_building_brood_nest', 8, 12);
    const before = state.entities.filter((e) => e.cardId === 'card_troop_skeletons').length;
    stepMatchBy(state, TICK_HZ * 10);
    const after = state.entities.filter((e) => e.cardId === 'card_troop_skeletons').length;
    expect(after).toBeGreaterThan(before);
  });

  it('Void Stalker arrives next to the nearest enemy rather than where it was dropped', () => {
    const state = newMatch();
    const bait = forceSpawn(state, RED, 'card_troop_knight', 12, 14);
    bait.deployTimer = 0;

    const stalker = play(state, 'card_troop_void_stalker', 4, 12)[0];
    // Dropped at x=4 but blinked toward the target at x=12.
    expect(fxToFloat(stalker.x)).toBeGreaterThan(8);
  });

  it('Banner Sergeant enrages nearby allies but not enemies', () => {
    const state = newMatch();
    play(state, 'card_troop_banner_sergeant', 8, 12);
    const ally = forceSpawn(state, BLUE, 'card_troop_knight', 8, 12);
    ally.deployTimer = 0;
    const foe = forceSpawn(state, RED, 'card_troop_knight', 8, 13);
    foe.deployTimer = 0;

    stepMatchBy(state, TICK_HZ + 4);
    expect(ally.rageTicks).toBeGreaterThan(0);
    expect(foe.rageTicks).toBe(0);
  });

  it('stays deterministic with the whole second wave on the field', () => {
    const run = () => {
      const state = newMatch();
      const cards = [
        'card_troop_sky_talon',
        'card_troop_powder_cart',
        'card_troop_marsh_walker',
        'card_troop_sand_burrower',
        'card_troop_mirror_shade',
        'card_troop_void_stalker',
        'card_troop_longshot',
        'card_building_brood_nest',
      ];
      cards.forEach((cardId, index) => {
        play(state, cardId, 3 + index, 12);
        stepMatchBy(state, 30);
      });
      stepMatchBy(state, 600);
      return state;
    };
    expect(hashMatchState(run())).toBe(hashMatchState(run()));
  });
});

// ---------------------------------------------------------------------------

describe('roster shape', () => {
  it('has grown to roughly fifty cards', () => {
    expect(BUILTIN_CARDS.length).toBeGreaterThanOrEqual(48);
  });

  it('keeps every description short and descriptive', () => {
    for (const card of BUILTIN_CARDS) {
      expect(card.description.length, `${card.name}`).toBeGreaterThan(0);
      expect(card.description.length, `${card.name}`).toBeLessThanOrEqual(120);
    }
  });

  it('spreads cards across the aether curve', () => {
    const costs = new Set(BUILTIN_CARDS.map((c) => c.aetherCost));
    expect(costs.size).toBeGreaterThanOrEqual(5);
  });

  it('resolves every card the decks reference', () => {
    for (const id of [...STARTER_DECK, ...BOT_DECK]) {
      expect(() => getCard(id)).not.toThrow();
    }
  });
});
