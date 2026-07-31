/**
 * Arena rendering: turf, river, bridges, tower platforms and the deployment
 * overlay.
 *
 * Everything here derives from the same grid the simulation navigates, rather
 * than from hand-placed art coordinates — so if the river mask or a tower
 * footprint changes, the picture and the pathfinding cannot disagree.
 *
 * Surfaces are textured (`./textures`) rather than filled with flat colour.
 * The static parts — turf, river bed, bridges, platforms, borders — are
 * composited once into an offscreen canvas and blitted each frame, because
 * none of it changes unless a tower falls. Painting several hundred textured
 * tiles plus their detail every frame would cost more than everything else in
 * the renderer combined.
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
import { texturePattern } from './textures';

/** Rect covering one tile, in logical space, normalised for the board flip. */
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

function footprintRect(
  footprint: { minX: number; minY: number; maxX: number; maxY: number },
  viewTeam: Team,
) {
  const a = tileToLogical(footprint.minX, footprint.minY, viewTeam);
  const b = tileToLogical(footprint.maxX + 1, footprint.maxY + 1, viewTeam);
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

// ---------------------------------------------------------------------------
// Static arena compositing
// ---------------------------------------------------------------------------

interface CachedArena {
  canvas: HTMLCanvasElement;
  key: string;
}

let cached: CachedArena | null = null;

/**
 * Paint the whole static arena into an offscreen canvas.
 *
 * Keyed on the grid version and the viewing side, so placing a building or
 * losing a tower rebuilds it and nothing else does.
 */
function buildArenaLayer(grid: ArenaGrid, viewTeam: Team): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = LOGICAL_W;
  canvas.height = FIELD_HEIGHT;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  // The layer is drawn in its own space; shift so tile Y maps to 0 at the top.
  ctx.translate(0, -FIELD_TOP);

  const grassBlue = texturePattern(ctx, 'grassBlue');
  const grassBlueAlt = texturePattern(ctx, 'grassBlueAlt');
  const grassRed = texturePattern(ctx, 'grassRed');
  const grassRedAlt = texturePattern(ctx, 'grassRedAlt');
  const water = texturePattern(ctx, 'water');
  const wood = texturePattern(ctx, 'wood');
  const dirt = texturePattern(ctx, 'dirt');

  // --- turf ----------------------------------------------------------------
  for (let ty = 0; ty < GRID_H; ty++) {
    const isRedHalf = ty > 16;
    for (let tx = 0; tx < GRID_W; tx++) {
      const rect = tileRect(tx, ty, viewTeam);
      const alt = (tx + ty) % 2 === 0;
      ctx.fillStyle = isRedHalf ? (alt ? grassRed : grassRedAlt) : alt ? grassBlue : grassBlueAlt;
      ctx.fillRect(rect.x, rect.y, rect.w + 0.5, rect.h + 0.5);
      // A faint checker on top of the texture keeps the tile grid readable for
      // placement without the flat two-tone look it replaced.
      ctx.fillStyle = alt ? 'rgba(255,255,255,0.028)' : 'rgba(0,0,0,0.045)';
      ctx.fillRect(rect.x, rect.y, rect.w + 0.5, rect.h + 0.5);
    }
  }

  // --- worn paths from each tower toward the bridges ------------------------
  ctx.save();
  ctx.globalAlpha = 0.5;
  for (const layout of TOWER_LAYOUTS) {
    if (layout.kind !== 'princess') continue;
    const from = tileToLogical(layout.centerX, layout.centerY, viewTeam);
    const bridgeX = layout.lane === 0 ? 4.5 : 13.5;
    const to = tileToLogical(bridgeX + 0.5, layout.team === 0 ? 15 : 17, viewTeam);
    ctx.strokeStyle = dirt;
    ctx.lineWidth = TILE_W * 0.85;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
  }
  ctx.restore();

  // --- river ---------------------------------------------------------------
  for (const ty of [15, 16]) {
    for (let tx = 0; tx < GRID_W; tx++) {
      const rect = tileRect(tx, ty, viewTeam);
      if (!isRiverTile(grid, tx, ty)) continue;
      ctx.fillStyle = water;
      ctx.fillRect(rect.x, rect.y, rect.w + 0.5, rect.h + 0.5);
    }
  }

  // Banks: a dirt lip and a darkening gradient where the turf meets water, so
  // the river reads as cut into the ground rather than painted onto it.
  const bankTop = tileRect(0, viewTeam === 1 ? 16 : 15, viewTeam);
  const bankBottom = tileRect(0, viewTeam === 1 ? 15 : 16, viewTeam);
  const riverTop = Math.min(bankTop.y, bankBottom.y);
  const riverBottom = Math.max(bankTop.y, bankBottom.y) + bankBottom.h;

  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = dirt;
  ctx.fillRect(0, riverTop - 5, LOGICAL_W, 5);
  ctx.fillRect(0, riverBottom, LOGICAL_W, 5);
  ctx.restore();

  const shade = ctx.createLinearGradient(0, riverTop, 0, riverBottom);
  shade.addColorStop(0, 'rgba(0,0,0,0.45)');
  shade.addColorStop(0.25, 'rgba(0,0,0,0.05)');
  shade.addColorStop(0.75, 'rgba(0,0,0,0.05)');
  shade.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = shade;
  ctx.fillRect(0, riverTop, LOGICAL_W, riverBottom - riverTop);

  // Foam lines along both banks.
  ctx.strokeStyle = 'rgba(255,255,255,0.32)';
  ctx.lineWidth = 2;
  for (const y of [riverTop + 3, riverBottom - 3]) {
    ctx.beginPath();
    for (let x = 0; x <= LOGICAL_W; x += 12) {
      ctx.lineTo(x, y + Math.sin(x * 0.08) * 1.8);
    }
    ctx.stroke();
  }

  // --- bridges -------------------------------------------------------------
  for (const ty of [15, 16]) {
    for (let tx = 0; tx < GRID_W; tx++) {
      if (isRiverTile(grid, tx, ty)) continue;
      const rect = tileRect(tx, ty, viewTeam);

      // Shadow cast onto the water under the deck.
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(rect.x, rect.y + rect.h - 4, rect.w + 0.5, 6);

      ctx.fillStyle = wood;
      ctx.fillRect(rect.x, rect.y, rect.w + 0.5, rect.h + 0.5);

      // Cross-planks, drawn per tile so they line up with the grid.
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 1.5;
      for (let i = 1; i < 4; i++) {
        const x = rect.x + (rect.w / 4) * i;
        ctx.beginPath();
        ctx.moveTo(x, rect.y);
        ctx.lineTo(x, rect.y + rect.h);
        ctx.stroke();
      }
    }
  }

  // Bridge rails along the outer edges of each crossing.
  for (const [left, right] of [
    [4, 5],
    [13, 14],
  ]) {
    for (const ty of [15, 16]) {
      const a = tileRect(left, ty, viewTeam);
      const b = tileRect(right, ty, viewTeam);
      const x0 = Math.min(a.x, b.x);
      const x1 = Math.max(a.x, b.x) + b.w;
      ctx.fillStyle = 'rgba(60,42,24,0.9)';
      ctx.fillRect(x0 - 4, a.y, 5, a.h + 1);
      ctx.fillRect(x1 - 1, a.y, 5, a.h + 1);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.fillRect(x0 - 4, a.y, 5, 2);
      ctx.fillRect(x1 - 1, a.y, 5, 2);
    }
  }

  // --- tower platforms -----------------------------------------------------
  for (const layout of TOWER_LAYOUTS) {
    const rect = footprintRect(layout.footprint, viewTeam);
    const stone = texturePattern(ctx, layout.team === 0 ? 'stoneBlue' : 'stoneRed');

    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.fillRect(rect.x - 3, rect.y - 3, rect.w + 6, rect.h + 6);
    ctx.fillStyle = stone;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.fillStyle = layout.team === 0 ? 'rgba(40,90,180,0.28)' : 'rgba(180,60,60,0.28)';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

    ctx.strokeStyle = layout.team === 0 ? 'rgba(120,180,255,0.8)' : 'rgba(255,140,120,0.8)';
    ctx.lineWidth = 3;
    ctx.strokeRect(rect.x + 1.5, rect.y + 1.5, rect.w - 3, rect.h - 3);
  }

  // --- arena border --------------------------------------------------------
  const border = texturePattern(ctx, 'stone');
  ctx.fillStyle = border;
  const top = tileToLogical(0, GRID_H, viewTeam).y;
  const bottom = tileToLogical(0, 0, viewTeam).y;
  ctx.fillRect(0, Math.min(top, bottom) - 10, LOGICAL_W, 10);
  ctx.fillRect(0, Math.max(top, bottom), LOGICAL_W, 10);
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fillRect(0, Math.min(top, bottom) - 10, LOGICAL_W, 3);
  ctx.fillRect(0, Math.max(top, bottom) + 7, LOGICAL_W, 3);

  // Vignette, so the eye settles on the middle of the board.
  const vignette = ctx.createRadialGradient(
    LOGICAL_W / 2,
    FIELD_TOP + FIELD_HEIGHT / 2,
    FIELD_HEIGHT * 0.28,
    LOGICAL_W / 2,
    FIELD_TOP + FIELD_HEIGHT / 2,
    FIELD_HEIGHT * 0.78,
  );
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.35)');
  ctx.fillStyle = vignette;
  ctx.fillRect(0, FIELD_TOP, LOGICAL_W, FIELD_HEIGHT);

  return canvas;
}

export function drawArena(ctx: CanvasRenderingContext2D, grid: ArenaGrid, viewTeam: Team): void {
  const key = `${grid.version}|${viewTeam}`;
  if (!cached || cached.key !== key) {
    cached = { canvas: buildArenaLayer(grid, viewTeam), key };
  }

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, FIELD_TOP, LOGICAL_W, FIELD_HEIGHT);
  ctx.clip();
  ctx.drawImage(cached.canvas, 0, FIELD_TOP);
  ctx.restore();
}

/** Drop the composited arena — used when the canvas or textures are rebuilt. */
export function invalidateArenaCache(): void {
  cached = null;
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
  ctx.globalAlpha = 0.2;
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
  ctx.setLineDash([]);
  ctx.restore();
}
