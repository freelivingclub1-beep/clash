/**
 * Entity construction and stat resolution.
 *
 * Card definitions are authored in human units (seconds, tiles, HP at level
 * 11). Everything the tick loop touches needs those pre-converted into the
 * sim's units — ticks and Q16.16 tiles — so resolution happens once per
 * (card, level, evolved) triple and is memoised. Nothing in the hot loop
 * divides by 30 or calls into the scaling tables.
 */

import type { CardDefinition } from '@cards/schema';
import { getCard } from '@cards/registry';
import { healthAtLevel, damageAtLevel, shieldAtLevel } from '@cards/scaling';
import { type Fx, fx, fxMul, FX_ONE } from './math/fixed';
import { type Rng, nextFxSpread } from './math/rng';
import {
  TICK_HZ,
  DEPLOY_DELAY_TICKS,
  TARGET_LOSE_RANGE_FACTOR,
  speedClassToFx,
} from './constants';
import { type Team, type Lane, laneForX, TOWER_LAYOUTS, enemyOf } from './nav/grid';
import { type Entity, type MatchState, NO_TARGET } from './types';
import { passiveHooks } from './scripts/passives';

export interface ResolvedStats {
  card: CardDefinition;
  hp: number;
  shield: number;
  damage: number;
  /** Ticks between attacks. */
  hitCooldown: number;
  /** Ticks of wind-up before the first swing at a new target. */
  firstAttackDelay: number;
  attackRange: Fx;
  attackRangeSq: Fx;
  sightRange: Fx;
  sightRangeSq: Fx;
  /** Squared distance at which a locked target is dropped. */
  loseRangeSq: Fx;
  splashRadius: Fx;
  splashRadiusSq: Fx;
  speed: Fx;
  radius: Fx;
  lifetimeTicks: number;
  statusTicks: number;
}

const statsCache = new Map<string, ResolvedStats>();

const secondsToTicks = (s: number): number => Math.max(0, Math.round(s * TICK_HZ));

/** Squared Fx length of an Fx scalar — kept beside the range fields it feeds. */
function sq(a: Fx): Fx {
  return Math.round((a * a) / FX_ONE);
}

export function resolveStats(cardId: string, level: number, evolved: boolean): ResolvedStats {
  const key = `${cardId}|${level}|${evolved ? 1 : 0}`;
  const cached = statsCache.get(key);
  if (cached) return cached;

  const card = getCard(cardId);
  const hpMultiplier = evolved ? card.evoHealthMultiplier : 1;
  const dmgMultiplier = evolved ? card.evoDamageMultiplier : 1;

  const attackRange = fx(card.attackRange);
  const sightRange = fx(card.sightRange);
  const splashRadius = fx(card.splashRadius);
  const loseRange = fxMul(sightRange, TARGET_LOSE_RANGE_FACTOR);

  const stats: ResolvedStats = {
    card,
    hp: Math.round(healthAtLevel(card, level) * hpMultiplier),
    shield: Math.round(shieldAtLevel(card, level) * hpMultiplier),
    damage: Math.round(damageAtLevel(card, level) * dmgMultiplier),
    hitCooldown: Math.max(1, secondsToTicks(card.hitSpeed)),
    firstAttackDelay: secondsToTicks(card.firstAttackDelay),
    attackRange,
    attackRangeSq: sq(attackRange),
    sightRange,
    sightRangeSq: sq(sightRange),
    loseRangeSq: sq(loseRange),
    splashRadius,
    splashRadiusSq: sq(splashRadius),
    speed: speedClassToFx(card.speedClass),
    radius: fx(card.bodyRadius),
    lifetimeTicks: secondsToTicks(card.lifetimeSeconds),
    statusTicks: secondsToTicks(card.statusDuration),
  };

  statsCache.set(key, stats);
  return stats;
}

/** Test hook — the cache keys on card id, so redefining a card must reset it. */
export function clearStatsCache(): void {
  statsCache.clear();
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

function blankEntity(id: number, team: Team, kind: Entity['kind']): Entity {
  return {
    id,
    alive: true,
    kind,
    team,
    cardId: '',
    level: 11,
    evolved: false,
    x: 0,
    y: 0,
    faceX: 0,
    faceY: team === 0 ? FX_ONE : -FX_ONE,
    radius: fx(0.4),
    flying: false,
    mass: 20,
    hp: 1,
    maxHp: 1,
    shield: 0,
    maxShield: 0,
    speed: 0,
    stepX: 0,
    stepY: 0,
    pushX: 0,
    pushY: 0,
    goalTowerIndex: -1,
    lane: 0,
    targetId: NO_TARGET,
    attackCooldown: 0,
    deployTimer: 0,
    windupDone: false,
    freezeTicks: 0,
    stunTicks: 0,
    slowTicks: 0,
    slowFactor: FX_ONE,
    rageTicks: 0,
    poisonTicks: 0,
    poisonDamagePerTick: 0,
    poisonResidue: 0,
    isHero: false,
    abilityTicks: 0,
    invisibleTicks: 0,
    tauntSourceId: NO_TARGET,
    passiveCharges: 0,
    passiveTimer: 0,
    passiveTargetId: NO_TARGET,
    lifetimeTicks: 0,
    towerIndex: -1,
    dormant: false,
    sourceId: NO_TARGET,
    destX: 0,
    destY: 0,
    damage: 0,
    splashRadius: 0,
    appliesStatus: false,
  };
}

function push(state: MatchState, entity: Entity): Entity {
  state.entities.push(entity);
  state.events.push({
    type: 'spawn',
    entityId: entity.id,
    cardId: entity.cardId,
    team: entity.team,
    x: entity.x,
    y: entity.y,
  });
  return entity;
}

/**
 * Which enemy tower a unit spawned at this X should march toward. Falls back
 * to the enemy king tower once that lane's princess tower is gone.
 */
export function objectiveTowerIndex(state: MatchState, team: Team, lane: Lane): number {
  const foe = enemyOf(team);
  const princess = TOWER_LAYOUTS.findIndex(
    (t) => t.team === foe && t.kind === 'princess' && t.lane === lane,
  );
  const princessEntity = state.entities.find((e) => e.alive && e.towerIndex === princess);
  if (princessEntity) return princess;
  return TOWER_LAYOUTS.findIndex((t) => t.team === foe && t.kind === 'king');
}

export function spawnTroop(
  state: MatchState,
  cardId: string,
  level: number,
  evolved: boolean,
  team: Team,
  x: Fx,
  y: Fx,
  opts: { skipDeployDelay?: boolean } = {},
): Entity {
  const stats = resolveStats(cardId, level, evolved);
  const card = stats.card;
  const entity = blankEntity(state.nextEntityId++, team, card.category === 'Building' ? 'building' : 'troop');

  entity.cardId = cardId;
  entity.level = level;
  entity.evolved = evolved;
  entity.x = x;
  entity.y = y;
  entity.radius = stats.radius;
  entity.flying = card.isFlying;
  entity.mass = card.massWeight;
  entity.hp = stats.hp;
  entity.maxHp = stats.hp;
  entity.shield = stats.shield;
  entity.maxShield = stats.shield;
  entity.speed = card.category === 'Building' ? 0 : stats.speed;
  entity.isHero = card.isHero;
  entity.lifetimeTicks = stats.lifetimeTicks;
  entity.deployTimer = opts.skipDeployDelay ? 0 : DEPLOY_DELAY_TICKS;
  entity.lane = laneForX(Math.floor(x / FX_ONE));
  entity.goalTowerIndex = objectiveTowerIndex(state, team, entity.lane);
  entity.faceY = team === 0 ? FX_ONE : -FX_ONE;

  if (card.isHero) state.players[team].heroEntityId = entity.id;

  return push(state, entity);
}

export function spawnTower(
  state: MatchState,
  towerIndex: number,
  cardId: string,
  level: number,
): Entity {
  const layout = TOWER_LAYOUTS[towerIndex];
  const stats = resolveStats(cardId, level, false);
  const entity = blankEntity(state.nextEntityId++, layout.team, 'tower');

  entity.cardId = cardId;
  entity.level = level;
  entity.x = fx(layout.centerX);
  entity.y = fx(layout.centerY);
  entity.radius = stats.radius;
  entity.mass = 100;
  entity.hp = stats.hp;
  entity.maxHp = stats.hp;
  entity.towerIndex = towerIndex;
  entity.lane = layout.lane ?? 0;
  entity.speed = 0;
  // King towers hold fire until damaged or until a princess tower falls.
  entity.dormant = layout.kind === 'king';
  entity.faceY = layout.team === 0 ? FX_ONE : -FX_ONE;

  return push(state, entity);
}

/**
 * Projectiles are spawned both by attacking units and by spell casts, and a
 * spell has no firing entity behind it — hence an explicit origin rather than
 * a source `Entity`.
 */
export interface ProjectileSpec {
  team: Team;
  cardId: string;
  level: number;
  evolved: boolean;
  originX: Fx;
  originY: Fx;
  /** Firing entity, or NO_TARGET for a spell. */
  sourceId: number;
  /** Homing target, or NO_TARGET to fly to a fixed point. */
  targetId: number;
  destX: Fx;
  destY: Fx;
  damage: number;
  splashRadius: Fx;
  appliesStatus: boolean;
}

export function spawnProjectile(state: MatchState, spec: ProjectileSpec): Entity {
  const entity = blankEntity(state.nextEntityId++, spec.team, 'projectile');
  entity.cardId = spec.cardId;
  entity.level = spec.level;
  entity.evolved = spec.evolved;
  entity.x = spec.originX;
  entity.y = spec.originY;
  entity.radius = 0;
  entity.flying = true;
  entity.sourceId = spec.sourceId;
  entity.targetId = spec.targetId;
  entity.destX = spec.destX;
  entity.destY = spec.destY;
  entity.damage = spec.damage;
  entity.splashRadius = spec.splashRadius;
  entity.appliesStatus = spec.appliesStatus;
  return push(state, entity);
}

/** Convenience for the common case: a unit firing at a locked target. */
export function fireProjectileFrom(
  state: MatchState,
  source: Entity,
  target: Entity,
  damage: number,
  splashRadius: Fx,
  appliesStatus: boolean,
): Entity {
  return spawnProjectile(state, {
    team: source.team,
    cardId: source.cardId,
    level: source.level,
    evolved: source.evolved,
    originX: source.x,
    originY: source.y,
    sourceId: source.id,
    targetId: target.id,
    destX: target.x,
    destY: target.y,
    damage,
    splashRadius,
    appliesStatus,
  });
}

// ---------------------------------------------------------------------------
// Formations
// ---------------------------------------------------------------------------

/**
 * Twelve unit vectors at 30-degree steps, in Q16.16.
 *
 * Hardcoded rather than derived from Math.cos/Math.sin: those are only
 * implementation-approximated by the ES spec, so computing them at runtime
 * would risk a one-ulp difference between engines becoming a desync.
 */
const DIR12: ReadonlyArray<readonly [Fx, Fx]> = [
  [65536, 0],
  [56756, 32768],
  [32768, 56756],
  [0, 65536],
  [-32768, 56756],
  [-56756, 32768],
  [-65536, 0],
  [-56756, -32768],
  [-32768, -56756],
  [0, -65536],
  [32768, -56756],
  [56756, -32768],
];

/**
 * Deployment offsets for a card that spawns `count` entities, in tiles.
 * Units fill rings of six outward from the drop point.
 */
export function formationOffsets(count: number): Array<readonly [Fx, Fx]> {
  if (count <= 1) return [[0, 0]];
  const offsets: Array<readonly [Fx, Fx]> = [];
  for (let i = 0; i < count; i++) {
    const ring = Math.floor(i / 6);
    const slot = i % 6;
    // Alternate rings are rotated 30 degrees so units do not line up radially.
    const dir = DIR12[(slot * 2 + (ring % 2)) % 12];
    const radius = fx(0.5 + ring * 0.5);
    offsets.push([fxMul(dir[0], radius), fxMul(dir[1], radius)]);
  }
  return offsets;
}

/** A small deterministic scatter so identical drops do not perfectly overlap. */
export function spawnJitter(rng: Rng): Fx {
  return nextFxSpread(rng, fx(0.06));
}

// ---------------------------------------------------------------------------
// Damage
// ---------------------------------------------------------------------------

/**
 * Apply damage, shield first. Returns the amount actually removed from health
 * so callers can attribute overkill.
 *
 * Towers are the only entities that report a destruction event here; troop
 * deaths are picked up by the deaths system so death effects resolve in a
 * single, ordered place.
 */
export function applyDamage(
  state: MatchState,
  target: Entity,
  amount: number,
  attacker?: Entity,
): number {
  if (!target.alive || amount <= 0) return 0;

  let remaining = amount;
  if (target.shield > 0) {
    const absorbed = Math.min(target.shield, remaining);
    target.shield -= absorbed;
    remaining -= absorbed;
  }
  if (remaining <= 0) return 0;

  const dealt = Math.min(target.hp, remaining);
  target.hp -= dealt;

  // A king tower wakes the moment it is touched.
  if (target.kind === 'tower' && target.dormant) target.dormant = false;

  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    state.needsCompaction = true;
    return dealt;
  }

  // Reactive passives — reflect, parry — fire only on a survivor, and only
  // when the damage came from an identifiable attacker. Spells and decay have
  // nobody to answer, which is deliberate: they are the counterplay.
  if (dealt > 0 && attacker) {
    const hooks = passiveHooks(resolveStats(target.cardId, target.level, target.evolved).card.passiveId);
    if (hooks?.onDamaged) {
      const magnitude = resolveStats(target.cardId, target.level, target.evolved).card
        .passiveMagnitude;
      hooks.onDamaged(state, target, attacker, dealt, magnitude);
    }
  }
  return dealt;
}

export function findEntity(state: MatchState, id: number): Entity | undefined {
  if (id === NO_TARGET) return undefined;
  // Entities are appended in ascending id order and never reordered, so the
  // array is always sorted by id and a binary search is valid.
  let lo = 0;
  let hi = state.entities.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const candidate = state.entities[mid];
    if (candidate.id === id) return candidate;
    if (candidate.id < id) lo = mid + 1;
    else hi = mid - 1;
  }
  return undefined;
}

export function isTargetable(entity: Entity | undefined): entity is Entity {
  return (
    !!entity &&
    entity.alive &&
    entity.kind !== 'projectile' &&
    entity.invisibleTicks <= 0 &&
    entity.deployTimer <= 0
  );
}

/** Whether `priority` permits attacking `target`. */
export function canTarget(priority: CardDefinition['targetPriority'], target: Entity): boolean {
  switch (priority) {
    case 'AirAndGround':
      return true;
    case 'Ground':
      return !target.flying;
    case 'AirOnly':
      return target.flying;
    case 'Buildings':
      return target.kind === 'building' || target.kind === 'tower';
    default:
      return false;
  }
}
