/** Types for the LPC compositor, which is plain JS so it can use pngjs directly. */
export interface Layer {
  walk: unknown;
  slash: unknown;
}
export declare function readSheet(dir: string, zipName: string, path: string): unknown;
export declare function listEntries(dir: string, zipName: string, prefix: string): string[];
export declare function composeAtlas(opts: {
  layers: Layer[];
  walkFrames: number;
  strikeFrames: number;
  strikeAnim: string;
}): unknown;
export declare function encode(png: unknown): Buffer;
