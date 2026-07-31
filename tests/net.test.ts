import { describe, it, expect } from 'vitest';
import '@cards/data';
import { STARTER_DECK, BOT_DECK } from '@cards/data';
import { LocalTransport, RecordingTransport, ReplayTransport } from '@net/transport';
import {
  LocalBotMatchmaker,
  isEligiblePairing,
  trophyWindowFor,
  deckLevelAverage,
  INITIAL_TROPHY_WINDOW,
  WIDENED_TROPHY_WINDOW,
  MAX_KING_TOWER_DELTA,
  type QueueTicket,
} from '@net/matchmaking';
import { BotController } from '@net/bot/botAI';
import { MatchRunner } from '@game/match';
import { createMatch } from '@sim/state';
import { stepMatch, hashMatchState } from '@sim/tick';
import { MATCH_END_TICK } from '@sim/constants';
import { BLUE, RED } from '@sim/nav/grid';
import type { Command } from '@sim/types';

const ticket = (over: Partial<QueueTicket> = {}): QueueTicket => ({
  playerId: 'p1',
  name: 'Tester',
  trophies: 4000,
  kingTowerLevel: 11,
  deck: STARTER_DECK,
  cardLevels: {},
  ...over,
});

describe('transport', () => {
  it('buckets a command forward by the input delay', () => {
    const transport = new LocalTransport(2);
    const command: Command = { type: 'deploy', team: BLUE, handIndex: 0, tileX: 8, tileY: 10 };

    transport.frameFor(0);
    const confirmTick = transport.submitCommand(command);
    expect(confirmTick).toBe(2);

    expect(transport.frameFor(1).commands).toHaveLength(0);
    expect(transport.frameFor(2).commands).toEqual([command]);
    // A frame is consumed once delivered.
    expect(transport.frameFor(2).commands).toHaveLength(0);
  });

  it('records a command log that replays to the identical state', () => {
    const config = { seed: 777, players: [{ deck: STARTER_DECK }, { deck: BOT_DECK }] as const };

    const recording = new RecordingTransport(new LocalTransport(2));
    const runner = new MatchRunner({
      config: { seed: config.seed, players: [{ deck: STARTER_DECK }, { deck: BOT_DECK }] },
      localTeam: BLUE,
      transport: recording,
      bot: new BotController({ team: RED, seed: config.seed }),
    });

    for (let tick = 0; tick < 1500; tick++) {
      if (tick === 200) runner.submitDeploy(0, 4, 12);
      if (tick === 600) runner.submitDeploy(1, 13, 12);
      if (tick === 1000) runner.submitDeploy(2, 8, 10);
      runner.stepOnce();
    }

    expect(recording.frames.length).toBeGreaterThan(0);

    // Replay the captured log into a fresh match with no bot attached.
    const replayState = createMatch({
      seed: config.seed,
      players: [{ deck: STARTER_DECK }, { deck: BOT_DECK }],
    });
    const replay = new ReplayTransport(recording.frames);
    for (let tick = 0; tick < 1500; tick++) {
      stepMatch(replayState, replay.frameFor(tick).commands);
    }

    expect(hashMatchState(replayState)).toBe(hashMatchState(runner.state));
  });
});

describe('matchmaking rules', () => {
  it('widens the trophy window after five seconds', () => {
    expect(trophyWindowFor(0)).toBe(INITIAL_TROPHY_WINDOW);
    expect(trophyWindowFor(4.9)).toBe(INITIAL_TROPHY_WINDOW);
    expect(trophyWindowFor(5)).toBe(WIDENED_TROPHY_WINDOW);
  });

  it('refuses a pairing outside the trophy window', () => {
    const a = { trophies: 4000, kingTowerLevel: 11 };
    expect(isEligiblePairing(a, { trophies: 4040, kingTowerLevel: 11 }, 0)).toBe(true);
    expect(isEligiblePairing(a, { trophies: 4100, kingTowerLevel: 11 }, 0)).toBe(false);
    // …until the window opens up.
    expect(isEligiblePairing(a, { trophies: 4100, kingTowerLevel: 11 }, 6)).toBe(true);
  });

  it('enforces the King Tower gate regardless of how long the wait was', () => {
    const a = { trophies: 4000, kingTowerLevel: 11 };
    expect(isEligiblePairing(a, { trophies: 4000, kingTowerLevel: 13 }, 60)).toBe(true);
    expect(isEligiblePairing(a, { trophies: 4000, kingTowerLevel: 14 }, 60)).toBe(false);
    expect(isEligiblePairing(a, { trophies: 4000, kingTowerLevel: 8 }, 60)).toBe(false);
  });

  it('produces an opponent that satisfies both gates', async () => {
    const matchmaker = new LocalBotMatchmaker(() => 4242);
    for (const trophies of [0, 500, 4000, 9000]) {
      const result = await matchmaker.findMatch(ticket({ trophies }));
      expect(result.opponent.isBot).toBe(true);
      expect(Math.abs(result.opponent.kingTowerLevel - 11)).toBeLessThanOrEqual(
        MAX_KING_TOWER_DELTA,
      );
      expect(Math.abs(result.opponent.trophies - trophies)).toBeLessThanOrEqual(
        result.trophyWindow,
      );
      expect(result.matchConfig.players).toHaveLength(2);
    }
  });

  it('averages deck levels for the queue token', () => {
    expect(deckLevelAverage(['a', 'b'], { a: 10, b: 12 })).toBe(11);
    expect(deckLevelAverage([], {})).toBe(0);
  });
});

describe('bot-driven match', () => {
  it('plays a full match to completion with both sides bot-controlled', () => {
    const seed = 20260731;
    const runner = new MatchRunner({
      config: { seed, players: [{ deck: STARTER_DECK }, { deck: BOT_DECK }] },
      localTeam: BLUE,
      transport: new LocalTransport(2),
      bot: new BotController({ team: RED, seed, aggression: 0.8 }),
    });
    const blueBot = new BotController({ team: BLUE, seed: seed ^ 99, aggression: 0.8 });

    let ticks = 0;
    while (!runner.finished && ticks < MATCH_END_TICK + 60) {
      for (const command of blueBot.decide(runner.state)) {
        if (command.type === 'deploy') {
          runner.submitDeploy(command.handIndex, command.tileX, command.tileY);
        } else if (command.type === 'ability') {
          runner.submitAbility();
        }
      }
      runner.stepOnce();
      ticks++;
    }

    // The match must actually resolve, not hang.
    expect(runner.finished).toBe(true);
    expect(['blue', 'red', 'draw']).toContain(runner.state.outcome);

    // Both bots should have actually spent aether on something.
    expect(runner.state.players[BLUE].aetherSpent).toBeGreaterThan(0);
    expect(runner.state.players[RED].aetherSpent).toBeGreaterThan(0);

    // And real damage should have been traded.
    const totalTowerDamage = runner.state.entities
      .filter((e) => e.towerIndex >= 0)
      .reduce((sum, t) => sum + (t.maxHp - t.hp), 0);
    expect(totalTowerDamage).toBeGreaterThan(0);
  });

  it('keeps the bot inside the rules — it never deploys in enemy territory', () => {
    const seed = 555;
    const state = createMatch({ seed, players: [{ deck: STARTER_DECK }, { deck: BOT_DECK }] });
    const bot = new BotController({ team: RED, seed });

    for (let tick = 0; tick < 3000; tick++) {
      const commands = bot.decide(state);
      for (const command of commands) {
        if (command.type !== 'deploy') continue;
        const card = state.players[RED].hand[command.handIndex];
        // Spells may be cast anywhere; troops may not.
        if (!card.startsWith('card_spell_')) {
          const laneOpen = state.players[RED].deployRights.laneOpen;
          const minY = laneOpen[0] || laneOpen[1] ? 10 : 17;
          expect(command.tileY).toBeGreaterThanOrEqual(minY);
        }
      }
      stepMatch(state, commands);
    }
  });

  it('is reproducible: the same seed yields the same match', () => {
    const play = () => {
      const seed = 31337;
      const runner = new MatchRunner({
        config: { seed, players: [{ deck: STARTER_DECK }, { deck: BOT_DECK }] },
        localTeam: BLUE,
        transport: new LocalTransport(2),
        bot: new BotController({ team: RED, seed }),
      });
      for (let i = 0; i < 2400; i++) runner.stepOnce();
      return hashMatchState(runner.state);
    };
    expect(play()).toBe(play());
  });
});
