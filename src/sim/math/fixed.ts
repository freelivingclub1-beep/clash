/**
 * Q16.16 signed fixed-point arithmetic.
 *
 * The simulation must produce bit-identical results on every machine that runs
 * it, so no float ever reaches sim state. Spatial quantities (tile positions,
 * velocities, ranges, radii) are stored as `Fx` — an integer scaled by 65536.
 *
 * Quantities that are *not* fixed-point, by deliberate choice:
 *   - health / damage / shield : plain integers (HP points). At Q16.16 a
 *     100k-HP tower would overflow int32.
 *   - aether                   : plain integer milli-aether, 0..10000.
 *   - time                     : plain integer ticks.
 *
 * Products stay well under 2^53 for our magnitude range (positions cap at 32
 * tiles = 2_097_152 raw), so the double-precision intermediate in `fxMul` is
 * exact and the rounding is reproducible.
 */

/** A Q16.16 fixed-point number. */
export type Fx = number;

export const FX_SHIFT = 16;
export const FX_ONE: Fx = 1 << FX_SHIFT; // 65536
export const FX_HALF: Fx = FX_ONE >> 1;
export const FX_ZERO: Fx = 0;

/** Whole number -> Fx. */
export function fx(n: number): Fx {
  return Math.round(n * FX_ONE);
}

/** Fx -> float. Render-side only; never feed the result back into sim state. */
export function fxToFloat(a: Fx): number {
  return a / FX_ONE;
}

/** Truncates toward negative infinity, matching tile-index semantics. */
export function fxFloorToInt(a: Fx): number {
  return Math.floor(a / FX_ONE);
}

export function fxRoundToInt(a: Fx): number {
  return Math.round(a / FX_ONE);
}

export function fxMul(a: Fx, b: Fx): Fx {
  return Math.round((a * b) / FX_ONE);
}

export function fxDiv(a: Fx, b: Fx): Fx {
  if (b === 0) return 0;
  return Math.round((a * FX_ONE) / b);
}

/** Scale an Fx by a plain integer. Cheaper and exact — no rounding needed. */
export function fxScaleInt(a: Fx, n: number): Fx {
  return a * n;
}

export function fxAbs(a: Fx): Fx {
  return a < 0 ? -a : a;
}

export function fxMin(a: Fx, b: Fx): Fx {
  return a < b ? a : b;
}

export function fxMax(a: Fx, b: Fx): Fx {
  return a > b ? a : b;
}

export function fxClamp(a: Fx, lo: Fx, hi: Fx): Fx {
  return a < lo ? lo : a > hi ? hi : a;
}

/**
 * Exact integer floor-sqrt. Seeded from Math.sqrt (which is only
 * implementation-approximated per the ES spec) and then corrected by integer
 * comparison, so the returned value is identical on every engine.
 */
export function isqrt(n: number): number {
  if (n <= 0) return 0;
  let x = Math.floor(Math.sqrt(n));
  while (x > 0 && x * x > n) x--;
  while ((x + 1) * (x + 1) <= n) x++;
  return x;
}

/** sqrt of a Q16.16 value, result in Q16.16. */
export function fxSqrt(a: Fx): Fx {
  if (a <= 0) return 0;
  return isqrt(a * FX_ONE);
}

/**
 * Squared magnitude of an Fx vector, returned in Q16.16.
 *
 * Ranges are compared squared everywhere in the sim to avoid sqrt in hot paths;
 * use `fxLenSq` on both sides rather than mixing squared and linear distances.
 */
export function fxLenSq(dx: Fx, dy: Fx): Fx {
  return Math.round((dx * dx + dy * dy) / FX_ONE);
}

export function fxLen(dx: Fx, dy: Fx): Fx {
  return fxSqrt(fxLenSq(dx, dy));
}
