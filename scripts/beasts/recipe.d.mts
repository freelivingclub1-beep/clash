/** Types for the animal recipe, which is plain JS so both builds can read it. */

/**
 * Either a wholesale hue/saturation replacement, or a set of stops indexed by
 * the source pixel's brightness. The ramp is what a two-tone coat needs — a
 * Doberman is black with rust points, and no single hue produces that.
 */
export type BeastPalette =
  | { hue: number; sat: number; light: number }
  | { ramp: Array<[number, number, number, number]> };

export interface BeastSpec {
  sheet: string;
  palette: BeastPalette | null;
  height?: number;
}
export declare const BEASTS: Record<string, BeastSpec>;
export declare function requiredSheets(): string[];
