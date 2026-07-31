/**
 * Always-on card passives.
 *
 * Where `abilities.ts` handles a Champion's *activated* button and
 * `evolutions.ts` handles what an evolved card gains, this registry handles
 * mechanics a card simply *has* — reflect, parry, chain, auras, death splits.
 *
 * Every passive here has a matching EPP price in `@cards/balance`. That is the
 * contract: a card gets one of these mechanics only by paying for it out of
 * its health and damage budget, and `tests/balance.test.ts` fails the build if
 * a card names a passive the price list has never heard of.
 *
 * Hooks fire at four points, all inside the existing tick order:
 *   onSpawn    — as the entity enters the field
 *   onHit      — after it lands a hit, with the victim
 *   onDamaged  — after it takes damage, with the attacker (may be undefined)
 *   onDeath    — during the deaths system
 *   onTick     — once per tick while alive, for auras
 */

import { type Fx, fx, fxLenSq, fxMul, FX_ONE } from '../math/fixed';
import { TICK_HZ } from '../constants';
import { enemyOf } from '../nav/grid';
import { applyDamage, isTargetable, resolveStats, spawnTroop } from '../entities';
import type { Entity, MatchState } from '../types';

export interface PassiveHooks {
  onSpawn?: (state: MatchState, self: Entity, magnitude: number) => void;
  onHit?: (state: MatchState, self: Entity, victim: Entity, magnitude: number) => void;
  onDamaged?: (
    state: MatchState,
    self: Entity,
    attacker: Entity | undefined,
    amount: number,
    magnitude: number,
  ) => void;
  onDeath?: (state: MatchState, self: Entity, magnitude: number) => void;
  onTick?: (state: MatchState, self: Entity, magnitude: number) => void;
}

const registry = new Map<string, PassiveHooks>();

function register(id: string, hooks: PassiveHooks): void {
  registry.set(id, hooks);
}

/** Allies of `self` within `radius`, ascending by id for stable resolution. */
function alliesInRadius(state: MatchState, self: Entity, radius: Fx): Entity[] {
  const radiusSq = Math.round((radius * radius) / FX_ONE);
  const found: Entity[] = [];
  for (const entity of state.entities) {
    if (entity.team !== self.team || entity === self) continue;
    if (!entity.alive || entity.kind === 'projectile') continue;
    if (fxLenSq(entity.x - self.x, entity.y - self.y) > radiusSq) continue;
    found.push(entity);
  }
  return found;
}

function enemiesInRadius(state: MatchState, self: Entity, radius: Fx): Entity[] {
  const foe = enemyOf(self.team);
  const radiusSq = Math.round((radius * radius) / FX_ONE);
  const found: Entity[] = [];
  for (const entity of state.entities) {
    if (entity.team !== foe || !isTargetable(entity)) continue;
    if (fxLenSq(entity.x - self.x, entity.y - self.y) > radiusSq) continue;
    found.push(entity);
  }
  return found;
}

// ---------------------------------------------------------------------------
// Defensive passives
// ---------------------------------------------------------------------------

/**
 * Reflect Shield — returns a share of incoming *ranged* damage to the shooter.
 *
 * Ranged only, deliberately: reflecting melee damage too would make the card a
 * hard counter to everything, and the whole point of the budget system is that
 * a mechanic has a defined scope you can play around.
 */
register('reflect_ranged', {
  onDamaged: (state, self, attacker, amount, magnitude) => {
    if (!attacker || !attacker.alive || attacker.team === self.team) return;
    const attackerStats = resolveStats(attacker.cardId, attacker.level, attacker.evolved);
    if (!attackerStats.card.usesProjectile) return;
    applyDamage(state, attacker, Math.round(amount * magnitude));
  },
});

/**
 * Parry — the next melee hit is negated entirely and answered with double
 * damage, then the parry goes on a short cooldown.
 *
 * `passiveCharges` doubles as the ready flag and `passiveTimer` as the
 * cooldown, so the mechanic costs no extra entity fields.
 */
register('parry_melee', {
  onSpawn: (_state, self) => {
    self.passiveCharges = 1;
  },
  onDamaged: (state, self, attacker, amount, magnitude) => {
    if (!attacker || self.passiveCharges <= 0) return;
    const attackerStats = resolveStats(attacker.cardId, attacker.level, attacker.evolved);
    if (attackerStats.card.usesProjectile) return;

    // Refund the blow that was already applied, then counter.
    self.hp = Math.min(self.maxHp, self.hp + amount);
    self.passiveCharges = 0;
    self.passiveTimer = Math.round(3.5 * TICK_HZ);
    applyDamage(state, attacker, Math.round(amount * magnitude));
  },
  onTick: (_state, self) => {
    if (self.passiveCharges > 0) return;
    if (self.passiveTimer > 0) self.passiveTimer--;
    if (self.passiveTimer === 0) self.passiveCharges = 1;
  },
});

/** Spawn Shield — absorbs a fixed share of max health before it starts. */
register('spawn_shield', {
  onSpawn: (_state, self, magnitude) => {
    const shield = Math.round(self.maxHp * magnitude);
    self.shield += shield;
    self.maxShield += shield;
  },
});

/** Enrage — attack and movement speed spike once badly wounded. */
register('enrage_low_hp', {
  onTick: (_state, self, magnitude) => {
    const wounded = self.hp <= self.maxHp * magnitude;
    // Held at 2 ticks rather than set once, so it lapses if the unit is healed.
    if (wounded) self.rageTicks = Math.max(self.rageTicks, 2);
  },
});

// ---------------------------------------------------------------------------
// Offensive passives
// ---------------------------------------------------------------------------

/** Chain Attack — the hit arcs to nearby enemies at reduced damage. */
register('chain_attack', {
  onHit: (state, self, victim, magnitude) => {
    const stats = resolveStats(self.cardId, self.level, self.evolved);
    const chainRadius = fx(2.5);
    const chained = enemiesInRadius(state, victim, chainRadius).filter((e) => e.id !== victim.id);

    // Bounded to two extra targets: an uncapped chain on a swarm is how a
    // card stops having a counter.
    for (const target of chained.slice(0, 2)) {
      applyDamage(state, target, Math.round(stats.damage * magnitude));
    }
  },
});

/** Attack Ramp — hit speed accelerates while it stays on the same target. */
register('attack_ramp', {
  onHit: (_state, self, victim, magnitude) => {
    if (self.passiveTargetId !== victim.id) {
      self.passiveTargetId = victim.id;
      self.passiveCharges = 0;
      return;
    }
    // Caps out so the ramp is a reward for an uninterrupted channel, not a
    // runaway. Each stack shaves a tick off the next cooldown.
    const cap = Math.max(1, Math.round(magnitude));
    self.passiveCharges = Math.min(cap, self.passiveCharges + 1);
  },
});

/** Displacement — every hit shoves the victim back toward its own side. */
register('displacement', {
  onHit: (_state, self, victim, magnitude) => {
    if (victim.kind === 'tower' || victim.kind === 'building') return;
    const away = self.team === 0 ? FX_ONE : -FX_ONE;
    victim.pushY += fxMul(away, fx(magnitude));
  },
});

/** Siege Bonus — extra damage against buildings and towers only. */
register('siege_bonus', {
  onHit: (state, self, victim, magnitude) => {
    if (victim.kind !== 'building' && victim.kind !== 'tower') return;
    const stats = resolveStats(self.cardId, self.level, self.evolved);
    applyDamage(state, victim, Math.round(stats.damage * magnitude));
  },
});

// ---------------------------------------------------------------------------
// Aura passives
// ---------------------------------------------------------------------------

/** Healing aura — mends nearby allies each second. */
register('aura_heal', {
  onTick: (state, self, magnitude) => {
    // Once a second rather than every tick, so healing is legible on the bars.
    if (state.tick % TICK_HZ !== 0) return;
    for (const ally of alliesInRadius(state, self, fx(3.5))) {
      if (ally.kind === 'tower') continue;
      ally.hp = Math.min(ally.maxHp, ally.hp + Math.round(magnitude));
    }
  },
});

/** Slowing aura — everything hostile nearby moves at reduced speed. */
register('aura_slow', {
  onTick: (state, self, magnitude) => {
    for (const enemy of enemiesInRadius(state, self, fx(4.0))) {
      if (enemy.kind === 'tower' || enemy.kind === 'building') continue;
      // Refreshed to 3 ticks so it lapses almost immediately on leaving the aura.
      enemy.slowTicks = Math.max(enemy.slowTicks, 3);
      enemy.slowFactor = fx(magnitude);
    }
  },
});

// ---------------------------------------------------------------------------
// Death passives
// ---------------------------------------------------------------------------

/** Death Split — breaks into smaller copies of a named unit. */
register('death_split', {
  onDeath: (state, self, magnitude) => {
    const stats = resolveStats(self.cardId, self.level, self.evolved);
    const spawnId = stats.card.deathEffectParam;
    if (!spawnId) return;

    const count = Math.max(1, Math.round(magnitude));
    const offsets: Array<[Fx, Fx]> = [
      [fx(-0.5), 0],
      [fx(0.5), 0],
      [0, fx(-0.5)],
      [0, fx(0.5)],
    ];
    for (let i = 0; i < count; i++) {
      const [ox, oy] = offsets[i % offsets.length];
      spawnTroop(state, spawnId, self.level, false, self.team, self.x + ox, self.y + oy, {
        skipDeployDelay: true,
      });
    }
  },
});

/** Death Zone — leaves a lingering damaging patch where it fell. */
register('death_zone', {
  onDeath: (state, self, magnitude) => {
    // Modelled as an immediate burst plus a poison stack on everything caught,
    // which reuses the existing status pipeline instead of adding a new entity
    // kind that every system would then have to know about.
    for (const enemy of enemiesInRadius(state, self, fx(2.5))) {
      enemy.poisonTicks = Math.max(enemy.poisonTicks, Math.round(3 * TICK_HZ));
      enemy.poisonDamagePerTick = Math.max(
        enemy.poisonDamagePerTick,
        Math.round(magnitude / TICK_HZ),
      );
    }
  },
});

/** Damage Immunity — shrugs off crowd control while alive. */
register('damage_immunity', {
  onTick: (_state, self) => {
    self.freezeTicks = 0;
    self.stunTicks = 0;
    self.slowTicks = 0;
    self.slowFactor = FX_ONE;
  },
});

// ---------------------------------------------------------------------------

export function passiveHooks(passiveId: string): PassiveHooks | undefined {
  if (!passiveId || passiveId === 'none') return undefined;
  return registry.get(passiveId);
}

export function hasPassive(passiveId: string): boolean {
  return passiveId === 'none' || registry.has(passiveId);
}

export function registeredPassives(): string[] {
  return ['none', ...[...registry.keys()].sort()];
}

/** Run every live entity's `onTick` passive. Called from the tick pipeline. */
export function passiveTick(state: MatchState): void {
  for (const entity of state.entities) {
    if (!entity.alive || entity.kind === 'projectile' || entity.deployTimer > 0) continue;
    const stats = resolveStats(entity.cardId, entity.level, entity.evolved);
    const hooks = passiveHooks(stats.card.passiveId);
    hooks?.onTick?.(state, entity, stats.card.passiveMagnitude);
  }
}
