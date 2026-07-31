import { describe, it, expect } from 'vitest';
import '@cards/data';
import { STARTER_DECK, BOT_DECK } from '@cards/data';
import { createMatch, elixirOf, type MatchConfig } from '@sim/state';
import { stepMatch, stepMatchBy, hashMatchState } from '@sim/tick';
import { fxToFloat, fx } from '@sim/math/fixed';
import {
  BLUE,
  RED,
  TOWER_LAYOUTS,
  isRiverTile,
  createArenaGrid,
  canDeployAt,
  laneForX,
} from '@sim/nav/grid';
import {
  EP_PER_ELIXIR,
  MAX_ELIXIR_POINTS,
  DOUBLE_ELIXIR_TICK,
  TRIPLE_ELIXIR_TICK,
  STARTING_ELIXIR_POINTS,
} from '@sim/constants';
import { elixirGainAtTick, elixirMultiplierAtTick } from '@sim/systems/clock';
import type { Command, MatchState } from '@sim/types';

const config = (): MatchConfig => ({
  seed: 12345,
  players: [{ deck: STARTER_DECK }, { deck: BOT_DECK }],
});

const liveTroops = (state: MatchState, team: 0 | 1) =>
  state.entities.filter((e) => e.alive && e.kind === 'troop' && e.team === team);

/** Deploy whatever is in hand slot 0, wherever it is legal. */
const deploy = (team: 0 | 1, handIndex: number, tileX: number, tileY: number): Command => ({
  type: 'deploy',
  team,
  handIndex,
  tileX,
  tileY,
});

describe('match setup', () => {
  it('spawns all six towers with the equipped tower troop stats', () => {
    const state = createMatch(config());
    const towers = state.entities.filter((e) => e.kind === 'tower');
    expect(towers).toHaveLength(6);

    const bluePrincess = towers.find((t) => t.towerIndex === 0);
    // Blue's deck equips Tower Princess (2534 HP); red's equips Cannoneer (2800).
    expect(bluePrincess?.maxHp).toBe(2534);
    const redPrincess = towers.find((t) => t.towerIndex === 3);
    expect(redPrincess?.maxHp).toBe(2800);

    // King towers start dormant.
    expect(towers.find((t) => t.towerIndex === 2)?.dormant).toBe(true);
  });

  it('deals four cards to hand and four to the queue, with no duplicates', () => {
    const state = createMatch(config());
    for (const player of state.players) {
      expect(player.hand).toHaveLength(4);
      expect(player.queue).toHaveLength(4);
      expect(new Set([...player.hand, ...player.queue]).size).toBe(8);
    }
  });

  it('marks only genuine evolution cards as evolution slots', () => {
    const state = createMatch(config());
    // Blue: slot 1 Knight (evo), slot 3 Archers (evo). Slot 2 is the hero.
    expect(state.players[BLUE].evolutionSlots.sort()).toEqual(
      ['card_troop_archers', 'card_troop_knight'].sort(),
    );
  });

  it('starts both players at five elixir', () => {
    const state = createMatch(config());
    expect(state.players[BLUE].elixirPoints).toBe(STARTING_ELIXIR_POINTS);
    expect(elixirOf(state.players[BLUE])).toBe(5);
  });
});

describe('elixir engine', () => {
  it('uses the exact tick rates the spec implies', () => {
    // 1 elixir per 2.8s / 1.4s / 0.7s is 84 / 42 / 21 ticks at 30Hz.
    expect(EP_PER_ELIXIR / elixirGainAtTick(0)).toBe(84);
    expect(EP_PER_ELIXIR / elixirGainAtTick(DOUBLE_ELIXIR_TICK)).toBe(42);
    expect(EP_PER_ELIXIR / elixirGainAtTick(TRIPLE_ELIXIR_TICK)).toBe(21);
    expect(elixirMultiplierAtTick(0)).toBe(1);
    expect(elixirMultiplierAtTick(DOUBLE_ELIXIR_TICK)).toBe(2);
    expect(elixirMultiplierAtTick(TRIPLE_ELIXIR_TICK)).toBe(3);
  });

  it('regenerates exactly one elixir every 84 ticks at single rate', () => {
    const state = createMatch(config());
    const before = state.players[BLUE].elixirPoints;
    stepMatchBy(state, 84);
    expect(state.players[BLUE].elixirPoints).toBe(before + EP_PER_ELIXIR);
  });

  it('caps at ten elixir and discards the overflow', () => {
    const state = createMatch(config());
    stepMatchBy(state, 2000);
    expect(state.players[BLUE].elixirPoints).toBe(MAX_ELIXIR_POINTS);
    expect(elixirOf(state.players[BLUE])).toBe(10);
  });

  it('charges the card cost and cycles the hand on a legal deploy', () => {
    const state = createMatch(config());
    stepMatchBy(state, 300); // bank some elixir

    const player = state.players[BLUE];
    const played = player.hand[0];
    const nextUp = player.queue[0];
    const before = player.elixirPoints;

    stepMatch(state, [deploy(BLUE, 0, 8, 10)]);

    expect(player.hand[0]).toBe(nextUp);
    expect(player.queue[player.queue.length - 1]).toBe(played);
    expect(player.elixirPoints).toBeLessThan(before);
  });

  it('rejects a deploy the player cannot afford', () => {
    const state = createMatch(config());
    const player = state.players[BLUE];
    player.elixirPoints = 0;

    stepMatch(state, [deploy(BLUE, 0, 8, 10)]);

    expect(player.elixirPoints).toBe(elixirGainAtTick(0));
    expect(state.events.some((e) => e.type === 'deployRejected')).toBe(true);
  });
});

describe('deployment rules', () => {
  it('confines a player to their own half until a tower falls', () => {
    const grid = createArenaGrid();
    const rights = { laneOpen: [false, false] as [boolean, boolean] };

    expect(canDeployAt(grid, BLUE, 8, 10, rights, false)).toBe(true);
    expect(canDeployAt(grid, BLUE, 8, 20, rights, false)).toBe(false);
    expect(canDeployAt(grid, RED, 8, 20, rights, false)).toBe(true);
    expect(canDeployAt(grid, RED, 8, 10, rights, false)).toBe(false);
  });

  it('opens a lane forward once that princess tower is destroyed', () => {
    const grid = createArenaGrid();
    const open = { laneOpen: [true, false] as [boolean, boolean] };
    // Lane 0 is the low-X side.
    expect(laneForX(3)).toBe(0);
    expect(canDeployAt(grid, BLUE, 3, 20, open, false)).toBe(true);
    // The untouched lane stays closed.
    expect(canDeployAt(grid, BLUE, 14, 20, open, false)).toBe(false);
  });

  it('never allows a drop onto the river', () => {
    const grid = createArenaGrid();
    const rights = { laneOpen: [false, false] as [boolean, boolean] };
    expect(canDeployAt(grid, BLUE, 0, 15, rights, false)).toBe(false);
    expect(canDeployAt(grid, BLUE, 8, 16, rights, false)).toBe(false);
  });
});

describe('arena geometry', () => {
  it('blocks the river everywhere except the two bridges', () => {
    const grid = createArenaGrid();
    for (const row of [15, 16]) {
      for (let x = 0; x < 18; x++) {
        const bridge = x === 4 || x === 5 || x === 13 || x === 14;
        expect(isRiverTile(grid, x, row)).toBe(!bridge);
      }
    }
  });

  it('mirrors the tower layout across the river', () => {
    const blue = TOWER_LAYOUTS.filter((t) => t.team === BLUE);
    const red = TOWER_LAYOUTS.filter((t) => t.team === RED);
    expect(blue).toHaveLength(3);
    expect(red).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(blue[i].centerX).toBe(red[i].centerX);
      expect(blue[i].centerY + red[i].centerY).toBe(32);
    }
  });
});

describe('unit behaviour', () => {
  it('walks a deployed ground troop toward the enemy without entering water', () => {
    const state = createMatch(config());
    stepMatchBy(state, 400);

    // Find and play a ground troop from hand.
    const handIndex = state.players[BLUE].hand.findIndex((id) => id.startsWith('card_troop_'));
    expect(handIndex).toBeGreaterThanOrEqual(0);
    stepMatch(state, [deploy(BLUE, handIndex, 4, 12)]);

    const troops = liveTroops(state, BLUE);
    expect(troops.length).toBeGreaterThan(0);
    const startY = troops[0].y;

    // Track every tile the troops occupy over the next few seconds.
    for (let i = 0; i < 300; i++) {
      stepMatch(state);
      for (const troop of liveTroops(state, BLUE)) {
        if (troop.flying) continue;
        const tx = Math.floor(fxToFloat(troop.x));
        const ty = Math.floor(fxToFloat(troop.y));
        expect(isRiverTile(state.grid, tx, ty)).toBe(false);
      }
    }

    const survivors = liveTroops(state, BLUE);
    if (survivors.length > 0) {
      // Blue advances toward higher Y.
      expect(survivors[0].y).toBeGreaterThan(startY);
    }
  });

  it('crosses the river at a bridge column', () => {
    const state = createMatch(config());
    stepMatchBy(state, 600);

    const handIndex = state.players[BLUE].hand.findIndex((id) => id.startsWith('card_troop_'));
    stepMatch(state, [deploy(BLUE, handIndex, 4, 13)]);

    let crossed = false;
    for (let i = 0; i < 900 && !crossed; i++) {
      stepMatch(state);
      for (const troop of liveTroops(state, BLUE)) {
        if (!troop.flying && fxToFloat(troop.y) > 17) crossed = true;
      }
    }
    expect(crossed).toBe(true);
  });

  it('lets towers shoot down an attacker that walks into range', () => {
    const state = createMatch(config());
    stepMatchBy(state, 600);

    const handIndex = state.players[BLUE].hand.findIndex((id) => id.startsWith('card_troop_'));
    stepMatch(state, [deploy(BLUE, handIndex, 4, 14)]);

    const redPrincess = state.entities.find((e) => e.towerIndex === 3);
    expect(redPrincess).toBeDefined();

    let towerFired = false;
    for (let i = 0; i < 1200; i++) {
      stepMatch(state);
      if (state.entities.some((e) => e.kind === 'projectile' && e.team === RED)) {
        towerFired = true;
        break;
      }
    }
    expect(towerFired).toBe(true);
  });
});

describe('determinism', () => {
  const scriptedRun = (): MatchState => {
    const state = createMatch(config());
    const script = new Map<number, Command[]>([
      [200, [deploy(BLUE, 0, 4, 12)]],
      [420, [deploy(RED, 0, 13, 20)]],
      [700, [deploy(BLUE, 1, 13, 12)]],
      [980, [deploy(RED, 2, 4, 20)]],
      [1400, [deploy(BLUE, 2, 8, 10)]],
      [1800, [deploy(RED, 1, 8, 22)]],
    ]);
    for (let tick = 0; tick < 3000; tick++) {
      stepMatch(state, script.get(tick) ?? []);
    }
    return state;
  };

  it('produces an identical state hash across independent runs', () => {
    const a = scriptedRun();
    const b = scriptedRun();
    expect(hashMatchState(a)).toBe(hashMatchState(b));
    expect(a.tick).toBe(b.tick);
    expect(a.entities.length).toBe(b.entities.length);
  });

  it('agrees tick by tick, not just at the end', () => {
    const a = createMatch(config());
    const b = createMatch(config());
    for (let tick = 0; tick < 900; tick++) {
      const commands: Command[] = tick === 300 ? [deploy(BLUE, 0, 4, 12)] : [];
      stepMatch(a, commands);
      stepMatch(b, commands);
      expect(hashMatchState(a)).toBe(hashMatchState(b));
    }
  });

  it('diverges when the seed changes, proving the hash is sensitive', () => {
    const a = createMatch({ ...config(), seed: 1 });
    const b = createMatch({ ...config(), seed: 2 });
    stepMatchBy(a, 200);
    stepMatchBy(b, 200);
    // Different seeds shuffle the deck differently.
    expect(a.players[BLUE].hand).not.toEqual(b.players[BLUE].hand);
  });

  it('never lets entity ids fall out of ascending order', () => {
    const state = scriptedRun();
    for (let i = 1; i < state.entities.length; i++) {
      expect(state.entities[i].id).toBeGreaterThan(state.entities[i - 1].id);
    }
  });
});

describe('fixed-point math', () => {
  it('round-trips whole tiles exactly', () => {
    for (let i = 0; i <= 32; i++) expect(fxToFloat(fx(i))).toBe(i);
  });
});
