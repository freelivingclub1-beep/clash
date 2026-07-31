/**
 * Screen-space mapping for the 9:16 portrait layout.
 *
 * The whole UI is authored against a fixed 1080x1920 logical canvas and scaled
 * uniformly to whatever the device actually gives us, so a tile is the same
 * fraction of the screen on every phone.
 *
 * Vertical bands, per spec §1:
 *   0-10%    header   — tower health, timer, opponent
 *   10-75%   field    — the 18x32 arena
 *   75-100%  hud      — hand, aether, ability button
 *
 * The field band is 1080x1248 for an 18x32 grid, so tiles cannot be square:
 * 60 wide by 39 tall. That ~0.65 vertical squash is deliberate — it is the
 * same foreshortening a tilted camera would produce, and it is what makes the
 * arena read as receding rather than as a flat top-down grid. The simulation
 * knows nothing about it; tiles are unit squares everywhere behind this file.
 */

import { GRID_W, GRID_H } from '@sim/constants';
import type { Team } from '@sim/types';

export const LOGICAL_W = 1080;
export const LOGICAL_H = 1920;

export const HEADER_HEIGHT = Math.round(LOGICAL_H * 0.1); // 192
export const FIELD_TOP = HEADER_HEIGHT;
export const FIELD_HEIGHT = Math.round(LOGICAL_H * 0.65); // 1248
export const FIELD_BOTTOM = FIELD_TOP + FIELD_HEIGHT; // 1440
export const HUD_TOP = FIELD_BOTTOM;
export const HUD_HEIGHT = LOGICAL_H - HUD_TOP; // 480

export const TILE_W = LOGICAL_W / GRID_W; // 60
export const TILE_H = FIELD_HEIGHT / GRID_H; // 39

export interface Viewport {
  /** Logical-to-device scale factor. */
  scale: number;
  /** Device-space offset of the logical origin, for letterboxing. */
  offsetX: number;
  offsetY: number;
  cssWidth: number;
  cssHeight: number;
  dpr: number;
}

/** Fit the 1080x1920 canvas inside a CSS box, centred, preserving aspect. */
export function computeViewport(cssWidth: number, cssHeight: number, dpr = 1): Viewport {
  const scale = Math.min(cssWidth / LOGICAL_W, cssHeight / LOGICAL_H);
  return {
    scale,
    offsetX: (cssWidth - LOGICAL_W * scale) / 2,
    offsetY: (cssHeight - LOGICAL_H * scale) / 2,
    cssWidth,
    cssHeight,
    dpr,
  };
}

/**
 * Tile space -> logical canvas space.
 *
 * `viewTeam` is the side the human is playing: their half is always drawn at
 * the bottom of the screen, so a red-side player sees a mirrored board rather
 * than having to play upside down.
 */
export function tileToLogical(tx: number, ty: number, viewTeam: Team): { x: number; y: number } {
  const flipped = viewTeam === 1;
  const gx = flipped ? GRID_W - tx : tx;
  const gy = flipped ? ty : GRID_H - ty;
  return { x: gx * TILE_W, y: FIELD_TOP + gy * TILE_H };
}

/** Logical canvas space -> tile space. The exact inverse of the above. */
export function logicalToTile(x: number, y: number, viewTeam: Team): { tx: number; ty: number } {
  const flipped = viewTeam === 1;
  const gx = x / TILE_W;
  const gy = (y - FIELD_TOP) / TILE_H;
  return {
    tx: flipped ? GRID_W - gx : gx,
    ty: flipped ? gy : GRID_H - gy,
  };
}

/** Pointer event coordinates (relative to the canvas box) -> tile space. */
export function clientToTile(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number },
  viewport: Viewport,
  viewTeam: Team,
): { tx: number; ty: number } {
  const logicalX = (clientX - rect.left - viewport.offsetX) / viewport.scale;
  const logicalY = (clientY - rect.top - viewport.offsetY) / viewport.scale;
  return logicalToTile(logicalX, logicalY, viewTeam);
}

export function isInsideField(logicalY: number): boolean {
  return logicalY >= FIELD_TOP && logicalY <= FIELD_BOTTOM;
}

/** Apply the viewport transform so all drawing can use logical coordinates. */
export function applyViewport(ctx: CanvasRenderingContext2D, viewport: Viewport): void {
  const s = viewport.scale * viewport.dpr;
  ctx.setTransform(s, 0, 0, s, viewport.offsetX * viewport.dpr, viewport.offsetY * viewport.dpr);
}
