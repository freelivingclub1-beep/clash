/**
 * sfc32 — a small, fast, all-32-bit-integer PRNG.
 *
 * Chosen over PCG32 because it needs no 64-bit multiply emulation: every
 * operation is a native 32-bit int op, so the output stream is identical on
 * every JS engine. State is a plain struct rather than a closure so it can be
 * snapshotted and restored with the rest of the match state (needed for replay
 * and, later, rollback).
 *
 * A match runs two independent streams:
 *   shuffleRng — deck cycle order only
 *   simRng     — spawn jitter, tie-breaks, bot decisions
 * Keeping them separate means adding a bot decision can never shift card order.
 */

import { type Fx, FX_ONE } from './fixed';

export interface Rng {
  a: number;
  b: number;
  c: number;
  d: number;
}

/** splitmix32 — used only to expand a single seed into four state words. */
function splitmix32(state: { s: number }): number {
  state.s = (state.s + 0x9e3779b9) | 0;
  let z = state.s;
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad);
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97);
  return (z ^ (z >>> 15)) >>> 0;
}

export function createRng(seed: number): Rng {
  const sm = { s: seed | 0 };
  const rng: Rng = {
    a: splitmix32(sm) | 0,
    b: splitmix32(sm) | 0,
    c: splitmix32(sm) | 0,
    d: splitmix32(sm) | 0,
  };
  // Discard the first outputs so poorly-distributed seeds settle.
  for (let i = 0; i < 12; i++) nextU32(rng);
  return rng;
}

export function cloneRng(r: Rng): Rng {
  return { a: r.a, b: r.b, c: r.c, d: r.d };
}

/** Next raw 32-bit unsigned value. */
export function nextU32(r: Rng): number {
  const t = (((r.a + r.b) | 0) + r.d) | 0;
  r.d = (r.d + 1) | 0;
  r.a = r.b ^ (r.b >>> 9);
  r.b = (r.c + (r.c << 3)) | 0;
  r.c = (r.c << 21) | (r.c >>> 11);
  r.c = (r.c + t) | 0;
  return t >>> 0;
}

/** Uniform integer in [0, maxExclusive). Rejection-sampled to stay unbiased. */
export function nextInt(r: Rng, maxExclusive: number): number {
  if (maxExclusive <= 1) return 0;
  const limit = 0x100000000 - (0x100000000 % maxExclusive);
  let v = nextU32(r);
  while (v >= limit) v = nextU32(r);
  return v % maxExclusive;
}

/** Uniform integer in [min, max] inclusive. */
export function nextRange(r: Rng, min: number, max: number): number {
  return min + nextInt(r, max - min + 1);
}

/** Uniform Fx in [0, 1). */
export function nextFx(r: Rng): Fx {
  return nextInt(r, FX_ONE);
}

/** Uniform Fx in [-magnitude, +magnitude] — used for spawn scatter. */
export function nextFxSpread(r: Rng, magnitude: Fx): Fx {
  if (magnitude <= 0) return 0;
  return nextInt(r, magnitude * 2 + 1) - magnitude;
}

/** In-place Fisher-Yates. Deterministic given the same rng state. */
export function shuffle<T>(r: Rng, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = nextInt(r, i + 1);
    const tmp = items[i];
    items[i] = items[j];
    items[j] = tmp;
  }
  return items;
}
