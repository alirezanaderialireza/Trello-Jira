// apps/web/src/features/board/store/sync/collaboration/mutationAckBridge.ts
//
// ─── Responsibility ──────────────────────────────────────────────────────────
// The MutationAckBridge is the single authoritative tracker of every
// optimistic mutation's lifecycle from creation to final settlement.
//
// It sits between:
//   • useOptimisticMutation (creates mutations, triggers rollback)
//   • reconcileIncomingEvent (receives server ACKs via WS)
//   • BoardStoreState.pendingMutations (the runtime registry)
//   • debugStore / telemetry (observability)
//
// Lifecycle state machine per mutation:
//
//   CREATED
//     │  onMutate() registers mutation
//     ▼
//   OPTIMISTIC_APPLIED
//     │  applyEvent() succeeds in store
//     ├──────────────────────────────► FAILED  (onError: server rejected)
//     │                                  │
//     │                                  ▼
//     │                              ROLLBACK_STARTED
//     │                                  │
//     │                                  ▼
//     │                              ROLLBACK_FINISHED
//     │                                  │
//     │                                  ▼
//     │                              GC_REMOVED
//     │
//     ▼
//   ACKED  (WS event with matching correlationId received)
//     │
//     ▼
//   GC_REMOVED  (gcPendingMutations() clears it after TTL)
//
// ─── What this bridge owns ───────────────────────────────────────────────────
//   • MutationRecord store — extended view of PendingMutation with UI state
//   • transition() — the only path for advancing lifecycle state
//   • onAck()      — called by reconcileIncomingEvent on WS confirmation
//   • onReject()   — called by useOptimisticMutation.onError
//   • onRollbackComplete() — called after restoreSnapshot() finishes
//   • useMutationStatus()  — React hook for per-mutation UI feedback
//   • useAnyPending()      — quick "is anything in flight?" hook
//
// ─── What this bridge does NOT own ──────────────────────────────────────────
//   • It does not call restoreSnapshot() — that stays in useOptimisticMutation.
//   • It does not modify BoardStoreState.cards/lists — pure lifecycle tracking.
//   • It does not own the GC timer — usePendingGC() owns that.
//
// ─── Idempotency ─────────────────────────────────────────────────────────────
//   transition() ignores attempts to move to the same state or to advance
//   a terminal state (ACKED, FAILED, GC_REMOVED).  Safe to call multiple times.
//
// ─── Thread safety ───────────────────────────────────────────────────────────
//   All mutations go through Zustand's atomic set() — no race conditions
//   between WS callbacks and React event handlers.
// ─────────────────────────────────────────────────────────────────────────────

import { create } from "zustand";
import { telemetry } from "@/lib/telemetry/logEvent";
import type { MutationLifecycleState } from "@/lib/telemetry/debugStore";
import {
  useBoardStore,
  type PendingMutation,
  type BoardSnapshot,
} from "../../useBoardStore";

// ============================================================================
// 1.  Public types
// ============================================================================

/** UI-visible status of a single mutation.  Superset of MutationLifecycleState. */
export type MutationStatus =
  | "pending"       // in-flight, optimistic applied, no server response yet
  | "acked"         // server confirmed
  | "failed"        // server rejected, rollback triggered
  | "rolling_back"  // restoreSnapshot() in progress
  | "rolled_back";  // rollback complete, safe to GC

/** Extended record stored in the bridge — richer than PendingMutation. */
export interface MutationRecord {
  readonly correlationId:      string;
  readonly type:               string;
  readonly aggregateId:        string;
  readonly createdAt:          number;
  readonly optimisticVersion?: number;
  readonly rollbackSnapshot?:  BoardSnapshot;

  status:      MutationStatus;
  settledAt?:  number;
  errorCode?:  string;
  retryCount:  number;

  /** Full lifecycle history for observability. */
  readonly history: readonly { readonly status: MutationStatus; readonly at: number }[];
}

/** Message broadcast from server confirming or rejecting a mutation. */
export interface MutationAckMessage {
  readonly kind:          "mutation.ack" | "mutation.reject";
  readonly correlationId: string;
  readonly aggregateId:   string;
  readonly errorCode?:    string;
  /** Server-assigned final version after the mutation was applied. */
  readonly serverVersion?: number;
}

// ============================================================================
// 2.  Internal Zustand store
// ============================================================================

interface AckBridgeStoreState {
  records: Record<string, MutationRecord>;

  _upsert:    (record: MutationRecord) => void;
  _transition:(correlationId: string, next: MutationStatus, extra?: Partial<MutationRecord>) => void;
  _remove:    (correlationId: string) => void;
  _gcSettled: (olderThanMs: number) => void;
}

/** States from which no further transitions are accepted. */
const TERMINAL_STATES = new Set<MutationStatus>(["acked", "rolled_back"]);

const useAckBridgeStore = create<AckBridgeStoreState>()((set, get) => ({
  records: {},

  _upsert: (record) =>
    set((s) => ({
      records: { ...s.records, [record.correlationId]: record },
    })),

  _transition: (correlationId, next, extra = {}) =>
    set((s) => {
      const rec = s.records[correlationId];
      if (!rec) return s;

      // Ignore redundant or illegal transitions.
      if (rec.status === next) return s;
      if (TERMINAL_STATES.has(rec.status)) return s;

      const now     = Date.now();
      const updated: MutationRecord = {
        ...rec,
        ...extra,
        status:     next,
        settledAt:  TERMINAL_STATES.has(next) ? now : rec.settledAt,
        history:    [...rec.history, { status: next, at: now }],
      };

      return { records: { ...s.records, [correlationId]: updated } };
    }),

  _remove: (correlationId) =>
    set((s) => {
      const { [correlationId]: _, ...rest } = s.records;
      return { records: rest };
    }),

  _gcSettled: (olderThanMs) =>
    set((s) => {
      const now  = Date.now();
      const next: Record<string, MutationRecord> = {};
      let changed = false;

      for (const [id, rec] of Object.entries(s.records)) {
        const isSettled  = TERMINAL_STATES.has(rec.status) || rec.status === "rolled_back";
        const isStale    = rec.settledAt != null && now - rec.settledAt > olderThanMs;
        if (isSettled && isStale) {
          changed = true;
          telemetry.log("MUTATION_ACK", "GC_REMOVED", {
            correlationId: id,
            type:          rec.type,
            status:        rec.status,
          });
        } else {
          next[id] = rec;
        }
      }

      return changed ? { records: next } : s;
    }),
}));

// ============================================================================
// 3.  State-to-LifecycleState mapping (bridges to existing debugStore telemetry)
// ============================================================================

const STATUS_TO_LIFECYCLE: Record<MutationStatus, MutationLifecycleState> = {
  pending:      "OPTIMISTIC_APPLIED",
  acked:        "ACKED",
  failed:       "FAILED",
  rolling_back: "ROLLBACK_STARTED",
  rolled_back:  "ROLLBACK_FINISHED",
};

// ============================================================================
// 4.  Constants
// ============================================================================

/** How long after settlement to keep a record before GC removes it. */
const GC_TTL_MS           = 5 * 60 * 1_000;  // 5 minutes
const GC_INTERVAL_MS      = 60_000;           // GC sweep every 60 s

// ============================================================================
// 5.  MutationAckBridge
// ============================================================================

export class MutationAckBridge {
  // ── timers ────────────────────────────────────────────────────────────────
  private gcTimer: ReturnType<typeof setInterval> | null = null;

  // ── public store ──────────────────────────────────────────────────────────
  readonly store = useAckBridgeStore;

  // ==========================================================================
  // 5a. Lifecycle
  // ==========================================================================

  init() {
    this.gcTimer = setInterval(() => {
      useAckBridgeStore.getState()._gcSettled(GC_TTL_MS);
      // Also drive the BoardStore's own GC so both stay in sync.
      useBoardStore.getState().gcPendingMutations();
    }, GC_INTERVAL_MS);

    telemetry.log("MUTATION_ACK", "BRIDGE_INIT", {});
  }

  destroy() {
    if (this.gcTimer) clearInterval(this.gcTimer);
    this.gcTimer = null;
    telemetry.log("MUTATION_ACK", "BRIDGE_DESTROYED", {});
  }

  // ==========================================================================
  // 5b. Registration — called by useOptimisticMutation.onMutate()
  // ==========================================================================

  /**
   * Register a new mutation.  Idempotent — if the correlationId already exists,
   * this is a no-op (handles double-call edge case in React Strict Mode).
   */
  register(mutation: PendingMutation) {
    const existing = useAckBridgeStore.getState().records[mutation.correlationId];
    if (existing) return; // already registered

    const record: MutationRecord = {
      correlationId:     mutation.correlationId,
      type:              mutation.type,
      aggregateId:       mutation.aggregateId,
      createdAt:         mutation.createdAt,
      optimisticVersion: mutation.optimisticVersion,
      rollbackSnapshot:  mutation.rollbackSnapshot,
      status:            "pending",
      retryCount:        mutation.retryCount,
      history:           [{ status: "pending", at: mutation.createdAt }],
    };

    useAckBridgeStore.getState()._upsert(record);

    // Mirror into the existing telemetry system.
    telemetry.mutation(mutation.correlationId, mutation.type, "OPTIMISTIC_APPLIED");

    telemetry.log("MUTATION_ACK", "REGISTERED", {
      correlationId: mutation.correlationId,
      type:          mutation.type,
      aggregateId:   mutation.aggregateId,
    });
  }

  // ==========================================================================
  // 5c. ACK — called by reconcileIncomingEvent when WS confirms the mutation
  // ==========================================================================

  onAck(correlationId: string, serverVersion?: number) {
    const rec = useAckBridgeStore.getState().records[correlationId];
    if (!rec) return; // already GC'd or unknown

    this._transition(correlationId, "acked", { errorCode: undefined });

    // Remove from BoardStore's pending registry — single source of truth.
    useBoardStore.getState().resolvePendingMutation(correlationId);

    telemetry.mutation(correlationId, rec.type, "ACKED");
    telemetry.log("MUTATION_ACK", "ACK_RECEIVED", {
      correlationId,
      type:          rec.type,
      serverVersion: serverVersion ?? "unknown",
      roundTripMs:   Date.now() - rec.createdAt,
    });
  }

  // ==========================================================================
  // 5d. Reject — called by useOptimisticMutation.onError()
  // ==========================================================================

  onReject(correlationId: string, errorCode?: string) {
    const rec = useAckBridgeStore.getState().records[correlationId];
    if (!rec) return;

    this._transition(correlationId, "failed", { errorCode });

    // Mark the BoardStore mutation as failed (keeps snapshot alive for rollback).
    useBoardStore.getState().updatePendingMutationStatus(correlationId, "failed");

    telemetry.mutation(correlationId, rec.type, "FAILED");
    telemetry.log("MUTATION_ACK", "REJECT_RECEIVED", {
      correlationId,
      type:      rec.type,
      errorCode: errorCode ?? "UNKNOWN",
    });
  }

  // ==========================================================================
  // 5e. Rollback lifecycle — called by useOptimisticMutation around restoreSnapshot
  // ==========================================================================

  onRollbackStart(correlationId: string) {
    const rec = useAckBridgeStore.getState().records[correlationId];
    if (!rec || rec.status !== "failed") return;

    this._transition(correlationId, "rolling_back");

    telemetry.mutation(correlationId, rec.type, "ROLLBACK_STARTED");
    telemetry.log("MUTATION_ACK", "ROLLBACK_STARTED", {
      correlationId,
      type: rec.type,
      snapshotPresent: !!rec.rollbackSnapshot,
    });
  }

  onRollbackComplete(correlationId: string) {
    const rec = useAckBridgeStore.getState().records[correlationId];
    if (!rec) return;

    this._transition(correlationId, "rolled_back");

    // Remove from BoardStore registry — mutation is fully settled.
    useBoardStore.getState().resolvePendingMutation(correlationId);

    telemetry.mutation(correlationId, rec.type, "ROLLBACK_FINISHED");
    telemetry.log("MUTATION_ACK", "ROLLBACK_COMPLETE", {
      correlationId,
      type:        rec.type,
      totalTimeMs: Date.now() - rec.createdAt,
    });
  }

  // ==========================================================================
  // 5f. Retry — optional: increment retryCount and reset to pending
  // ==========================================================================

  /**
   * Re-register a mutation for retry after a transient failure.
   * Only valid from "failed" state — terminal states cannot be retried.
   */
  onRetry(correlationId: string) {
    const rec = useAckBridgeStore.getState().records[correlationId];
    if (!rec || rec.status !== "failed") return;

    const updated: Partial<MutationRecord> = {
      retryCount: rec.retryCount + 1,
      errorCode:  undefined,
    };

    this._transition(correlationId, "pending", updated);

    useBoardStore.getState().updatePendingMutationStatus(correlationId, "pending");

    telemetry.log("MUTATION_ACK", "RETRY_SCHEDULED", {
      correlationId,
      retryCount: updated.retryCount,
    });
  }

  // ==========================================================================
  // 5g. Server-push ACK/reject messages (direct WS path)
  // ==========================================================================

  /**
   * Called by BoardSocketClient when it receives a dedicated mutation ack
   * message (separate from the domain event stream).
   * This is the direct fast-path — bypasses reconcileIncomingEvent.
   */
  applyAckMessage(msg: MutationAckMessage) {
    if (msg.kind === "mutation.ack") {
      this.onAck(msg.correlationId, msg.serverVersion);
    } else {
      this.onReject(msg.correlationId, msg.errorCode);
    }
  }

  // ==========================================================================
  // 5h. Query helpers (synchronous)
  // ==========================================================================

  getStatus(correlationId: string): MutationStatus | null {
    return useAckBridgeStore.getState().records[correlationId]?.status ?? null;
  }

  getRecord(correlationId: string): MutationRecord | null {
    return useAckBridgeStore.getState().records[correlationId] ?? null;
  }

  /** Returns all mutations currently in a non-terminal, non-settled state. */
  getPendingRecords(): MutationRecord[] {
    return Object.values(useAckBridgeStore.getState().records).filter(
      (r) => r.status === "pending" || r.status === "rolling_back",
    );
  }

  // ==========================================================================
  // 5i. Internal transition helper
  // ==========================================================================

  private _transition(
    correlationId: string,
    next: MutationStatus,
    extra: Partial<MutationRecord> = {},
  ) {
    useAckBridgeStore.getState()._transition(correlationId, next, extra);

    // Keep existing telemetry debugStore in sync.
    const rec = useAckBridgeStore.getState().records[correlationId];
    if (rec) {
      telemetry.mutation(correlationId, rec.type, STATUS_TO_LIFECYCLE[next]);
    }
  }
}

// ============================================================================
// 6.  React hooks
// ============================================================================

/**
 * Returns the live MutationStatus for a single correlationId.
 * Returns null if the record has been GC'd or was never registered.
 */
export function useMutationStatus(correlationId: string): MutationStatus | null {
  return useAckBridgeStore((s) => s.records[correlationId]?.status ?? null);
}

/**
 * Returns the full MutationRecord for a single correlationId.
 * Useful for rendering error details, retry buttons, etc.
 */
export function useMutationRecord(correlationId: string): MutationRecord | null {
  return useAckBridgeStore((s) => s.records[correlationId] ?? null);
}

/**
 * Returns true if there are any mutations currently pending (in-flight or
 * rolling back).  Use for top-level "saving…" indicators.
 */
export function useAnyPending(): boolean {
  return useAckBridgeStore((s) =>
    Object.values(s.records).some(
      (r) => r.status === "pending" || r.status === "rolling_back",
    ),
  );
}

/**
 * Returns the count of mutations in each lifecycle bucket.
 * Useful for observability dashboards or debug overlays.
 */
export function useMutationStats(): Record<MutationStatus, number> {
  return useAckBridgeStore((s) => {
    const counts: Record<MutationStatus, number> = {
      pending:      0,
      acked:        0,
      failed:       0,
      rolling_back: 0,
      rolled_back:  0,
    };
    for (const rec of Object.values(s.records)) {
      counts[rec.status] = (counts[rec.status] ?? 0) + 1;
    }
    return counts;
  });
}

/**
 * Returns all mutations that are currently in the "failed" state and have
 * not yet started rolling back.  Use to render a "retry / dismiss" UI.
 */
export function useFailedMutations(): MutationRecord[] {
  return useAckBridgeStore((s) =>
    Object.values(s.records).filter((r) => r.status === "failed"),
  );
}
