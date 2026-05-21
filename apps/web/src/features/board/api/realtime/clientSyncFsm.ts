// apps/web/src/features/board/api/realtime/clientSyncFsm.ts
//
// ============================================================================
// 🔄 ClientSyncFSM — Explicit Client-Side Data-Sync State Machine
// ============================================================================
//
// Architecture:
// ─────────────
// SyncStatus in the Zustand store (healthy | gap_detected | reconnecting |
// desynced) was designed as a simple flag, not an FSM.  It has no explicit
// transition rules, no guards, and no observer for state changes.
//
// This causes:
//   • UI oscillating between states on rapid WS event bursts
//   • No entry/exit hooks for triggering catch-up logic
//   • No way to distinguish "transient gap" from "persistent gap"
//   • desynced entered from unrelated paths (disconnect, server order, buffer
//     overflow) with no way to distinguish them in the UI
//
// Solution:
// ─────────
// ClientSyncFSM is a standalone class that:
//   1. Owns a richer set of states than SyncStatus
//   2. Validates every transition against an explicit table
//   3. Fires observer callbacks on entry to each state
//   4. Derives a backward-compatible SyncStatus so the store doesn't change
//   5. Provides counts and metadata for observability
//
// States:
// ───────
//   idle          Initial state.  Board not yet hydrated.
//   synced        Board is hydrated and fully up-to-date.
//   catching_up   Gap detected in sequence; draining buffer.
//   resyncing     Full re-hydration in progress (buffer overflow or server
//                 RESYNC_REQUIRED).
//   reconnecting  Transport disconnected; waiting for WS to re-open.
//   offline       Transport terminal; user action required.
//
// Transition drivers:
// ───────────────────
//   board_hydrated      → synced
//   ws_connected        → synced (if was reconnecting)
//   gap_detected        → catching_up
//   gap_resolved        → synced
//   resync_required     → resyncing
//   resync_complete     → synced
//   transport_dropped   → reconnecting
//   transport_terminal  → offline
//   manual_reconnect    → reconnecting  (user clicked "Retry")
//   board_closed        → idle
// ============================================================================

import { telemetry } from "../../devtools/logEvent";
import type { SyncStatus } from "../../store/useBoardStore";

// ============================================================================
// 🔄 States
// ============================================================================

export type ClientSyncState =
  | "idle"
  | "synced"
  | "catching_up"
  | "resyncing"
  | "reconnecting"
  | "offline";

// ============================================================================
// ⚡ Transition Triggers
// ============================================================================

export type SyncTrigger =
  | "board_hydrated"
  | "ws_connected"
  | "gap_detected"
  | "gap_resolved"
  | "resync_required"
  | "resync_complete"
  | "transport_dropped"
  | "transport_terminal"
  | "manual_reconnect"
  | "board_closed";

// ============================================================================
// 🔁 Transition Table
// ============================================================================
//
// [currentState][trigger] → nextState | null (invalid)
//
// null means the trigger is silently ignored in that state.
// ============================================================================

type TransitionTable = Record<ClientSyncState, Partial<Record<SyncTrigger, ClientSyncState>>>;

const TRANSITIONS: TransitionTable = {
  idle: {
    board_hydrated:   "synced",
    transport_dropped: "reconnecting",
  },
  synced: {
    gap_detected:      "catching_up",
    resync_required:   "resyncing",
    transport_dropped: "reconnecting",
    board_closed:      "idle",
  },
  catching_up: {
    gap_resolved:      "synced",
    resync_required:   "resyncing",
    transport_dropped: "reconnecting",
    board_closed:      "idle",
    // Another gap while catching up stays in catching_up
    gap_detected:      "catching_up",
  },
  resyncing: {
    resync_complete:   "synced",
    transport_dropped: "reconnecting",
    board_closed:      "idle",
  },
  reconnecting: {
    ws_connected:      "synced",
    resync_required:   "resyncing",
    transport_terminal: "offline",
    board_closed:      "idle",
    // Still disconnecting — stays reconnecting
    transport_dropped: "reconnecting",
  },
  offline: {
    manual_reconnect:  "reconnecting",
    board_closed:      "idle",
  },
};

// ============================================================================
// 📣 Observer
// ============================================================================

export interface SyncStateChangeEvent {
  prev:    ClientSyncState;
  next:    ClientSyncState;
  trigger: SyncTrigger;
  ts:      number;
}

export type SyncFsmObserver = (event: SyncStateChangeEvent) => void;

// ============================================================================
// 📊 Metrics
// ============================================================================

export interface SyncFsmMetrics {
  state:              ClientSyncState;
  gapCount:           number;   // total gaps detected this session
  resyncCount:        number;   // total full resyncs this session
  reconnectCount:     number;   // total reconnect events this session
  lastTransitionAt:   number | null;
  /** Backward-compatible SyncStatus for Zustand store consumers */
  legacySyncStatus:   SyncStatus;
}

// ============================================================================
// 🔄 ClientSyncFSM
// ============================================================================

export class ClientSyncFSM {
  private _state: ClientSyncState = "idle";

  // Counters
  private _gapCount       = 0;
  private _resyncCount    = 0;
  private _reconnectCount = 0;
  private _lastTransitionAt: number | null = null;

  private readonly _observers = new Set<SyncFsmObserver>();

  // ==========================================================================
  // 🌐 Public API
  // ==========================================================================

  public get state(): ClientSyncState {
    return this._state;
  }

  public get metrics(): SyncFsmMetrics {
    return {
      state:            this._state,
      gapCount:         this._gapCount,
      resyncCount:      this._resyncCount,
      reconnectCount:   this._reconnectCount,
      lastTransitionAt: this._lastTransitionAt,
      legacySyncStatus: this._toLegacy(this._state),
    };
  }

  /**
   * Subscribe to state transitions.
   * Returns an unsubscribe function.
   */
  public subscribe(cb: SyncFsmObserver): () => void {
    this._observers.add(cb);
    return () => this._observers.delete(cb);
  }

  /**
   * Fire a trigger.  If the trigger is valid for the current state the FSM
   * transitions and notifies observers.  If invalid the call is a no-op
   * (logged in dev mode).
   */
  public send(trigger: SyncTrigger): void {
    const next = TRANSITIONS[this._state]?.[trigger];

    if (next === undefined) {
      // Silently ignore — invalid transitions are normal (e.g. ws_connected
      // while already synced after a brief blip).
      if (process.env.NODE_ENV === "development") {
        console.debug(
          `[ClientSyncFSM] Ignored trigger "${trigger}" in state "${this._state}"`,
        );
      }
      return;
    }

    if (next === this._state) {
      // Self-transition (e.g. gap_detected while already catching_up) —
      // bump counters but don't re-emit to avoid unnecessary renders.
      this._updateCounters(trigger);
      return;
    }

    const prev = this._state;
    this._state = next;
    this._lastTransitionAt = Date.now();
    this._updateCounters(trigger);

    telemetry.log("SYNC_FSM", "TRANSITION", {
      from:    prev,
      to:      next,
      trigger,
    });

    const event: SyncStateChangeEvent = { prev, next, trigger, ts: this._lastTransitionAt };
    this._observers.forEach((cb) => {
      try {
        cb(event);
      } catch (err) {
        console.error("[ClientSyncFSM] Observer threw:", err);
      }
    });
  }

  // ==========================================================================
  // 🔁 Legacy SyncStatus bridge
  // ==========================================================================

  private _toLegacy(state: ClientSyncState): SyncStatus {
    switch (state) {
      case "idle":
      case "synced":       return "healthy";
      case "catching_up":  return "gap_detected";
      case "reconnecting": return "reconnecting";
      case "resyncing":
      case "offline":      return "desynced";
    }
  }

  // ==========================================================================
  // 📊 Counter updates
  // ==========================================================================

  private _updateCounters(trigger: SyncTrigger): void {
    if (trigger === "gap_detected")      this._gapCount++;
    if (trigger === "resync_required")   this._resyncCount++;
    if (trigger === "transport_dropped") this._reconnectCount++;
  }
}

// ============================================================================
// 🌍 Singleton
// ============================================================================

export const clientSyncFsm = new ClientSyncFSM();
