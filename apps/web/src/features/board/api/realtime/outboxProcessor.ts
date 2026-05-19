// apps/web/src/features/board/api/realtime/outboxProcessor.ts
//
// ============================================================================
// 📤 OutboxProcessor — Client-side Mutation Delivery Guarantees
// ============================================================================
//
// Architecture:
// ─────────────
// The outbox pattern solves the "sent but not confirmed" window.
// After useOptimisticMutation fires the tRPC call, the result is either:
//   A) ACKed by WS echo   → reconcileIncomingEvent removes from pendingMutations
//   B) HTTP 200 returned  → useOptimisticMutation marks status = "acked"
//   C) HTTP error         → useOptimisticMutation marks status = "failed" + rollback
//   D) Network dropped    → mutation stuck in status = "pending" indefinitely
//
// Case D is the gap this processor fills.
//
// Responsibilities:
//   1. Scan pendingMutations on an interval (SCAN_INTERVAL_MS)
//   2. For "pending" mutations older than PENDING_TIMEOUT_MS → retry
//   3. Retry uses exponential backoff per mutation (via retryCount)
//   4. After MAX_RETRY_ATTEMPTS → move to Dead-Letter Queue (DLQ)
//   5. DLQ entries are never re-attempted automatically; they require
//      user action or session reload
//   6. All transitions are logged via telemetry
//   7. Duplicate-safe: skips mutations already being retried (in-flight set)
//
// What this processor does NOT do:
//   • Re-send WS messages (WS transport handles reconnect + catch-up)
//   • Re-apply optimistic events (already applied by useOptimisticMutation)
//   • Touch the domain event pipeline (reducers are pure)
//   • Block the UI thread (all async, no synchronous loops)
//
// Integration:
//   Mounted via useOutboxProcessor() in BoardPage.
//   Reads/writes useBoardStore.pendingMutations.
//   Calls the provided retryFn for each stale mutation.
// ============================================================================

import type { PendingMutation } from "../../store/useBoardStore";
import { telemetry } from "../../devtools/logEvent";

// ============================================================================
// ⚙️ Configuration
// ============================================================================

export interface OutboxConfig {
  /**
   * How often the processor scans pendingMutations (ms).
   * Default: 5_000 (every 5 s)
   */
  scanIntervalMs: number;

  /**
   * How long a mutation may sit in "pending" before being considered stale
   * and eligible for retry (ms).
   * Default: 8_000 (8 s)
   */
  pendingTimeoutMs: number;

  /**
   * Maximum number of automatic retry attempts before DLQ.
   * Default: 4
   */
  maxRetryAttempts: number;

  /**
   * Backoff base for retry delay: base * 2^retryCount (ms), capped at maxBackoffMs.
   * Default: 1_000
   */
  backoffBaseMs: number;

  /**
   * Maximum backoff cap (ms).
   * Default: 30_000
   */
  maxBackoffMs: number;
}

export const DEFAULT_OUTBOX_CONFIG: OutboxConfig = {
  scanIntervalMs:   5_000,
  pendingTimeoutMs: 8_000,
  maxRetryAttempts: 4,
  backoffBaseMs:    1_000,
  maxBackoffMs:     30_000,
};

// ============================================================================
// 📋 DLQ Entry
// ============================================================================

export interface DeadLetterEntry {
  mutation:   PendingMutation;
  reason:     "max_retries_exhausted" | "retry_threw" | "manual";
  failedAt:   number;
  retryCount: number;
}

// ============================================================================
// 🔁 Retry Function Contract
// ============================================================================

/**
 * The caller (BoardRealtimeClient / BoardPage) provides this function.
 * It is responsible for re-issuing the HTTP mutation for a given correlationId.
 *
 * Returns true if the retry was accepted (HTTP 2xx or will be ACKed via WS).
 * Throws on hard failure (HTTP 4xx that should not be retried).
 */
export type OutboxRetryFn = (mutation: PendingMutation) => Promise<void>;

// ============================================================================
// 📤 OutboxProcessor
// ============================================================================

export class OutboxProcessor {
  private readonly cfg: OutboxConfig;
  private readonly retryFn: OutboxRetryFn;

  /** Fetch current pendingMutations snapshot */
  private readonly getStore:   () => Record<string, PendingMutation>;
  /** Mark a mutation as failed */
  private readonly markFailed: (correlationId: string) => void;
  /** Update retryCount on a mutation */
  private readonly incrementRetry: (correlationId: string) => void;

  /** Mutations currently being retried (in-flight guard) */
  private readonly inFlight = new Set<string>();

  /** Dead-letter queue */
  private readonly dlq: DeadLetterEntry[] = [];

  /** setInterval handle */
  private scanTimerId: ReturnType<typeof setInterval> | null = null;

  constructor(
    cfg: Partial<OutboxConfig>,
    retryFn: OutboxRetryFn,
    storeAccessors: {
      getStore:       () => Record<string, PendingMutation>;
      markFailed:     (correlationId: string) => void;
      incrementRetry: (correlationId: string) => void;
    },
  ) {
    this.cfg         = { ...DEFAULT_OUTBOX_CONFIG, ...cfg };
    this.retryFn     = retryFn;
    this.getStore    = storeAccessors.getStore;
    this.markFailed  = storeAccessors.markFailed;
    this.incrementRetry = storeAccessors.incrementRetry;
  }

  // ==========================================================================
  // ▶️ Start / Stop
  // ==========================================================================

  public start(): void {
    if (this.scanTimerId !== null) return; // already running

    telemetry.log("OUTBOX", "PROCESSOR_STARTED", {
      scanIntervalMs:   this.cfg.scanIntervalMs,
      pendingTimeoutMs: this.cfg.pendingTimeoutMs,
      maxRetryAttempts: this.cfg.maxRetryAttempts,
    });

    this.scanTimerId = setInterval(() => {
      this._scan().catch((err) => {
        // Never crash the interval on an unexpected error.
        telemetry.log("OUTBOX", "SCAN_UNEXPECTED_ERROR", {
          error: String(err),
        });
      });
    }, this.cfg.scanIntervalMs);

    // Run once immediately so stale mutations from a previous session
    // (e.g. after hard refresh during an inflight mutation) are caught fast.
    void this._scan();
  }

  public stop(): void {
    if (this.scanTimerId !== null) {
      clearInterval(this.scanTimerId);
      this.scanTimerId = null;
    }

    this.inFlight.clear();

    telemetry.log("OUTBOX", "PROCESSOR_STOPPED", {
      dlqSize: this.dlq.length,
    });
  }

  // ==========================================================================
  // 📋 DLQ access
  // ==========================================================================

  public get deadLetterQueue(): readonly DeadLetterEntry[] {
    return this.dlq;
  }

  public clearDlq(): void {
    this.dlq.length = 0;
    telemetry.log("OUTBOX", "DLQ_CLEARED", {});
  }

  // ==========================================================================
  // 🔍 Scan
  // ==========================================================================

  private async _scan(): Promise<void> {
    const pending = this.getStore();
    const now     = Date.now();

    for (const [correlationId, mutation] of Object.entries(pending)) {
      // Only process mutations that are stuck in "pending"
      if (mutation.status !== "pending") continue;

      // Skip mutations that are already being retried in this pass
      if (this.inFlight.has(correlationId)) continue;

      const age = now - mutation.createdAt;

      // Not old enough yet — needs to sit for at least pendingTimeoutMs
      // plus its backoff delay
      const backoffDelay = this._backoff(mutation.retryCount);
      const effectiveTimeout = this.cfg.pendingTimeoutMs + backoffDelay;

      if (age < effectiveTimeout) continue;

      // --- Eligible for retry ---

      if (mutation.retryCount >= this.cfg.maxRetryAttempts) {
        this._moveToDlq(mutation, "max_retries_exhausted");
        continue;
      }

      // Fire and forget — no await so concurrent retries are possible
      void this._retry(mutation);
    }
  }

  // ==========================================================================
  // 🔁 Retry
  // ==========================================================================

  private async _retry(mutation: PendingMutation): Promise<void> {
    const { correlationId } = mutation;

    this.inFlight.add(correlationId);

    telemetry.log("OUTBOX", "RETRY_ATTEMPT", {
      correlationId,
      retryCount: mutation.retryCount + 1,
      type: mutation.type,
      aggregateId: mutation.aggregateId,
    });

    try {
      this.incrementRetry(correlationId);
      await this.retryFn(mutation);

      telemetry.log("OUTBOX", "RETRY_ACCEPTED", {
        correlationId,
        type: mutation.type,
      });

      // Success: ACK will be confirmed via WS echo.  We don't remove from
      // pendingMutations here — reconcileIncomingEvent does that on WS ACK.
    } catch (err: any) {
      const isHardFailure =
        err?.data?.httpStatus >= 400 && err?.data?.httpStatus < 500;

      telemetry.log("OUTBOX", isHardFailure ? "RETRY_HARD_FAIL" : "RETRY_SOFT_FAIL", {
        correlationId,
        type:       mutation.type,
        error:      err?.message ?? String(err),
        httpStatus: err?.data?.httpStatus,
      });

      if (isHardFailure) {
        // 4xx errors are non-retriable — move directly to DLQ
        this.markFailed(correlationId);
        this._moveToDlq(mutation, "retry_threw");
      }
      // For soft failures (network errors, 5xx) we let the scan loop retry
      // again next cycle with backoff.
    } finally {
      this.inFlight.delete(correlationId);
    }
  }

  // ==========================================================================
  // 💀 DLQ
  // ==========================================================================

  private _moveToDlq(
    mutation: PendingMutation,
    reason: DeadLetterEntry["reason"],
  ): void {
    // Prevent duplicate DLQ entries if scan runs multiple times quickly
    if (this.dlq.some((e) => e.mutation.correlationId === mutation.correlationId)) {
      return;
    }

    this.markFailed(mutation.correlationId);

    const entry: DeadLetterEntry = {
      mutation,
      reason,
      failedAt:   Date.now(),
      retryCount: mutation.retryCount,
    };

    this.dlq.push(entry);

    telemetry.log("OUTBOX", "MOVED_TO_DLQ", {
      correlationId: mutation.correlationId,
      type:          mutation.type,
      reason,
      retryCount:    mutation.retryCount,
    });
  }

  // ==========================================================================
  // ⏱️ Backoff helper
  // ==========================================================================

  private _backoff(retryCount: number): number {
    return Math.min(
      this.cfg.backoffBaseMs * Math.pow(2, retryCount),
      this.cfg.maxBackoffMs,
    );
  }
}
