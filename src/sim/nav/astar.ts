/**
 * A* over the tile grid.
 *
 * The six tower goals are served by flow fields, which is the overwhelming
 * majority of navigation. This is the fallback for goals that aren't one of
 * those six — a unit chasing a placed building, or a targeted troop that has
 * wandered off the field's reachable set.
 *
 * The heuristic is the octile distance under the same 10/14 step costs used by
 * the flow field, so it is admissible and the two systems agree on what a
 * "short" path is.
 */

import { CellHeap } from './cellHeap';
import {
  type ArenaGrid,
  CELL_COUNT,
  cellIndex,
  cellX,
  cellY,
  inBounds,
  isWalkable,
} from './grid';

const COST_CARDINAL = 10;
const COST_DIAGONAL = 14;

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

function octile(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.abs(ax - bx);
  const dy = Math.abs(ay - by);
  return COST_CARDINAL * (dx + dy) + (COST_DIAGONAL - 2 * COST_CARDINAL) * Math.min(dx, dy);
}

/**
 * Find a tile path from start to goal. Returns cell indices from the first
 * step after `start` through `goal` inclusive, or an empty array if no path
 * exists. The goal tile itself may be blocked (a building being attacked), in
 * which case the path ends on the nearest reachable neighbour of it.
 */
export function findPath(
  grid: ArenaGrid,
  startX: number,
  startY: number,
  goalX: number,
  goalY: number,
  flying = false,
): number[] {
  if (!inBounds(startX, startY) || !inBounds(goalX, goalY)) return [];

  const start = cellIndex(startX, startY);
  const goal = cellIndex(goalX, goalY);
  if (start === goal) return [];

  const goalBlocked = !isWalkable(grid, goalX, goalY, flying);

  const gScore = new Int32Array(CELL_COUNT).fill(-1);
  const cameFrom = new Int32Array(CELL_COUNT).fill(-1);
  const closed = new Uint8Array(CELL_COUNT);
  const open = new CellHeap();

  gScore[start] = 0;
  open.push(start, octile(startX, startY, goalX, goalY));

  let reached = -1;

  while (open.size > 0) {
    const current = open.pop();
    if (closed[current]) continue;
    closed[current] = 1;

    if (current === goal) {
      reached = current;
      break;
    }

    const x = cellX(current);
    const y = cellY(current);

    // When the goal is a blocked structure, standing next to it is arrival.
    if (goalBlocked && Math.abs(x - goalX) <= 1 && Math.abs(y - goalY) <= 1) {
      reached = current;
      break;
    }

    for (const [dx, dy, step] of NEIGHBOURS) {
      const nx = x + dx;
      const ny = y + dy;
      if (!isWalkable(grid, nx, ny, flying)) continue;
      if (dx !== 0 && dy !== 0) {
        if (!isWalkable(grid, x + dx, y, flying)) continue;
        if (!isWalkable(grid, x, y + dy, flying)) continue;
      }
      const neighbour = cellIndex(nx, ny);
      if (closed[neighbour]) continue;
      const tentative = gScore[current] + step;
      if (gScore[neighbour] !== -1 && gScore[neighbour] <= tentative) continue;
      gScore[neighbour] = tentative;
      cameFrom[neighbour] = current;
      open.push(neighbour, tentative + octile(nx, ny, goalX, goalY));
    }
  }

  if (reached === -1) return [];

  const path: number[] = [];
  for (let cell = reached; cell !== -1 && cell !== start; cell = cameFrom[cell]) {
    path.push(cell);
  }
  path.reverse();
  return path;
}
