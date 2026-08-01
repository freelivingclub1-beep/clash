/** Types for the LPC compositor, which is plain JS so it can use pngjs directly. */
export interface Layer {
  walk: unknown;
  slash: unknown;
  /** Which LPC animation the strike sheet came from; sets its frame count. */
  slashAnim?: string;
}
export declare function readSheet(dir: string, zipName: string, path: string): unknown;
export declare function listEntries(dir: string, zipName: string, prefix: string): string[];
export declare function composeAtlas(opts: {
  layers: Layer[];
  walkFrames: number;
  strikeFrames: number;
}): unknown;
export type Palette =
  | { hue: number; sat: number; light: number; ramp?: undefined }
  /** Brightness-indexed stops: `[t, r, g, b]`, t in 0..1. */
  | { ramp: Array<[number, number, number, number]> };
export declare function recolour(sheet: unknown, palette: Palette): unknown;
export declare function encode(png: unknown, colours?: number): Buffer;
export declare const CELL: number;
export declare const LOGICAL: number;
