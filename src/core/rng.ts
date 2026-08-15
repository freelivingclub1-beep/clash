/**
 * Deterministic seeded PRNG.
 *
 * Every random draw in KENNEL goes through this. The race is a seeded,
 * server-side, deterministic log (see design doc §9) — given the same seed and
 * the same inputs, the same race must come out every time, forever. That is
 * what makes the replay layer a pure view over the log rather than a second
 * implementation of the game.
 */

/** cyrb128: string -> four 32-bit seed words. */
function hashSeed(seed: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;

  for (let i = 0; i < seed.length; i++) {
    const k = seed.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }

  return [
    (h3 ^ (h1 >>> 18)) >>> 0,
    (h4 ^ (h2 >>> 22)) >>> 0,
    (h1 ^ (h3 >>> 17)) >>> 0,
    (h2 ^ (h4 >>> 19)) >>> 0,
  ];
}

export class Rng {
  readonly seed: string;
  #a: number;
  #b: number;
  #c: number;
  #d: number;

  constructor(seed: string) {
    this.seed = seed;
    const [a, b, c, d] = hashSeed(seed);
    this.#a = a;
    this.#b = b;
    this.#c = c;
    this.#d = d;
    // Discard the first few draws so closely-related seeds diverge immediately.
    for (let i = 0; i < 12; i++) this.float();
  }

  /** xoshiro128** — uniform float in [0, 1). */
  float(): number {
    const t = this.#b << 9;
    let r = Math.imul(this.#b, 5);
    r = ((r << 7) | (r >>> 25)) >>> 0;
    r = Math.imul(r, 9) >>> 0;

    this.#c ^= this.#a;
    this.#d ^= this.#b;
    this.#b ^= this.#c;
    this.#a ^= this.#d;
    this.#c ^= t;
    this.#d = ((this.#d << 11) | (this.#d >>> 21)) >>> 0;

    return r / 4294967296;
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + this.float() * (max - min);
  }

  /** Uniform integer in [min, max], inclusive both ends. */
  int(min: number, max: number): number {
    return min + Math.floor(this.float() * (max - min + 1));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.float() < p;
  }

  /** Uniform choice from a non-empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error("Rng.pick: empty array");
    return items[Math.floor(this.float() * items.length)]!;
  }

  /** `count` distinct choices, in draw order. */
  pickMany<T>(items: readonly T[], count: number): T[] {
    if (count > items.length) {
      throw new Error(`Rng.pickMany: asked for ${count} of ${items.length}`);
    }
    const pool = [...items];
    const out: T[] = [];
    for (let i = 0; i < count; i++) {
      out.push(pool.splice(Math.floor(this.float() * pool.length), 1)[0]!);
    }
    return out;
  }

  /** Fisher-Yates, returning a new array. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.float() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    return out;
  }

  /** Normal-ish deviate via the mean of four draws. Cheap, bounded, good enough. */
  jitter(spread: number): number {
    const n = (this.float() + this.float() + this.float() + this.float()) / 4;
    return (n - 0.5) * 2 * spread;
  }

  /** A derived stream, so subsystems can draw without disturbing each other. */
  fork(label: string): Rng {
    return new Rng(`${this.seed}:${label}:${Math.floor(this.float() * 2 ** 32)}`);
  }
}

/** Clamp helper used all over the sim. */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Linear interpolation. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
