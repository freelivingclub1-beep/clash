/**
 * Flow-field navigation.
 *
 * Almost every unit in a match is walking toward one of six fixed goals — each
 * team's two princess towers and its king tower. Running A* per unit for that
 * would be wasteful, so instead each goal gets one Dijkstra sweep over the 576
 * cells of the grid, producing a per-cell step direction. Units then navigate
 * by a single array lookup per tick.
 *
 * Fields are cached against `ArenaGrid.version`, so placing a building or
 * losing a tower invalidates and recomputes them — cheap at this grid size.
 * Dynamic goals that aren't one of the six fall back to `@sim/nav/astar`.
 */

import { GRID_W, GRID_H } from '../constants';
import {
  type ArenaGrid,
  type TileRect,
  CELL_COUNT,
  cellIndex,
  cellX,
  cellY,
  inBounds,
} from './grid';
import { CellHeap } from './cellHeap';

/** Cardinal moves cost 10, diagonals 14 — a 7/5 integer approximation of √2. */
const COST_CARDINAL = 10;
const COST_DIAGONAL = 14;
const UNREACHABLE = -1;

const NEIGHBOURS: ReadonlyArray<readonly [number, number, number]> = [
  [0, -1, COST_CARDINAL],
  [1, 0, COST_CARDINAL],
  [0, 1, COST_CARDINAL],
  [-1, 0, COST_CARDINAL],
  [1, -1, COST_DIAGONAL],
  [1, 1, COST_DIAGONAL],
  [-1, 1, COST_DIAGONAL],
  [-1, -1, COST_DIAGONAL],
];

export interface FlowField {
  /** Integer cost from each cell to the nearest goal cell, or -1. */
  dist: Int32Array;
  /** Step toward the goal from each cell. (0,0) means "arrived or stuck". */
  dirX: Int8Array;
  dirY: Int8Array;
}

/**
 * Whether a ground unit may occupy a cell. Goal cells are exempt: a tower's
 * own footprint seeds the sweep even though it is blocked, so attackers path
 * up to its edge rather than treating it as an obstacle to route around.
 */
function passable(grid: ArenaGrid, tx: number, ty: number, flying: boolean): boolean {
  if (!inBounds(tx, ty)) return false;
  if (flying) return true;
  const i = cellIndex(tx, ty);
  return grid.terrain[i] === 0 && grid.occupancy[i] === 0;
}

export function computeFlowField(
  grid: ArenaGrid,
  goalCells: readonly number[],
  flying = false,
): FlowField {
  const dist = new Int32Array(CELL_COUNT).fill(UNREACHABLE);
  const dirX = new Int8Array(CELL_COUNT);
  const dirY = new Int8Array(CELL_COUNT);
  const heap = new CellHeap();

  for (const cell of goalCells) {
    if (cell < 0 || cell >= CELL_COUNT) continue;
    if (dist[cell] !== UNREACHABLE) continue;
    dist[cell] = 0;
    heap.push(cell, 0);
  }

  while (heap.size > 0) {
    const cell = heap.pop();
    const cost = dist[cell];
    const x = cellX(cell);
    const y = cellY(cell);

    for (const [dx, dy, step] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!passable(grid, nx, ny, flying)) continue;
      // Diagonals may not squeeze between two blocked cells.
      if (dx !== 0 && dy !== 0) {
        if (!passable(grid, x + dx, y, flying)) continue;
        if (!passable(grid, x, y + dy, flying)) continue;
      }
      const next = cellIndex(nx, ny);
      const candidate = cost + step;
      if (dist[next] !== UNREACHABLE && dist[next] <= candidate) continue;
      dist[next] = candidate;
      // The field is built outward from the goal, so the step that improved
      // this cell points back the way we came — i.e. toward the goal.
      dirX[next] = -dx as number;
      dirY[next] = -dy as number;
      heap.push(next, candidate);
    }
  }

  return { dist, dirX, dirY };
}

/** Every cell of a tower footprint, used to seed that tower's field. */
export function rectCells(r: TileRect): number[] {
  const cells: number[] = [];
  for (let ty = r.minY; ty <= r.maxY; ty++) {
    for (let tx = r.minX; tx <= r.maxX; tx++) {
      if (inBounds(tx, ty)) cells.push(cellIndex(tx, ty));
    }
  }
  return cells;
}

export function isReachable(field: FlowField, tx: number, ty: number): boolean {
  if (!inBounds(tx, ty)) return false;
  return field.dist[cellIndex(tx, ty)] !== UNREACHABLE;
}

/**
 * The step direction from a tile, as a unit-ish (dx, dy) in tile space.
 * Returns (0,0) when the cell is a goal or unreachable.
 */
export function flowDirection(field: FlowField, tx: number, ty: number): [number, number] {
  if (!inBounds(tx, ty)) return [0, 0];
  const i = cellIndex(tx, ty);
  return [field.dirX[i], field.dirY[i]];
}

/**
 * Cached flow fields for a match.
 *
 * Keyed by goal identity plus the grid version they were built against, so a
 * tower falling or a building landing transparently forces a rebuild.
 */
export class FlowFieldCache {
  private fields = new Map<string, { version: number; field: FlowField }>();

  constructor(private readonly grid: ArenaGrid) {}

  get(key: string, goalCells: readonly number[], flying = false): FlowField {
    const cached = this.fields.get(key);
    if (cached && cached.version === this.grid.version) return cached.field;
    const field = computeFlowField(this.grid, goalCells, flying);
    this.fields.set(key, { version: this.grid.version, field });
    return field;
  }

  /** Drop everything — used when the grid is rebuilt wholesale. */
  clear(): void {
    this.fields.clear();
  }
}

export const GRID_DIMENSIONS = { width: GRID_W, height: GRID_H } as const;
