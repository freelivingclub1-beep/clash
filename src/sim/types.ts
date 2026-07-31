/**
 * Core simulation types.
 *
 * `Entity` is a single flat struct covering troops, buildings, towers,
 * projectiles and spell bursts rather than a class hierarchy or a component
 * store. At the scale of a match — a few hundred live entities — a fat struct
 * with unused fields is both faster and far easier to serialise and hash for
 * the determinism tests than either alternative.
 *
 * Status effects are flat tick counters for the same reason: an array of
 * effect objects would allocate every tick and would need an ordering rule to
 * stay replay-stable.
 */

import type { Fx } from './math/fixed';
import type { Rng } from './math/rng';
import type { Team, Lane, DeployRights, ArenaGrid } from './nav/grid';
import type { FlowFieldCache } from './nav/flowfield';

export type { Team, Lane };

export type EntityKind = 'troop' | 'building' | 'tower' | 'projectile';

export const NO_TARGET = -1;

export interface Entity {
  id: number;
  alive: boolean;
  kind: EntityKind;
  team: Team;

  /** Definition this entity was built from; stats are read back through it. */
  cardId: string;
  level: number;
  /** True when spawned from an evolved card. */
  evolved: boolean;

  // --- transform -----------------------------------------------------------
  x: Fx;
  y: Fx;
  /** Facing, kept for the renderer and for cone splash. */
  faceX: Fx;
  faceY: Fx;
  radius: Fx;
  flying: boolean;
  /** Set by the terrain_walk passive: crosses the river without a bridge. */
  ignoresTerrain: boolean;
  mass: number;

  // --- health --------------------------------------------------------------
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;

  // --- movement ------------------------------------------------------------
  /** Base tiles-per-tick before status modifiers. */
  speed: Fx;
  /** Per-tick displacement chosen by steering, consumed by movement. */
  stepX: Fx;
  stepY: Fx;
  /** Knockback impulse, decayed each tick. */
  pushX: Fx;
  pushY: Fx;

  // --- objective / combat --------------------------------------------------
  /** Index into TOWER_LAYOUTS this unit marches toward when nothing is near. */
  goalTowerIndex: number;
  lane: Lane;
  targetId: number;
  /** Ticks until this entity may attack again. */
  attackCooldown: number;
  /** Ticks remaining of the pre-deploy freeze; nothing acts while > 0. */
  deployTimer: number;
  /** Set once the first-attack delay has been paid for the current target. */
  windupDone: boolean;

  // --- status effects (ticks remaining) ------------------------------------
  freezeTicks: number;
  stunTicks: number;
  slowTicks: number;
  /** Speed multiplier while slowed, Q16.16. */
  slowFactor: Fx;
  rageTicks: number;
  poisonTicks: number;
  poisonDamagePerTick: number;
  /** Damage-over-time remainder, so fractional DPS does not round to zero. */
  poisonResidue: number;

  // --- hero ----------------------------------------------------------------
  isHero: boolean;
  /** Ticks remaining of an active ability effect (dash, cloak, taunt). */
  abilityTicks: number;
  /** Untargetable while > 0. */
  invisibleTicks: number;
  /** Entity forced to attack this one, for taunt effects. */
  tauntSourceId: number;

  // --- passive scratch space -----------------------------------------------
  /** Passive-specific counter: parry readiness, attack-ramp stacks. */
  passiveCharges: number;
  /** Passive-specific countdown, e.g. the parry cooldown. */
  passiveTimer: number;
  /** Last target seen by a passive, so attack ramp can detect a switch. */
  passiveTargetId: number;

  // --- shield --------------------------------------------------------------
  /** Ticks of displacement immunity granted the instant a shield breaks. */
  shieldBreakTicks: number;

  // --- charge --------------------------------------------------------------
  /** Uninterrupted distance travelled, in Q16.16 tiles. Resets on impact. */
  chargeDistance: Fx;
  /** True once `chargeDistance` passes the card's threshold. */
  charging: boolean;

  // --- building ------------------------------------------------------------
  /** Ticks of life left; buildings self-destruct at 0. */
  lifetimeTicks: number;

  // --- tower ---------------------------------------------------------------
  /** Index into TOWER_LAYOUTS, or -1 for non-towers. */
  towerIndex: number;
  /** King towers stay dormant until damaged or a princess tower falls. */
  dormant: boolean;

  // --- projectile ----------------------------------------------------------
  sourceId: number;
  /** Homing target; projectiles fall back to their last known point. */
  /**
   * Where a projectile was fired from.
   *
   * Write-once at spawn and never read by the simulation — it exists so the
   * renderer can work out how far along its flight a shot is, which is what
   * an arc and a travel trail are drawn from. Deliberately excluded from the
   * determinism hash for that reason: it is derived from state already hashed.
   */
  originX: Fx;
  originY: Fx;
  destX: Fx;
  destY: Fx;
  damage: number;
  splashRadius: Fx;
  /** Status the projectile applies on impact, mirrored from the source card. */
  appliesStatus: boolean;
}

export type MatchPhase = 'countdown' | 'regulation' | 'overtime' | 'finished';
export type MatchOutcome = 'ongoing' | 'blue' | 'red' | 'draw';

export interface PlayerState {
  team: Team;
  /** Integer aether points; 84 points = 1 aether. */
  aetherPoints: number;

  /** The eight battle cards, in deck-slot order. */
  deck: string[];
  towerTroopCardId: string;
  /** Card id -> level, from the player's collection. */
  levels: Map<string, number>;

  /** Four cards currently playable. */
  hand: string[];
  /** Remaining cycle; queue[0] is the "next card" shown in the HUD. */
  queue: string[];

  /** Card ids allowed to evolve (deck slot 1, and slot 3 when it is an evo). */
  evolutionSlots: string[];
  /** Plays remaining before the card evolves. */
  evoCounters: Map<string, number>;
  /** Set when the counter has run out and the next play will be evolved. */
  evoReady: Map<string, boolean>;

  /** Live hero entity id, or NO_TARGET. */
  heroEntityId: number;
  /** Ticks until the ability may be used again. */
  heroAbilityCooldown: number;

  crowns: number;
  /** Which enemy lanes have opened up for forward deployment. */
  deployRights: DeployRights;
  /** Aether spent this match — surfaced in the post-match summary. */
  aetherSpent: number;
  /** Cards deployed this match, for the same summary. */
  cardsPlayed: number;
}

export interface MatchState {
  tick: number;
  phase: MatchPhase;
  outcome: MatchOutcome;

  grid: ArenaGrid;
  flowFields: FlowFieldCache;

  /** Dense, id-ordered, tombstoned. Never reordered. */
  entities: Entity[];
  nextEntityId: number;
  /** Set when any entity died this tick, so compaction can be skipped. */
  needsCompaction: boolean;

  players: [PlayerState, PlayerState];

  /** Deck cycle order only. */
  shuffleRng: Rng;
  /** Everything else: spawn scatter, tie-breaks, bot decisions. */
  simRng: Rng;

  /** Render-only feed of things that happened this tick; cleared each tick. */
  events: SimEvent[];
}

export type SimEvent =
  | { type: 'spawn'; entityId: number; cardId: string; team: Team; x: Fx; y: Fx }
  | { type: 'death'; entityId: number; cardId: string; team: Team; x: Fx; y: Fx }
  | { type: 'hit'; x: Fx; y: Fx; damage: number; splash: boolean }
  | { type: 'towerDestroyed'; towerIndex: number; team: Team }
  | { type: 'shieldBreak'; entityId: number; team: Team; x: Fx; y: Fx }
  /** A shot leaving a weapon, so the renderer can flash the muzzle. */
  | { type: 'shoot'; cardId: string; team: Team; x: Fx; y: Fx; faceX: Fx; faceY: Fx }
  | { type: 'charge'; entityId: number; team: Team; x: Fx; y: Fx }
  | { type: 'ability'; team: Team; hook: string; x: Fx; y: Fx }
  | { type: 'spell'; cardId: string; team: Team; x: Fx; y: Fx; radius: Fx }
  | { type: 'deployRejected'; team: Team; reason: string };

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/**
 * Player intent. These are the payloads a lockstep server would relay
 * verbatim, so they stay small and JSON-serialisable — no entity references,
 * no floats, tile coordinates only.
 */
export type Command =
  | { type: 'deploy'; team: Team; handIndex: number; tileX: number; tileY: number }
  | { type: 'ability'; team: Team }
  | { type: 'emote'; team: Team; emoteId: number };

export interface InputFrame {
  tick: number;
  commands: Command[];
}
