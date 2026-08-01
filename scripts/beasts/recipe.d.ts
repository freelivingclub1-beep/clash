/** Types for the animal recipe, which is plain JS so both builds can read it. */
export interface BeastSpec {
  sheet: string;
  palette: { hue: number; sat: number; light: number } | null;
  height?: number;
}
export declare const BEASTS: Record<string, BeastSpec>;
export declare function requiredSheets(): string[];
