// apps/web/src/features/board/store/sync/backpressure/frameBudgetScheduler.ts
// ─────────────────────────────────────────────────────────────────────────────
// FrameBudgetScheduler — processes queued events within per-frame time budget.
//
// Uses requestAnimationFrame (or setImmediate in non-browser environments).
// Each frame: process items from PriorityQueue until FRAME_BUDGET_MS elapsed.
// Remaining items carry over to the next frame — never blocking the main thread.
//
// Integration:
//   scheduler.start()          — begin rAF loop
//   scheduler.enqueue(item, p) — add to priority queue
//   scheduler.stop()           — cancel next frame
// ─────────────────────────────────────────────────────────────────────────────

import { PriorityQueue, PRIORITY } from "./priorityQueue";
import type { QueuePriority }       from "./priorityQueue";
import { AdaptiveThrottle }         from "./adaptiveThrottle";
import { EventCoalescer }           from "./eventCoalescer";

const FRAME_BUDGET_MS = 8;   // ~half a 60 fps frame

export type ItemProcessor<T> = (item: T, priority: QueuePriority) => void;
export type CoalesceKeyFn<T> = (item: T) => string | null;  // null = don't coalesce

export interface FrameSchedulerOptions<T> {
  process:      ItemProcessor<T>;
  coalesceKey?: CoalesceKeyFn<T>;
  frameBudget?: number;
}

export class FrameBudgetScheduler<T> {
  private readonly queue     = new PriorityQueue<T>();
  private readonly throttle  = new AdaptiveThrottle();
  private readonly coalescer: EventCoalescer<T> | null;
  private rafHandle: number | null = null;
  private readonly frameBudget: number;
  private readonly process: ItemProcessor<T>;

  constructor(opts: FrameSchedulerOptions<T>) {
    this.process     = opts.process;
    this.frameBudget = opts.frameBudget ?? FRAME_BUDGET_MS;
    this.coalescer   = opts.coalesceKey
      ? new EventCoalescer<T>((item) => opts.coalesceKey!(item) ?? String(Date.now()))
      : null;
  }

  enqueue(item: T, priority: QueuePriority = PRIORITY.MEDIUM): void {
    if (this.coalescer) {
      const key = (this as any).opts?.coalesceKey?.(item);
      if (key !== null) {
        this.coalescer.add(item);
        return;
      }
    }
    this.queue.enqueue(item, priority);
  }

  start(): void {
    if (this.rafHandle !== null) return;
    this.scheduleFrame();
  }

  stop(): void {
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
  }

  getMetrics() {
    return { queue: this.queue.metrics(), throttle: { mode: this.throttle.getMode(), avgLag: this.throttle.getAvgLag() } };
  }

  private scheduleFrame(): void {
    const raf = typeof requestAnimationFrame !== "undefined"
      ? requestAnimationFrame
      : (cb: FrameRequestCallback) => setTimeout(cb, 16) as unknown as number;
    this.rafHandle = raf(() => this.runFrame());
  }

  private runFrame(): void {
    this.rafHandle = null;
    const deadline = performance.now() + this.frameBudget;

    // Flush coalescer into queue first
    if (this.coalescer && !this.coalescer.isEmpty()) {
      for (const item of this.coalescer.flush()) {
        this.queue.enqueue(item, PRIORITY.LOW);
      }
    }

    while (performance.now() < deadline && !this.queue.isEmpty()) {
      const qi = this.queue.dequeue();
      if (!qi) break;
      if (!this.throttle.shouldProcess(qi.priority)) {
        // Shed: record the drop but don't process
        this.throttle.recordLag(qi.enqueuedAt);
        continue;
      }
      this.throttle.recordLag(qi.enqueuedAt);
      try { this.process(qi.item, qi.priority); } catch { /* isolation */ }
    }

    // Always schedule next frame if there's more work
    if (!this.queue.isEmpty() || (this.coalescer && !this.coalescer.isEmpty())) {
      this.scheduleFrame();
    } else {
      this.scheduleFrame(); // keep loop alive for new arrivals
    }
  }
}
