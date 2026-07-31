/**
 * A binary min-heap over grid cell indices, shared by the flow-field sweep and
 * the A* fallback.
 *
 * Ties are broken by cell index rather than being left to insertion order.
 * Cost alone is not a total order, and letting equal-cost cells pop in
 * whatever sequence they happened to be pushed would make path results depend
 * on entity spawn history — exactly the kind of drift that breaks replay.
 */
export class CellHeap {
  private cells: number[] = [];
  private costs: number[] = [];

  get size(): number {
    return this.cells.length;
  }

  clear(): void {
    this.cells.length = 0;
    this.costs.length = 0;
  }

  push(cell: number, cost: number): void {
    this.cells.push(cell);
    this.costs.push(cost);
    let i = this.cells.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!this.less(i, parent)) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.cells[0];
    const lastCell = this.cells.pop() as number;
    const lastCost = this.costs.pop() as number;
    if (this.cells.length > 0) {
      this.cells[0] = lastCell;
      this.costs[0] = lastCost;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let smallest = i;
        if (l < this.cells.length && this.less(l, smallest)) smallest = l;
        if (r < this.cells.length && this.less(r, smallest)) smallest = r;
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }

  private less(a: number, b: number): boolean {
    if (this.costs[a] !== this.costs[b]) return this.costs[a] < this.costs[b];
    return this.cells[a] < this.cells[b];
  }

  private swap(a: number, b: number): void {
    const c = this.cells[a];
    this.cells[a] = this.cells[b];
    this.cells[b] = c;
    const k = this.costs[a];
    this.costs[a] = this.costs[b];
    this.costs[b] = k;
  }
}
