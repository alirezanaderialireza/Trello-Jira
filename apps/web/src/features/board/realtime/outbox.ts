// apps/web/src/features/board/realtime/outbox.ts
//
// Phase-1.1 — OutboxProcessor
//
// Manages the local queue of optimistic mutations that need to be sent to,
// and confirmed by, the server.
//
// Responsibilities:
//   • Queue mutations before sending
//   • Retry with exponential backoff on failure
//   • Mark as acked when server confirms via SERVER_ACK
//   • Move to Dead-Letter Queue (DLQ) after maxRetries exceeded
//   • Detect and handle poison mutations (always-failing events)
//   • Rollback optimistic state when a mutation fails permanently
//
// Does NOT:
//   • Own the WebSocket — uses a SendFn callback
//   • Touch Zustand directly — uses callbacks for store interaction
//   • Know about domain event types

import type { BoardSnapshot } from "../store/useBoardStore";

// ============================================================================
// Types
// ============================================================================

export type OutboxItemStatus =
  | "queued"     // waiting to be sent
  | "sending"    // sent, waiting for ACK
  | "acked"      // server confirmed
  | "failed"     // permanent failure → in DLQ
  | "poison";    // maxRetries exceeded → dead-lettered

export interface OutboxItem {
  /** Client-generated idempotency key (UUID) */
  readonly mutationId:     string;
  /** Correlation id for WS reconciliation */
  readonly correlationId:  string;
  /** Serialised payload for the WS MUTATION message */
  readonly payload:        unknown;
  /** Board scope */
  readonly boardId:        string;

  /** Current state of this mutation */
  status:        OutboxItemStatus;
  /** How many times we've attempted to send this */
  retryCount:    number;
  /** When to next attempt (epoch ms) — undefined means "send immediately" */
  nextRetryAt?:  number;
  /** When this item was added to the queue */
  createdAt:     number;
  /** Most recent error message */
  lastError?:    string;

  /**
   * Snapshot to restore if this mutation fails permanently.
   * Captured at the moment the mutation was enqueued.
   */
  rollbackSnapshot?: BoardSnapshot;
}

export interface DLQItem {
  item:      OutboxItem;
  failedAt:  number;
  reason:    string;
}

export interface OutboxConfig {
  /** Max send attempts before declaring a mutation poison (default 5) */
  maxRetries:          number;
  /** Base delay for exponential backoff in ms (default 1 000) */
  retryBaseMs:         number;
  /** Maximum delay cap in ms (default 30 000) */
  retryMaxMs:          number;
  /** Max items in the outbox before backpressure kicks in (default 200) */
  maxQueueSize:        number;
  /** Max items in the DLQ (oldest entries are dropped first) (default 50) */
  maxDlqSize:          number;
}

export const DEFAULT_OUTBOX_CONFIG: OutboxConfig = {
  maxRetries:   5,
  retryBaseMs:  1_000,
  retryMaxMs:   30_000,
  maxQueueSize: 200,
  maxDlqSize:   50,
};

/**
 * Callback types — injected at construction so OutboxProcessor stays
 * decoupled from Zustand, React, and WebSocket.
 */
export interface OutboxCallbacks {
  /** Send a serialised MUTATION message over the WebSocket */
  send: (payload: unknown) => void;
  /** Roll back optimistic state for a permanently failed mutation */
  rollback: (snapshot: BoardSnapshot, correlationId: string) => void;
  /** Notify the rest of the system that an item was dead-lettered */
  onPoison?: (item: DLQItem) => void;
}

// ============================================================================
// OutboxProcessor
// ============================================================================

export class OutboxProcessor {
  private readonly queue   = new Map<string, OutboxItem>();  // mutationId → item
  private readonly dlq:    DLQItem[] = [];

  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private connected  = false;

  private readonly cfg:       OutboxConfig;
  private readonly callbacks: OutboxCallbacks;

  constructor(callbacks: OutboxCallbacks, cfg: Partial<OutboxConfig> = {}) {
    this.cfg       = { ...DEFAULT_OUTBOX_CONFIG, ...cfg };
    this.callbacks = callbacks;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Enqueue a new mutation.
   * Returns false (backpressure) if the queue is at capacity.
   */
  enqueue(item: Omit<OutboxItem, "status" | "retryCount" | "createdAt">): boolean {
    if (this.queue.size >= this.cfg.maxQueueSize) return false;

    const entry: OutboxItem = {
      ...item,
      status:     "queued",
      retryCount: 0,
      createdAt:  Date.now(),
    };

    this.queue.set(item.mutationId, entry);
    this._tryFlush();
    return true;
  }

  /**
   * Call when a SERVER_ACK arrives.
   * Removes the item from the queue and clears any rollback snapshot.
   */
  ack(mutationId: string): void {
    const item = this.queue.get(mutationId);
    if (!item) return;

    this.queue.set(mutationId, { ...item, status: "acked" });
    this.queue.delete(mutationId);
  }

  /**
   * Call when a SERVER_NACK arrives.
   * If retryable → schedule retry.
   * If not retryable → dead-letter immediately.
   */
  nack(mutationId: string, reason: string, retryable: boolean): void {
    const item = this.queue.get(mutationId);
    if (!item) return;

    if (!retryable || item.retryCount >= this.cfg.maxRetries) {
      this._deadLetter(item, reason);
      return;
    }

    const delay = this._backoff(item.retryCount);
    this.queue.set(mutationId, {
      ...item,
      status:      "queued",
      retryCount:  item.retryCount + 1,
      nextRetryAt: Date.now() + delay,
      lastError:   reason,
    });
  }

  /**
   * Notify the outbox that the WS connection is live.
   * Immediately flushes the queue.
   */
  setConnected(connected: boolean): void {
    this.connected = connected;
    if (connected) this._tryFlush();
  }

  /**
   * Start the periodic flush timer.
   * Call once after construction.
   */
  start(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => this._tryFlush(), 500);
  }

  /**
   * Stop the timer and clear the queue.
   */
  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.queue.clear();
  }

  // ── Inspection ──────────────────────────────────────────────────────────────

  get pendingCount(): number { return this.queue.size; }

  get dlqItems(): ReadonlyArray<DLQItem> { return this.dlq; }

  get isBackpressured(): boolean { return this.queue.size >= this.cfg.maxQueueSize; }

  /**
   * Get all items in "queued" or "sending" state (useful for diagnostics).
   */
  getPending(): OutboxItem[] {
    return [...this.queue.values()].filter(
      (i) => i.status === "queued" || i.status === "sending",
    );
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private _tryFlush(): void {
    if (!this.connected) return;

    const now = Date.now();

    for (const [mutationId, item] of this.queue.entries()) {
      if (item.status !== "queued") continue;
      if (item.nextRetryAt && item.nextRetryAt > now) continue;

      if (item.retryCount >= this.cfg.maxRetries) {
        this._deadLetter(item, item.lastError ?? "max retries exceeded");
        continue;
      }

      try {
        this.callbacks.send(item.payload);
        this.queue.set(mutationId, { ...item, status: "sending" });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "send failed";
        this.nack(mutationId, msg, true);
      }
    }
  }

  private _deadLetter(item: OutboxItem, reason: string): void {
    const dlqItem: DLQItem = {
      item:     { ...item, status: "poison" },
      failedAt: Date.now(),
      reason,
    };

    this.dlq.push(dlqItem);

    // Trim DLQ if over capacity (oldest first)
    while (this.dlq.length > this.cfg.maxDlqSize) {
      this.dlq.shift();
    }

    this.queue.delete(item.mutationId);

    // Rollback optimistic state
    if (item.rollbackSnapshot) {
      this.callbacks.rollback(item.rollbackSnapshot, item.correlationId);
    }

    this.callbacks.onPoison?.(dlqItem);
  }

  private _backoff(attempt: number): number {
    const jitter = Math.random() * 1_000;
    return Math.min(
      this.cfg.retryBaseMs * Math.pow(2, attempt) + jitter,
      this.cfg.retryMaxMs,
    );
  }
}
