// apps/web/src/features/board/store/sync/backpressure/priorityQueue.ts
// ─────────────────────────────────────────────────────────────────────────────
// PriorityQueue — bounded multi-lane queue for backpressure management.
//
// Lanes (descending priority):
//   CRITICAL (0) — mutations ACKs, auth events      — unbounded
//   HIGH     (1) — replay events, resync             — max 500
//   MEDIUM   (2) — presence, sequence updates        — max 200
//   LOW      (3) — typing indicators, cursor moves   — max 50
//
// Overflow policy: drop oldest in the overflowed lane (load shedding).
// Consumers call dequeue() to get the next item across all lanes (priority order).
// ─────────────────────────────────────────────────────────────────────────────

export type QueuePriority = 0 | 1 | 2 | 3;
export const PRIORITY = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 } as const;

const LIMITS: Record<QueuePriority, number> = { 0: Infinity, 1: 500, 2: 200, 3: 50 };

export interface QueuedItem<T> {
  priority: QueuePriority;
  item:     T;
  enqueuedAt: number;
}

export interface QueueMetrics {
  depths: Record<QueuePriority, number>;
  dropped: Record<QueuePriority, number>;
  total: number;
}

export class PriorityQueue<T> {
  private readonly lanes: Array<QueuedItem<T>[]> = [[], [], [], []];
  private dropped: Record<QueuePriority, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };

  enqueue(item: T, priority: QueuePriority = PRIORITY.MEDIUM): void {
    const lane  = this.lanes[priority]!;
    const limit = LIMITS[priority];
    if (lane.length >= limit) {
      lane.shift();          // drop oldest (load shedding)
      this.dropped[priority]++;
    }
    lane.push({ priority, item, enqueuedAt: Date.now() });
  }

  /** Returns the highest-priority item available, or null if all empty */
  dequeue(): QueuedItem<T> | null {
    for (let p = 0; p <= 3; p++) {
      const lane = this.lanes[p as QueuePriority]!;
      if (lane.length > 0) return lane.shift()!;
    }
    return null;
  }

  /** Peek without consuming */
  peek(): QueuedItem<T> | null {
    for (let p = 0; p <= 3; p++) {
      if (this.lanes[p as QueuePriority]!.length > 0) return this.lanes[p as QueuePriority]![0]!;
    }
    return null;
  }

  get size(): number { return this.lanes.reduce((s, l) => s + l.length, 0); }

  isEmpty(): boolean { return this.size === 0; }

  metrics(): QueueMetrics {
    return {
      depths:  { 0: this.lanes[0]!.length, 1: this.lanes[1]!.length,
                 2: this.lanes[2]!.length, 3: this.lanes[3]!.length },
      dropped: { ...this.dropped },
      total:   this.size,
    };
  }

  clear(): void { this.lanes.forEach((l) => (l.length = 0)); }
}
