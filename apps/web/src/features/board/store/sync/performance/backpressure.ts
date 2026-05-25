// apps/web/src/features/board/store/sync/performance/backpressure.ts
//
// ─── Responsibility ──────────────────────────────────────────────────────────
// Adaptive flow control for the event pipeline.
// Monitors main-thread frame budget and applies throttling dynamically.
//
// Modes:
//   NORMAL       — all events processed immediately.
//   THROTTLED    — LOW priority events deferred / coalesced more aggressively.
//   SHEDDING     — LOW events dropped, MEDIUM deferred, only HIGH pass through.
//
// Transitions are based on frame-budget utilization:
//   utilization < 60%  → NORMAL
//   60% ≤ util < 85%   → THROTTLED
//   util ≥ 85%         → SHEDDING
//
// The controller runs a sampling loop every N frames, measures long-task
// duration, and adjusts the mode accordingly.
// ─────────────────────────────────────────────────────────────────────────────

import { telemetry } from "@/lib/telemetry/logEvent";

// ============================================================================
// 1.  Types
// ============================================================================

export type BackpressureMode = "NORMAL" | "THROTTLED" | "SHEDDING";

export interface BackpressureConfig {
  /** Target frame budget in ms. Default: 16 (60fps). */
  readonly frameBudgetMs: number;
  /** Sampling interval (frames). Default: 10. */
  readonly sampleEveryFrames: number;
  /** Threshold to enter THROTTLED mode. Default: 0.6. */
  readonly throttleThreshold: number;
  /** Threshold to enter SHEDDING mode. Default: 0.85. */
  readonly sheddingThreshold: number;
  /** Cooldown frames before mode can change again. Default: 5. */
  readonly cooldownFrames: number;
}

export interface BackpressureSnapshot {
  readonly mode: BackpressureMode;
  readonly utilization: number;
  readonly frameCount: number;
  readonly longTaskCount: number;
}

const DEFAULT_CONFIG: BackpressureConfig = {
  frameBudgetMs: 16,
  sampleEveryFrames: 10,
  throttleThreshold: 0.6,
  sheddingThreshold: 0.85,
  cooldownFrames: 5,
};

// ============================================================================
// 2.  BackpressureController
// ============================================================================

export class BackpressureController {
  private config: BackpressureConfig;
  private _mode: BackpressureMode = "NORMAL";
  private _utilization = 0;
  private _frameCount = 0;
  private _longTaskCount = 0;
  private _lastModeChange = 0;

  // ── Sampling state ─────────────────────────────────────────────────────────
  private rafId: number | null = null;
  private lastFrameTime = 0;
  private frameDurations: number[] = [];
  private _active = false;

  constructor(config: Partial<BackpressureConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ==========================================================================
  // 2a. Lifecycle
  // ==========================================================================

  init(): void {
    this._active = true;
    this.lastFrameTime = performance.now();
    this._scheduleFrame();
  }

  destroy(): void {
    this._active = false;
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  // ==========================================================================
  // 2b. Public API
  // ==========================================================================

  get mode(): BackpressureMode { return this._mode; }
  get utilization(): number { return this._utilization; }

  snapshot(): BackpressureSnapshot {
    return {
      mode: this._mode,
      utilization: this._utilization,
      frameCount: this._frameCount,
      longTaskCount: this._longTaskCount,
    };
  }

  /**
   * Should this event be processed given the current mode?
   * Returns true if the event should pass, false if it should be deferred/dropped.
   */
  shouldProcess(priority: "HIGH" | "MEDIUM" | "LOW"): boolean {
    switch (this._mode) {
      case "NORMAL":
        return true;
      case "THROTTLED":
        return priority !== "LOW";
      case "SHEDDING":
        return priority === "HIGH";
    }
  }

  // ==========================================================================
  // 2c. Internal — frame sampling
  // ==========================================================================

  private _scheduleFrame(): void {
    if (!this._active) return;
    this.rafId = requestAnimationFrame((now) => this._onFrame(now));
  }

  private _onFrame(now: number): void {
    if (!this._active) return;

    const duration = now - this.lastFrameTime;
    this.lastFrameTime = now;
    this._frameCount++;

    this.frameDurations.push(duration);

    if (duration > this.config.frameBudgetMs) {
      this._longTaskCount++;
    }

    // Sample every N frames
    if (this.frameDurations.length >= this.config.sampleEveryFrames) {
      this._evaluate();
      this.frameDurations = [];
    }

    this._scheduleFrame();
  }

  private _evaluate(): void {
    // Average frame duration / budget = utilization
    const avgDuration = this.frameDurations.reduce((a, b) => a + b, 0) / this.frameDurations.length;
    this._utilization = avgDuration / this.config.frameBudgetMs;

    // Cooldown check
    if (this._frameCount - this._lastModeChange < this.config.cooldownFrames) return;

    let nextMode: BackpressureMode;
    if (this._utilization >= this.config.sheddingThreshold) {
      nextMode = "SHEDDING";
    } else if (this._utilization >= this.config.throttleThreshold) {
      nextMode = "THROTTLED";
    } else {
      nextMode = "NORMAL";
    }

    if (nextMode !== this._mode) {
      const prev = this._mode;
      this._mode = nextMode;
      this._lastModeChange = this._frameCount;

      telemetry.log("STORE", "BACKPRESSURE_MODE_CHANGE", {
        from: prev,
        to: nextMode,
        utilization: Math.round(this._utilization * 100) / 100,
        longTaskCount: this._longTaskCount,
      });
    }
  }
}

// ============================================================================
// 3.  Singleton
// ============================================================================

export const backpressure = new BackpressureController();
