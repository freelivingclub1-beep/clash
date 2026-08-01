/**
 * Fairness checks that run on every commit.
 *
 * The EPP audit checks that a card's *stat line* costs what it should. It
 * cannot see what a mechanic is worth in play — which is exactly how a card
 * that multiplies its own damage can audit at 0.99. These tests play the game
 * instead of reading the numbers.
 *
 * They are deliberately narrow about what counts as a problem. A cheap card
 * beating an expensive one is the genre working: Skeletons behind a Mini PEKKA
 * is supposed to win, and placement and timing being decisive is the design,
 * not a defect. What fails the build is a card that wins a lane unassisted, or
 * one that comes out ahead against every archetype at once — a card with no
 * bad matchup, and therefore no decision attached to playing it.
 *
 * `npm run balance` runs the same checks with the full tables attached, for
 * when a flag needs interpreting rather than just detecting.
 */

import { describe, it, expect } from 'vitest';
import '@cards/data';
import { getCard, selectableCards } from '@cards/registry';
import { roleOf, groupByRole, DECK_ROLES } from '@cards/roles';
import {
  BENCHMARK_PANEL,
  MIN_TRADE_SAMPLES,
  TRADE_VALUE_CEILING,
  duel,
  duelIsMeaningful,
  fairnessFlags,
  testableCards,
  towerClock,
  towerPressure,
  tradeValue,
} from '@game/fairness';

describe('fairness harness', () => {
  it('stages duels on dry land, not across the river', () => {
    // The first version spawned either side of the halfway line, which put both
    // sides on the water rows: every melee card "lost" to every ranged card at
    // full health because it never reached the fight. A melee bruiser must be
    // able to walk into a shooter and win.
    const result = duel('card_troop_mini_pekka', 'card_troop_musketeer');
    expect(result.winner).toBe('a');
    expect(result.bRemaining).toBe(0);
  });

  it('does not report a duel between cards that cannot touch each other', () => {
    // Buildings-only against a troop is not a fight, and neither is a
    // ground-only card against a flier.
    expect(duelIsMeaningful(getCard('card_troop_giant'), getCard('card_troop_knight'))).toBe(false);
    expect(duelIsMeaningful(getCard('card_troop_skeletons'), getCard('card_troop_minions'))).toBe(
      false,
    );
    expect(duelIsMeaningful(getCard('card_troop_knight'), getCard('card_troop_musketeer'))).toBe(
      true,
    );
  });

  it('measures tower pressure against something that survives a push', () => {
    // A card with no damage cannot pressure anything; a heavy one should take
    // a real bite out of an undefended tower. Both ends sanity-check the rig.
    expect(towerClock('card_troop_frost_wisp').towerRemaining).toBeGreaterThan(0.5);
    expect(towerClock('card_troop_giant').towerRemaining).toBeLessThan(0.2);
  });
});

describe('roster fairness', () => {
  it('has no card that wins a lane on its own', () => {
    const { rows, threshold } = towerPressure();
    const outliers = rows
      .filter((row) => row.perAether > threshold)
      .map(
        (row) =>
          `${row.name} (${row.aetherCost}): ${row.perAether.toFixed(3)} per aether vs bar ${threshold.toFixed(3)}`,
      );
    expect(outliers).toEqual([]);
  });

  it('has no card that trades up against every archetype at once', () => {
    const outliers = testableCards()
      .filter((card) => card.damage > 0)
      .map((card) => tradeValue(card.id))
      .filter((row) => row.samples >= MIN_TRADE_SAMPLES && row.netAether > TRADE_VALUE_CEILING)
      .map((row) => `${row.name} (${row.aetherCost}): +${row.netAether} aether per fight`);
    expect(outliers).toEqual([]);
  });

  it('reports no flags at all', () => {
    expect(fairnessFlags().map((flag) => `${flag.name}: ${flag.detail}`)).toEqual([]);
  });

  it('keeps the benchmark panel itself on the roster', () => {
    // A renamed or removed panel card would silently shrink every sample.
    for (const cardId of BENCHMARK_PANEL) {
      expect(() => getCard(cardId)).not.toThrow();
    }
  });
});

describe('deck roles', () => {
  it('gives every selectable card a known role', () => {
    for (const card of selectableCards()) {
      expect(DECK_ROLES).toContain(roleOf(card));
    }
  });

  it('offers a real choice in every role a deck has to fill', () => {
    // Depth is the point: a role with one card in it is not a decision. The
    // roles a player must fill every deck are the ones this guards.
    const counts = new Map(groupByRole(selectableCards()).map((g) => [g.role, g.cards.length]));
    for (const role of ['WinCondition', 'Tank', 'Swarm', 'Ranged', 'Melee', 'Spell', 'Building']) {
      expect(counts.get(role as never) ?? 0).toBeGreaterThanOrEqual(4);
    }
  });

  it('sorts win conditions by what they walk at, not by cost', () => {
    // The derivation is load-bearing for the collection UI, so pin the rule:
    // anything that ignores defenders and walks at buildings is a win condition.
    for (const card of selectableCards()) {
      if (card.targetPriority !== 'Buildings') continue;
      if (card.category !== 'Troop') continue;
      expect(roleOf(card)).toBe('WinCondition');
    }
  });
});
