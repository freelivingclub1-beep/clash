/**
 * The arena grid: 18x32 tiles of walkability.
 *
 * Two masks are kept apart because they change at different rates:
 *   terrain   — the river. Fixed for the whole match, computed once.
 *   occupancy — towers and buildings. Mutates when a tower falls or a
 *               building is placed or decays, and every such change bumps
 *               `version` so flow fields know to recompute.
 *
 * Flying units consult neither mask.
 */

import {
  GRID_W,
  GRID_H,
  RIVER_ROW_LOW,
  RIVER_ROW_HIGH,
  BRIDGE_COLUMNS,
  LANE_SPLIT_X,
  DEPLOY_ROWS_BLUE,
  DEPLOY_ROWS_RED,
  DEPLOY_ROWS_BLUE_EXTENDED_MAX,
  DEPLOY_ROWS_RED_EXTENDED_MIN,
} from '../constants';

export const CELL_COUNT = GRID_W * GRID_H;

/** 0 = blue (defends low Y), 1 = red (defends high Y). */
export type Team = 0 | 1;
export const BLUE: Team = 0;
export const RED: Team = 1;
export const enemyOf = (team: Team): Team => (team === BLUE ? RED : BLUE);

/** Lane 0 sits at low X (screen left), lane 1 at high X. */
export type Lane = 0 | 1;

export interface ArenaGrid {
  /** 1 = river. Never changes during a match. */
  readonly terrain: Uint8Array;
  /** 1 = occupied by a standing tower or building. */
  readonly occupancy: Uint8Array;
  /** Incremented on every occupancy change; flow fields cache against it. */
  version: number;
}

export function cellIndex(tx: number, ty: number): number {
  return ty * GRID_W + tx;
}

export function cellX(index: number): number {
  return index % GRID_W;
}

export function cellY(index: number): number {
  return Math.floor(index / GRID_W);
}

export function inBounds(tx: number, ty: number): boolean {
  return tx >= 0 && tx < GRID_W && ty >= 0 && ty < GRID_H;
}

export function isRiverRow(ty: number): boolean {
  return ty === RIVER_ROW_LOW || ty === RIVER_ROW_HIGH;
}

export function isBridgeColumn(tx: number): boolean {
  return BRIDGE_COLUMNS.includes(tx);
}

export function createArenaGrid(): ArenaGrid {
  const terrain = new Uint8Array(CELL_COUNT);
  for (let ty = 0; ty < GRID_H; ty++) {
    if (!isRiverRow(ty)) continue;
    for (let tx = 0; tx < GRID_W; tx++) {
      // The river blocks every column except where the two bridges cross.
      if (!isBridgeColumn(tx)) terrain[cellIndex(tx, ty)] = 1;
    }
  }
  return { terrain, occupancy: new Uint8Array(CELL_COUNT), version: 1 };
}

/** Ground units are stopped by both masks; flying units by neither. */
export function isWalkable(grid: ArenaGrid, tx: number, ty: number, flying: boolean): boolean {
  if (!inBounds(tx, ty)) return false;
  if (flying) return true;
  const i = cellIndex(tx, ty);
  return grid.terrain[i] === 0 && grid.occupancy[i] === 0;
}

/** True if the tile is water — used by tests and by the renderer's tinting. */
export function isRiverTile(grid: ArenaGrid, tx: number, ty: number): boolean {
  return inBounds(tx, ty) && grid.terrain[cellIndex(tx, ty)] === 1;
}

export function setOccupied(grid: ArenaGrid, rect: TileRect, occupied: boolean): void {
  const value = occupied ? 1 : 0;
  for (let ty = rect.minY; ty <= rect.maxY; ty++) {
    for (let tx = rect.minX; tx <= rect.maxX; tx++) {
      if (inBounds(tx, ty)) grid.occupancy[cellIndex(tx, ty)] = value;
    }
  }
  grid.version++;
}

// ---------------------------------------------------------------------------
// Tower layout
// ---------------------------------------------------------------------------

export interface TileRect {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export type TowerKind = 'king' | 'princess';

export interface TowerLayout {
  kind: TowerKind;
  team: Team;
  /** Princess towers carry a lane; the king tower is central (null). */
  lane: Lane | null;
  footprint: TileRect;
  /** Tile-space center, in whole/half tiles. */
  centerX: number;
  centerY: number;
}

function rect(minX: number, minY: number, maxX: number, maxY: number): TileRect {
  return { minX, minY, maxX, maxY };
}

function layout(kind: TowerKind, team: Team, lane: Lane | null, r: TileRect): TowerLayout {
  return {
    kind,
    team,
    lane,
    footprint: r,
    centerX: (r.minX + r.maxX + 1) / 2,
    centerY: (r.minY + r.maxY + 1) / 2,
  };
}

/**
 * Princess towers are 3x3, king towers 4x4, mirrored across the river.
 * Order is fixed and load-bearing: tower ids index into this array, and those
 * ids appear in match state, so reordering would break replays.
 */
export const TOWER_LAYOUTS: readonly TowerLayout[] = [
  layout('princess', BLUE, 0, rect(2, 5, 4, 7)),
  layout('princess', BLUE, 1, rect(13, 5, 15, 7)),
  layout('king', BLUE, null, rect(7, 1, 10, 4)),
  layout('princess', RED, 0, rect(2, 24, 4, 26)),
  layout('princess', RED, 1, rect(13, 24, 15, 26)),
  layout('king', RED, null, rect(7, 27, 10, 30)),
];

export function towerLayoutIndex(team: Team, kind: TowerKind, lane: Lane | null): number {
  return TOWER_LAYOUTS.findIndex((t) => t.team === team && t.kind === kind && t.lane === lane);
}

/** Which princess tower a unit spawned at `tx` should march toward. */
export function laneForX(tx: number): Lane {
  return tx < LANE_SPLIT_X ? 0 : 1;
}

// ---------------------------------------------------------------------------
// Deployment rules
// ---------------------------------------------------------------------------

export interface DeployRights {
  /** Set for each enemy lane whose princess tower has fallen. */
  laneOpen: [boolean, boolean];
}

/**
 * Deployment is restricted to a player's own half, extending forward into a
 * lane once that lane's enemy princess tower has been destroyed.
 */
export function canDeployAt(
  grid: ArenaGrid,
  team: Team,
  tx: number,
  ty: number,
  rights: DeployRights,
  flying: boolean,
): boolean {
  if (!inBounds(tx, ty)) return false;
  // Nothing may be dropped onto water or onto a standing structure.
  if (!isWalkable(grid, tx, ty, false)) return false;
  if (flying && isRiverTile(grid, tx, ty)) return false;

  const lane = laneForX(tx);
  if (team === BLUE) {
    const maxY = rights.laneOpen[lane] ? DEPLOY_ROWS_BLUE_EXTENDED_MAX : DEPLOY_ROWS_BLUE.max;
    return ty >= DEPLOY_ROWS_BLUE.min && ty <= maxY;
  }
  const minY = rights.laneOpen[lane] ? DEPLOY_ROWS_RED_EXTENDED_MIN : DEPLOY_ROWS_RED.min;
  return ty >= minY && ty <= DEPLOY_ROWS_RED.max;
}
