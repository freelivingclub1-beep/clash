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
import { tryGetCard } from '@cards/registry';
import { type Element, ELEMENT_LOOKS, elementOf } from './elements';
import {
  EFFECT_FRAMES,
  drawEffectFrame,
  effectSheet,
  type EffectName,
} from './effectSprites';

const MAX_PARTICLES = 600;
const MAX_NUMBERS = 60;
const MAX_BOLTS = 40;
const MAX_SPRITES = 48;

/**
 * The drawn animation each element strikes with.
 *
 * Chosen by what the effect actually looks like rather than by its name in the
 * pack: `sunburn` is a rolling orange bloom and makes a far better fire hit
 * than the file called `fire`, which is a steady torch flame built to loop.
 * `spin` marks the ones whose art has no fixed up — giving those a random
 * rotation stops repeated hits from stamping an identical shape.
 */
const ELEMENT_EFFECTS: Record<Element, { name: EffectName; size: number; life: number; spin?: boolean }> = {
  fire: { name: 'sunburn', size: 62, life: 480 },
  frost: { name: 'freezing', size: 66, life: 560 },
  toxic: { name: 'felspell', size: 60, life: 620, spin: true },
  storm: { name: 'magickahit', size: 58, life: 380, spin: true },
  water: { name: 'magicbubbles', size: 60, life: 620 },
  arcane: { name: 'magicspell', size: 58, life: 560, spin: true },
  holy: { name: 'nebula', size: 64, life: 520 },
  shadow: { name: 'midnight', size: 62, life: 560, spin: true },
  steel: { name: 'weaponhit', size: 46, life: 300, spin: true },
};

type ParticleShape =
  | 'spark'
  | 'puff'
  | 'ring'
  | 'shard'
  /** Tapered tongue of flame that shrinks and rises. */
  | 'flame'
  /** Hard-edged diamond, for ice and glass. */
  | 'crystal'
  /** Swelling then popping circle, for gas and rot. */
  | 'bubble'
  /** Teardrop that falls fast, for water. */
  | 'droplet'
  /** Slow, growing, translucent — smoke and residue. */
  | 'smoke'
  /** Four-point twinkle, for holy and arcane motes. */
  | 'star'
  /** A flattened ring that spreads along the ground rather than expanding. */
  | 'wave'
  /** Soft additive orb. The workhorse of every energy effect. */
  | 'glow'
  /** Additive orb with four long spikes — a lens flare, for the hottest cores. */
  | 'flare'
  /** Thin bright ring expanding fast, for the leading edge of a blast. */
  | 'shock';

/**
 * Shapes that glow rather than sit flat on the board.
 *
 * Smoke, shards and debris are lit by the scene; energy emits its own light.
 * Getting that distinction right is what stops a blast reading as confetti.
 */
const ADDITIVE_BY_DEFAULT: ReadonlySet<ParticleShape> = new Set<ParticleShape>([
  'glow',
  'flare',
  'shock',
  'flame',
  'star',
  'spark',
]);

/**
 * Soft sprites, baked once and blitted thereafter.
 *
 * Canvas has no soft brush: a `fill()` gives a hard edge, and a hard edge is
 * why flat particle work reads as cut paper rather than as light. Baking a
 * radial falloff into a small offscreen canvas and drawing *that* is both
 * softer and cheaper than a path fill per particle per frame.
 *
 * Keyed by colour and radius, so the working set is a couple of dozen sprites
 * for the whole game.
 */
const glowCache = new Map<string, HTMLCanvasElement>();

function glowSprite(colour: string, radius: number, spikes = false): HTMLCanvasElement {
  const r = Math.max(2, Math.round(radius));
  const key = `${colour}|${r}|${spikes ? 1 : 0}`;
  const hit = glowCache.get(key);
  if (hit) return hit;

  const size = r * 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(r, r, 0, r, r, r);
    // White-hot centre fading through the element colour to nothing. The
    // colour never reaches the very middle, which is what makes a bright core.
    /*
     * A small, restrained white centre. At a wide bright core, additive
     * sprites stacked into a featureless white blob and every element looked
     * the same again — the colour has to survive the accumulation, so the
     * white is barely more than a highlight.
     */
    g.addColorStop(0, 'rgba(255,255,255,0.72)');
    g.addColorStop(0.14, colour);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);

    if (spikes) {
      // Four soft spikes make a point of light read as a flare rather than a
      // dot — the cheapest trick there is for selling brightness.
      const s = ctx.createLinearGradient(0, r, size, r);
      s.addColorStop(0, 'rgba(0,0,0,0)');
      s.addColorStop(0.5, 'rgba(255,255,255,0.5)');
      s.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = s;
      ctx.fillRect(0, r - Math.max(1, r * 0.07), size, Math.max(2, r * 0.14));
      const v = ctx.createLinearGradient(r, 0, r, size);
      v.addColorStop(0, 'rgba(0,0,0,0)');
      v.addColorStop(0.5, 'rgba(255,255,255,0.5)');
      v.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = v;
      ctx.fillRect(r - Math.max(1, r * 0.07), 0, Math.max(2, r * 0.14), size);
    }
  }
  glowCache.set(key, canvas);
  return canvas;
}

/** Soft dark puff for smoke, which absorbs light rather than emitting it. */
const smokeCache = new Map<string, HTMLCanvasElement>();

function smokeSprite(colour: string, radius: number): HTMLCanvasElement {
  const r = Math.max(3, Math.round(radius));
  const key = `${colour}|${r}`;
  const hit = smokeCache.get(key);
  if (hit) return hit;

  const size = r * 2;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(r, r, 0, r, r, r);
    g.addColorStop(0, colour);
    g.addColorStop(0.55, colour);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  smokeCache.set(key, canvas);
  return canvas;
}

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
  /**
   * Drawn with `lighter` rather than `source-over`.
   *
   * This is most of the difference between "some particles" and an effect that
   * looks lit: overlapping additive sprites accumulate toward white, so the
   * middle of a blast is hot and its edges are coloured, instead of every
   * particle being the same flat swatch wherever it lands.
   */
  additive: boolean;
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
    additive: false,
  };
}

/**
 * A hand-drawn animation playing at a point.
 *
 * Kept separate from particles because it is not one: a particle is a moving
 * dot with a colour, and this is a fixed strip of authored frames. Sharing the
 * pool would mean a single spell's worth of sparks could evict the drawn
 * effect that is the whole reason the spell reads as a spell.
 */
interface EffectSprite {
  active: boolean;
  name: EffectName;
  x: number;
  y: number;
  size: number;
  life: number;
  maxLife: number;
  rotation: number;
  /** Fades out over the tail of its life rather than cutting. */
  fade: boolean;
  additive: boolean;
}

function blankSprite(): EffectSprite {
  return {
    active: false,
    name: 'weaponhit',
    x: 0,
    y: 0,
    size: 48,
    life: 0,
    maxLife: 1,
    rotation: 0,
    fade: true,
    additive: true,
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
  private readonly sprites: EffectSprite[] = Array.from({ length: MAX_SPRITES }, blankSprite);
  private particleCursor = 0;
  private numberCursor = 0;
  private boltCursor = 0;
  private spriteCursor = 0;

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

  private nextSprite(): EffectSprite {
    const sprite = this.sprites[this.spriteCursor];
    this.spriteCursor = (this.spriteCursor + 1) % MAX_SPRITES;
    return sprite;
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
    opts: {
      speed?: number;
      life?: number;
      size?: number;
      shape?: ParticleShape;
      gravity?: number;
      additive?: boolean;
    } = {},
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
      particle.additive = opts.additive ?? ADDITIVE_BY_DEFAULT.has(particle.shape);
    }
  }

  /**
   * Play a drawn animation at a point.
   *
   * `life` is the whole play-through, so the frame rate follows the duration
   * rather than the wall clock — a lingering effect plays slowly and a quick
   * one snaps, out of the same sixteen frames.
   */
  playEffect(
    name: EffectName,
    x: number,
    y: number,
    size: number,
    opts: { life?: number; rotation?: number; fade?: boolean; additive?: boolean } = {},
  ): void {
    const sprite = this.nextSprite();
    sprite.active = true;
    sprite.name = name;
    sprite.x = x;
    sprite.y = y;
    sprite.size = size;
    sprite.maxLife = opts.life ?? 520;
    sprite.life = sprite.maxLife;
    sprite.rotation = opts.rotation ?? 0;
    sprite.fade = opts.fade ?? true;
    sprite.additive = opts.additive ?? true;
  }

  ring(x: number, y: number, colour: string, size = 26, life = 320, additive = true): void {
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
    particle.additive = additive;
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
  /**
   * An impact, drawn as the thing that caused it.
   *
   * Every hit in the game used to be the same warm yellow burst — the event
   * carried no card, so the renderer could not have known any better. With the
   * card in hand each element gets its own behaviour rather than its own
   * colour: fire throws tongues of flame that rise and leaves smoke, frost
   * shatters into crystals and lingers as a pale ring, toxin ferments as
   * bubbles that outlast the blow, water spreads a flat wave along the ground.
   *
   * `power` scales the whole effect, so the same routine serves a jab from a
   * dagger and a five-aether spell landing.
   */
  private elementalImpact(el: Element, x: number, y: number, power: number): void {
    const look = ELEMENT_LOOKS[el];
    const n = (base: number): number => Math.max(2, Math.round(base * power));

    /*
     * The drawn animation goes on first, at the point of contact.
     *
     * It is the part with a shape — a rim, a rune, a tongue of flame — and the
     * particles below spread out around it. Rotating it by the element's own
     * hash-free constant would look mechanical, so effects that read as
     * radial (blasts, rings) are left upright and only the swirls turn.
     */
    const drawn = ELEMENT_EFFECTS[el];
    this.playEffect(drawn.name, x, y, drawn.size * (0.7 + power * 0.55), {
      life: Math.round(drawn.life * (0.8 + power * 0.3)),
      rotation: drawn.spin ? this.random() * Math.PI * 2 : 0,
    });

    // Bigger effects also last longer, so a spell reads as an event rather
    // than as a large flicker.
    const life = (base: number): number => Math.round(base * (0.75 + power * 0.35));

    /*
     * Every element opens the same way and diverges immediately.
     *
     * The flash and the hot core are what make an impact land — a real effect
     * is brightest at the instant of contact and decays, rather than being one
     * even puff of colour for its whole life. The element then supplies the
     * body of the effect on top.
     */
    this.flash(x, y, look.core, 9 * power, life(120));
    this.shock(x, y, look.core, 16 * power, life(200));

    switch (el) {
      case 'fire':
        // Rolling plume: glow underneath, flame licks over it, smoke after.
        this.burst(x, y, n(9), look.body, { speed: 1.3 * power, size: 9, life: life(560), shape: 'glow', gravity: -0.018 });
        this.burst(x, y, n(12), look.body, { speed: 1.5 * power, size: 7, life: life(620), shape: 'flame', gravity: -0.02 });
        this.burst(x, y, n(6), look.core, { speed: 0.9 * power, size: 5, life: life(420), shape: 'flame', gravity: -0.028 });
        this.burst(x, y, n(7), look.trail, { speed: 1.1 * power, size: 7, life: life(980), shape: 'smoke', gravity: -0.016 });
        this.burst(x, y, n(10), '#ffc46b', { speed: 3.6 * power, size: 2, life: life(460), shape: 'spark', gravity: 0.05 });
        break;

      case 'frost':
        this.burst(x, y, n(7), look.body, { speed: 1.1 * power, size: 8, life: life(420), shape: 'glow', gravity: 0 });
        this.burst(x, y, n(12), look.body, { speed: 3 * power, size: 3, life: life(460), shape: 'crystal', gravity: 0.035 });
        this.burst(x, y, n(5), look.core, { speed: 1.2 * power, size: 3, life: life(680), shape: 'star', gravity: -0.004 });
        this.ring(x, y, 'rgba(190,240,255,0.9)', 22 * power, life(280));
        this.ring(x, y, 'rgba(127,216,255,0.5)', 34 * power, life(680));
        break;

      case 'toxic':
        // Deliberately dull: rot should not glitter. Almost all of this is
        // non-additive, so it sits on the board like a stain.
        this.burst(x, y, n(10), look.body, { speed: 1.4 * power, size: 3, life: life(980), shape: 'bubble', gravity: -0.018 });
        this.burst(x, y, n(7), look.trail, { speed: 1.0 * power, size: 7, life: life(1200), shape: 'smoke', gravity: -0.012 });
        this.burst(x, y, n(4), look.core, { speed: 1.0 * power, size: 5, life: life(520), shape: 'glow', gravity: -0.02 });
        break;

      case 'storm': {
        this.burst(x, y, n(6), look.body, { speed: 0.6 * power, size: 10, life: life(200), shape: 'glow' });
        this.burst(x, y, n(16), look.core, { speed: 4.6 * power, size: 3, life: life(340), shape: 'spark' });
        this.burst(x, y, 2, look.body, { speed: 1.2 * power, size: 5, life: life(260), shape: 'flare' });
        this.ring(x, y, 'rgba(255,255,255,0.95)', 18 * power, life(220));
        const forks = Math.max(4, Math.round(4 * power));
        for (let i = 0; i < forks; i++) {
          const a = (i / forks) * Math.PI * 2 + this.random() * 0.9;
          const r = 30 * power;
          this.arc(x, y, x + Math.cos(a) * r, y + Math.sin(a) * r * 0.55, look.core, life(300));
          this.arc(x, y, x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.35, look.body, life(260));
        }
        break;
      }

      case 'water':
        this.burst(x, y, n(6), look.body, { speed: 1.0 * power, size: 7, life: life(360), shape: 'glow' });
        this.burst(x, y, n(12), look.body, { speed: 2.8 * power, size: 3, life: life(520), shape: 'droplet', gravity: 0.07 });
        this.burst(x, y, n(5), look.core, { speed: 1.6 * power, size: 2, life: life(400), shape: 'droplet', gravity: 0.06 });
        this.wave(x, y, 'rgba(120,200,240,0.85)', 30 * power, life(500));
        this.wave(x, y, 'rgba(74,168,224,0.5)', 42 * power, life(700));
        break;

      case 'arcane':
        this.burst(x, y, n(8), look.body, { speed: 1.0 * power, size: 8, life: life(480), shape: 'glow', gravity: -0.01 });
        this.burst(x, y, n(10), look.body, { speed: 2.4 * power, size: 3, life: life(560), shape: 'star', gravity: -0.012 });
        this.ring(x, y, 'rgba(180,95,224,0.9)', 24 * power, life(440));
        this.ring(x, y, 'rgba(240,216,255,0.55)', 14 * power, life(600));
        break;

      case 'holy':
        this.burst(x, y, 2, look.body, { speed: 0.4 * power, size: 8, life: life(460), shape: 'flare', gravity: -0.02 });
        this.burst(x, y, n(10), look.body, { speed: 1.9 * power, size: 3, life: life(680), shape: 'star', gravity: -0.035 });
        this.burst(x, y, n(6), look.body, { speed: 2.8 * power, size: 2, life: life(460), shape: 'spark', gravity: -0.02 });
        this.ring(x, y, 'rgba(255,216,74,0.9)', 26 * power, life(420));
        break;

      case 'shadow':
        // The one effect that gets *darker* in the middle: a smoke core drawn
        // normally, with additive motes escaping it.
        this.burst(x, y, n(12), look.trail, { speed: 1.4 * power, size: 8, life: life(760), shape: 'smoke', gravity: 0.004 });
        this.burst(x, y, n(9), look.core, { speed: 2.9 * power, size: 3, life: life(460), shape: 'star', gravity: -0.012 });
        this.ring(x, y, 'rgba(201,176,224,0.9)', 24 * power, life(460));
        break;

      case 'steel':
      default:
        this.burst(x, y, n(14), '#ffffff', { speed: 4.4 * power, size: 2, life: life(260), shape: 'spark', gravity: 0.1 });
        this.burst(x, y, n(6), look.core, { speed: 3.0 * power, size: 3, life: life(340), shape: 'shard', gravity: 0.08 });
        this.burst(x, y, n(4), look.trail, { speed: 1.6 * power, size: 5, life: life(500), shape: 'puff', gravity: 0.01 });
        break;
    }
  }

  /** A single bright point at the instant of contact. */
  private flash(x: number, y: number, colour: string, size: number, life: number): void {
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
    particle.shape = 'flare';
    particle.gravity = 0;
    particle.additive = true;
  }

  /** The fast, thin leading edge of a blast. */
  private shock(x: number, y: number, colour: string, size: number, life: number): void {
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
    particle.shape = 'shock';
    particle.gravity = 0;
    particle.additive = true;
  }

  /** A flattened ring that spreads along the ground. */
  wave(x: number, y: number, colour: string, size = 30, life = 420): void {
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
    particle.shape = 'wave';
    particle.gravity = 0;
    particle.additive = true;
  }

  consume(events: readonly SimEvent[], viewTeam: Team): void {
    for (const event of events) {
      switch (event.type) {
        case 'hit': {
          const at = tileToLogical(fxToFloat(event.x), fxToFloat(event.y), viewTeam);
          const card = tryGetCard(event.cardId);
          const el = card ? elementOf(card) : 'steel';
          this.elementalImpact(el, at.x, at.y, event.splash ? 1.35 : 0.6);
          if (event.splash) this.addShake(2.2);
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
          // A body leaving the board is a moment worth drawing: the spirit
          // wisp plays over the dust so a death reads even in a scrum.
          this.playEffect('phantom', at.x, at.y - TILE_H * 0.5, 52, { life: 560 });
          break;
        }

        case 'spell': {
          /*
           * A spell landing is the biggest single visual moment a player
           * causes, and every one of them used to be the same orange ring.
           */
          const at = tileToLogical(fxToFloat(event.x), fxToFloat(event.y), viewTeam);
          const radius = fxToFloat(event.radius);
          const card = tryGetCard(event.cardId);
          const el = card ? elementOf(card) : 'fire';
          const look = ELEMENT_LOOKS[el];
          this.elementalImpact(el, at.x, at.y, 2.4);
          /*
           * A second, much larger drawn animation scaled to the spell's real
           * radius. The impact effect is sized for a blow landing; a spell
           * covers tiles, and without something at that scale a five-aether
           * cast looked exactly like a sword hit with more sparks.
           */
          this.playEffect(ELEMENT_EFFECTS[el].name, at.x, at.y, radius * TILE_W * 2.1, {
            life: 700,
            rotation: this.random() * Math.PI * 2,
          });
          // Plus a ring at the spell's own radius, so its footprint is exact.
          this.ring(at.x, at.y, look.body, radius * TILE_W, 480);
          this.addShake(5);
          break;
        }

        case 'ability': {
          const at = tileToLogical(fxToFloat(event.x), fxToFloat(event.y), viewTeam);
          // A hero ability is a cast, and there is a drawn cast animation for
          // exactly this — a rune circle that opens and closes on the ground.
          this.playEffect('casting', at.x, at.y, 108, { life: 760 });
          this.playEffect('protectioncircle', at.x, at.y, 84, { life: 900 });
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
          this.playEffect('sunburn', at.x, at.y, 190, { life: 900 });
          this.playEffect('vortex', at.x, at.y, 150, { life: 1100, rotation: this.random() * 6.28 });
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
          this.playEffect('vortex', at.x, at.y, 78, { life: 520, rotation: this.random() * 6.28 });
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
          this.playEffect('weaponhit', at.x, at.y - TILE_H * 0.6, 44, { life: 260 });
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
    // A summoning circle where the card lands, so a drop is an event on the
    // board rather than a unit appearing out of nothing.
    this.playEffect('loading', at.x, at.y, 76, { life: 620 });
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

    for (const sprite of this.sprites) {
      if (!sprite.active) continue;
      sprite.life -= dt;
      if (sprite.life <= 0) sprite.active = false;
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
    /*
     * Two passes, because blend mode is not a per-particle property in canvas
     * and flipping it per draw would cost more than the draw.
     *
     * Smoke first, under everything, drawn normally so it darkens the board.
     * Then everything that emits light, drawn additively so overlapping
     * particles accumulate toward white — which is what gives a blast a hot
     * centre instead of a uniform wash of one colour.
     */
    ctx.save();
    for (let pass = 0; pass < 2; pass++) {
      const additivePass = pass === 1;
      ctx.globalCompositeOperation = additivePass ? 'lighter' : 'source-over';
      for (const particle of this.particles) {
        if (!particle.active || particle.additive !== additivePass) continue;
        const t = particle.life / particle.maxLife;
        ctx.globalAlpha = Math.max(0, Math.min(1, t));
        this.drawParticle(ctx, particle, t);
      }
    }

    /*
     * The drawn animations last, over every particle.
     *
     * They carry the shape of the effect, so anything the particles throw in
     * front of them would read as the effect being *behind* smoke. Additive
     * for the same reason the particles are: these frames are lit, and stacking
     * them over a plume should brighten it rather than paste a rectangle of
     * art on top of it.
     */
    ctx.globalCompositeOperation = 'lighter';
    for (const sprite of this.sprites) {
      if (!sprite.active) continue;
      const sheet = effectSheet(sprite.name);
      if (!sheet) continue;
      const t = 1 - sprite.life / sprite.maxLife;
      const frame = Math.min(EFFECT_FRAMES - 1, Math.floor(t * EFFECT_FRAMES));
      // Fade over the last third only, so the animation gets to play at full
      // strength and then leaves, rather than dimming from the first frame.
      ctx.globalAlpha = sprite.fade ? Math.max(0, Math.min(1, (1 - t) * 3)) : 1;
      if (!sprite.additive) ctx.globalCompositeOperation = 'source-over';
      drawEffectFrame(ctx, sheet, frame, sprite.x, sprite.y, sprite.size, sprite.rotation);
      if (!sprite.additive) ctx.globalCompositeOperation = 'lighter';
    }

    ctx.restore();
    ctx.globalAlpha = 1;
  }

  private drawParticle(ctx: CanvasRenderingContext2D, particle: Particle, t: number): void {
    const blit = (sprite: HTMLCanvasElement, radius: number): void => {
      ctx.drawImage(sprite, particle.x - radius, particle.y - radius, radius * 2, radius * 2);
    };

    switch (particle.shape) {
      case 'glow':
        blit(glowSprite(particle.colour, particle.size * 3), particle.size * 3 * (1.5 - t * 0.5));
        break;

      case 'flare':
        blit(glowSprite(particle.colour, particle.size * 4, true), particle.size * 4 * (1.7 - t * 0.7));
        break;

      case 'shock': {
        // The leading edge of a blast: thin, bright, and gone almost at once.
        const grow = particle.size * (2.4 - t * 1.9);
        ctx.strokeStyle = particle.colour;
        ctx.lineWidth = Math.max(1, 7 * t);
        ctx.beginPath();
        ctx.ellipse(particle.x, particle.y, grow, grow * (TILE_H / TILE_W), 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }

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

      case 'wave': {
        const grow = particle.size * (2.2 - t * 1.2);
        ctx.strokeStyle = particle.colour;
        ctx.lineWidth = 4 * t + 1;
        ctx.beginPath();
        ctx.ellipse(particle.x, particle.y, grow, grow * 0.28, 0, 0, Math.PI * 2);
        ctx.stroke();
        break;
      }

      case 'smoke':
        // Billows outward and drifts up as it thins.
        blit(smokeSprite(particle.colour, particle.size * 3), particle.size * 3 * (2.2 - t * 1.1));
        break;

      case 'puff':
        blit(smokeSprite(particle.colour, particle.size * 2), particle.size * 2 * (1.8 - t));
        break;

      case 'flame': {
        /*
         * A glowing core with a tapered tongue over it. The glow is what makes
         * it look like combustion rather than an orange triangle.
         */
        const h = particle.size * 3.2 * t;
        const w = particle.size * (0.5 + t * 0.6);
        blit(glowSprite(particle.colour, particle.size * 2.2), particle.size * 2.2);
        ctx.fillStyle = particle.colour;
        ctx.beginPath();
        ctx.moveTo(particle.x, particle.y - h);
        ctx.quadraticCurveTo(particle.x + w, particle.y - h * 0.35, particle.x + w * 0.6, particle.y);
        ctx.quadraticCurveTo(particle.x, particle.y + w * 0.4, particle.x - w * 0.6, particle.y);
        ctx.quadraticCurveTo(particle.x - w, particle.y - h * 0.35, particle.x, particle.y - h);
        ctx.closePath();
        ctx.fill();
        break;
      }

      case 'crystal': {
        const r = particle.size * (0.7 + t);
        ctx.fillStyle = particle.colour;
        ctx.beginPath();
        ctx.moveTo(particle.x, particle.y - r * 1.6);
        ctx.lineTo(particle.x + r * 0.7, particle.y);
        ctx.lineTo(particle.x, particle.y + r * 1.6);
        ctx.lineTo(particle.x - r * 0.7, particle.y);
        ctx.closePath();
        ctx.fill();
        break;
      }

      case 'bubble': {
        const r = particle.size * (2.2 - t * 1.1);
        ctx.strokeStyle = particle.colour;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha *= 0.3;
        ctx.fillStyle = particle.colour;
        ctx.fill();
        ctx.globalAlpha = Math.max(0, Math.min(1, t));
        break;
      }

      case 'droplet': {
        const r = particle.size * (0.6 + t * 0.8);
        ctx.fillStyle = particle.colour;
        ctx.beginPath();
        ctx.moveTo(particle.x, particle.y - r * 1.8);
        ctx.quadraticCurveTo(particle.x + r, particle.y, particle.x, particle.y + r);
        ctx.quadraticCurveTo(particle.x - r, particle.y, particle.x, particle.y - r * 1.8);
        ctx.closePath();
        ctx.fill();
        break;
      }

      case 'star': {
        const r = particle.size * (1.4 - t * 0.4);
        blit(glowSprite(particle.colour, r * 2, true), r * 2);
        break;
      }

      case 'shard':
        ctx.fillStyle = particle.colour;
        ctx.fillRect(particle.x, particle.y, particle.size, particle.size * 1.8);
        break;

      default:
        // A spark is a short streak along its own motion, not a square.
        ctx.strokeStyle = particle.colour;
        ctx.lineWidth = Math.max(1, particle.size * 0.9);
        ctx.beginPath();
        ctx.moveTo(particle.x, particle.y);
        ctx.lineTo(particle.x - particle.vx * 2.2, particle.y - particle.vy * 2.2);
        ctx.stroke();
    }
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
