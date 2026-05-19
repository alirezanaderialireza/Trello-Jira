// apps/web/src/features/board/store/sync/mutationLifecycleManager.ts
// -----------------------------------------------------------------------------
// Centralized Mutation Lifecycle Manager.
//
// Every mutation passes through a strict lifecycle:
//   queued → sent → acknowledged | failed → retried | rolled_back | dead_lettered
//
// Design:
//   - Single source of truth for all in-flight mutations
//   - Explicit status transitions (invalid transitions rejected)
//   - Per-mutation retry logic with exponential backoff + jitter
//   - Dead Letter Queue (DLQ) for poison mutations (max retries exceeded)
//   - Observer pattern for UI status indicators
//   - Deterministic — replay-safe, testable in isolation
//   - Integrates with useBoardStore (restoreSnapshot on rollback)
//   - Integrates with SyncStateMachine (pauses mutations when offline)
// -----------------------------------------------------------------------------

import type { BoardSnapshot } from "../useBoardStore";

// ============================================================================
// Types
// ============================================================================

export type MutationStatus =
  | "queued"
  | "sent"
  | "acknowledged"
  | "failed"
  | "retried"
  | "rolled_back"
  | "dead_lettered";

export interface MutationRecord {
  /** Client-generated correlation ID — unique per mutation attempt */
  correlationId: string;
  /** Domain event type (e.g., "card.moved") */
  eventType: string;
  /** Aggregate being mutated */
  aggregateId: string;
  /** Current lifecycle status */
  status: MutationStatus;
  /** Unix ms when mutation was created */
  createdAt: number;
  /** Unix ms of last status change */
  updatedAt: number;
  /** Number of retry attempts so far */
  retryCount: number;
  /** Max retries before DLQ (default: 3) */
  maxRetries: number;
  /** Optimistic event version for OCC reconciliation */
  optimisticVersion?: number;
  /** Snapshot for rollback on failure */
  rollbackSnapshot?: BoardSnapshot;
  /** Error details from last failure */
  lastError?: MutationError;
  /** Scheduled retry timestamp (null if not scheduled) */
  nextRetryAt: number | null;
}

export interface MutationError {
  code: string;
  message: string;
  retryable: boolean;
  occurredAt: number;
}

// ============================================================================
// Lifecycle Events (status transitions)
// ============================================================================

export type MutationLifecycleEvent =
  | { type: "ENQUEUE"; correlationId: string; eventType: string; aggregateId: string; snapshot?: BoardSnapshot; optimisticVersion?: number; maxRetries?: number }
  | { type: "SEND"; correlationId: string }
  | { type: "ACK"; correlationId: string; serverSequence?: string }
  | { type: "FAIL"; correlationId: string; error: MutationError }
  | { type: "RETRY"; correlationId: string }
  | { type: "ROLLBACK"; correlationId: string; reason: string }
  | { type: "DEAD_LETTER"; correlationId: string; reason: string }
  | { type: "PURGE_COMPLETED"; olderThanMs: number }
  | { type: "PURGE_ALL" };

// ============================================================================
// Valid Transition Table
// ============================================================================

const VALID_TRANSITIONS: Record<MutationStatus, MutationStatus[]> = {
  queued:        ["sent", "rolled_back", "dead_lettered"],
  sent:          ["acknowledged", "failed", "rolled_back"],
  acknowledged:  [], // terminal — can only be purged
  failed:        ["retried", "rolled_back", "dead_lettered"],
  retried:       ["sent", "rolled_back", "dead_lettered"],
  rolled_back:   [], // terminal
  dead_lettered: [], // terminal
};

function isValidTransition(from: MutationStatus, to: MutationStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

// ============================================================================
// Retry Strategy (exponential backoff with jitter)
// ============================================================================

const BASE_RETRY_DELAY_MS = 1000;
const MAX_RETRY_DELAY_MS = 30_000;
const JITTER_FACTOR = 0.3;

export function calculateRetryDelay(retryCount: number): number {
  const exponential = Math.min(
    BASE_RETRY_DELAY_MS * Math.pow(2, retryCount),
    MAX_RETRY_DELAY_MS,
  );
  const jitter = exponential * JITTER_FACTOR * (Math.random() * 2 - 1);
  return Math.round(exponential + jitter);
}

// ============================================================================
// Observer Pattern
// ============================================================================

export type MutationObserver = (
  event: MutationLifecycleEvent,
  record: MutationRecord | null,
  allRecords: ReadonlyMap<string, MutationRecord>,
) => void;

// ============================================================================
// MutationLifecycleManager
// ============================================================================

export class MutationLifecycleManager {
  private mutations: Map<string, MutationRecord> = new Map();
  private deadLetterQueue: MutationRecord[] = [];
  private observers: Set<MutationObserver> = new Set();
  private retryTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  // Callback for executing rollback (injected by store layer)
  private rollbackFn: ((snapshot: BoardSnapshot) => void) | null = null;
  // Callback for re-sending mutation (injected by mutation hooks)
  private resendFn: ((record: MutationRecord) => Promise<void>) | null = null;

  // ==========================================================================
  // Configuration
  // ==========================================================================

  onRollback(fn: (snapshot: BoardSnapshot) => void): void {
    this.rollbackFn = fn;
  }

  onResend(fn: (record: MutationRecord) => Promise<void>): void {
    this.resendFn = fn;
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  dispatch(event: MutationLifecycleEvent): void {
    switch (event.type) {
      case "ENQUEUE":
        this.handleEnqueue(event);
        break;
      case "SEND":
        this.handleSend(event);
        break;
      case "ACK":
        this.handleAck(event);
        break;
      case "FAIL":
        this.handleFail(event);
        break;
      case "RETRY":
        this.handleRetry(event);
        break;
      case "ROLLBACK":
        this.handleRollback(event);
        break;
      case "DEAD_LETTER":
        this.handleDeadLetter(event);
        break;
      case "PURGE_COMPLETED":
        this.handlePurgeCompleted(event);
        break;
      case "PURGE_ALL":
        this.handlePurgeAll();
        break;
    }
  }

  get(correlationId: string): MutationRecord | undefined {
    return this.mutations.get(correlationId);
  }

  getAll(): ReadonlyMap<string, MutationRecord> {
    return this.mutations;
  }

  getPending(): MutationRecord[] {
    return Array.from(this.mutations.values()).filter(
      (m) => m.status === "queued" || m.status === "sent" || m.status === "retried",
    );
  }

  getFailed(): MutationRecord[] {
    return Array.from(this.mutations.values()).filter(
      (m) => m.status === "failed",
    );
  }

  getDeadLetterQueue(): readonly MutationRecord[] {
    return this.deadLetterQueue;
  }

  subscribe(observer: MutationObserver): () => void {
    this.observers.add(observer);
    return () => this.observers.delete(observer);
  }

  destroy(): void {
    for (const timer of this.retryTimers.values()) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();
    this.observers.clear();
    this.mutations.clear();
    this.deadLetterQueue = [];
  }

  // ==========================================================================
  // Stats (for devtools / observability)
  // ==========================================================================

  stats(): {
    total: number;
    queued: number;
    sent: number;
    acknowledged: number;
    failed: number;
    retried: number;
    rolledBack: number;
    deadLettered: number;
  } {
    const all = Array.from(this.mutations.values());
    return {
      total: all.length,
      queued: all.filter((m) => m.status === "queued").length,
      sent: all.filter((m) => m.status === "sent").length,
      acknowledged: all.filter((m) => m.status === "acknowledged").length,
      failed: all.filter((m) => m.status === "failed").length,
      retried: all.filter((m) => m.status === "retried").length,
      rolledBack: all.filter((m) => m.status === "rolled_back").length,
      deadLettered: this.deadLetterQueue.length,
    };
  }

  // ==========================================================================
  // Handlers
  // ==========================================================================

  private handleEnqueue(event: Extract<MutationLifecycleEvent, { type: "ENQUEUE" }>): void {
    const record: MutationRecord = {
      correlationId: event.correlationId,
      eventType: event.eventType,
      aggregateId: event.aggregateId,
      status: "queued",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      retryCount: 0,
      maxRetries: event.maxRetries ?? 3,
      optimisticVersion: event.optimisticVersion,
      rollbackSnapshot: event.snapshot,
      nextRetryAt: null,
    };

    this.mutations.set(event.correlationId, record);
    this.notify(event, record);
  }

  private handleSend(event: Extract<MutationLifecycleEvent, { type: "SEND" }>): void {
    const record = this.mutations.get(event.correlationId);
    if (!record) return;

    if (!isValidTransition(record.status, "sent")) {
      this.logInvalidTransition(record, "sent");
      return;
    }

    record.status = "sent";
    record.updatedAt = Date.now();
    this.notify(event, record);
  }

  private handleAck(event: Extract<MutationLifecycleEvent, { type: "ACK" }>): void {
    const record = this.mutations.get(event.correlationId);
    if (!record) return;

    if (!isValidTransition(record.status, "acknowledged")) {
      this.logInvalidTransition(record, "acknowledged");
      return;
    }

    record.status = "acknowledged";
    record.updatedAt = Date.now();
    record.nextRetryAt = null;

    // Clear any pending retry timer
    this.clearRetryTimer(event.correlationId);

    this.notify(event, record);
  }

  private handleFail(event: Extract<MutationLifecycleEvent, { type: "FAIL" }>): void {
    const record = this.mutations.get(event.correlationId);
    if (!record) return;

    if (!isValidTransition(record.status, "failed")) {
      this.logInvalidTransition(record, "failed");
      return;
    }

    record.status = "failed";
    record.updatedAt = Date.now();
    record.lastError = event.error;

    this.notify(event, record);

    // Auto-retry if retryable and under max retries
    if (event.error.retryable && record.retryCount < record.maxRetries) {
      const delay = calculateRetryDelay(record.retryCount);
      record.nextRetryAt = Date.now() + delay;

      const timer = setTimeout(() => {
        this.dispatch({ type: "RETRY", correlationId: event.correlationId });
      }, delay);

      this.retryTimers.set(event.correlationId, timer);
    } else if (!event.error.retryable || record.retryCount >= record.maxRetries) {
      // Non-retryable or max retries exceeded → decide: rollback or DLQ
      if (record.rollbackSnapshot) {
        this.dispatch({
          type: "ROLLBACK",
          correlationId: event.correlationId,
          reason: event.error.retryable
            ? "MAX_RETRIES_EXCEEDED"
            : `NON_RETRYABLE: ${event.error.code}`,
        });
      } else {
        this.dispatch({
          type: "DEAD_LETTER",
          correlationId: event.correlationId,
          reason: event.error.message,
        });
      }
    }
  }

  private handleRetry(event: Extract<MutationLifecycleEvent, { type: "RETRY" }>): void {
    const record = this.mutations.get(event.correlationId);
    if (!record) return;

    if (!isValidTransition(record.status, "retried")) {
      this.logInvalidTransition(record, "retried");
      return;
    }

    record.status = "retried";
    record.retryCount += 1;
    record.updatedAt = Date.now();
    record.nextRetryAt = null;

    this.clearRetryTimer(event.correlationId);
    this.notify(event, record);

    // Re-send the mutation
    if (this.resendFn) {
      this.resendFn(record)
        .then(() => {
          this.dispatch({ type: "SEND", correlationId: event.correlationId });
        })
        .catch((err: any) => {
          this.dispatch({
            type: "FAIL",
            correlationId: event.correlationId,
            error: {
              code: err?.code ?? "RESEND_FAILED",
              message: err?.message ?? "Retry resend failed",
              retryable: true,
              occurredAt: Date.now(),
            },
          });
        });
    }
  }

  private handleRollback(event: Extract<MutationLifecycleEvent, { type: "ROLLBACK" }>): void {
    const record = this.mutations.get(event.correlationId);
    if (!record) return;

    if (!isValidTransition(record.status, "rolled_back")) {
      this.logInvalidTransition(record, "rolled_back");
      return;
    }

    record.status = "rolled_back";
    record.updatedAt = Date.now();
    record.nextRetryAt = null;

    this.clearRetryTimer(event.correlationId);

    // Execute rollback on store
    if (record.rollbackSnapshot && this.rollbackFn) {
      this.rollbackFn(record.rollbackSnapshot);
    }

    this.notify(event, record);
  }

  private handleDeadLetter(event: Extract<MutationLifecycleEvent, { type: "DEAD_LETTER" }>): void {
    const record = this.mutations.get(event.correlationId);
    if (!record) return;

    if (!isValidTransition(record.status, "dead_lettered")) {
      this.logInvalidTransition(record, "dead_lettered");
      return;
    }

    record.status = "dead_lettered";
    record.updatedAt = Date.now();
    record.nextRetryAt = null;

    this.clearRetryTimer(event.correlationId);

    // Move to DLQ
    this.deadLetterQueue.push({ ...record });

    this.notify(event, record);
  }

  private handlePurgeCompleted(event: Extract<MutationLifecycleEvent, { type: "PURGE_COMPLETED" }>): void {
    const cutoff = Date.now() - event.olderThanMs;
    const terminalStatuses: MutationStatus[] = ["acknowledged", "rolled_back"];

    for (const [id, record] of this.mutations) {
      if (terminalStatuses.includes(record.status) && record.updatedAt < cutoff) {
        this.mutations.delete(id);
      }
    }

    this.notify(event, null);
  }

  private handlePurgeAll(): void {
    for (const timer of this.retryTimers.values()) {
      clearTimeout(timer);
    }
    this.retryTimers.clear();
    this.mutations.clear();
    this.deadLetterQueue = [];
    this.notify({ type: "PURGE_ALL" }, null);
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  private notify(event: MutationLifecycleEvent, record: MutationRecord | null): void {
    for (const observer of this.observers) {
      try {
        observer(event, record, this.mutations);
      } catch {
        // Observer failure must not crash lifecycle manager
      }
    }
  }

  private clearRetryTimer(correlationId: string): void {
    const timer = this.retryTimers.get(correlationId);
    if (timer) {
      clearTimeout(timer);
      this.retryTimers.delete(correlationId);
    }
  }

  private logInvalidTransition(record: MutationRecord, targetStatus: MutationStatus): void {
    if (process.env.NODE_ENV === "development") {
      console.warn(
        `[MutationLifecycle] Invalid transition: ${record.status} → ${targetStatus}` +
          ` (correlationId=${record.correlationId})`,
      );
    }
  }
}

// ============================================================================
// Singleton (per board instance — create new for each board load)
// ============================================================================

let _instance: MutationLifecycleManager | null = null;

export function getMutationLifecycleManager(): MutationLifecycleManager {
  if (!_instance) {
    _instance = new MutationLifecycleManager();
  }
  return _instance;
}

export function resetMutationLifecycleManager(): void {
  _instance?.destroy();
  _instance = null;
}
