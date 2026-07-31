import { describe, it, expect, beforeEach } from 'vitest';
import '@cards/data';
import { STARTER_DECK, BOT_DECK } from '@cards/data';
import { getCard } from '@cards/registry';
import { createMatch, forceSpawn, type MatchConfig } from '@sim/state';
import { stepMatch, stepMatchBy } from '@sim/tick';
import { BLUE, RED } from '@sim/nav/grid';
import { EP_PER_ELIXIR, TICK_HZ } from '@sim/constants';
import { findEntity, resolveStats } from '@sim/entities';
import { hasAbilityHook } from '@sim/scripts/abilities';
import { hasEvolutionScript } from '@sim/scripts/evolutions';
import { validateDeck, DECK_LAYOUT, heroCardIn, evolutionCardsIn } from '@game/deck';
import {
  InMemoryProfileRepository,
  createDefaultProfile,
  applyMatchResult,
} from '@game/profile/repository';
import { arenaForTrophies, cardLevelMap, playerProfileSchema } from '@game/profile/schema';
import type { Command, MatchState } from '@sim/types';

const config = (): MatchConfig => ({
  seed: 4242,
  players: [{ deck: STARTER_DECK }, { deck: BOT_DECK }],
});

/** Force a card into hand slot 0 and play it, so tests control what is cast. */
function playCard(state: MatchState, cardId: string, tileX = 8, tileY = 10): void {
  const player = state.players[BLUE];
  player.hand[0] = cardId;
  player.elixirPoints = 10 * EP_PER_ELIXIR;
  const command: Command = { type: 'deploy', team: BLUE, handIndex: 0, tileX, tileY };
  stepMatch(state, [command]);
}

describe('card evolutions', () => {
  it('evolves on the play after the cycle counter reaches zero', () => {
    const state = createMatch(config());
    const knight = 'card_troop_knight';
    const requirement = getCard(knight).evoCycleRequirement;
    expect(requirement).toBe(2);
    expect(state.players[BLUE].evoCounters.get(knight)).toBe(2);

    // First two plays are ordinary and wind the counter down.
    playCard(state, knight);
    expect(state.players[BLUE].evoCounters.get(knight)).toBe(1);
    expect(state.entities.some((e) => e.cardId === knight && e.evolved)).toBe(false);

    playCard(state, knight);
    expect(state.players[BLUE].evoCounters.get(knight)).toBe(0);
    expect(state.players[BLUE].evoReady.get(knight)).toBe(true);

    // The third play is the evolved one, and the counter resets behind it.
    playCard(state, knight);
    expect(state.entities.some((e) => e.cardId === knight && e.evolved)).toBe(true);
    expect(state.players[BLUE].evoReady.get(knight)).toBe(false);
    expect(state.players[BLUE].evoCounters.get(knight)).toBe(requirement);
  });

  it('never evolves a card that is not in an evolution slot', () => {
    const state = createMatch(config());
    // Musketeer sits in a standard slot and has no evolution at all.
    for (let i = 0; i < 6; i++) playCard(state, 'card_troop_musketeer');
    expect(state.entities.some((e) => e.cardId === 'card_troop_musketeer' && e.evolved)).toBe(
      false,
    );
  });

  it('applies the evolution health multiplier to the spawned unit', () => {
    const knight = getCard('card_troop_knight');
    const base = resolveStats(knight.id, 11, false);
    const evolved = resolveStats(knight.id, 11, true);
    expect(evolved.hp).toBe(Math.round(base.hp * knight.evoHealthMultiplier));
    expect(evolved.hp).toBeGreaterThan(base.hp);
  });

  it('runs the evolution spawn hook — evolved Knight gains a shield', () => {
    const state = createMatch(config());
    const knight = 'card_troop_knight';
    playCard(state, knight);
    playCard(state, knight);
    playCard(state, knight);

    const evolvedKnight = state.entities.find((e) => e.cardId === knight && e.evolved);
    expect(evolvedKnight).toBeDefined();
    expect(evolvedKnight!.shield).toBeGreaterThan(0);
  });

  it('has a registered script for every evolution card that names one', () => {
    for (const deck of [STARTER_DECK, BOT_DECK]) {
      for (const cardId of deck) {
        const card = getCard(cardId);
        if (!card.hasEvolution || !card.evoBehaviorScriptId) continue;
        expect(hasEvolutionScript(card.evoBehaviorScriptId)).toBe(true);
      }
    }
  });
});

describe('hero abilities', () => {
  const deployHero = (state: MatchState) => {
    playCard(state, 'card_troop_golden_knight', 8, 12);
    // Clear the deploy freeze so the hero is a live participant.
    stepMatchBy(state, TICK_HZ + 2);
    return findEntity(state, state.players[BLUE].heroEntityId);
  };

  it('registers the hero on the field and lights the ability', () => {
    const state = createMatch(config());
    const hero = deployHero(state);
    expect(hero).toBeDefined();
    expect(hero!.isHero).toBe(true);
    expect(state.players[BLUE].heroAbilityCooldown).toBe(0);
  });

  it('charges elixir and starts the cooldown when the ability fires', () => {
    const state = createMatch(config());
    deployHero(state);
    // Give the dash something to reach.
    forceSpawn(state, RED, 'card_troop_musketeer', 8, 14);

    const player = state.players[BLUE];
    player.elixirPoints = 10 * EP_PER_ELIXIR;
    const card = getCard('card_troop_golden_knight');

    stepMatch(state, [{ type: 'ability', team: BLUE }]);

    expect(player.heroAbilityCooldown).toBeGreaterThan(0);
    expect(player.elixirPoints).toBeLessThan(10 * EP_PER_ELIXIR);
    expect(state.events.some((e) => e.type === 'ability')).toBe(true);
    expect(card.abilityElixirCost).toBeGreaterThan(0);
  });

  it('refuses the ability while it is on cooldown', () => {
    const state = createMatch(config());
    deployHero(state);
    forceSpawn(state, RED, 'card_troop_musketeer', 8, 14);
    state.players[BLUE].elixirPoints = 10 * EP_PER_ELIXIR;

    stepMatch(state, [{ type: 'ability', team: BLUE }]);
    const afterFirst = state.players[BLUE].elixirPoints;

    stepMatch(state, [{ type: 'ability', team: BLUE }]);
    expect(
      state.events.some((e) => e.type === 'deployRejected' && e.reason === 'ability-on-cooldown'),
    ).toBe(true);
    // Only the first activation was paid for (modulo one tick of regeneration).
    expect(state.players[BLUE].elixirPoints).toBeGreaterThanOrEqual(afterFirst);
  });

  it('rejects the ability outright when no hero is deployed', () => {
    const state = createMatch(config());
    state.players[BLUE].elixirPoints = 10 * EP_PER_ELIXIR;
    stepMatch(state, [{ type: 'ability', team: BLUE }]);
    expect(
      state.events.some((e) => e.type === 'deployRejected' && e.reason === 'no-hero-on-field'),
    ).toBe(true);
  });

  it('frees the hero slot when the champion dies', () => {
    const state = createMatch(config());
    const hero = deployHero(state);
    expect(state.players[BLUE].heroEntityId).toBe(hero!.id);

    hero!.hp = 0;
    hero!.alive = false;
    state.needsCompaction = true;
    stepMatch(state);

    expect(state.players[BLUE].heroEntityId).toBe(-1);
    expect(state.players[BLUE].heroAbilityCooldown).toBe(0);
  });

  it('has a registered implementation for every ability hook in the roster', () => {
    for (const deck of [STARTER_DECK, BOT_DECK]) {
      for (const cardId of deck) {
        const card = getCard(cardId);
        if (!card.isHero) continue;
        expect(hasAbilityHook(card.abilityActionHook)).toBe(true);
      }
    }
  });

  it("Archer Queen's cloak makes her untargetable", () => {
    const state = createMatch(config());
    playCard(state, 'card_troop_archer_queen', 8, 12);
    stepMatchBy(state, TICK_HZ + 2);

    const queen = findEntity(state, state.players[BLUE].heroEntityId);
    expect(queen).toBeDefined();

    const attacker = forceSpawn(state, RED, 'card_troop_musketeer', 8, 13);
    attacker.targetId = queen!.id;

    state.players[BLUE].elixirPoints = 10 * EP_PER_ELIXIR;
    stepMatch(state, [{ type: 'ability', team: BLUE }]);

    expect(queen!.invisibleTicks).toBeGreaterThan(0);
    // The cloak must break any existing lock, not merely block new ones.
    expect(attacker.targetId).not.toBe(queen!.id);
  });
});

describe('tower troops', () => {
  it('takes princess tower health from the equipped tower troop card', () => {
    const state = createMatch({
      seed: 1,
      players: [
        { deck: [...STARTER_DECK.slice(0, 8), 'card_towertroop_dagger_duchess'] },
        { deck: [...BOT_DECK.slice(0, 8), 'card_towertroop_cannoneer'] },
      ],
    });

    const bluePrincess = state.entities.find((e) => e.towerIndex === 0);
    const redPrincess = state.entities.find((e) => e.towerIndex === 3);
    expect(bluePrincess!.maxHp).toBe(getCard('card_towertroop_dagger_duchess').baseHealth);
    expect(redPrincess!.maxHp).toBe(getCard('card_towertroop_cannoneer').baseHealth);
  });

  it('gives the Cannoneer ground-only targeting, unlike the Princess', () => {
    expect(getCard('card_towertroop_cannoneer').targetPriority).toBe('Ground');
    expect(getCard('card_towertroop_tower_princess').targetPriority).toBe('AirAndGround');
  });

  it('keeps the King Tower dormant until a princess tower falls', () => {
    const state = createMatch(config());
    const blueKing = state.entities.find((e) => e.towerIndex === 2);
    expect(blueKing!.dormant).toBe(true);

    const bluePrincess = state.entities.find((e) => e.towerIndex === 0);
    bluePrincess!.hp = 0;
    bluePrincess!.alive = false;
    state.needsCompaction = true;
    stepMatch(state);

    expect(blueKing!.dormant).toBe(false);
    // And the attacker is credited a crown for it.
    expect(state.players[RED].crowns).toBe(1);
  });
});

describe('deck rules', () => {
  it('accepts both shipped decks', () => {
    expect(validateDeck(STARTER_DECK).ok).toBe(true);
    expect(validateDeck(BOT_DECK).ok).toBe(true);
  });

  it('rejects a non-evolution card in the evolution slot', () => {
    const deck = [...STARTER_DECK];
    deck[0] = 'card_troop_musketeer';
    const result = validateDeck(deck);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.slot === 0)).toBe(true);
  });

  it('rejects a non-champion in the hero slot', () => {
    const deck = [...STARTER_DECK];
    deck[1] = 'card_troop_musketeer';
    expect(validateDeck(deck).ok).toBe(false);
  });

  it('rejects a battle card in the tower troop slot', () => {
    const deck = [...STARTER_DECK];
    deck[8] = 'card_troop_knight';
    expect(validateDeck(deck).ok).toBe(false);
  });

  it('rejects duplicates', () => {
    const deck = [...STARTER_DECK];
    deck[4] = deck[3];
    const result = validateDeck(deck);
    expect(result.ok).toBe(false);
    expect(result.issues.some((i) => i.message.includes('already in slot'))).toBe(true);
  });

  it('rejects a deck of the wrong size', () => {
    expect(validateDeck(STARTER_DECK.slice(0, 8)).ok).toBe(false);
  });

  it('accepts a champion in the wild slot', () => {
    const deck = [...STARTER_DECK];
    deck[2] = 'card_troop_archer_queen';
    expect(validateDeck(deck).ok).toBe(true);
  });

  it('exposes the nine slot roles', () => {
    expect(DECK_LAYOUT).toHaveLength(9);
    expect(DECK_LAYOUT[0].role).toBe('evolution');
    expect(DECK_LAYOUT[1].role).toBe('hero');
    expect(DECK_LAYOUT[2].role).toBe('wild');
    expect(DECK_LAYOUT[8].role).toBe('towerTroop');
  });

  it('reads the hero and evolution cards back out of a deck', () => {
    expect(heroCardIn(STARTER_DECK)).toBe('card_troop_golden_knight');
    expect(evolutionCardsIn(STARTER_DECK).sort()).toEqual(
      ['card_troop_archers', 'card_troop_knight'].sort(),
    );
  });

  it('computes average elixir across the eight battle cards only', () => {
    const expected =
      STARTER_DECK.slice(0, 8).reduce((sum, id) => sum + getCard(id).elixirCost, 0) / 8;
    expect(validateDeck(STARTER_DECK).averageElixir).toBeCloseTo(
      Math.round(expected * 10) / 10,
      5,
    );
  });
});

describe('player profile', () => {
  let repository: InMemoryProfileRepository;

  beforeEach(() => {
    repository = new InMemoryProfileRepository();
  });

  it('creates a default profile that passes its own schema and deck rules', async () => {
    const profile = await repository.load();
    expect(playerProfileSchema.safeParse(profile).success).toBe(true);
    expect(validateDeck(profile.deck).ok).toBe(true);
    expect(profile.collection.length).toBeGreaterThan(0);
    expect(profile.kingTowerLevel).toBe(11);
  });

  it('round-trips through save and load', async () => {
    const profile = await repository.load();
    profile.name = 'Renamed';
    profile.trophies = 5200;
    await repository.save(profile);

    const reloaded = await repository.load();
    expect(reloaded.name).toBe('Renamed');
    expect(reloaded.trophies).toBe(5200);
  });

  it('maps the collection to the card levels the simulation consumes', () => {
    const profile = createDefaultProfile();
    const levels = cardLevelMap(profile);
    expect(levels['card_troop_knight']).toBe(11);
    expect(Object.keys(levels).length).toBe(profile.collection.length);
  });

  it('moves trophies and the win/loss record on a result', () => {
    const profile = createDefaultProfile();
    const before = profile.trophies;

    applyMatchResult(profile, 'blue', 0);
    expect(profile.trophies).toBeGreaterThan(before);
    expect(profile.wins).toBe(1);

    applyMatchResult(profile, 'blue', 1);
    expect(profile.losses).toBe(1);

    const afterLoss = profile.trophies;
    applyMatchResult(profile, 'draw', 0);
    expect(profile.trophies).toBe(afterLoss);
  });

  it('never lets trophies fall below zero', () => {
    const profile = createDefaultProfile();
    profile.trophies = 5;
    applyMatchResult(profile, 'red', 0);
    expect(profile.trophies).toBe(0);
  });

  it('derives arena from trophies, clamped to the 24 that exist', () => {
    expect(arenaForTrophies(0)).toBe(1);
    expect(arenaForTrophies(4000)).toBe(11);
    expect(arenaForTrophies(999999)).toBe(24);
  });

  it('excludes engine-only cards from the collection', async () => {
    const profile = await repository.load();
    expect(profile.collection.some((e) => e.cardId === 'card_towertroop_king_tower')).toBe(false);
  });
});
