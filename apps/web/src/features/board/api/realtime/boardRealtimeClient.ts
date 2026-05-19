// apps/web/src/features/board/api/realtime/boardRealtimeClient.ts
//
// ============================================================================
// 🎯 BoardRealtimeClient — Unified Realtime Facade
// ============================================================================
//
// Responsibility:
// ───────────────
// This class is the single surface area that BoardPage (and any future
// component) touches for all realtime concerns.  It composes:
//
//   BoardSocketClient   transport FSM, heartbeat, epoch, backoff, event batching
//   ClientSyncFSM       data-sync state machine
//   OutboxProcessor     mutation retry queue + DLQ
//
// and drives them as a cohesive unit.
//
// Gaps fixed in this revision:
// ─────────────────────────────
//
// GAP 1 — DLQ observer bridge was broken.
//   _buildOutbox() now passes an onDlqEntry callback to OutboxProcessor so
//   dlq_entry_added is emitted synchronously when _moveToDlq() fires.
//   No polling loop needed.
//
// GAP 2 — Zustand store subscription leak.
//   _wireSubscriptions() now saves the unsubscribe fn returned by
//   useBoardStore.subscribe() and calls it in _unwireSubscriptions().
//   Previously the fn was discarded → subscriptions accumulated on
//   each disconnect()+connect() cycle.
//
// GAP 3 — connect() sent wrong FSM trigger on first call.
//   clientSyncFsm.send("transport_dropped") was called unconditionally,
//   moving the FSM idle→reconnecting before board_hydrated even fires.
//   Fixed: only send "transport_dropped" when the FSM is NOT idle
//   (i.e. a reconnect, not a first connect).
//
// GAP 7 — Dual-write conflict on store syncStatus.
//   boardSocketClient previously wrote syncStatus directly in _openSocket(),
//   _scheduleReconnect(), and SYSTEM/RESYNC_REQUIRED handlers.
//   boardRealtimeClient is now the SINGLE WRITER via the FSM observer.
//   All direct writes removed from boardSocketClient.
//
// GAP 8 — CATCH_UP_MAX_EVENTS buffer overflow left FSM stuck in "resyncing".
//   boardRealtimeClient now fires an "auto_resync" observer event when the
//   FSM enters "resyncing", giving BoardPage a hook to trigger a full reload.
//   An optional onResyncRequired callback in configure() handles this.
//
// What this class does NOT do:
//   • Own domain reducers      (→ event-application/*)
//   • Own Zustand state        (→ useBoardStore)
//   • Own React lifecycle      (→ BoardPage useEffect)
//   • Own tRPC calls           (→ mutation hooks / boardApi)
//
// Multi-tab safety:
// ─────────────────
// Each tab has its own singleton instance (module-level export).
// There is no shared mutable state between tabs — each manages its own WS
// connection, outbox, and sync FSM independently.  Cross-tab consistency is
// achieved via the server broadcasting every committed event to all
// subscribers of that board room.
// ============================================================================

import { boardSocket }         from "./boardSocketClient";
import { clientSyncFsm }       from "./clientSyncFsm";
import { OutboxProcessor }     from "./outboxProcessor";
import { useBoardStore }        from "../../store/useBoardStore";
import { telemetry }            from "../../devtools/logEvent";

import type { ConnectionEvent, ConnectionMetrics } from "./connectionFsm";
import type { SyncStateChangeEvent, ClientSyncState } from "./clientSyncFsm";
import type { OutboxConfig, DeadLetterEntry }        from "./outboxProcessor";
import type { PendingMutation }                      from "../../store/useBoardStore";

// ============================================================================
// 📣 Unified Observable Event
// ============================================================================

export type RealtimeClientEvent =
  | { type: "transport_changed";  metrics: ConnectionMetrics }
  | { type: "sync_state_changed"; event: SyncStateChangeEvent }
  | { type: "resync_required";    reason: string }
  | { type: "reconnect_failed";   attempts: number }
  | { type: "dlq_entry_added";    entry: DeadLetterEntry }
  /** GAP 8: emitted when FSM enters "resyncing" so BoardPage can reload */
  | { type: "auto_resync_required"; reason: "buffer_overflow" | "server_ordered" };

// ============================================================================
// 📊 Unified Metrics Snapshot
// ============================================================================

export interface RealtimeClientMetrics {
  transport:   ConnectionMetrics;
  syncState:   ClientSyncState;
  gapCount:    number;
  resyncCount: number;
  dlqSize:     number;
}

// ============================================================================
// ⚙️ Config
// ============================================================================

export interface BoardRealtimeClientConfig {
  outbox?: Partial<OutboxConfig>;
  /**
   * retryFn — called by OutboxProcessor when a pending mutation is stale.
   * Must re-issue the HTTP call for the given mutation.
   * Defaults to a no-op stub; callers MUST inject the real boardApi method.
   */
  retryFn?: (mutation: PendingMutation) => Promise<void>;
  /**
   * GAP 8: called when the realtime engine determines a full board resync
   * is required (buffer overflow ≥ 200 events or server RESYNC_REQUIRED).
   * BoardPage should call window.location.reload() or re-fetch board data.
   */
  onResyncRequired?: (reason: "buffer_overflow" | "server_ordered") => void;
}

// ============================================================================
// 🎯 BoardRealtimeClient
// ============================================================================

class BoardRealtimeClient {
  private readonly _observers = new Set<(e: RealtimeClientEvent) => void>();
  private _outbox: OutboxProcessor | null = null;
  private _retryFn: (mutation: PendingMutation) => Promise<void>;

  // GAP 8: callback for auto-resync
  private _onResyncRequired: ((reason: "buffer_overflow" | "server_ordered") => void) | undefined;

  // Unsubscribe handles for child subscriptions
  private _unsubTransport:   (() => void) | null = null;
  private _unsubSyncFsm:     (() => void) | null = null;
  // GAP 2 FIX: save the Zustand unsubscribe fn so we don't leak on reconnect
  private _unsubStore:       (() => void) | null = null;

  constructor() {
    // Default retry fn: no-op stub.  Real callers inject via configure().
    this._retryFn = async (_mutation: PendingMutation) => {
      if (process.env.NODE_ENV === "development") {
        console.warn(
          "[BoardRealtimeClient] No retryFn configured. " +
          "Inject via boardRealtimeClient.configure({ retryFn }).",
        );
      }
    };
  }

  // ==========================================================================
  // ⚙️ Configuration (call once at app bootstrap, before connect)
  // ==========================================================================

  public configure(cfg: BoardRealtimeClientConfig): void {
    if (cfg.retryFn) {
      this._retryFn = cfg.retryFn;
    }

    // GAP 8: wire resync callback
    if (cfg.onResyncRequired) {
      this._onResyncRequired = cfg.onResyncRequired;
    }

    // Re-create outbox with new config if already running
    if (this._outbox) {
      this._outbox.stop();
      this._outbox = null;
    }

    this._outbox = this._buildOutbox(cfg.outbox ?? {});
  }

  // ==========================================================================
  // 🔌 Connection Lifecycle
  // ==========================================================================

  /**
   * Connect to a board room.
   * Idempotent for the same boardId.
   */
  public connect(boardId: string, token?: string): void {
    telemetry.log("REALTIME_CLIENT", "CONNECT_REQUESTED", { boardId });

    // Wire child subscriptions on first connect
    this._wireSubscriptions();

    // Start outbox processor
    this._ensureOutbox().start();

    // Drive transport
    boardSocket.connect(boardId, token);

    // GAP 3 FIX: only send "transport_dropped" on *reconnect* (FSM not idle).
    // On first connect the FSM is in "idle" — sending transport_dropped would
    // move it to "reconnecting" before board_hydrated fires, which is
    // semantically wrong and produces a spurious "reconnecting" flash in UI.
    // board_hydrated is fired separately by notifyBoardHydrated() after initBoard().
    if (clientSyncFsm.state !== "idle") {
      clientSyncFsm.send("transport_dropped");
    }
  }

  /**
   * Disconnect and stop all background processors.
   * Call in React useEffect cleanup.
   */
  public disconnect(): void {
    telemetry.log("REALTIME_CLIENT", "DISCONNECT_REQUESTED", {});

    boardSocket.disconnect();
    this._ensureOutbox().stop();
    this._unwireSubscriptions();

    clientSyncFsm.send("board_closed");
  }

  /**
   * Notify the FSM that the board has been hydrated.
   * Call after initBoard() completes.
   */
  public notifyBoardHydrated(): void {
    clientSyncFsm.send("board_hydrated");
  }

  /**
   * Manual reconnect triggered by the user (e.g., "Retry" button).
   */
  public triggerManualReconnect(boardId: string, token?: string): void {
    telemetry.log("REALTIME_CLIENT", "MANUAL_RECONNECT", { boardId });
    clientSyncFsm.send("manual_reconnect");
    boardSocket.connect(boardId, token);
  }

  // ==========================================================================
  // 📊 Observable surface
  // ==========================================================================

  public get metrics(): RealtimeClientMetrics {
    const fsmMetrics = clientSyncFsm.metrics;
    return {
      transport:   boardSocket.metrics,
      syncState:   fsmMetrics.state,
      gapCount:    fsmMetrics.gapCount,
      resyncCount: fsmMetrics.resyncCount,
      dlqSize:     this._outbox?.deadLetterQueue.length ?? 0,
    };
  }

  public subscribe(cb: (e: RealtimeClientEvent) => void): () => void {
    this._observers.add(cb);
    return () => this._observers.delete(cb);
  }

  public get deadLetterQueue(): readonly DeadLetterEntry[] {
    return this._outbox?.deadLetterQueue ?? [];
  }

  public clearDlq(): void {
    this._outbox?.clearDlq();
  }

  // ==========================================================================
  // 🔧 Internal — Subscriptions
  // ==========================================================================

  private _wireSubscriptions(): void {
    // Idempotent — only wire once per connect() call
    if (this._unsubTransport) return;

    // ── Transport FSM events → Sync FSM triggers ──────────────────────────
    this._unsubTransport = boardSocket.subscribe((e: ConnectionEvent) => {
      switch (e.type) {
        case "state_changed":
          if (e.state === "connected") {
            clientSyncFsm.send("ws_connected");
          }
          if (e.state === "reconnecting" || e.state === "connecting") {
            clientSyncFsm.send("transport_dropped");
          }
          if (e.state === "terminal") {
            clientSyncFsm.send("transport_terminal");
          }
          this._emit({ type: "transport_changed", metrics: boardSocket.metrics });
          break;

        case "metrics_updated":
          this._emit({ type: "transport_changed", metrics: e.metrics });
          break;

        case "resync_required":
          clientSyncFsm.send("resync_required");
          this._emit({ type: "resync_required", reason: e.reason });
          break;

        case "reconnect_failed":
          this._emit({ type: "reconnect_failed", attempts: e.attempts });
          break;
      }
    });

    // ── Sync FSM transitions → single store writer (GAP 7) ───────────────
    //
    // boardRealtimeClient is the SOLE writer of useBoardStore.syncStatus.
    // All direct useBoardStore.setState({ syncStatus }) calls have been
    // removed from boardSocketClient.
    this._unsubSyncFsm = clientSyncFsm.subscribe((e: SyncStateChangeEvent) => {
      // Derive legacy SyncStatus from the new FSM state and write it once.
      const legacyStatus = clientSyncFsm.metrics.legacySyncStatus;
      const currentStoreStatus = useBoardStore.getState().syncStatus;
      if (currentStoreStatus !== legacyStatus) {
        useBoardStore.setState({ syncStatus: legacyStatus });
      }

      this._emit({ type: "sync_state_changed", event: e });

      telemetry.log("REALTIME_CLIENT", "SYNC_STATE_CHANGED", {
        prev:    e.prev,
        next:    e.next,
        trigger: e.trigger,
      });

      // GAP 8 FIX: when FSM enters "resyncing" notify the UI so it can
      // trigger a full board reload.  The FSM cannot initiate the reload
      // itself — that is a UI concern (window.location.reload / re-fetch).
      if (e.next === "resyncing") {
        const reason =
          e.trigger === "resync_required"
            ? "server_ordered"
            : "buffer_overflow";

        telemetry.log("REALTIME_CLIENT", "AUTO_RESYNC_REQUIRED", { reason });

        this._emit({ type: "auto_resync_required", reason });

        // Fire the injected callback (BoardPage wires this to window.location.reload)
        try {
          this._onResyncRequired?.(reason);
        } catch (err) {
          console.error("[BoardRealtimeClient] onResyncRequired threw:", err);
        }
      }
    });

    // ── Store syncStatus changes → Sync FSM triggers (GAP 2 FIX) ─────────
    //
    // reconcileIncomingEvent writes syncStatus directly to the Zustand store.
    // We subscribe here and forward changes to the FSM so it stays in sync.
    //
    // GAP 2 FIX: the unsubscribe fn is NOW saved to this._unsubStore and
    // called in _unwireSubscriptions().  Previously it was discarded,
    // causing a new subscription to be added on every disconnect+reconnect.
    this._unsubStore = useBoardStore.subscribe((state, prevState) => {
      if (state.syncStatus === prevState.syncStatus) return;

      if (state.syncStatus === "gap_detected") {
        clientSyncFsm.send("gap_detected");
      }
      if (
        state.syncStatus === "healthy" &&
        prevState.syncStatus === "gap_detected"
      ) {
        clientSyncFsm.send("gap_resolved");
      }
      if (state.syncStatus === "desynced") {
        // This path is triggered by reconcileIncomingEvent when buffer ≥ 200.
        // The FSM will transition to "resyncing", which fires the observer
        // above and calls _onResyncRequired.
        clientSyncFsm.send("resync_required");
      }
    });
  }

  private _unwireSubscriptions(): void {
    this._unsubTransport?.();
    this._unsubSyncFsm?.();
    // GAP 2 FIX: clean up Zustand store subscription
    this._unsubStore?.();
    this._unsubTransport = null;
    this._unsubSyncFsm   = null;
    this._unsubStore     = null;
  }

  // ==========================================================================
  // 📤 Outbox helpers
  // ==========================================================================

  private _ensureOutbox(): OutboxProcessor {
    if (!this._outbox) {
      this._outbox = this._buildOutbox({});
    }
    return this._outbox;
  }

  private _buildOutbox(cfg: Partial<OutboxConfig>): OutboxProcessor {
    const outbox = new OutboxProcessor(
      cfg,
      this._retryFn,
      {
        getStore: () => useBoardStore.getState().pendingMutations,

        markFailed: (correlationId) =>
          useBoardStore.getState().updatePendingMutationStatus(correlationId, "failed"),

        incrementRetry: (correlationId) => {
          useBoardStore.setState((state) => {
            const mutation = state.pendingMutations[correlationId];
            if (!mutation) return state;
            return {
              pendingMutations: {
                ...state.pendingMutations,
                [correlationId]: {
                  ...mutation,
                  retryCount: mutation.retryCount + 1,
                },
              },
            };
          });
        },

        // GAP 1 FIX: onDlqEntry is now wired so boardRealtimeClient emits
        // dlq_entry_added synchronously when OutboxProcessor._moveToDlq()
        // fires.  useOutboxProcessor's subscriber will receive it correctly.
        onDlqEntry: (entry) => {
          this._emit({ type: "dlq_entry_added", entry });
        },
      },
    );

    return outbox;
  }

  // ==========================================================================
  // 📣 Observer helpers
  // ==========================================================================

  private _emit(e: RealtimeClientEvent): void {
    this._observers.forEach((cb) => {
      try {
        cb(e);
      } catch (err) {
        console.error("[BoardRealtimeClient] Observer threw:", err);
      }
    });
  }
}

// ============================================================================
// 🌍 Singleton
// ============================================================================

export const boardRealtimeClient = new BoardRealtimeClient();
