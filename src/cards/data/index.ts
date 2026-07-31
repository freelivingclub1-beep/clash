/**
 * Built-in roster registration.
 *
 * Importing this module is what populates the registry; every entry point that
 * needs cards (`main.tsx`, the tests, the bot) imports it exactly once.
 */

import { registerCard } from '../registry';
import { TROOP_CARDS } from './troops';
import { SPELL_AND_BUILDING_CARDS } from './spellsAndBuildings';
import { CHAMPION_CARDS, TOWER_TROOP_CARDS } from './championsAndTowers';
import { UNIQUE_CARDS } from './uniques';
import { UNIQUE_CARDS_2 } from './uniques2';
import { UNIQUE_CARDS_3 } from './uniques3';

export const BUILTIN_CARDS = [
  ...TROOP_CARDS,
  ...SPELL_AND_BUILDING_CARDS,
  ...CHAMPION_CARDS,
  ...TOWER_TROOP_CARDS,
  ...UNIQUE_CARDS,
  ...UNIQUE_CARDS_2,
  ...UNIQUE_CARDS_3,
];

for (const card of BUILTIN_CARDS) registerCard(card);

export * from './troops';
export * from './spellsAndBuildings';
export * from './championsAndTowers';
export * from './uniques';
export * from './uniques2';
export * from './uniques3';

/** A sensible starting deck: 8 battle cards + a tower troop. */
export const STARTER_DECK: string[] = [
  'card_troop_knight', // slot 1 — evolution slot
  'card_troop_golden_knight', // slot 2 — hero slot
  'card_troop_archers', // slot 3 — wild slot (second evolution)
  'card_troop_musketeer',
  'card_troop_hog_rider',
  'card_building_cannon',
  'card_spell_fireball',
  'card_spell_zap',
  'card_towertroop_tower_princess', // slot 9 — tower troop
];

/** The bot's deck — deliberately different so matches don't mirror. */
export const BOT_DECK: string[] = [
  'card_troop_barbarians', // slot 1 — evolution slot
  'card_troop_archer_queen', // slot 2 — hero slot
  'card_troop_skeletons', // slot 3 — wild slot (second evolution)
  'card_troop_giant',
  'card_troop_baby_dragon',
  'card_troop_valkyrie',
  'card_building_tesla',
  'card_spell_arrows',
  'card_towertroop_cannoneer', // slot 9 — tower troop
];
