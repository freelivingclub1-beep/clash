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
import { GRID_H } from '../constants';
import { enemyOf } from '../nav/grid';
import { RIVER_ROW_LOW } from '../constants';
import { applyDamage, canTarget, isTargetable, resolveStats, spawnTroop } from '../entities';
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

/** True when a straight line between two rows would cross the water. */
function crossesRiver(fromY: Fx, toY: Fx): boolean {
  const from = fromY / FX_ONE;
  const to = toY / FX_ONE;
  const bank = RIVER_ROW_LOW;
  return (from < bank) !== (to < bank);
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
 * Thornmail — the melee twin of Reflect Shield.
 *
 * Same shape, opposite scope, and that is the point: the two cards that carry
 * these are a real choice rather than a strictly-better pair. One punishes the
 * shooter behind the push, the other punishes the tank in front of it, and
 * neither does anything at all against the other's prey.
 *
 * The reflected blow deliberately cannot chain: it is dealt with no attacker,
 * so a Thornmail hit by another Thornmail does not start a rally.
 */
register('reflect_melee', {
  onDamaged: (state, self, attacker, amount, magnitude) => {
    if (!attacker || !attacker.alive || attacker.team === self.team) return;
    const attackerStats = resolveStats(attacker.cardId, attacker.level, attacker.evolved);
    if (attackerStats.card.usesProjectile) return;
    applyDamage(state, attacker, Math.round(amount * magnitude));
  },
});

/**
 * Executioner — extra damage against anything already below half health.
 *
 * A timing card rather than a stat card. Played on a fresh push it is an
 * ordinary melee body; played a beat later, after your tower has chipped the
 * front line, it deletes what is left. The counterplay is equally concrete —
 * pull it onto something at full health and the bonus never fires.
 */
register('execute_low_hp', {
  onHit: (state, self, victim, magnitude) => {
    if (victim.hp * 2 > victim.maxHp) return;
    const stats = resolveStats(self.cardId, self.level, self.evolved);
    applyDamage(state, victim, Math.round(stats.damage * magnitude), self, { passives: false });
  },
});

/**
 * First Strike — the opening blow on each new victim is the heavy one.
 *
 * The exact inverse of `damage_ramp`, and built that way on purpose: one card
 * wants to stay on a single target for as long as it can, the other wants to
 * be pulled off constantly. A lone tank blanks First Strike completely; a wide
 * swarm blanks the ramp. Which of those your opponent plays is the whole read.
 *
 * `passiveTargetId` holds the victim the bonus has already been spent on.
 */
register('first_strike', {
  onHit: (state, self, victim, magnitude) => {
    if (self.passiveTargetId === victim.id) return;
    self.passiveTargetId = victim.id;
    const stats = resolveStats(self.cardId, self.level, self.evolved);
    applyDamage(state, victim, Math.round(stats.damage * magnitude), self, { passives: false });
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
      // The arc is what makes a chain legible. Without it the extra victims
      // just lose health with nothing on screen connecting them to the hit.
      state.events.push({
        type: 'arc',
        team: self.team,
        x: victim.x,
        y: victim.y,
        toX: target.x,
        toY: target.y,
        kind: 'chain',
      });
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

/**
 * Plating aura — tops nearby allies back up to a small armour layer.
 *
 * Grants shield rather than health on purpose. A shield is a *separate*
 * durability layer with overkill absorption, so one point of it given to a
 * swarm is worth far more than one point of healing: each body it lands on
 * eats one blow of any size. That is also why the top-up is capped and slow —
 * a plate every few seconds is a real defensive investment, a plate every tick
 * would make the escorted push unkillable by anything that hits once.
 */
register('aura_shield', {
  onTick: (state, self, magnitude) => {
    const period = Math.round(2.5 * TICK_HZ);
    if (state.tick % period !== 0) return;
    const cap = Math.max(1, Math.round(magnitude));
    for (const ally of alliesInRadius(state, self, fx(3.2))) {
      if (ally.kind === 'tower' || ally.kind === 'building') continue;
      if (ally.shield >= cap) continue;
      ally.shield = cap;
      // The plate the renderer draws is keyed off `maxShield`, so a unit that
      // never had one of its own still shows the armour it has been given.
      ally.maxShield = Math.max(ally.maxShield, cap);
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
// Conditional damage
// ---------------------------------------------------------------------------

/** Air Superiority — extra damage against flying targets only. */
register('air_superiority', {
  onHit: (state, self, victim, magnitude) => {
    if (!victim.flying) return;
    const stats = resolveStats(self.cardId, self.level, self.evolved);
    applyDamage(state, victim, Math.round(stats.damage * magnitude), self);
  },
});

/** Shield Breaker — extra damage while the victim still has a shield up. */
register('shield_breaker', {
  onHit: (state, self, victim, magnitude) => {
    if (victim.shield <= 0) return;
    const stats = resolveStats(self.cardId, self.level, self.evolved);
    applyDamage(state, victim, Math.round(stats.damage * magnitude), self);
  },
});

/**
 * Suicide Charge — detonates on contact, then dies.
 *
 * The blast is deliberately area damage on the *victim's* position rather than
 * the carrier's: the carrier has already closed to melee, and centring on the
 * target is what lets it punish a tightly packed defence.
 */
register('suicide_charge', {
  onHit: (state, self, victim, magnitude) => {
    const stats = resolveStats(self.cardId, self.level, self.evolved);
    const blast = Math.round(stats.damage * magnitude);
    for (const enemy of enemiesInRadius(state, victim, fx(2.0))) {
      applyDamage(state, enemy, blast, self);
    }
    // Consumed by its own attack — no death effect credit, no lingering body.
    self.hp = 0;
    self.alive = false;
    state.needsCompaction = true;
  },
});

// ---------------------------------------------------------------------------
// Buffs
// ---------------------------------------------------------------------------

/**
 * Damage Aura — nearby allies fight faster.
 *
 * Implemented by granting rage rather than by adding a parallel damage
 * multiplier: rage already shortens attack cooldowns, already ticks down, and
 * already renders a tell. A second mechanism would duplicate all three.
 */
register('aura_damage', {
  onTick: (state, self, magnitude) => {
    for (const ally of alliesInRadius(state, self, fx(magnitude))) {
      if (ally.kind === 'tower' || ally.kind === 'building') continue;
      // Two ticks, refreshed continuously, so it lapses on leaving the aura.
      ally.rageTicks = Math.max(ally.rageTicks, 2);
    }
  },
});

/** Pack Bond — stronger while it has company, useless alone. */
register('pack_bond', {
  onTick: (state, self, magnitude) => {
    const needed = Math.max(1, Math.round(magnitude));
    let allies = 0;
    for (const ally of alliesInRadius(state, self, fx(3.0))) {
      if (ally.kind === 'troop') allies++;
      if (allies >= needed) break;
    }
    if (allies >= needed) self.rageTicks = Math.max(self.rageTicks, 2);
  },
});

/** Growth — maximum health climbs the longer it stays alive. */
register('growth', {
  onTick: (state, self, magnitude) => {
    if (state.tick % TICK_HZ !== 0) return;
    // Capped at double the starting pool so a stalled match cannot produce an
    // unkillable unit.
    const cap = self.maxHp * 2;
    const gain = Math.round(magnitude);
    if (self.maxHp >= cap) return;
    self.maxHp += gain;
    self.hp += gain;
  },
});

// ---------------------------------------------------------------------------
// Evasion and protection
// ---------------------------------------------------------------------------

/**
 * Burrow — untargetable while travelling, exposed while attacking.
 *
 * Reuses `invisibleTicks`, which `isTargetable` already honours, so every
 * targeting path picks this up without modification. Refreshed to 2 ticks so
 * it drops the instant the unit stops to swing.
 */
register('burrow', {
  onTick: (_state, self) => {
    // Movement alone is the tell. Gating on "has no target" never fired,
    // because a marching unit always holds the enemy tower as its objective;
    // what actually distinguishes travelling from fighting is that a unit
    // stops moving once it is in range to swing.
    const moving = self.stepX !== 0 || self.stepY !== 0;
    if (moving) self.invisibleTicks = Math.max(self.invisibleTicks, 2);
  },
});

/** Frontal Armour — shrugs off damage from whatever it is facing. */
register('frontal_armor', {
  onDamaged: (_state, self, attacker, amount, magnitude) => {
    if (!attacker) return;
    // Dot product of the facing vector against the attacker's bearing: a
    // positive result means the blow landed on the shield side.
    const toAttackerX = attacker.x - self.x;
    const toAttackerY = attacker.y - self.y;
    const facing = self.faceX * toAttackerX + self.faceY * toAttackerY;
    if (facing <= 0) return;
    self.hp = Math.min(self.maxHp, self.hp + Math.round(amount * magnitude));
  },
});

/** Damage Share — the nearest ally takes part of every blow. */
register('damage_share', {
  onDamaged: (state, self, _attacker, amount, magnitude) => {
    const nearby = alliesInRadius(state, self, fx(5.0)).filter(
      (ally) => ally.kind === 'troop' && ally.alive,
    );
    if (nearby.length === 0) return;

    let closest = nearby[0];
    let bestDist = fxLenSq(closest.x - self.x, closest.y - self.y);
    for (const ally of nearby) {
      const dist = fxLenSq(ally.x - self.x, ally.y - self.y);
      if (dist < bestDist) {
        closest = ally;
        bestDist = dist;
      }
    }

    const shared = Math.round(amount * magnitude);
    if (shared <= 0) return;
    // Refund the share from self before passing it on, so the total damage
    // dealt across both bodies is unchanged — this redistributes, not reduces.
    self.hp = Math.min(self.maxHp, self.hp + shared);
    // Suppress the ally's own reactive passives: two linked keepers would
    // otherwise trade the same share back and forth without end.
    applyDamage(state, closest, shared, undefined, { passives: false });
  },
});

/** Self Replicate — one weakened copy, the first time it is hurt. */
register('self_replicate', {
  onSpawn: (_state, self) => {
    self.passiveCharges = 1;
  },
  onDamaged: (state, self, _attacker, _amount, magnitude) => {
    if (self.passiveCharges <= 0) return;
    self.passiveCharges = 0;

    const copy = spawnTroop(state, self.cardId, self.level, self.evolved, self.team, self.x + fx(0.7), self.y, {
      skipDeployDelay: true,
    });
    // The copy must not replicate in turn, or one card fills the arena.
    copy.passiveCharges = 0;
    copy.maxHp = Math.max(1, Math.round(copy.maxHp * magnitude));
    copy.hp = copy.maxHp;
  },
});

// ---------------------------------------------------------------------------
// Positioning
// ---------------------------------------------------------------------------

/** Blink Strike — arrives already on top of the nearest enemy. */
register('blink_strike', {
  onSpawn: (state, self, magnitude) => {
    const target = enemiesInRadius(state, self, fx(magnitude))
      .filter((enemy) => enemy.kind !== 'tower')
      .sort((a, b) => {
        const da = fxLenSq(a.x - self.x, a.y - self.y);
        const db = fxLenSq(b.x - self.x, b.y - self.y);
        return da === db ? a.id - b.id : da - db;
      })[0];
    if (!target) return;
    self.x = target.x;
    self.y = target.y + (self.team === 0 ? -fx(0.8) : fx(0.8));
    self.targetId = target.id;
  },
});

/** Spawner — periodically produces the unit named in `deathEffectParam`. */
register('spawner', {
  onTick: (state, self, magnitude) => {
    const period = Math.max(1, Math.round(magnitude * TICK_HZ));
    if (self.passiveTimer > 0) {
      self.passiveTimer--;
      return;
    }
    self.passiveTimer = period;

    const stats = resolveStats(self.cardId, self.level, self.evolved);
    const spawnId = stats.card.deathEffectParam;
    if (!spawnId) return;
    spawnTroop(state, spawnId, self.level, false, self.team, self.x, self.y + fx(0.8), {
      skipDeployDelay: true,
    });
  },
});

/**
 * Terrain Walk — crosses the river without using a bridge.
 *
 * The movement system consults `ignoresTerrain` alongside `flying` when
 * testing walkability. Set here on spawn rather than read from the card in
 * the hot loop.
 */
register('terrain_walk', {
  onSpawn: (_state, self) => {
    self.ignoresTerrain = true;
  },
});

/**
 * Charge — accelerates over uninterrupted distance, then doubles the next hit.
 *
 * Registered with no hooks on purpose. The mechanic changes movement speed and
 * outgoing damage, and there is no hook for either: `movement` accumulates the
 * distance and applies the speed multiplier, `combat` applies the doubled hit
 * and clears the state, and `status` breaks it on crowd control.
 *
 * The entry still has to exist, because the registry is what answers "is this
 * a known passive" — and that check is exactly what caught this being given a
 * price before it had an implementation.
 */
register('charge', {});

/**
 * Damage ramp — each consecutive bite on the same victim hits harder.
 *
 * Hooks are the wrong place for this one, for the same reason as `charge`: the
 * ramp has to scale the damage of the swing that is being made, and `onHit`
 * fires after that swing has already landed. `combat` reads the stack count,
 * scales the hit, then increments — so the registry entry exists to declare the
 * passive known, and the arithmetic lives next to the attack it modifies.
 *
 * The stack lives on `passiveTargetId`/`passiveCharges`, which is also what
 * makes the resets fall out for free: a new victim resets it in `combat`, a
 * dead victim resets it in `releaseLocksOn`, and a reset spell resets it in
 * `applyStatus`.
 */
register('damage_ramp', {});

/**
 * Tunnel — surfaces wherever it was dropped, after digging its way there.
 *
 * The dig is the whole card. It can be placed on any tile on the board, but it
 * spends the journey underground: untargetable, undrawn, and completely absent
 * from the board until it comes up. The further from your own back line you
 * placed it, the longer that takes — dropping one just over the river is quick,
 * dropping one behind their king tower gives them several seconds to notice
 * their aether bar move and prepare for it.
 *
 * Implemented on `deployTimer`, which the engine already treats as "not yet
 * targetable and taking no actions", rather than as a new entity state — so
 * nothing else in the tick loop needs to know tunnelling exists.
 */
register('tunnel', {
  onSpawn: (_state, self, magnitude) => {
    /*
     * Rows from the digger's own back line, so distance is measured from where
     * it started rather than from the middle of the board. Blue digs upward
     * from row 0, red downward from row 31.
     */
    const row = self.y / FX_ONE;
    const travelled = self.team === 0 ? row : GRID_H - row;
    const seconds = Math.max(0.6, (travelled * magnitude) / 10);
    self.deployTimer = Math.round(seconds * TICK_HZ);
  },
  onTick: (state, self) => {
    // Fires on the first tick after the dig ends — `passiveTick` skips
    // anything still on a deploy timer, so this is exactly the surfacing tick.
    if (self.passiveCharges > 0) return;
    self.passiveCharges = 1;
    state.events.push({
      type: 'surface',
      cardId: self.cardId,
      team: self.team,
      x: self.x,
      y: self.y,
    });
  },
});

// ---------------------------------------------------------------------------
// The menagerie wave
//
// Twelve mechanics that had no representation in the set. Each one is written
// against the same scratch fields the older passives share — `passiveCharges`,
// `passiveTimer`, `passiveTargetId` — rather than adding entity state, so the
// determinism hash is untouched and a saved replay still resolves.
// ---------------------------------------------------------------------------

/**
 * Lifesteal — heals itself for a share of the damage it deals.
 *
 * The inverse of a shield: it buys nothing against burst, and everything
 * against a long fight it is winning. A lone tank feeds it indefinitely; a
 * spell removes it before the healing ever compounds.
 */
register('lifesteal', {
  onHit: (_state, self, victim, magnitude) => {
    if (!self.alive || victim.kind === 'tower') return;
    const stats = resolveStats(self.cardId, self.level, self.evolved);
    const healed = Math.round(stats.damage * magnitude);
    self.hp = Math.min(self.maxHp, self.hp + healed);
  },
});

/**
 * Mark — whatever it last hit takes more damage from *everything*.
 *
 * The card does almost no damage itself. Its value is entirely in what your
 * other cards do to the thing it has pointed at, which makes it worthless
 * played alone and disproportionate played behind a push. `passiveTargetId`
 * holds the mark; the multiplier is applied in `applyDamage`.
 */
register('mark_target', {
  onHit: (_state, self, victim, magnitude) => {
    if (victim.kind === 'tower') return;
    self.passiveTargetId = victim.id;
    victim.markedTicks = Math.max(victim.markedTicks, Math.round(TICK_HZ * magnitude));
  },
});

/**
 * Ambush — colossal opening blow, then an ordinary body.
 *
 * Invisible until it strikes, and the strike is multiplied. Unlike Blink
 * Strike, which repositions on spawn and then fights normally, this one is
 * *only* the first hit: after it lands, what remains is a weak unit standing
 * in the open where you chose to put it.
 */
register('ambush', {
  onSpawn: (_state, self) => {
    self.passiveCharges = 1;
    self.invisibleTicks = Math.round(TICK_HZ * 30);
  },
  onHit: (state, self, victim, magnitude) => {
    if (self.passiveCharges <= 0) return;
    self.passiveCharges = 0;
    self.invisibleTicks = 0;
    const stats = resolveStats(self.cardId, self.level, self.evolved);
    applyDamage(state, victim, Math.round(stats.damage * magnitude), self, { passives: false });
  },
});

/**
 * Guardian — dies once and gets back up.
 *
 * Returns at a fraction of its pool the first time it would be killed. Any
 * card that trades evenly with it loses the rematch, so the counter is not to
 * out-damage it but to overkill it — or to walk past it, since it comes back
 * exactly where it fell rather than where the fight has moved to.
 */
register('revive_once', {
  onSpawn: (_state, self) => {
    self.passiveCharges = 1;
  },
  onDamaged: (_state, self, _attacker, _amount, magnitude) => {
    if (self.hp > 0 || self.passiveCharges <= 0) return;
    self.passiveCharges = 0;
    self.alive = true;
    self.hp = Math.max(1, Math.round(self.maxHp * magnitude));
    self.stunTicks = Math.max(self.stunTicks, Math.round(TICK_HZ * 0.6));
  },
});

/**
 * Harvest — permanently stronger for every body it puts down.
 *
 * Scales with the *defence* thrown at it, which inverts the usual read: the
 * cheap chaff that answers most pushes feeds this one instead. Left alone
 * through a swarm it becomes a genuine problem; answered with one big body it
 * gains nothing at all. `passiveCharges` counts the kills.
 */
register('harvest', {
  onHit: (_state, self, victim, magnitude) => {
    if (victim.alive || victim.kind === 'tower') return;
    self.passiveCharges = Math.min(10, self.passiveCharges + 1);
    // Growth is banked as health as well, so it visibly swells.
    const stats = resolveStats(self.cardId, self.level, self.evolved);
    const gain = Math.round(stats.damage * magnitude);
    self.maxHp += gain;
    self.hp = Math.min(self.maxHp, self.hp + gain);
  },
});

/**
 * Momentum — hits for more the further it has run unobstructed.
 *
 * Related to `charge`, and deliberately not the same: charge is a threshold
 * that fires once and resets, this is a continuous curve with no ceiling
 * inside a lane. Blocking it early is worth far more than blocking it late,
 * so a cheap body dropped at the bridge is a real answer to an expensive card.
 */
register('momentum', {
  onTick: (_state, self) => {
    const moving = self.stepX !== 0 || self.stepY !== 0;
    if (moving) self.passiveTimer = Math.min(self.passiveTimer + 1, Math.round(TICK_HZ * 8));
    else self.passiveTimer = 0;
  },
  onHit: (state, self, victim, magnitude) => {
    const seconds = self.passiveTimer / TICK_HZ;
    if (seconds < 1) return;
    const stats = resolveStats(self.cardId, self.level, self.evolved);
    const bonus = Math.round(stats.damage * magnitude * Math.min(4, seconds));
    self.passiveTimer = 0;
    if (bonus > 0) applyDamage(state, victim, bonus, self, { passives: false });
  },
});

/**
 * Spell Ward — the first spell that touches it does nothing.
 *
 * Not damage reduction: a full negation of one instance, however large, which
 * makes it the only card in the set that punishes a Rocket rather than dying
 * to it. Answered by any *cheap* spell, since the ward spends itself on
 * whatever lands first — including a two-aether Zap.
 */
register('spell_ward', {
  onSpawn: (_state, self) => {
    self.passiveCharges = 1;
  },
});

/**
 * Sunder — every blow permanently blunts what it hits.
 *
 * Reduces the victim's damage rather than its health, so it wins fights it
 * could never win on stats and does nothing whatsoever to a tower. Against a
 * swarm it is close to useless — each body is blunted separately and they die
 * before it matters — and against one expensive bruiser it is decisive.
 */
register('sunder', {
  onHit: (_state, _self, victim, magnitude) => {
    if (victim.kind === 'tower' || victim.kind === 'building') return;
    const floor = Math.round(victim.damage * 0.35);
    victim.damage = Math.max(floor, victim.damage - Math.round(victim.damage * magnitude));
  },
});

/**
 * Tether — damage dealt to the thing it has hooked is echoed onto its
 * neighbours.
 *
 * Turns a tight formation into a liability. The wider the opposing push is
 * spread, the less this does, which is the exact opposite of every splash card
 * in the set and the reason it is not simply another one.
 */
register('tether', {
  onHit: (state, self, victim, magnitude) => {
    /*
     * Enemies of *self*, measured from the victim.
     *
     * `enemiesInRadius` derives the hostile team from the entity it is given,
     * so passing the victim here would have searched for the victim's enemies
     * — that is, our own side — and echoed the damage onto the allies standing
     * next to the thing we just hit.
     */
    const radiusSq = Math.round((fx(2.2) * fx(2.2)) / FX_ONE);
    const foe = enemyOf(self.team);
    for (const other of state.entities) {
      if (other.team !== foe || !isTargetable(other)) continue;
      if (fxLenSq(other.x - victim.x, other.y - victim.y) > radiusSq) continue;
      if (other.id === victim.id || other.kind === 'tower') continue;
      const stats = resolveStats(self.cardId, self.level, self.evolved);
      applyDamage(state, other, Math.round(stats.damage * magnitude), self, { passives: false });
      state.events.push({
        type: 'arc',
        team: self.team,
        x: victim.x,
        y: victim.y,
        toX: other.x,
        toY: other.y,
        kind: 'chain',
      });
    }
  },
});

/**
 * Bulwark Aura — allies nearby take a share of their damage as pushback
 * instead.
 *
 * Reads as a slow-moving wall of protection that has to keep up with the push
 * it is protecting. Distinct from `aura_shield`, which hands out a pool that
 * absorbs a whole blow: this reduces every hit by a little and never runs out,
 * so it beats sustained chip and loses to a single heavy strike.
 */
register('aura_guard', {
  onTick: (state, self, magnitude) => {
    if (self.passiveTimer > 0) {
      self.passiveTimer--;
      return;
    }
    self.passiveTimer = Math.round(TICK_HZ * 0.5);
    for (const ally of alliesInRadius(state, self, fx(3.4))) {
      if (ally.kind === 'tower') continue;
      // Refunds a fraction of the ally's missing health each half-second, which
      // is a reduction expressed after the fact rather than a pre-hit shield.
      const missing = ally.maxHp - ally.hp;
      if (missing <= 0) continue;
      ally.hp = Math.min(ally.maxHp, ally.hp + Math.round(missing * magnitude));
    }
  },
});

/**
 * Split Shot — strikes a second target at the same instant.
 *
 * Not `chain_attack`: there is no arc and no falloff, the second victim simply
 * takes the same blow, and it must be within the card's own reach rather than
 * near the first. So it is a card that wants two things in front of it and is
 * strictly a single-target card against one.
 */
register('split_shot', {
  onHit: (state, self, victim, magnitude) => {
    const stats = resolveStats(self.cardId, self.level, self.evolved);
    const reach = fx(stats.card.attackRange + 1);
    for (const other of enemiesInRadius(state, self, reach)) {
      if (other.id === victim.id) continue;
      applyDamage(state, other, Math.round(stats.damage * magnitude), self, { passives: false });
      state.events.push({
        type: 'shoot',
        cardId: self.cardId,
        team: self.team,
        x: self.x,
        y: self.y,
        faceX: other.x - self.x,
        faceY: other.y - self.y,
      });
      break;
    }
  },
});

/**
 * Siphon — drains the *aether* of whoever it damages.
 *
 * The only card in the set that attacks the resource rather than the board.
 * It is deliberately feeble in a fight: every second it survives in front of a
 * tower costs the defender tempo they cannot see on the health bars, which is
 * a pressure no other card applies.
 */
register('siphon', {
  onHit: (state, self, victim, magnitude) => {
    if (victim.kind !== 'tower') return;
    const foe = state.players[enemyOf(self.team)];
    const drained = Math.round(magnitude);
    foe.aetherPoints = Math.max(0, foe.aetherPoints - drained);
  },
});

/**
 * Maelstrom — drags everything hostile toward it, continuously.
 *
 * The board has plenty of ways to push a unit away and, until this, none to
 * pull one in. That asymmetry mattered: a push is a defensive tool and a pull
 * is an offensive one, and it changes what a formation is worth. Bodies spread
 * across a lane get gathered into a clump — which is exactly the shape every
 * splash card in the set wants — so this is the setup half of a two-card play
 * rather than a threat on its own.
 *
 * Applied as displacement, not as a position write, so it composes with
 * knockback and with the shield-break immunity window instead of overriding
 * them.
 */
register('vortex_pull', {
  onTick: (state, self, magnitude) => {
    const reach = fx(3.6);
    for (const victim of enemiesInRadius(state, self, reach)) {
      if (victim.kind === 'tower' || victim.kind === 'building') continue;
      if (victim.shieldBreakTicks > 0) continue;
      const dx = self.x - victim.x;
      const dy = self.y - victim.y;
      const distSq = fxLenSq(dx, dy);
      // Nothing inside a body's own radius: a unit already on top of it should
      // sit there and be hit, not vibrate against the centre.
      if (distSq < Math.round((fx(0.6) * fx(0.6)) / FX_ONE)) continue;
      const dist = Math.max(1, Math.round(Math.sqrt(distSq * FX_ONE)));
      const pull = fxMul(fx(magnitude), FX_ONE);
      victim.pushX += Math.round((dx / dist) * pull);
      victim.pushY += Math.round((dy / dist) * pull);
    }
  },
});

/**
 * Harpoon — its blow drags the target in rather than knocking it back.
 *
 * The point is not the damage. A ranged support unit standing behind a tank
 * is safe from everything in the set except a spell; hooked out of the line
 * and dropped in front of your own bodies, it is not. So this is the one card
 * that answers a *formation* instead of a unit, and it is at its worst against
 * the swarms that formations exist to beat.
 */
register('hook_pull', {
  onHit: (state, self, victim, magnitude) => {
    if (victim.kind === 'tower' || victim.kind === 'building') return;
    if (victim.shieldBreakTicks > 0) return;
    const dx = self.x - victim.x;
    const dy = self.y - victim.y;
    const distSq = fxLenSq(dx, dy);
    if (distSq <= 0) return;
    const dist = Math.max(1, Math.round(Math.sqrt(distSq * FX_ONE)));
    // Yanked most of the way in, so the hook visibly *lands* the target next
    // to the puller instead of nudging it a tile closer.
    const haul = fxMul(fx(magnitude), FX_ONE);
    victim.pushX += Math.round((dx / dist) * haul);
    victim.pushY += Math.round((dy / dist) * haul);
    // Briefly stunned on arrival: being dragged out of position is worth
    // nothing if the target simply keeps swinging on the way.
    victim.stunTicks = Math.max(victim.stunTicks, Math.round(TICK_HZ * 0.4));
    state.events.push({
      type: 'arc',
      team: self.team,
      x: self.x,
      y: self.y,
      toX: victim.x,
      toY: victim.y,
      kind: 'chain',
    });
  },
});

/**
 * Siegebreaker — vaults onto something far away and lands on top of it.
 *
 * Deliberately not a targeted jump the player controls: it fires on its own
 * cooldown at whatever is furthest inside its reach, so the card is a threat
 * you position rather than a button you aim. What it buys is the ability to
 * cross the line of chaff a defence puts up and land on the support behind it,
 * which nothing else in the set can do.
 *
 * The leap is a teleport plus an area blow, because a real arc would need
 * airborne state the simulation does not have — and an airborne troop that is
 * neither flying nor grounded would be a targeting bug in every system that
 * asks the question.
 */
register('leap_strike', {
  onTick: (state, self, magnitude) => {
    if (self.passiveTimer > 0) {
      self.passiveTimer--;
      return;
    }
    const reach = fx(5.5);
    const priority = resolveStats(self.cardId, self.level, self.evolved).card.targetPriority;
    let furthest: Entity | undefined;
    let furthestSq = Math.round((fx(2.2) * fx(2.2)) / FX_ONE);
    for (const victim of enemiesInRadius(state, self, reach)) {
      if (victim.kind === 'tower') continue;
      // Only onto something it could actually fight. A ground-only leaper
      // vaulting onto a flier lands next to a target it cannot swing at.
      if (!canTarget(priority, victim)) continue;
      /*
       * Never across the river.
       *
       * The leap is meant to skip the *line* a defence puts up, not the map.
       * At five and a half tiles a leaper standing at the bank could clear the
       * water without a bridge, which is a whole separate mechanic — and one
       * this card has not paid for.
       */
      if (!self.flying && crossesRiver(self.y, victim.y)) continue;
      const distSq = fxLenSq(victim.x - self.x, victim.y - self.y);
      if (distSq <= furthestSq) continue;
      furthestSq = distSq;
      furthest = victim;
    }
    if (!furthest) return;

    self.passiveTimer = Math.round(TICK_HZ * 5);
    self.x = furthest.x;
    self.y = furthest.y;
    self.targetId = furthest.id;
    self.windupDone = false;

    const stats = resolveStats(self.cardId, self.level, self.evolved);
    const blast = Math.round(stats.damage * magnitude);
    for (const victim of enemiesInRadius(state, self, fx(1.8))) {
      applyDamage(state, victim, blast, self, { passives: false });
      victim.stunTicks = Math.max(victim.stunTicks, Math.round(TICK_HZ * 0.5));
    }
    state.events.push({
      type: 'hit',
      cardId: self.cardId,
      x: self.x,
      y: self.y,
      damage: blast,
      splash: true,
    });
  },
});

/**
 * Wreckage — what is left when it dies keeps shooting.
 *
 * A troop that becomes a building. Two cards' worth of value in one, paid for
 * in the usual way, and it rewrites how you trade with it: killing it does not
 * clear the tile, so the cheap body you spent to stop the push is now stuck in
 * front of a turret. The wreck inherits nothing — it is its own card with its
 * own health — so the answer is to kill it a second time.
 */
register('wreckage', {
  onDeath: (state, self, magnitude) => {
    const stats = resolveStats(self.cardId, self.level, self.evolved);
    // The wreck is named the same way a spawner names its output, so a card
    // gets both mechanics from one field and neither needs a schema of its own.
    const wreckId = stats.card.deathEffectParam;
    if (!wreckId) return;
    const wreck = spawnTroop(state, wreckId, self.level, false, self.team, self.x, self.y, {
      skipDeployDelay: true,
    });
    // Scaled off the parent so a bigger cart leaves a bigger wreck without
    // needing a second card per size.
    wreck.maxHp = Math.max(1, Math.round(wreck.maxHp * magnitude));
    wreck.hp = wreck.maxHp;
  },
});

/**
 * Unstable Core — dying hands the *opponent* aether.
 *
 * The only passive in the set priced below zero. Everything else buys a
 * mechanic out of the stat budget; this sells a drawback back into it, so the
 * card is enormous for its cost and every one you lose funds the answer to the
 * next one. It changes how you are allowed to use it — as a tank you must get
 * value from, never as a body you throw away — which is a decision no other
 * card in the game asks for.
 */
register('gift_aether', {
  onDeath: (state, self, magnitude) => {
    const foe = state.players[enemyOf(self.team)];
    foe.aetherPoints += Math.round(magnitude);
  },
});

/**
 * Deflect — catches a shot and sends it back.
 *
 * Ranged only and on a cooldown, so it is a rhythm rather than an immunity:
 * one shot in every window is refused and returned, and a fast shooter simply
 * pays through it. Distinct from `reflect_ranged`, which echoes a share of
 * every hit and never negates one — this negates completely, but rarely.
 */
register('deflect', {
  onDamaged: (state, self, attacker, amount, magnitude) => {
    if (!attacker || !attacker.alive || attacker.team === self.team) return;
    if (self.passiveTimer > 0) return;
    const attackerStats = resolveStats(attacker.cardId, attacker.level, attacker.evolved);
    if (!attackerStats.card.usesProjectile) return;

    self.passiveTimer = Math.round(TICK_HZ * 2.5);
    // Refunded, then returned. The blow has already landed by the time a
    // damage hook runs, so negation has to be an explicit heal.
    self.hp = Math.min(self.maxHp, self.hp + amount);
    applyDamage(state, attacker, Math.round(amount * magnitude), self, { passives: false });
    state.events.push({
      type: 'arc',
      team: self.team,
      x: self.x,
      y: self.y,
      toX: attacker.x,
      toY: attacker.y,
      kind: 'chain',
    });
  },
  onTick: (_state, self) => {
    if (self.passiveTimer > 0) self.passiveTimer--;
  },
});

/**
 * Provoke — everything nearby has to deal with it first.
 *
 * A defensive card that protects things it is not standing in front of, which
 * is the one shape the set was missing: every other defensive answer works by
 * occupying a tile. Taunting a push off a tower and onto a body of your
 * choosing is a positional play, and it is answered by simply killing the
 * taunter — so the mechanic costs it the health it would otherwise have.
 */
register('taunt', {
  onTick: (state, self, magnitude) => {
    if (self.passiveTimer > 0) {
      self.passiveTimer--;
      return;
    }
    self.passiveTimer = Math.round(TICK_HZ * 0.5);
    for (const victim of enemiesInRadius(state, self, fx(magnitude))) {
      if (victim.kind === 'tower' || victim.kind === 'building') continue;
      /*
       * Only what could have attacked us anyway.
       *
       * The engine's taunt override does not consult the victim's target
       * priority, which is right for a Champion's metered button — that is a
       * once-a-fight play with a real cost. An always-on aura with the same
       * reach would be a universal answer to every building-targeting win
       * condition in the game, and would leave a Giant swinging at something
       * its card says it cannot attack.
       */
      const victimCard = resolveStats(victim.cardId, victim.level, victim.evolved).card;
      if (!canTarget(victimCard.targetPriority, self)) continue;
      victim.tauntSourceId = self.id;
      /*
       * Only redirect a unit that is not already looking at us.
       *
       * Reassigning the target unconditionally also cleared `windupDone`, and
       * this runs twice a second — so every unit inside the radius restarted
       * its first-attack delay before it could ever finish one and simply
       * never swung. The taunter won every fight in the benchmark panel by a
       * wide margin, which is what a mechanic looks like when it has silently
       * become invulnerability.
       */
      /*
       * `abilityTicks` is the taunt's countdown, not only a hero's.
       *
       * Targeting honours a taunt for as long as that counter runs and drops
       * it the moment it does not — so a taunt set without one is cleared on
       * the very next tick, and the mechanic silently degrades into a single
       * nudge that normal retargeting undoes. Slightly longer than the refresh
       * interval, so it holds while the victim is in radius and lapses shortly
       * after it leaves.
       */
      victim.abilityTicks = Math.max(victim.abilityTicks, Math.round(TICK_HZ * 0.8));
      if (victim.targetId === self.id) continue;
      victim.targetId = self.id;
      victim.windupDone = false;
    }
  },
});

/**
 * Disarm — its blows stop the victim swinging back.
 *
 * Not a stun: the target keeps walking, keeps being pushed, keeps being a
 * body in the way. It simply cannot attack. Against one big single-target
 * threat that is close to a full answer; against a swarm it does nothing at
 * all, because each blow disarms exactly one of them and the rest keep going.
 */
register('disarm', {
  onHit: (_state, self, victim, magnitude) => {
    if (victim.kind === 'tower') return;
    const ticks = Math.round(TICK_HZ * magnitude);
    victim.attackCooldown = Math.max(victim.attackCooldown, ticks);
    victim.windupDone = false;
    void self;
  },
});

/**
 * War Drum — everything around it swings faster.
 *
 * The counterpart to `aura_slow`, aimed at your own side. It multiplies a
 * push rather than adding to it, so it is worth nothing on its own and a great
 * deal behind three bodies — which makes it a card you commit *after* reading
 * the defence rather than one you open with.
 */
register('rally', {
  onTick: (state, self, magnitude) => {
    for (const ally of alliesInRadius(state, self, fx(3.2))) {
      if (ally.kind === 'tower' || ally.attackCooldown <= 0) continue;
      // Shaving the cooldown is a rate increase expressed per tick, which
      // stays exact in integers where a multiplier on hit speed would not.
      if (state.tick % Math.max(2, Math.round(1 / magnitude)) === 0) ally.attackCooldown--;
    }
  },
});

/**
 * Mire — the ground around it holds and hurts.
 *
 * A zone rather than a target, so it punishes a defence for standing where it
 * wants to stand. Slow and damage together is deliberate: either alone is
 * ignorable at this radius, and the pair forces a decision about whether the
 * tile is worth holding.
 */
register('quicksand', {
  onTick: (state, self, magnitude) => {
    for (const victim of enemiesInRadius(state, self, fx(2.8))) {
      if (victim.kind === 'tower' || victim.flying) continue;
      victim.slowTicks = Math.max(victim.slowTicks, 4);
      victim.slowFactor = fx(0.55);
      if (state.tick % Math.round(TICK_HZ) !== 0) continue;
      const stats = resolveStats(self.cardId, self.level, self.evolved);
      applyDamage(state, victim, Math.max(1, Math.round(stats.damage * magnitude)), self, {
        passives: false,
      });
    }
  },
});

/**
 * Overcharge — every blow it does not land is stored in the next one.
 *
 * The inverse of `attack_ramp`, which rewards a card for hitting the same
 * thing for a long time. This rewards it for *waiting*: a unit that has stood
 * idle behind the line arrives with a blow several times its size, and one
 * that has been chipping away the whole time arrives with a normal one. It
 * turns a slow card into a threat that must be answered before it connects.
 */
register('overcharge', {
  onTick: (_state, self) => {
    /*
     * Time since the last blow, counted plainly.
     *
     * The first attempt tried to decide whether the unit was "idle" from its
     * target and cooldown, which is wrong twice over: a unit walking to the
     * tower has a target and no cooldown, and a unit mid-reload has a cooldown
     * and is not waiting for anything. Ticks since it last connected is the
     * quantity the mechanic is actually about, and `onHit` is where it resets.
     */
    self.passiveCharges = Math.min(self.passiveCharges + 1, Math.round(TICK_HZ * 6));
  },
  onHit: (state, self, victim, magnitude) => {
    const seconds = self.passiveCharges / TICK_HZ;
    self.passiveCharges = 0;
    if (seconds < 1) return;
    const stats = resolveStats(self.cardId, self.level, self.evolved);
    const bonus = Math.round(stats.damage * magnitude * Math.min(6, seconds));
    if (bonus > 0) applyDamage(state, victim, bonus, self, { passives: false });
  },
});

/**
 * Blood Pact — it pays out when it dies.
 *
 * A support card whose value is realised at the moment it is killed, which
 * inverts the usual instinct to focus the healer first: killing it *is* the
 * heal. The counterplay is to leave it alive and kill what it is supporting,
 * which is a harder read than "shoot the priest".
 */
register('bloodpact', {
  onDeath: (state, self, magnitude) => {
    const gift = Math.round(self.maxHp * magnitude);
    for (const ally of alliesInRadius(state, self, fx(4.2))) {
      if (ally.kind === 'tower') continue;
      ally.hp = Math.min(ally.maxHp, ally.hp + gift);
    }
  },
});

/**
 * Soul Bind — everything it kills comes back on your side.
 *
 * The board had no way to convert an opponent's losses into your own gains.
 * Every other mechanic in the set operates on what is already yours or takes
 * something away from theirs; this turns their dead into your bodies, which
 * makes trading into it actively bad rather than merely inefficient. The
 * counter is not to fight it — kill it, or feed it nothing by pushing
 * elsewhere.
 *
 * Only troops, and never towers or buildings: a card that spawned a unit every
 * time it chipped a tower would be a win condition that funds itself.
 */
register('soul_bind', {
  onHit: (state, self, victim, magnitude) => {
    if (victim.alive || victim.kind === 'tower' || victim.kind === 'building') return;
    const stats = resolveStats(self.cardId, self.level, self.evolved);
    const spawnId = stats.card.deathEffectParam;
    if (!spawnId) return;
    const bodies = Math.max(1, Math.round(magnitude));
    for (let i = 0; i < bodies; i++) {
      const raised = spawnTroop(
        state,
        spawnId,
        self.level,
        false,
        self.team,
        victim.x,
        victim.y + fx(i * 0.5),
        { skipDeployDelay: true },
      );
      state.events.push({
        type: 'spawn',
        entityId: raised.id,
        cardId: spawnId,
        team: self.team,
        x: raised.x,
        y: raised.y,
      });
    }
  },
});

/**
 * Boomerang — one throw, three bodies, and a long wait to catch it.
 *
 * Distinct from both of the mechanics it sits between. `chain_attack` arcs
 * outward from each victim to the next and falls off as it goes;
 * `split_shot` strikes exactly one extra and only within the card's own
 * reach. This is a single object on a circuit: it takes the nearest bodies in
 * order and hits every one of them for the same amount, which makes it the
 * only attack in the game whose value is flat in the number of targets rather
 * than decaying across them.
 *
 * The reload is where it is paid for. Three seconds is an age — long enough
 * that a swarm walks a third of a lane between throws, and long enough that
 * catching a single target with it is a waste of the card. It wants a crowd,
 * and against one body it is the worst attacker of its cost in the set.
 *
 * `magnitude` is the number of *extra* bodies beyond the one it was aimed at.
 */
register('boomerang', {
  onHit: (state, self, victim, magnitude) => {
    const stats = resolveStats(self.cardId, self.level, self.evolved);
    const extra = Math.max(0, Math.round(magnitude));
    if (extra === 0) return;

    /*
     * Nearest first, measured from the flight so far rather than from the
     * thrower. A boomerang travels a circuit — taking whatever is closest to
     * the last thing it clipped is what makes the path read as one object
     * rather than three simultaneous hits.
     */
    const reach = fx(stats.card.attackRange + 2);
    const struck = new Set<number>([victim.id]);
    let from = victim;

    for (let i = 0; i < extra; i++) {
      let nearest: Entity | undefined;
      let nearestSq = Infinity;
      for (const other of enemiesInRadius(state, self, reach)) {
        if (struck.has(other.id) || other.kind === 'tower') continue;
        const distSq = fxLenSq(other.x - from.x, other.y - from.y);
        if (distSq >= nearestSq) continue;
        nearestSq = distSq;
        nearest = other;
      }
      if (!nearest) break;

      struck.add(nearest.id);
      applyDamage(state, nearest, stats.damage, self, { passives: false });
      state.events.push({
        type: 'arc',
        team: self.team,
        x: from.x,
        y: from.y,
        toX: nearest.x,
        toY: nearest.y,
        kind: 'chain',
      });
      from = nearest;
    }
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
