// apps/web/src/features/board/api/realtime/useSyncStatus.ts
//
// ============================================================================
// 🔌 useSyncStatus — Unified Connection + Data-Sync Status Hook
// ============================================================================
//
// Architecture note:
// ──────────────────
// Two independent state machines must be combined for the UI:
//
//   ConnectionState (transport)   — from boardSocket.metrics
//   SyncStatus      (data-sync)   — from useBoardStore
//
// Neither is sufficient alone:
//   • ConnectionState "connected" + SyncStatus "desynced" → "Reconnected but
//     data is behind; catching up"
//   • ConnectionState "reconnecting" + SyncStatus "healthy" → "Temporarily
//     offline but last known state is good"
//
// This hook fuses both into a single UISyncStatus for component consumption,
// keeping the two FSMs decoupled at the source.
//
// Subscription model:
// ───────────────────
// boardSocket.subscribe() is an observer pattern (not React state), so we
// bridge it into React state via useEffect + useState.  The component
// re-renders ONLY when the derived UISyncStatus changes — not on every
// metrics_updated tick (which fires on every RTT sample).
// ============================================================================

"use client";

import { useEffect, useState, useCallback } from "react";
import { useBoardStore } from "../../store/useBoardStore";
import { boardSocket } from "./boardSocketClient";
import type { ConnectionState, ConnectionMetrics } from "./connectionFsm";
import type { SyncStatus } from "../../store/useBoardStore";

// ============================================================================
// 🎨 Derived UI Status
// ============================================================================

/**
 * A single enum consumed by UI components.
 * Derived from ConnectionState × SyncStatus.
 */
export type UISyncStatus =
  /** Socket open, data up-to-date */
  | "synced"
  /** Socket open, catching up on missed events (gap in sequence) */
  | "catching_up"
  /** Socket temporarily dropped; attempting to reconnect */
  | "reconnecting"
  /** Socket open but a full resync is required (data too far behind) */
  | "resyncing_required"
  /** Max reconnect attempts exhausted; user action required */
  | "offline"
  /** Initial state: socket not yet opened */
  | "idle";

// ============================================================================
// 🔢 Priority Table
// ============================================================================
// Maps (ConnectionState, SyncStatus) → UISyncStatus.
// Ordered from most-severe to least-severe so the UI always shows the
// most actionable state.
// ============================================================================

function deriveUiStatus(
  conn: ConnectionState,
  sync: SyncStatus,
): UISyncStatus {
  // Terminal transport = nothing works; user must act.
  if (conn === "terminal") return "offline";

  // Server-ordered resync regardless of connection state.
  if (sync === "desynced") return "resyncing_required";

  // Transport is down but not terminal.
  if (conn === "reconnecting" || conn === "connecting" || conn === "handshaking") {
    return "reconnecting";
  }

  // Not yet started.
  if (conn === "idle") return "idle";

  // Transport connected — look at data-sync dimension.
  if (sync === "gap_detected") return "catching_up";

  // Both healthy.
  return "synced";
}

// ============================================================================
// 📊 Hook Return Shape
// ============================================================================

export interface SyncStatusInfo {
  /** Derived UI-facing status */
  uiStatus:   UISyncStatus;
  /** Raw transport FSM state (for devtools / advanced consumers) */
  connState:  ConnectionState;
  /** Raw data-sync state from store */
  syncStatus: SyncStatus;
  /** Latest RTT in ms, null if never measured */
  latencyMs:  number | null;
  /** Number of reconnect attempts in current session */
  reconnectAttempts: number;
  /** Whether the user can trigger a manual reload to recover */
  canReload: boolean;
}

// ============================================================================
// 🪝 useSyncStatus
// ============================================================================

export function useSyncStatus(): SyncStatusInfo {
  // ── Data-sync state from Zustand (reactive) ──────────────────────────────
  const syncStatus = useBoardStore((state) => state.syncStatus);

  // ── Transport metrics from boardSocket (observer-based) ──────────────────
  // We initialize from the singleton's current snapshot so the hook is
  // accurate even if it mounts after the socket is already connected.
  const [metrics, setMetrics] = useState<ConnectionMetrics>(
    () => boardSocket.metrics,
  );

  const handleConnectionEvent = useCallback(
    (event: Parameters<Parameters<typeof boardSocket.subscribe>[0]>[0]) => {
      // We only need to re-render when metrics that affect UISyncStatus change.
      // Specifically: state, reconnectAttempts, latencyMs.
      // "metrics_updated" fires on every pong — we only update React state
      // when the relevant fields actually change to avoid unnecessary renders.
      if (event.type === "state_changed" || event.type === "metrics_updated") {
        setMetrics((prev) => {
          const next =
            event.type === "metrics_updated"
              ? event.metrics
              : boardSocket.metrics;

          // Bail if nothing UI-relevant changed.
          if (
            prev.state             === next.state &&
            prev.reconnectAttempts === next.reconnectAttempts &&
            prev.latencyMs         === next.latencyMs
          ) {
            return prev; // reference-equal → no re-render
          }

          return next;
        });
      }
    },
    [],
  );

  useEffect(() => {
    // Subscribe and sync immediately in case metrics changed between
    // useState initializer and this effect running.
    setMetrics(boardSocket.metrics);
    const unsub = boardSocket.subscribe(handleConnectionEvent);
    return unsub;
  }, [handleConnectionEvent]);

  // ── Derive UI status ─────────────────────────────────────────────────────
  const uiStatus = deriveUiStatus(metrics.state, syncStatus);

  return {
    uiStatus,
    connState:         metrics.state,
    syncStatus,
    latencyMs:         metrics.latencyMs,
    reconnectAttempts: metrics.reconnectAttempts,
    canReload:         uiStatus === "offline" || uiStatus === "resyncing_required",
  };
}
