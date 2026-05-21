// apps/web/src/features/board/store/sync/useSyncOrchestrator.ts
// ─────────────────────────────────────────────────────────────────────────────
// The single "glue" hook that wires everything together.
//
// Responsibilities:
//   1. Mounts the SyncStateMachine effect handler
//   2. Routes FSM effects → boardSocketClient / projectionRebuildTooling
//   3. Mirrors FSM SyncState back into useBoardStore.syncStatus (so UI works)
//   4. Handles full resync: wipe → fetch → replay → apply
//   5. Coordinates MutationLifecycleManager with store's restoreSnapshot
//   6. Provides public API: triggerManualReconnect()
//
// Usage (mount once per board, inside BoardView or a parent layout):
//   useSyncOrchestrator({ boardId, authToken, fetchJournal })
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useEffect, useCallback, useRef } from "react";
import { useBoardStore } from "../useBoardStore";
import { getSyncFSM, resetSyncFSM } from "./syncFSMSingleton";
import {
  getMutationLifecycleManager,
  resetMutationLifecycleManager,
} from "./mutationLifecycleManager";
import { rebuildProjection } from "./projectionRebuildTooling";
import { boardSocket } from "../../api/realtime/boardSocketClient";
import type { SyncEffect } from "./syncStateMachine";
import type { JournalEntry } from "./replayEngine";

// ============================================================================
// Types
// ============================================================================

export interface SyncOrchestratorOptions {
  boardId: string;
  authToken?: string;
  /**
   * Function to fetch the event journal from the server.
   * Injected here so the sync layer has no direct dependency on tRPC.
   */
  fetchJournal?: (params: {
    boardId: string;
    fromSequence: string;
    limit: number;
    abortSignal?: AbortSignal;
  }) => Promise<{
    events: JournalEntry[];
    hasMore: boolean;
    latestSequence: string;
  }>;
}

export interface SyncOrchestratorHandle {
  triggerManualReconnect: () => void;
  triggerFullResync: () => void;
}

// ============================================================================
// Hook
// ============================================================================

export function useSyncOrchestrator(
  options: SyncOrchestratorOptions,
): SyncOrchestratorHandle {
  const { boardId, authToken, fetchJournal } = options;

  const abortControllerRef = useRef<AbortController | null>(null);
  const isResyncingRef = useRef(false);

  // ──────────────────────────────────────────────────────────────────────────
  // Effect handler: translates FSM effects into concrete side effects
  // ──────────────────────────────────────────────────────────────────────────
  const handleEffect = useCallback(
    async (effect: SyncEffect) => {
      const fsm = getSyncFSM();
      const store = useBoardStore.getState();

      switch (effect.type) {
        // ── Connect WebSocket ────────────────────────────────────────────
        case "CONNECT_WS": {
          boardSocket.doConnect(effect.boardId, effect.lastSequence);
          break;
        }

        // ── Disconnect WebSocket ─────────────────────────────────────────
        case "DISCONNECT_WS": {
          boardSocket.disconnect();
          break;
        }

        // ── Pull missed events (gap recovery) ────────────────────────────
        case "PULL_MISSED_EVENTS": {
          if (!fetchJournal) break;

          try {
            const page = await fetchJournal({
              boardId: effect.boardId,
              fromSequence: effect.fromSequence,
              limit: 200,
            });

            if (page.events.length > 0) {
              // Apply missed events through the normal reconcile path
              for (const entry of page.events) {
                store.applyWebsocketEvent({
                  sequence: entry.sequence,
                  type: entry.type,
                  payload: entry.payload,
                });
              }
            }

            fsm.send({ type: "GAP_RECOVERED" });
          } catch (err: any) {
            console.error("[SyncOrchestrator] Pull missed events failed:", err);
            fsm.send({ type: "GAP_UNRECOVERABLE" });
          }
          break;
        }

        // ── Full resync: wipe → fetch → replay → apply ───────────────────
        case "REQUEST_FULL_RESYNC": {
          if (isResyncingRef.current) break;
          if (!fetchJournal) {
            console.warn("[SyncOrchestrator] No fetchJournal — cannot resync");
            break;
          }

          isResyncingRef.current = true;

          // Cancel any previous resync
          abortControllerRef.current?.abort();
          abortControllerRef.current = new AbortController();

          try {
            const liveState = useBoardStore.getState();
            const result = await rebuildProjection(liveState, {
              boardId: effect.boardId,
              tenantId: "", // tenantId from session — not available here; omit
              fetchJournal,
              snapshotInterval: 100,
              enableLog: process.env.NODE_ENV === "development",
              abortSignal: abortControllerRef.current.signal,
              onProgress: (progress) => {
                if (process.env.NODE_ENV === "development") {
                  console.log(
                    `[SyncOrchestrator] Resync ${progress.phase} ${progress.percent}%: ${progress.message}`,
                  );
                }
              },
            });

            if (result.success && result.state) {
              // Apply rebuilt state to store
              useBoardStore.setState({
                lists: result.state.lists,
                cards: result.state.cards,
                cardsByList: result.state.cardsByList,
                listOrder: result.state.listOrder,
                boardSequence: result.state.boardSequence,
                bufferedEvents: {},
                pendingMutations: {},
                syncStatus: "synced",
              });

              fsm.send({ type: "RESYNC_COMPLETE" });
            } else {
              console.error("[SyncOrchestrator] Rebuild failed:", result.error);
              fsm.send({ type: "WS_DISCONNECTED" });
            }
          } catch (err: any) {
            if (err?.name !== "AbortError") {
              console.error("[SyncOrchestrator] Resync error:", err);
            }
          } finally {
            isResyncingRef.current = false;
          }
          break;
        }

        // ── Schedule reconnect ───────────────────────────────────────────
        case "SCHEDULE_RECONNECT": {
          // boardSocketClient schedules its own reconnect internally.
          // FSM just records the attempt count via RECONNECT_ATTEMPT.
          break;
        }

        // ── Notify user offline ──────────────────────────────────────────
        case "NOTIFY_USER_OFFLINE": {
          // Update store status so UI can show offline banner
          useBoardStore.setState({ syncStatus: "offline" });
          break;
        }

        // ── Log ──────────────────────────────────────────────────────────
        case "LOG": {
          if (process.env.NODE_ENV === "development") {
            const method = effect.level === "error"
              ? console.error
              : effect.level === "warn"
              ? console.warn
              : console.log;
            method(`[SyncFSM] ${effect.message}`, effect.data ?? "");
          }
          break;
        }

        // ── BroadcastChannel tab state ───────────────────────────────────
        case "BROADCAST_TAB_STATE": {
          // Handled inside SyncStateMachine class directly
          break;
        }
      }
    },
    [boardId, fetchJournal],
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Mirror FSM state → store syncStatus
  // ──────────────────────────────────────────────────────────────────────────
  const handleStateChange = useCallback(
    (fsmState: import("./syncStateMachine").SyncState) => {
      useBoardStore.setState({ syncStatus: fsmState });
    },
    [],
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Mount / Unmount
  // ──────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const fsm = getSyncFSM();
    const mlm = getMutationLifecycleManager();

    // Wire rollback callback
    mlm.onRollback((snapshot) => {
      useBoardStore.getState().restoreSnapshot(snapshot);
    });

    // Wire FSM effect handler
    fsm.onEffect(handleEffect);

    // Subscribe to state changes for store mirroring
    const unsubscribeFSM = fsm.subscribe((state, _ctx, _event) => {
      handleStateChange(state);
    });

    // Start the board session
    boardSocket.connect(boardId, authToken);

    return () => {
      // Cleanup on unmount (board unload)
      unsubscribeFSM();
      boardSocket.disconnect();
      abortControllerRef.current?.abort();
      resetMutationLifecycleManager();
      resetSyncFSM();
    };
  }, [boardId, authToken, handleEffect, handleStateChange]);

  // ──────────────────────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────────────────────
  const triggerManualReconnect = useCallback(() => {
    getSyncFSM().send({ type: "MANUAL_RECONNECT" });
  }, []);

  const triggerFullResync = useCallback(() => {
    getSyncFSM().send({ type: "GAP_UNRECOVERABLE" });
  }, []);

  return { triggerManualReconnect, triggerFullResync };
}
