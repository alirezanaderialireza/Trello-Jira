// apps/web/src/features/board/store/sync/backpressure/adaptiveThrottle.ts
// ─────────────────────────────────────────────────────────────────────────────
// AdaptiveThrottle — dynamically adjusts processing rate based on queue lag.
//
// Algorithm:
//   • Compute "lag" = now - item.enqueuedAt for each item processed.
//   • Maintain a rolling average over the last LAG_WINDOW items.
//   • If avg lag > HIGH_LAG_MS  → enter "stressed" mode (drop LOW, throttle MEDIUM).
//   • If avg lag > CRITICAL_LAG_MS → enter "crisis" mode (drop LOW+MEDIUM).
//   • If avg lag < LOW_LAG_MS   → return to "normal" mode.
//
// The throttle exposes shouldProcess(priority) which the scheduler calls
// before dequeuing each item.
// ─────────────────────────────────────────────────────────────────────────────

import type { QueuePriority } from "./priorityQueue";
import { PRIORITY }            from "./priorityQueue";

const LAG_WINDOW       = 20;
const HIGH_LAG_MS      = 200;
const CRITICAL_LAG_MS  = 1_000;
const RECOVERY_LAG_MS  = 50;

export type ThrottleMode = "normal" | "stressed" | "crisis";

export class AdaptiveThrottle {
  private lagSamples: number[] = [];
  private mode: ThrottleMode   = "normal";

  /** Call after processing each item to record its queue lag */
  recordLag(enqueuedAt: number): void {
    const lag = Date.now() - enqueuedAt;
    this.lagSamples.push(lag);
    if (this.lagSamples.length > LAG_WINDOW) this.lagSamples.shift();
    this.updateMode();
  }

  /** Returns false if the item should be skipped (shed load) */
  shouldProcess(priority: QueuePriority): boolean {
    switch (this.mode) {
      case "normal":   return true;
      case "stressed": return priority <= PRIORITY.MEDIUM;  // drop LOW
      case "crisis":   return priority <= PRIORITY.HIGH;    // drop LOW + MEDIUM
    }
  }

  getMode(): ThrottleMode { return this.mode; }

  getAvgLag(): number {
    if (!this.lagSamples.length) return 0;
    return this.lagSamples.reduce((s, v) => s + v, 0) / this.lagSamples.length;
  }

  reset(): void { this.lagSamples = []; this.mode = "normal"; }

  private updateMode(): void {
    const avg = this.getAvgLag();
    if      (avg > CRITICAL_LAG_MS) this.mode = "crisis";
    else if (avg > HIGH_LAG_MS)     this.mode = "stressed";
    else if (avg < RECOVERY_LAG_MS) this.mode = "normal";
  }
}
