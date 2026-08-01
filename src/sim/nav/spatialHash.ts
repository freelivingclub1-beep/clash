/**
 * Uniform spatial hash over the tile grid, rebuilt once per tick.
 *
 * Used for boids separation and for target acquisition, both of which ask
 * "what is near this point" hundreds of times per tick. Storage is an
 * intrusive linked list over two typed arrays rather than an array of arrays,
 * so a rebuild allocates nothing after the first tick.
 *
 * Query results come back in ascending slot order, which for our callers means
 * ascending entity index — a stable, replay-safe ordering.
 */

import { GRID_W, GRID_H } from '../constants';
import { CELL_COUNT, cellIndex, inBounds } from './grid';

export class SpatialHash {
  /** First slot stored in each cell, or -1. */
  private readonly head = new Int32Array(CELL_COUNT).fill(-1);
  /** Next slot in the same cell, or -1. */
  private next: Int32Array;
  private slotCell: Int32Array;
  private count = 0;

  constructor(capacity = 512) {
    this.next = new Int32Array(capacity).fill(-1);
    this.slotCell = new Int32Array(capacity).fill(-1);
  }

  clear(): void {
    // Only the cells actually touched last tick need resetting.
    for (let slot = 0; slot < this.count; slot++) {
      const cell = this.slotCell[slot];
      if (cell >= 0) this.head[cell] = -1;
    }
    this.count = 0;
  }

  private grow(needed: number): void {
    if (needed <= this.next.length) return;
    let size = this.next.length;
    while (size < needed) size *= 2;
    const next = new Int32Array(size).fill(-1);
    const slotCell = new Int32Array(size).fill(-1);
    next.set(this.next);
    slotCell.set(this.slotCell);
    this.next = next;
    this.slotCell = slotCell;
  }

  /**
   * Insert `slot` (an entity index) at a tile. Slots must be inserted in
   * ascending order for queries to come back ascending — callers iterate the
   * entity array in id order, which satisfies this.
   */
  insert(slot: number, tx: number, ty: number): void {
    if (!inBounds(tx, ty)) return;
    this.grow(slot + 1);
    const cell = cellIndex(tx, ty);
    this.next[slot] = this.head[cell];
    this.head[cell] = slot;
    this.slotCell[slot] = cell;
    if (slot + 1 > this.count) this.count = slot + 1;
  }

  /**
   * Append every slot within `radiusTiles` of (tx, ty) to `out`, in ascending
   * slot order. Returns the number appended.
   *
   * This is a broad-phase: the caller still has to test real distances, since
   * a tile bucket is coarser than a circle.
   */
  query(tx: number, ty: number, radiusTiles: number, out: number[]): number {
    const r = Math.max(0, Math.ceil(radiusTiles));
    const minX = Math.max(0, tx - r);
    const maxX = Math.min(GRID_W - 1, tx + r);
    const minY = Math.max(0, ty - r);
    const maxY = Math.min(GRID_H - 1, ty + r);

    const before = out.length;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        for (let slot = this.head[cellIndex(x, y)]; slot !== -1; slot = this.next[slot]) {
          out.push(slot);
        }
      }
    }

    // Buckets are walked in cell order and each bucket is newest-first, so the
    // raw result is unordered. Sorting restores the ascending-slot guarantee
    // the callers rely on for deterministic tie-breaks.
    const added = out.length - before;
    if (added > 1) {
      const tail = out.splice(before, added).sort((a, b) => a - b);
      for (const slot of tail) out.push(slot);
    }
    return added;
  }
}
