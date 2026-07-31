/**
 * Visual effects: particles, floating damage numbers and screen shake.
 *
 * This is the layer that makes a hit feel like a hit. The simulation already
 * knows everything worth reacting to — it emits `hit`, `death`, `spell`,
 * `ability` and `towerDestroyed` events — but nothing was drawing them, so
 * combat resolved as health bars quietly changing length.
 *
 * Entirely render-side and entirely disposable. Nothing here feeds back into
 * the simulation, particles are not part of match state, and dropping every
 * effect on a slow frame changes nothing but the picture. That is deliberate:
 * effects must never be able to desync a match.
 *
 * Both pools are fixed-size ring buffers. A splash spell landing in a swarm
 * can emit hundreds of particles in one tick, and allocating those every time
 * would produce exactly the GC stutter the effects exist to avoid.
 */

import { fxToFloat } from '@sim/math/fixed';
import type { SimEvent, Team } from '@sim/types';
import { TILE_W, TILE_H, tileToLogical } from './camera';

const MAX_PARTICLES = 600;
const MAX_NUMBERS = 60;
const MAX_BOLTS = 40;

type ParticleShape = 'spark' | 'puff' | 'ring' | 'shard';

interface Particle {
  active: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  colour: string;
  shape: ParticleShape;
  gravity: number;
}

/**
 * A lightning arc between two points.
 *
 * Not a particle: a particle is a point with a velocity, and an arc is a line
 * with two fixed ends and a shape between them. The jag offsets are baked at
 * spawn so the bolt holds its silhouette while it fades instead of reshuffling
 * every frame into noise.
 */
interface Bolt {
  active: boolean;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  jag: number[];
  life: number;
  maxLife: number;
  colour: string;
  width: number;
}

interface DamageNumber {
  active: boolean;
  x: number;
  y: number;
  vy: number;
  life: number;
  maxLife: number;
  text: string;
  colour: string;
  size: number;
}

function blankParticle(): Particle {
  return {
    active: false,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    life: 0,
    maxLife: 1,
    size: 3,
    colour: '#fff',
    shape: 'spark',
    gravity: 0,
  };
}

function blankBolt(): Bolt {
  return { active: false, x1: 0, y1: 0, x2: 0, y2: 0, jag: [], life: 0, maxLife: 1, colour: '#fff', width: 2 };
}

function blankNumber(): DamageNumber {
  return { active: false, x: 0, y: 0, vy: 0, life: 0, maxLife: 1, text: '', colour: '#fff', size: 20 };
}

export class VfxSystem {
  private readonly particles: Particle[] = Array.from({ length: MAX_PARTICLES }, blankParticle);
  private readonly numbers: DamageNumber[] = Array.from({ length: MAX_NUMBERS }, blankNumber);
  private readonly bolts: Bolt[] = Array.from({ length: MAX_BOLTS }, blankBolt);
  private particleCursor = 0;
  private numberCursor = 0;
  private boltCursor = 0;

  /** Current shake magnitude in logical pixels; decays every frame. */
  private shake = 0;
  private shakeSeed = 1;

  /**
   * Claim a slot, overwriting the oldest if the pool is full.
   *
   * Overwriting rather than dropping keeps the *newest* effects visible, which
   * is what a player is actually looking at during a big fight.
   */
  private nextParticle(): Particle {
    const particle = this.particles[this.particleCursor];
    this.particleCursor = (this.particleCursor + 1) % MAX_PARTICLES;
    return particle;
  }

  private nextBolt(): Bolt {
    const bolt = this.bolts[this.boltCursor];
    this.boltCursor = (this.boltCursor + 1) % MAX_BOLTS;
    return bolt;
  }

  private nextNumber(): DamageNumber {
    const number = this.numbers[this.numberCursor];
    this.numberCursor = (this.numberCursor + 1) % MAX_NUMBERS;
    return number;
  }

  /** Deterministic-enough jitter. Render-only, so a plain LCG is fine here. */
  private random(): number {
    this.shakeSeed = (Math.imul(this.shakeSeed, 1664525) + 1013904223) | 0;
    return ((this.shakeSeed >>> 8) & 0xffff) / 0xffff;
  }

  private spread(magnitude: number): number {
    return (this.random() * 2 - 1) * magnitude;
  }

  // -------------------------------------------------------------------------
  // Emitters
  // -------------------------------------------------------------------------

  burst(
    x: number,
    y: number,
    count: number,
    colour: string,
    opts: { speed?: number; life?: number; size?: number; shape?: ParticleShape; gravity?: number } = {},
  ): void {
    const speed = opts.speed ?? 2.4;
    for (let i = 0; i < count; i++) {
      const particle = this.nextParticle();
      particle.active = true;
      particle.x = x;
      particle.y = y;
      particle.vx = this.spread(speed);
      // Biased upward: debris thrown up and falling back reads as impact,
      // debris spreading evenly reads as a flat circle.
      particle.vy = this.spread(speed) - speed * 0.4;
      particle.maxLife = opts.life ?? 340 + this.random() * 180;
      particle.life = particle.maxLife;
      particle.size = opts.size ?? 2 + this.random() * 3;
      particle.colour = colour;
      particle.shape = opts.shape ?? 'spark';
      particle.gravity = opts.gravity ?? 0.012;
    }
  }

  ring(x: number, y: number, colour: string, size = 26, life = 320): void {
    const particle = this.nextParticle();
    particle.active = true;
    particle.x = x;
    particle.y = y;
    particle.vx = 0;
    particle.vy = 0;
    particle.maxLife = life;
    particle.life = life;
    particle.size = size;
    particle.colour = colour;
    particle.shape = 'ring';
    particle.gravity = 0;
  }

  /**
   * A jagged arc from one point to another.
   *
   * Segments are proportional to length so a long chain does not read as a
   * gentle curve while a short one reads as a zigzag.
   */
  arc(x1: number, y1: number, x2: number, y2: number, colour: string, life = 220): void {
    const bolt = this.nextBolt();
    bolt.active = true;
    bolt.x1 = x1;
    bolt.y1 = y1;
    bolt.x2 = x2;
    bolt.y2 = y2;
    bolt.maxLife = life;
    bolt.life = life;
    bolt.colour = colour;
    bolt.width = 2.5;

    const span = Math.hypot(x2 - x1, y2 - y1);
    const segments = Math.max(3, Math.min(9, Math.round(span / 14)));
    bolt.jag = [];
    for (let i = 1; i < segments; i++) bolt.jag.push(this.spread(Math.min(16, span * 0.18)));
  }

  damageNumber(x: number, y: number, amount: number, colour = '#ffffff', big = false): void {
    const number = this.nextNumber();
    number.active = true;
    number.x = x + this.spread(8);
    number.y = y;
    number.vy = -0.05;
    number.maxLife = big ? 1100 : 750;
    number.life = number.maxLife;
    number.text = String(amount);
    number.colour = colour;
    number.size = big ? 34 : 22;
  }

  addShake(magnitude: number): void {
    // Take the strongest shake rather than summing: three simultaneous hits
    // should not multiply into a screen-clearing earthquake.
    this.shake = Math.max(this.shake, magnitude);
  }

  // -------------------------------------------------------------------------
  // Event translation
  // -------------------------------------------------------------------------

  /**
   * Turn one tick's simulation events into effects.
   *
   * `viewTeam` is needed because everything here works in logical screen
   * space, and the board is mirrored for a red-side player.
   */
  consume(events: readonly SimEvent[], viewTeam: Team): void {
    for (const event of events) {
      switch (event.type) {
        case 'hit': {
          const at = tileToLogical(fxToFloat(event.x), fxToFloat(event.y), viewTeam);
          if (event.splash) {
            this.burst(at.x, at.y, 14, '#ffd27a', { speed: 3.2, size: 3 });
            this.ring(at.x, at.y, 'rgba(255,200,110,0.85)', 34);
            this.addShake(2.2);
          } else {
            this.burst(at.x, at.y, 5, '#ffe9b0', { speed: 1.8, size: 2 });
          }
          if (event.damage > 0) {
            this.damageNumber(at.x, at.y - TILE_H, event.damage, event.splash ? '#ffcf6b' : '#ffffff');
          }
          break;
        }

        case 'death': {
          const at = tileToLogical(fxToFloat(event.x), fxToFloat(event.y), viewTeam);
          this.burst(at.x, at.y, 16, event.team === 0 ? '#7fb8ff' : '#ff9b8b', {
            speed: 2.6,
            shape: 'puff',
            size: 4,
            life: 520,
          });
          break;
        }

        case 'spell': {
          const at = tileToLogical(fxToFloat(event.x), fxToFloat(event.y), viewTeam);
          const radius = fxToFloat(event.radius);
          this.burst(at.x, at.y, 34, '#ff9a4a', { speed: 4.5, size: 4, life: 620 });
          this.ring(at.x, at.y, 'rgba(255,140,60,0.9)', radius * TILE_W, 480);
          this.addShake(5);
          break;
        }

        case 'ability': {
          const at = tileToLogical(fxToFloat(event.x), fxToFloat(event.y), viewTeam);
          this.burst(at.x, at.y, 24, '#ffd84a', { speed: 3.6, size: 3, life: 560 });
          this.ring(at.x, at.y, 'rgba(255,216,74,0.95)', 60, 520);
          this.addShake(4);
          break;
        }

        case 'towerDestroyed': {
          // The single most important moment in a match — treated as such.
          const at = tileToLogical(9, event.team === 0 ? 6 : 26, viewTeam);
          this.burst(at.x, at.y, 60, '#ffb04a', { speed: 6, size: 6, life: 900, shape: 'shard' });
          this.burst(at.x, at.y, 40, '#8a8f9a', { speed: 4, size: 5, life: 1100, shape: 'puff' });
          this.ring(at.x, at.y, 'rgba(255,176,74,0.95)', 120, 700);
          this.addShake(14);
          break;
        }

        case 'arc': {
          const from = tileToLogical(fxToFloat(event.x), fxToFloat(event.y), viewTeam);
          const to = tileToLogical(fxToFloat(event.toX), fxToFloat(event.toY), viewTeam);
          const lift = TILE_H * 0.6;
          const colour = event.kind === 'stun' ? '#bfe8ff' : '#a8d8ff';
          this.arc(from.x, from.y - lift, to.x, to.y - lift, colour, event.kind === 'stun' ? 260 : 200);
          // A crackle at the receiving end, so the arc lands on something.
          this.burst(to.x, to.y - lift, 5, colour, { speed: 1.6, size: 2, life: 200, gravity: 0 });
          break;
        }

        case 'surface': {
          // Earth thrown up as it breaks ground — the moment the defender
          // finds out where it went, so it should be unmissable.
          const at = tileToLogical(fxToFloat(event.x), fxToFloat(event.y), viewTeam);
          this.burst(at.x, at.y, 22, '#7a5c3a', { speed: 3.4, size: 4, life: 520, shape: 'puff' });
          this.burst(at.x, at.y, 10, '#4a3822', { speed: 2.2, size: 3, life: 620, shape: 'shard', gravity: 0.05 });
          this.ring(at.x, at.y, 'rgba(140,110,70,0.9)', 30, 380);
          this.addShake(3);
          break;
        }

        case 'shoot': {
          /*
           * Muzzle flash, thrown along the shooter's facing.
           *
           * Small and very short — a quarter of the life of an impact burst.
           * It exists to tie the shot to the shooter, and anything longer
           * turns a rank of Archers into a permanent haze.
           */
          const at = tileToLogical(fxToFloat(event.x), fxToFloat(event.y), viewTeam);
          const length = Math.hypot(fxToFloat(event.faceX), fxToFloat(event.faceY)) || 1;
          const dirX = fxToFloat(event.faceX) / length;
          const dirY = fxToFloat(event.faceY) / length;
          const muzzleX = at.x + dirX * TILE_W * 0.3;
          const muzzleY = at.y - TILE_H * 0.6 + dirY * TILE_H * 0.3;
          for (let i = 0; i < 4; i++) {
            const particle = this.nextParticle();
            particle.active = true;
            particle.x = muzzleX;
            particle.y = muzzleY;
            particle.vx = dirX * 1.4 + this.spread(0.5);
            particle.vy = dirY * 1.4 + this.spread(0.5);
            particle.maxLife = 130;
            particle.life = particle.maxLife;
            particle.size = 2 + this.random() * 2;
            particle.colour = '#ffe6a8';
            particle.shape = 'spark';
            particle.gravity = 0;
          }
          break;
        }

        case 'shieldBreak': {
          /*
           * The plate comes off.
           *
           * Short-lived and heavy on purpose: these are metal fragments, so
           * they should fall fast and be gone. Debris that hangs around after
           * the moment it belongs to turns into litter you have to read past
           * during the next exchange, which is the opposite of a tell.
           */
          const at = tileToLogical(fxToFloat(event.x), fxToFloat(event.y), viewTeam);
          this.burst(at.x, at.y - TILE_H * 0.6, 9, '#cfe4f7', {
            speed: 3.4,
            size: 3,
            shape: 'shard',
            life: 300,
            gravity: 0.05,
          });
          this.ring(at.x, at.y - TILE_H * 0.6, 'rgba(200,228,255,0.9)', 22, 200);
          break;
        }

        case 'spawn':
          // Handled by the entity renderer's spawn scale-up, not by particles.
          break;

        default:
          break;
      }
    }
  }

  /** Deploy confirmation ring, emitted by the battle screen on a drop. */
  deployBurst(tileX: number, tileY: number, colour: string, viewTeam: Team): void {
    const at = tileToLogical(tileX + 0.5, tileY + 0.5, viewTeam);
    this.ring(at.x, at.y, colour, 40, 420);
    this.burst(at.x, at.y, 12, colour, { speed: 2, size: 3, gravity: -0.004 });
  }

  // -------------------------------------------------------------------------
  // Simulation and drawing
  // -------------------------------------------------------------------------

  update(deltaMs: number): void {
    const dt = Math.min(64, deltaMs);
    for (const bolt of this.bolts) {
      if (!bolt.active) continue;
      bolt.life -= dt;
      if (bolt.life <= 0) bolt.active = false;
    }

    for (const particle of this.particles) {
      if (!particle.active) continue;
      particle.life -= dt;
      if (particle.life <= 0) {
        particle.active = false;
        continue;
      }
      particle.x += particle.vx * (dt / 16.67);
      particle.y += particle.vy * (dt / 16.67);
      particle.vy += particle.gravity * dt;
    }

    for (const number of this.numbers) {
      if (!number.active) continue;
      number.life -= dt;
      if (number.life <= 0) {
        number.active = false;
        continue;
      }
      number.y += number.vy * dt;
      number.vy *= 0.985;
    }

    // Exponential decay, framerate independent.
    this.shake *= Math.pow(0.88, dt / 16.67);
    if (this.shake < 0.15) this.shake = 0;
  }

  /** Offset the whole scene should be drawn at this frame. */
  shakeOffset(): { x: number; y: number } {
    if (this.shake === 0) return { x: 0, y: 0 };
    return { x: this.spread(this.shake), y: this.spread(this.shake) };
  }

  /** Arcs are drawn under the figures so a bolt never hides a health bar. */
  drawBolts(ctx: CanvasRenderingContext2D): void {
    for (const bolt of this.bolts) {
      if (!bolt.active) continue;
      const t = bolt.life / bolt.maxLife;
      const segments = bolt.jag.length + 1;
      const dx = (bolt.x2 - bolt.x1) / segments;
      const dy = (bolt.y2 - bolt.y1) / segments;
      // Perpendicular, for the jag offsets.
      const span = Math.hypot(bolt.x2 - bolt.x1, bolt.y2 - bolt.y1) || 1;
      const nx = -(bolt.y2 - bolt.y1) / span;
      const ny = (bolt.x2 - bolt.x1) / span;

      // Drawn twice: a wide soft glow, then a hard white core over it.
      for (const pass of [0, 1]) {
        ctx.globalAlpha = (pass === 0 ? 0.35 : 0.95) * t;
        ctx.strokeStyle = pass === 0 ? bolt.colour : '#ffffff';
        ctx.lineWidth = (pass === 0 ? bolt.width * 3 : bolt.width) * (0.5 + t * 0.5);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(bolt.x1, bolt.y1);
        for (let i = 1; i < segments; i++) {
          const offset = bolt.jag[i - 1] * t;
          ctx.lineTo(bolt.x1 + dx * i + nx * offset, bolt.y1 + dy * i + ny * offset);
        }
        ctx.lineTo(bolt.x2, bolt.y2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  drawParticles(ctx: CanvasRenderingContext2D): void {
    for (const particle of this.particles) {
      if (!particle.active) continue;
      const t = particle.life / particle.maxLife;
      ctx.globalAlpha = Math.max(0, Math.min(1, t));

      switch (particle.shape) {
        case 'ring': {
          // Rings expand as they fade, which reads as a shockwave.
          const grow = particle.size * (1.6 - t * 0.6);
          ctx.strokeStyle = particle.colour;
          ctx.lineWidth = 3 * t + 1;
          ctx.beginPath();
          ctx.ellipse(particle.x, particle.y, grow, grow * (TILE_H / TILE_W), 0, 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'puff':
          ctx.fillStyle = particle.colour;
          ctx.beginPath();
          ctx.arc(particle.x, particle.y, particle.size * (1.8 - t), 0, Math.PI * 2);
          ctx.fill();
          break;
        case 'shard':
          ctx.fillStyle = particle.colour;
          ctx.fillRect(particle.x, particle.y, particle.size, particle.size * 1.8);
          break;
        default:
          ctx.fillStyle = particle.colour;
          ctx.fillRect(particle.x, particle.y, particle.size, particle.size);
      }
    }
    ctx.globalAlpha = 1;
  }

  drawNumbers(ctx: CanvasRenderingContext2D): void {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const number of this.numbers) {
      if (!number.active) continue;
      const t = number.life / number.maxLife;
      // Hold full opacity for the first half, then fade — a number that starts
      // fading immediately is unreadable at speed.
      ctx.globalAlpha = Math.max(0, Math.min(1, t * 2));
      ctx.font = `800 ${number.size}px system-ui, sans-serif`;
      ctx.lineWidth = 5;
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.strokeText(number.text, number.x, number.y);
      ctx.fillStyle = number.colour;
      ctx.fillText(number.text, number.x, number.y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'start';
    ctx.textBaseline = 'alphabetic';
  }

  clear(): void {
    for (const particle of this.particles) particle.active = false;
    for (const number of this.numbers) number.active = false;
    this.shake = 0;
  }
}
