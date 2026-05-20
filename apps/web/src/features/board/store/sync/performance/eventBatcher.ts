// apps/web/src/features/board/store/sync/performance/eventBatcher.ts
//
// ─── Responsibility ──────────────────────────────────────────────────────────
// Coalesces high-frequency events into batches flushed on rAF boundaries.
// Prevents main-thread saturation from rapid cursor/typing/mutation updates.
//
// Two flush strategies:
//   1. rAF-based (default for UI events) — max 1 flush per animation frame.
//   2. Time-window (for WS egress) — flush every N ms regardless of frames.
//
// Priority lanes:
//   HIGH   — card mutations, list mutations (never dropped)
//   MEDIUM — comments, labels, checklists
//   LOW    — cursor, typing, presence (drop-oldest under backpressure)
//
// ─── Design rules ────────────────────────────────────────────────────────────
//   • No React dependency — pure class.
//   • Deterministic ordering within each priority lane (FIFO).
//   • Backpressure: when LOW lane exceeds capacity, oldest events are dropped.
//   • Observable: flush count, drop count, avg batch size exposed to metrics.
// ─────────────────────────────────────────────────────────────────────────────

import { telemetry } from "../../../devtools/logEvent";

// ============================================================================
// 1.  Types
// ============================================================================

export type EventPriority = "HIGH" | "MEDIUM" | "LOW";

export interface BatchableEvent<T = unknown> {
  readonly id: string;
  readonly priority: EventPriority;
  readonly payload: T;
  readonly timestamp: number;
  /** Optional dedup key — events with same key are coalesced (last-write-wins). */
  readonly coalesceKey?: string;
}

export interface BatcherConfig {
  /** Flush strategy. Default: "raf". */
  readonly flushMode: "raf" | "interval";
  /** Interval ms for "interval" mode. Default: 50. */
  readonly intervalMs: number;
  /** Max events per flush (all lanes combined). Default: 100. */
  readonly maxBatchSize: number;
  /** Max capacity for LOW lane before drop-oldest. Default: 50. */
  readonly lowLaneCapacity: number;
  /** Whether to enable coalescing (same coalesceKey → keep only latest). Default: true. */
  readonly enableCoalescing: boolean;
}

export interface BatchFlushResult<T = unknown> {
  readonly events: readonly BatchableEvent<T>[];
  readonly droppedCount: number;
  readonly coalescedCount: number;
}

export type FlushCallback<T = unknown> = (result: BatchFlushResult<T>) => void;

const DEFAULT_CONFIG: BatcherConfig = {
  flushMode: "raf",
  intervalMs: 50,
  maxBatchSize: 100,
  lowLaneCapacity: 50,
  enableCoalescing: true,
};

// ============================================================================
// 2.  EventBatcher
// ============================================================================

export class EventBatcher<T = unknown> {
  private config: BatcherConfig;
  private readonly callback: FlushCallback<T>;

  // ── Lane queues (FIFO per lane) ────────────────────────────────────────────
  private highQueue: BatchableEvent<T>[] = [];
  private mediumQueue: BatchableEvent<T>[] = [];
  private lowQueue: BatchableEvent<T>[] = [];

  // ── Coalesce index (coalesceKey → latest event in queue) ───────────────────
  private coalesceIndex = new Map<string, BatchableEvent<T>>();

  // ── Scheduling state ───────────────────────────────────────────────────────
  private rafId: number | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private scheduled = false;

  // ── Metrics ────────────────────────────────────────────────────────────────
  private _totalEnqueued = 0;
  private _totalFlushed = 0;
  private _totalDropped = 0;
  private _totalCoalesced = 0;
  private _flushCount = 0;

  constructor(callback: FlushCallback<T>, config: Partial<BatcherConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.callback = callback;
  }

  // ==========================================================================
  // 2a. Lifecycle
  // ==========================================================================

  init(): void {
    if (this.config.flushMode === "interval") {
      this.intervalId = setInterval(() => this._flush(), this.config.intervalMs);
    }
  }

  destroy(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    if (this.intervalId !== null) clearInterval(this.intervalId);
    this.rafId = null;
    this.intervalId = null;
    // Final flush
    this._flush();
  }

  // ==========================================================================
  // 2b. Enqueue
  // ==========================================================================

  enqueue(event: BatchableEvent<T>): void {
    this._totalEnqueued++;

    // ── Coalescing ─────────────────────────────────────────────────────────
    if (this.config.enableCoalescing && event.coalesceKey) {
      const existing = this.coalesceIndex.get(event.coalesceKey);
      if (existing) {
        // Remove existing from its queue (replace with latest)
        this._removeFromQueue(existing);
        this._totalCoalesced++;
      }
      this.coalesceIndex.set(event.coalesceKey, event);
    }

    // ── Insert into priority lane ──────────────────────────────────────────
    switch (event.priority) {
      case "HIGH":
        this.highQueue.push(event);
        break;
      case "MEDIUM":
        this.mediumQueue.push(event);
        break;
      case "LOW":
        // Backpressure: drop oldest if over capacity
        if (this.lowQueue.length >= this.config.lowLaneCapacity) {
          const dropped = this.lowQueue.shift()!;
          this._totalDropped++;
          if (dropped.coalesceKey) this.coalesceIndex.delete(dropped.coalesceKey);
          telemetry.log("STORE", "BATCHER_LOW_LANE_DROP", {
            droppedId: dropped.id,
            queueSize: this.lowQueue.length,
          });
        }
        this.lowQueue.push(event);
        break;
    }

    // ── Schedule flush ─────────────────────────────────────────────────────
    this._scheduleFlush();
  }

  // ==========================================================================
  // 2c. Manual flush (for testing or forced drain)
  // ==========================================================================

  flush(): BatchFlushResult<T> {
    return this._flush();
  }

  // ==========================================================================
  // 2d. Metrics / observability
  // ==========================================================================

  get stats() {
    return {
      totalEnqueued: this._totalEnqueued,
      totalFlushed: this._totalFlushed,
      totalDropped: this._totalDropped,
      totalCoalesced: this._totalCoalesced,
      flushCount: this._flushCount,
      avgBatchSize: this._flushCount > 0 ? this._totalFlushed / this._flushCount : 0,
      currentQueueSize: this.highQueue.length + this.mediumQueue.length + this.lowQueue.length,
    };
  }

  // ==========================================================================
  // 2e. Internal — flush
  // ==========================================================================

  private _flush(): BatchFlushResult<T> {
    this.scheduled = false;

    // Drain all lanes in priority order, up to maxBatchSize.
    const batch: BatchableEvent<T>[] = [];
    const max = this.config.maxBatchSize;

    // HIGH first (never dropped, never limited)
    while (this.highQueue.length > 0 && batch.length < max) {
      batch.push(this.highQueue.shift()!);
    }
    // Then MEDIUM
    while (this.mediumQueue.length > 0 && batch.length < max) {
      batch.push(this.mediumQueue.shift()!);
    }
    // Then LOW
    while (this.lowQueue.length > 0 && batch.length < max) {
      batch.push(this.lowQueue.shift()!);
    }

    // Clean coalesce index for flushed events.
    for (const event of batch) {
      if (event.coalesceKey) this.coalesceIndex.delete(event.coalesceKey);
    }

    const result: BatchFlushResult<T> = {
      events: batch,
      droppedCount: this._totalDropped,
      coalescedCount: this._totalCoalesced,
    };

    if (batch.length > 0) {
      this._totalFlushed += batch.length;
      this._flushCount++;
      this.callback(result);
    }

    return result;
  }

  // ==========================================================================
  // 2f. Internal — scheduling
  // ==========================================================================

  private _scheduleFlush(): void {
    if (this.scheduled) return;
    this.scheduled = true;

    if (this.config.flushMode === "raf") {
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        this._flush();
      });
    }
    // "interval" mode relies on setInterval — no manual scheduling needed.
  }

  // ==========================================================================
  // 2g. Internal — remove from queue (for coalescing)
  // ==========================================================================

  private _removeFromQueue(event: BatchableEvent<T>): void {
    // Remove from whichever lane contains it (linear scan — small queues).
    const removeFrom = (q: BatchableEvent<T>[]) => {
      const idx = q.indexOf(event);
      if (idx !== -1) { q.splice(idx, 1); return true; }
      return false;
    };
    if (removeFrom(this.highQueue)) return;
    if (removeFrom(this.mediumQueue)) return;
    removeFrom(this.lowQueue);
  }
}
