// apps/web/src/features/board/api/realtime/useSyncStatus.ts
//
// ============================================================================
// 🔌 useSyncStatus — Unified Status Hook (Phase 2)
// ============================================================================
//
// Phase 2 changes:
// ────────────────
// Now consumes boardRealtimeClient instead of boardSocket directly.
// This gives a unified view of:
//   • Transport FSM  (ConnectionMetrics)
//   • Sync FSM       (ClientSyncState)
//   • DLQ size       (for devtools / warnings)
//   • Outbox health
//
// The derived UISyncStatus priority table has been extended:
//   terminal   → "offline"
//   offline    → "offline"           (sync FSM terminal)
//   resyncing  → "resyncing"         (new: full snapshot in progress)
//   desynced   → "resyncing_required"
//   reconnecting (any) → "reconnecting"
//   catching_up → "catching_up"
//   idle        → "idle"
//   synced      → "synced"
// ============================================================================

"use client";

import { useEffect, useState, useCallback } from "react";
import { boardRealtimeClient }                 from "./boardRealtimeClient";
import type { RealtimeClientEvent, RealtimeClientMetrics } from "./boardRealtimeClient";
import type { ClientSyncState }                from "./clientSyncFsm";
import type { ConnectionState }                from "./connectionFsm";
import type { SyncStatus }                     from "../../store/useBoardStore";

// ============================================================================
// 🎨 Derived UI Status
// ============================================================================

export type UISyncStatus =
  | "synced"
  | "catching_up"
  | "reconnecting"
  | "resyncing"
  | "resyncing_required"
  | "offline"
  | "idle";

// ============================================================================
// 🔢 Derivation
// ============================================================================

function deriveUiStatus(
  connState: ConnectionState,
  syncState: ClientSyncState,
  storeSyncStatus: SyncStatus,
): UISyncStatus {
  // Transport terminal (max reconnect attempts) or sync FSM offline
  if (connState === "terminal" || syncState === "offline") return "offline";

  // Full resync in progress (buffer overflow or server RESYNC_REQUIRED)
  if (syncState === "resyncing") return "resyncing";

  // Store says desynced but FSM hasn't yet received the trigger
  if (storeSyncStatus === "desynced") return "resyncing_required";

  // Transport not yet up
  if (
    connState === "reconnecting" ||
    connState === "connecting"   ||
    connState === "handshaking"  ||
    syncState === "reconnecting"
  ) {
    return "reconnecting";
  }

  // Not yet started
  if (connState === "idle" || syncState === "idle") return "idle";

  // Data gap in progress
  if (syncState === "catching_up" || storeSyncStatus === "gap_detected") {
    return "catching_up";
  }

  return "synced";
}

// ============================================================================
// 📊 Hook Return Shape
// ============================================================================

export interface SyncStatusInfo {
  /** Derived UI-facing status */
  uiStatus:          UISyncStatus;
  /** Raw transport state */
  connState:         ConnectionState;
  /** Rich sync FSM state */
  syncState:         ClientSyncState;
  /** Legacy store status (for backward-compat consumers) */
  syncStatus:        SyncStatus;
  /** Latest RTT in ms, null if never measured */
  latencyMs:         number | null;
  /** Reconnect attempts in current session */
  reconnectAttempts: number;
  /** Gap events detected this session */
  gapCount:          number;
  /** Full resyncs performed this session */
  resyncCount:       number;
  /** Dead-letter queue size */
  dlqSize:           number;
  /** Whether the user can trigger a reload */
  canReload:         boolean;
}

// ============================================================================
// 🪝 useSyncStatus
// ============================================================================

export function useSyncStatus(): SyncStatusInfo {
  // ── Initialize from current snapshot ─────────────────────────────────────
  const [clientMetrics, setClientMetrics] = useState<RealtimeClientMetrics>(
    () => boardRealtimeClient.metrics,
  );

  // Store's SyncStatus (legacy, kept for reconcileIncomingEvent compat)
  const [storeSyncStatus, setStoreSyncStatus] = useState<SyncStatus>("healthy");

  // ── Bridge boardRealtimeClient observer into React state ──────────────────
  const handleClientEvent = useCallback((event: RealtimeClientEvent) => {
    if (
      event.type === "transport_changed" ||
      event.type === "sync_state_changed"
    ) {
      setClientMetrics((prev) => {
        const next = boardRealtimeClient.metrics;

        // Bail if nothing UI-relevant changed (avoid re-renders on every RTT pong)
        if (
          prev.transport.state             === next.transport.state             &&
          prev.transport.reconnectAttempts === next.transport.reconnectAttempts &&
          prev.transport.latencyMs         === next.transport.latencyMs         &&
          prev.syncState                   === next.syncState                   &&
          prev.gapCount                    === next.gapCount                    &&
          prev.dlqSize                     === next.dlqSize
        ) {
          return prev;
        }

        return next;
      });
    }

    if (event.type === "sync_state_changed") {
      // Sync the store status to keep legacy consumers accurate
      const { legacySyncStatus } = boardRealtimeClient.metrics.transport
        ? { legacySyncStatus: _syncStateToLegacy(event.event.next) }
        : { legacySyncStatus: "healthy" as SyncStatus };
      setStoreSyncStatus(legacySyncStatus);
    }
  }, []);

  useEffect(() => {
    // Sync immediately in case events fired between useState init and mount
    setClientMetrics(boardRealtimeClient.metrics);
    const unsub = boardRealtimeClient.subscribe(handleClientEvent);
    return unsub;
  }, [handleClientEvent]);

  // ── Derive ────────────────────────────────────────────────────────────────
  const { transport, syncState, gapCount, resyncCount, dlqSize } = clientMetrics;

  const uiStatus = deriveUiStatus(transport.state, syncState, storeSyncStatus);

  return {
    uiStatus,
    connState:         transport.state,
    syncState,
    syncStatus:        storeSyncStatus,
    latencyMs:         transport.latencyMs,
    reconnectAttempts: transport.reconnectAttempts,
    gapCount,
    resyncCount,
    dlqSize,
    canReload:
      uiStatus === "offline"             ||
      uiStatus === "resyncing_required"  ||
      uiStatus === "resyncing",
  };
}

// ============================================================================
// Helpers
// ============================================================================

function _syncStateToLegacy(state: ClientSyncState): SyncStatus {
  switch (state) {
    case "idle":
    case "synced":       return "healthy";
    case "catching_up":  return "gap_detected";
    case "reconnecting": return "reconnecting";
    case "resyncing":
    case "offline":      return "desynced";
  }
}
