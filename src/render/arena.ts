/**
 * Static arena rendering: turf, river, bridges, tower platforms and the
 * deployment overlay.
 *
 * Everything here derives from the same grid the simulation navigates, rather
 * than from hand-placed art coordinates — so if the river mask or a tower
 * footprint changes, the picture and the pathfinding cannot disagree.
 */

import { GRID_W, GRID_H } from '@sim/constants';
import {
  type ArenaGrid,
  type Team,
  TOWER_LAYOUTS,
  isRiverTile,
  canDeployAt,
  type DeployRights,
} from '@sim/nav/grid';
import {
  TILE_W,
  TILE_H,
  FIELD_TOP,
  FIELD_HEIGHT,
  LOGICAL_W,
  tileToLogical,
} from './camera';

const TURF_BLUE = '#3d6b3a';
const TURF_BLUE_ALT = '#427341';
const TURF_RED = '#4a5f7a';
const TURF_RED_ALT = '#506781';
const RIVER = '#2f6f9e';
const RIVER_HIGHLIGHT = '#4a8cbd';
const BRIDGE = '#8a6b45';
const BRIDGE_EDGE = '#6d5335';

/** Rect covering one tile, in logical space, normalised for the flip. */
function tileRect(tx: number, ty: number, viewTeam: Team) {
  const a = tileToLogical(tx, ty, viewTeam);
  const b = tileToLogical(tx + 1, ty + 1, viewTeam);
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

export function drawArena(
  ctx: CanvasRenderingContext2D,
  grid: ArenaGrid,
  viewTeam: Team,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, FIELD_TOP, LOGICAL_W, FIELD_HEIGHT);
  ctx.clip();

  // Turf, checkered so the tile grid reads without drawing explicit lines.
  for (let ty = 0; ty < GRID_H; ty++) {
    const isRedHalf = ty > 16;
    for (let tx = 0; tx < GRID_W; tx++) {
      const rect = tileRect(tx, ty, viewTeam);
      const alt = (tx + ty) % 2 === 0;
      ctx.fillStyle = isRedHalf
        ? alt
          ? TURF_RED
          : TURF_RED_ALT
        : alt
          ? TURF_BLUE
          : TURF_BLUE_ALT;
      ctx.fillRect(rect.x, rect.y, rect.w + 0.5, rect.h + 0.5);
    }
  }

  // River and bridges, straight from the walkability mask.
  for (const ty of [15, 16]) {
    for (let tx = 0; tx < GRID_W; tx++) {
      const rect = tileRect(tx, ty, viewTeam);
      if (isRiverTile(grid, tx, ty)) {
        ctx.fillStyle = RIVER;
        ctx.fillRect(rect.x, rect.y, rect.w + 0.5, rect.h + 0.5);
        ctx.fillStyle = RIVER_HIGHLIGHT;
        ctx.fillRect(rect.x, rect.y + rect.h * 0.35, rect.w + 0.5, rect.h * 0.12);
      } else {
        ctx.fillStyle = BRIDGE;
        ctx.fillRect(rect.x, rect.y, rect.w + 0.5, rect.h + 0.5);
        ctx.fillStyle = BRIDGE_EDGE;
        ctx.fillRect(rect.x, rect.y, rect.w + 0.5, 3);
        ctx.fillRect(rect.x, rect.y + rect.h - 3, rect.w + 0.5, 3);
      }
    }
  }

  // Tower platforms sit under the tower entities drawn later.
  for (const layout of TOWER_LAYOUTS) {
    const a = tileToLogical(layout.footprint.minX, layout.footprint.minY, viewTeam);
    const b = tileToLogical(layout.footprint.maxX + 1, layout.footprint.maxY + 1, viewTeam);
    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    const w = Math.abs(b.x - a.x);
    const h = Math.abs(b.y - a.y);

    ctx.fillStyle = layout.team === 0 ? 'rgba(40,90,180,0.35)' : 'rgba(180,60,60,0.35)';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = layout.team === 0 ? '#5b9bd5' : '#d55b5b';
    ctx.lineWidth = 3;
    ctx.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
  }

  ctx.restore();
}

/**
 * Tint every tile the player may legally drop on. Shown only while a card is
 * being dragged, so the rules are discoverable without a tutorial.
 */
export function drawDeployOverlay(
  ctx: CanvasRenderingContext2D,
  grid: ArenaGrid,
  team: Team,
  rights: DeployRights,
  flying: boolean,
  viewTeam: Team,
): void {
  ctx.save();
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = '#ffffff';
  for (let ty = 0; ty < GRID_H; ty++) {
    for (let tx = 0; tx < GRID_W; tx++) {
      if (!canDeployAt(grid, team, tx, ty, rights, flying)) continue;
      const rect = tileRect(tx, ty, viewTeam);
      ctx.fillRect(rect.x, rect.y, rect.w + 0.5, rect.h + 0.5);
    }
  }
  ctx.restore();
}

/** The translucent preview shown under the finger while dragging a card. */
export function drawPlacementGhost(
  ctx: CanvasRenderingContext2D,
  tx: number,
  ty: number,
  legal: boolean,
  tint: string,
  viewTeam: Team,
): void {
  const centre = tileToLogical(tx + 0.5, ty + 0.5, viewTeam);
  ctx.save();
  ctx.globalAlpha = 0.65;
  ctx.fillStyle = legal ? tint : '#c0392b';
  ctx.beginPath();
  ctx.ellipse(centre.x, centre.y, TILE_W * 0.45, TILE_H * 0.6, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.globalAlpha = 1;
  ctx.strokeStyle = legal ? '#ffffff' : '#ff6b5b';
  ctx.lineWidth = 4;
  ctx.setLineDash([10, 8]);
  ctx.beginPath();
  ctx.ellipse(centre.x, centre.y, TILE_W * 0.75, TILE_H * 0.95, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
