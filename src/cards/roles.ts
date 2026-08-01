/**
 * Deck roles.
 *
 * A deep roster is only deep if you can navigate it. Sixty-odd cards in one
 * flat grid is a wall; the same sixty split into "what job does this do in a
 * deck" is a set of small choices — pick a win condition, pick something that
 * answers swarms, pick a spell — which is where deck identity actually comes
 * from.
 *
 * Roles are derived rather than hand-tagged on every card, because the answer
 * is nearly always already in the stat line: a troop that only walks at
 * buildings *is* a win condition, a card with three bodies *is* a swarm. Cards
 * whose intent disagrees with their stats set `role` explicitly and that wins.
 */

import type { CardDefinition } from './schema';

export const DECK_ROLES = [
  'WinCondition',
  'Tank',
  'Swarm',
  'Ranged',
  'Melee',
  'Support',
  'Building',
  'Spell',
  'Champion',
  'TowerTroop',
] as const;

export type DeckRole = (typeof DECK_ROLES)[number];

/** Human-facing blurb, shown as the section header in the collection. */
export const ROLE_BLURBS: Record<DeckRole, string> = {
  WinCondition: 'Walks past your defenders and goes for the tower.',
  Tank: 'Soaks damage at the front of a push.',
  Swarm: 'Several bodies at once — trades badly into splash.',
  Ranged: 'Damage from behind a tank, and the usual answer to air.',
  Melee: 'Single-body ground fighters that stop a push cold.',
  Support: 'Buffs, heals and slows the rest of your board.',
  Building: 'Placed, decays, and pulls a push off its line.',
  Spell: 'Instant answers and finishers — balanced by what they kill.',
  Champion: 'One per deck, with an ability you spend aether to fire.',
  TowerTroop: 'Sits in your King Tower slot and defends for the whole match.',
};

/** Ordering used wherever roles are listed, roughly the order you draft in. */
export const ROLE_ORDER: readonly DeckRole[] = DECK_ROLES;

/** Range at or beyond which a troop counts as shooting rather than swinging. */
const RANGED_THRESHOLD = 3.5;
/** Health at or above which a single body reads as a tank rather than a fighter. */
const TANK_HEALTH = 1900;

/**
 * The role a card fills in a deck.
 *
 * Order is the whole design: the earlier checks are the ones that override the
 * later ones. A flying buildings-only card is a win condition first and a
 * flier second; a three-body ranged card is ranged before it is a swarm,
 * because that is how you would actually slot it.
 */
export function roleOf(card: CardDefinition): DeckRole {
  if (card.role) return card.role as DeckRole;

  if (card.category === 'TowerTroop') return 'TowerTroop';
  if (card.category === 'Spell') return 'Spell';
  if (card.category === 'Building') return 'Building';
  if (card.isHero) return 'Champion';
  if (card.targetPriority === 'Buildings') return 'WinCondition';
  if (card.passiveId.startsWith('aura_')) return 'Support';
  if (card.attackRange >= RANGED_THRESHOLD) return 'Ranged';
  if (card.spawnCount >= 2) return 'Swarm';
  if (card.baseHealth >= TANK_HEALTH) return 'Tank';
  return 'Melee';
}

/** Cards bucketed by role, in `ROLE_ORDER`, skipping roles with no cards. */
export function groupByRole(
  cards: readonly CardDefinition[],
): Array<{ role: DeckRole; cards: CardDefinition[] }> {
  const buckets = new Map<DeckRole, CardDefinition[]>();
  for (const card of cards) {
    const role = roleOf(card);
    const bucket = buckets.get(role);
    if (bucket) bucket.push(card);
    else buckets.set(role, [card]);
  }
  return ROLE_ORDER.filter((role) => buckets.has(role)).map((role) => ({
    role,
    cards: buckets.get(role) as CardDefinition[],
  }));
}
