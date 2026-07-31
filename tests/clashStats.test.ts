/**
 * Our Clash Royale counterparts must keep Clash Royale's numbers.
 *
 * Seventeen cards are direct counterparts, and their stats are transcribed from
 * the reference game's own tables rather than invented (see
 * `@cards/clashReference` for provenance and unit conversions). They are also
 * the calibration target for the whole EPP model, so a card quietly drifting
 * away from its source would move the bar every other card is judged against.
 */

import { describe, it, expect } from 'vitest';
import '@cards/data';
import { getCard, selectableCards } from '@cards/registry';
import { CLASH_REFERENCE } from '@cards/clashReference';
import { SPEED_TILES_PER_MIN } from '@cards/schema';
import { auditCard } from '@cards/balance';

const referenceIds = Object.keys(CLASH_REFERENCE);

describe('Clash Royale reference stats', () => {
  it('covers a real slice of the roster', () => {
    expect(referenceIds.length).toBeGreaterThanOrEqual(17);
    for (const id of referenceIds) expect(() => getCard(id)).not.toThrow();
  });

  for (const id of referenceIds) {
    const reference = CLASH_REFERENCE[id];

    it(`matches ${reference.crName} exactly`, () => {
      const card = getCard(id);
      expect(card.baseHealth).toBe(reference.baseHealth);
      expect(card.damage).toBe(reference.damage);
      expect(card.hitSpeed).toBe(reference.hitSpeed);
      expect(card.firstAttackDelay).toBe(reference.firstAttackDelay);
      expect(card.attackRange).toBe(reference.attackRange);
      expect(card.sightRange).toBe(reference.sightRange);
      expect(card.splashRadius).toBe(reference.splashRadius);
      expect(card.bodyRadius).toBe(reference.bodyRadius);
      expect(card.massWeight).toBe(reference.massWeight);
      if (reference.speedClass) expect(card.speedClass).toBe(reference.speedClass);
    });
  }
});

describe('movement speeds', () => {
  /*
   * The table was one full tier too fast — our "Medium" was 90 tiles per
   * minute, which is Clash Royale's *Fast*. Everything moved like the tier
   * above it, which cut a third off the time a player has to read a push and
   * answer it, and made placing a blocker feel impossible.
   */
  it('uses the reference game’s own tiers', () => {
    expect(SPEED_TILES_PER_MIN).toEqual({
      VerySlow: 30,
      Slow: 45,
      Medium: 60,
      Fast: 90,
      VeryFast: 120,
    });
  });

  it('walks a Medium troop the length of one half in a sane time', () => {
    // 16 tiles of half-arena at 60 tiles/minute is 16 seconds — slow enough to
    // see a push coming, react to it, and have the deploy land before it hits.
    const secondsPerHalf = (16 / SPEED_TILES_PER_MIN.Medium) * 60;
    expect(secondsPerHalf).toBeGreaterThan(12);
    expect(secondsPerHalf).toBeLessThan(20);
  });
});

describe('model calibration', () => {
  it('centres the EPP model on the reference cards', () => {
    /*
     * The model used to be calibrated against our own roster, which was
     * circular — it agreed with whatever we had already written. Against the
     * reference game it was out by a quarter, insisting a real Giant was
     * two-thirds over budget. The median of the seventeen is the honest bar.
     */
    const ratios = referenceIds.map((id) => auditCard(getCard(id)).ratio).sort((a, b) => a - b);
    const median = ratios[Math.floor(ratios.length / 2)];
    expect(median).toBeGreaterThan(0.9);
    expect(median).toBeLessThan(1.1);
  });

  it('keeps the rest of the roster inside the band the reference cards set', () => {
    const outside = selectableCards()
      .filter((card) => card.category !== 'Spell' && card.category !== 'TowerTroop')
      .map((card) => ({ card, audit: auditCard(card) }))
      .filter(({ audit }) => !audit.withinTolerance)
      .map(({ card, audit }) => `${card.name}: ${audit.ratio}`);
    expect(outside).toEqual([]);
  });
});
