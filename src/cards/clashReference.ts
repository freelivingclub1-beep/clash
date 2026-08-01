/**
 * Clash Royale reference stats.
 *
 * Seventeen of our cards are direct counterparts of Clash Royale cards, and
 * those are stats that a decade of live balancing has already settled. Guessing
 * at them — or worse, play-testing our way back to them — is wasted effort and
 * gets the *feel* wrong in ways no amount of internal consistency fixes.
 *
 * Every number below is transcribed from the game's own `characters`,
 * `buildings` and `projectiles` tables as published in the open
 * `RoyaleAPI/cr-api-data` dataset, at Tournament Standard (level 11), with
 * units converted from the game's internal thousandths to tiles and seconds:
 *
 * The source stores each card's stats at *its own* level 1, which is not the
 * same card level for every rarity — a Rare's level 1 is card level 3, an
 * Epic's is level 6. Scaling to Tournament Standard therefore takes a
 * different number of upgrade steps per rarity, published as
 * `tournament_level_index` in `rarities.json`:
 *
 *   Common x2.56   Rare x2.12   Epic x1.60   Legendary x1.21   Champion x1.00
 *
 * Applying the Common multiplier to everything — which an earlier version of
 * this table did — silently hands every Rare a 21% advantage and every Epic a
 * 60% one over the cards they are balanced against. It is invisible in a
 * one-card audit and shows up only as counters that mysteriously stop working:
 * a 21%-oversized Musketeer survives the Goblins that are supposed to kill her.
 *
 *   sight_range 5500      -> sightRange 5.5 tiles
 *   range 1200            -> attackRange 1.2 tiles
 *   hit_speed 1200        -> hitSpeed 1.2 seconds
 *   load_time 700         -> firstAttackDelay 0.7 seconds
 *   collision_radius 500  -> bodyRadius 0.5 tiles
 *
 * Damage and splash for a ranged card live on its *projectile* in that data,
 * not on the character, which is why a naive read reports a Wizard doing zero
 * damage with no splash.
 *
 * One deliberate departure: the source records `mass: 0` for buildings, which
 * is meaningless for something that cannot be pushed and which our schema
 * rejects outright. Those are pinned to the schema floor of 1.
 *
 * This table is not read at runtime. It exists so `tests/clashStats.test.ts`
 * can assert the card definitions still match it — the point is that a future
 * edit to a Knight cannot silently drift away from the Knight.
 */

import type { SpeedClass } from './schema';

export interface ClashReferenceStats {
  /** Name in the source data, for tracing a number back to its row. */
  crName: string;
  baseHealth: number;
  damage: number;
  hitSpeed: number;
  firstAttackDelay: number;
  attackRange: number;
  sightRange: number;
  splashRadius: number;
  bodyRadius: number;
  massWeight: number;
  /** Absent for buildings, which do not move. */
  speedClass?: SpeedClass;
}

export const CLASH_REFERENCE: Record<string, ClashReferenceStats> = {
  'card_troop_knight': {
    crName: 'Knight',
    baseHealth: 1766,
    damage: 202,
    hitSpeed: 1.2,
    firstAttackDelay: 0.7,
    attackRange: 1.2,
    sightRange: 5.5,
    splashRadius: 0,
    bodyRadius: 0.5,
    massWeight: 6,
    speedClass: 'Medium',
  },
  'card_troop_archers': {
    crName: 'Archer',
    baseHealth: 304,
    damage: 107,
    hitSpeed: 0.9,
    firstAttackDelay: 0.4,
    attackRange: 5,
    sightRange: 5.5,
    splashRadius: 0,
    bodyRadius: 0.5,
    massWeight: 3,
    speedClass: 'Medium',
  },
  'card_troop_musketeer': {
    crName: 'Musketeer',
    baseHealth: 721,
    damage: 218,
    hitSpeed: 1,
    firstAttackDelay: 0.2,
    attackRange: 6,
    sightRange: 6,
    splashRadius: 0,
    bodyRadius: 0.5,
    massWeight: 5,
    speedClass: 'Medium',
  },
  'card_troop_giant': {
    crName: 'Giant',
    baseHealth: 4092,
    damage: 254,
    hitSpeed: 1.5,
    firstAttackDelay: 1,
    attackRange: 1.2,
    sightRange: 7.5,
    splashRadius: 0,
    bodyRadius: 0.75,
    massWeight: 18,
    speedClass: 'Slow',
  },
  'card_troop_hog_rider': {
    crName: 'HogRider',
    baseHealth: 1696,
    damage: 318,
    hitSpeed: 1.6,
    firstAttackDelay: 1,
    attackRange: 0.8,
    sightRange: 9.5,
    splashRadius: 0,
    bodyRadius: 0.6,
    massWeight: 4,
    speedClass: 'VeryFast',
  },
  'card_troop_mini_pekka': {
    crName: 'MiniPekka',
    baseHealth: 1361,
    damage: 721,
    hitSpeed: 1.6,
    firstAttackDelay: 1.1,
    attackRange: 0.8,
    sightRange: 5.5,
    splashRadius: 0,
    bodyRadius: 0.45,
    massWeight: 4,
    speedClass: 'Fast',
  },
  'card_troop_valkyrie': {
    crName: 'Valkyrie',
    baseHealth: 1908,
    damage: 267,
    hitSpeed: 1.5,
    firstAttackDelay: 1.4,
    attackRange: 1.2,
    sightRange: 5.5,
    splashRadius: 2,
    bodyRadius: 0.5,
    massWeight: 5,
    speedClass: 'Medium',
  },
  'card_troop_wizard': {
    crName: 'Wizard',
    baseHealth: 721,
    damage: 282,
    hitSpeed: 1.4,
    firstAttackDelay: 1,
    attackRange: 5.5,
    sightRange: 5.5,
    splashRadius: 1.5,
    bodyRadius: 0.5,
    massWeight: 5,
    speedClass: 'Medium',
  },
  'card_troop_baby_dragon': {
    crName: 'BabyDragon',
    baseHealth: 1152,
    damage: 160,
    hitSpeed: 1.5,
    firstAttackDelay: 1.2,
    attackRange: 3.5,
    sightRange: 5.5,
    splashRadius: 1.2,
    bodyRadius: 0.5,
    massWeight: 5,
    speedClass: 'Fast',
  },
  'card_troop_barbarians': {
    crName: 'Barbarian',
    baseHealth: 670,
    damage: 192,
    hitSpeed: 1.3,
    firstAttackDelay: 0.9,
    attackRange: 0.7,
    sightRange: 5.5,
    splashRadius: 0,
    bodyRadius: 0.5,
    massWeight: 4,
    speedClass: 'Medium',
  },
  'card_troop_skeletons': {
    crName: 'Skeleton',
    baseHealth: 81,
    damage: 81,
    hitSpeed: 1,
    firstAttackDelay: 0.5,
    attackRange: 0.5,
    sightRange: 5.5,
    splashRadius: 0,
    bodyRadius: 0.5,
    massWeight: 1,
    speedClass: 'Fast',
  },
  'card_troop_goblins': {
    crName: 'Goblin',
    baseHealth: 202,
    damage: 120,
    hitSpeed: 1.1,
    firstAttackDelay: 0.7,
    attackRange: 0.5,
    sightRange: 5.5,
    splashRadius: 0,
    bodyRadius: 0.5,
    massWeight: 2,
    speedClass: 'VeryFast',
  },
  'card_troop_spear_goblins': {
    crName: 'SpearGoblin',
    baseHealth: 133,
    damage: 81,
    hitSpeed: 1.7,
    firstAttackDelay: 1.2,
    attackRange: 5.5,
    sightRange: 5.5,
    splashRadius: 0,
    bodyRadius: 0.5,
    massWeight: 1,
    speedClass: 'VeryFast',
  },
  'card_troop_minions': {
    crName: 'Minion',
    baseHealth: 230,
    damage: 117,
    hitSpeed: 1,
    firstAttackDelay: 0.5,
    attackRange: 1.6,
    sightRange: 5.5,
    splashRadius: 0,
    bodyRadius: 0.5,
    massWeight: 2,
    speedClass: 'Fast',
  },
  'card_troop_bomber': {
    crName: 'Bomber',
    baseHealth: 332,
    damage: 222,
    hitSpeed: 1.8,
    firstAttackDelay: 1.6,
    attackRange: 4.5,
    sightRange: 5.5,
    splashRadius: 1.5,
    bodyRadius: 0.5,
    massWeight: 4,
    speedClass: 'Medium',
  },
  'card_building_cannon': {
    crName: 'Cannon',
    baseHealth: 824,
    damage: 212,
    hitSpeed: 0.9,
    firstAttackDelay: 0,
    attackRange: 5.5,
    sightRange: 5.5,
    splashRadius: 0,
    bodyRadius: 0.6,
    massWeight: 1,
  },
  'card_building_tesla': {
    crName: 'Tesla',
    baseHealth: 1152,
    damage: 230,
    hitSpeed: 1.1,
    firstAttackDelay: 0.7,
    attackRange: 5.5,
    sightRange: 5.5,
    splashRadius: 0,
    bodyRadius: 0.5,
    massWeight: 1,
  },
};
