// apps/web/src/features/board/store/sync/useSyncOrchestrator.ts
// ─────────────────────────────────────────────────────────────────────────────
// The single "glue" hook that wires everything together.
//
// Responsibilities:
//   1. Registers the SyncStateMachine effect runner (via setSyncEffectRunner)
//   2. Routes FSM effects → boardSocketClient / projectionRebuildTooling / timers
//   3. Mirrors FSM status into useBoardStore.syncStatus (UPDATE_STORE_STATUS)
//   4. Handles full resync / replay: wipe → fetch → replay → apply
//   5. Coordinates MutationLifecycleManager with store's restoreSnapshot
//   6. Provides public API: triggerManualReconnect() / triggerFullResync()
//
// Usage (mount once per board, inside BoardView or a parent layout):
//   useSyncOrchestrator({ boardId, authToken, fetchJournal })
// ─────────────────────────────────────────────────────────────────────────────

"use client";

import { useEffect, useCallback, useRef } from "react";
import { useBoardStore } from "../useBoardStore";
import { getSyncFSM, resetSyncFSM, setSyncEffectRunner } from "./syncFSMSingleton";
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
  const gapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ──────────────────────────────────────────────────────────────────────────
  // Shared full-resync / replay routine (wipe → fetch → replay → apply)
  // ──────────────────────────────────────────────────────────────────────────
  const runFullResync = useCallback(async () => {
    const fsm = getSyncFSM();

    if (isResyncingRef.current) return;
    if (!fetchJournal) {
      console.warn("[SyncOrchestrator] No fetchJournal — cannot resync");
      return;
    }

    isResyncingRef.current = true;

    // Cancel any previous resync
    abortControllerRef.current?.abort();
    abortControllerRef.current = new AbortController();

    try {
      const liveState = useBoardStore.getState();
      const result = await rebuildProjection(liveState, {
        boardId,
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

        fsm.send({
          type: "REPLAY_COMPLETE",
          finalSequence: result.state.boardSequence,
        });
      } else {
        console.error("[SyncOrchestrator] Rebuild failed:", result.error);
        fsm.send({
          type: "REPLAY_FAILED",
          reason: result.error ?? "rebuild_failed",
        });
      }
    } catch (err: unknown) {
      if ((err as { name?: string })?.name !== "AbortError") {
        console.error("[SyncOrchestrator] Resync error:", err);
        fsm.send({ type: "REPLAY_FAILED", reason: "resync_threw" });
      }
    } finally {
      isResyncingRef.current = false;
    }
  }, [boardId, fetchJournal]);

  // ──────────────────────────────────────────────────────────────────────────
  // Effect runner: translates FSM effects into concrete side effects.
  //
  // Effects emitted by the FSM (see syncStateMachine.ts → SyncEffect):
  //   UPDATE_STORE_STATUS, START_GAP_TIMER, CANCEL_GAP_TIMER, REQUEST_CATCH_UP,
  //   START_REPLAY, SCHEDULE_RECONNECT, CANCEL_RECONNECT, TRIGGER_FULL_RESYNC,
  //   LOG
  // ──────────────────────────────────────────────────────────────────────────
  const handleEffect = useCallback(
    (effect: SyncEffect) => {
      const fsm = getSyncFSM();
      const store = useBoardStore.getState();

      switch (effect.type) {
        // ── Mirror FSM status into the store (single source of truth for UI) ──
        case "UPDATE_STORE_STATUS": {
          useBoardStore.setState({ syncStatus: effect.status });
          break;
        }

        // ── Gap timer: declare the gap unrecoverable after timeoutMs ──────────
        case "START_GAP_TIMER": {
          if (gapTimerRef.current) clearTimeout(gapTimerRef.current);
          gapTimerRef.current = setTimeout(() => {
            gapTimerRef.current = null;
            getSyncFSM().send({ type: "GAP_TIMEOUT" });
          }, effect.timeoutMs);
          break;
        }

        case "CANCEL_GAP_TIMER": {
          if (gapTimerRef.current) {
            clearTimeout(gapTimerRef.current);
            gapTimerRef.current = null;
          }
          break;
        }

        // ── Pull missed events to fill a sequence gap ─────────────────────────
        case "REQUEST_CATCH_UP": {
          if (!fetchJournal) {
            fsm.send({ type: "RESYNC_REQUIRED" });
            break;
          }
          void (async () => {
            try {
              const page = await fetchJournal({
                boardId,
                fromSequence: effect.fromSequence,
                limit: 200,
              });
              for (const entry of page.events) {
                store.applyWebsocketEvent({
                  sequence: entry.sequence,
                  type: entry.type,
                  payload: entry.payload,
                });
              }
              fsm.send({ type: "GAP_FILLED" });
            } catch (err) {
              console.error("[SyncOrchestrator] Catch-up failed:", err);
              fsm.send({ type: "RESYNC_REQUIRED" });
            }
          })();
          break;
        }

        // ── Incremental replay (gap timed out) ───────────────────────────────
        case "START_REPLAY": {
          void runFullResync();
          break;
        }

        // ── Full resync (unrecoverable desync) ───────────────────────────────
        case "TRIGGER_FULL_RESYNC": {
          void runFullResync();
          break;
        }

        // ── Schedule a reconnect attempt with backoff ─────────────────────────
        case "SCHEDULE_RECONNECT": {
          if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            const seq = useBoardStore.getState().boardSequence;
            boardSocket.doConnect(boardId, seq);
            getSyncFSM().send({ type: "RECONNECT_ATTEMPT", attempt: effect.attempt });
          }, effect.delayMs);
          break;
        }

        case "CANCEL_RECONNECT": {
          if (reconnectTimerRef.current) {
            clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
          }
          break;
        }

        // ── Structured log ────────────────────────────────────────────────────
        case "LOG": {
          if (process.env.NODE_ENV === "development") {
            console.log(`[SyncFSM] ${effect.action}`, effect.data ?? {});
          }
          break;
        }
      }
    },
    [boardId, fetchJournal, runFullResync],
  );

  // ──────────────────────────────────────────────────────────────────────────
  // Mount / Unmount
  // ──────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    const mlm = getMutationLifecycleManager();

    // Wire rollback callback
    mlm.onRollback((snapshot) => {
      useBoardStore.getState().restoreSnapshot(snapshot);
    });

    // Register the FSM effect runner.
    setSyncEffectRunner(handleEffect);

    // Start the board session (sends CONNECT_REQUESTED through the FSM).
    boardSocket.connect(boardId, authToken);

    return () => {
      // Cleanup on unmount (board unload / board change).
      setSyncEffectRunner(null);
      boardSocket.disconnect();
      abortControllerRef.current?.abort();
      if (gapTimerRef.current) clearTimeout(gapTimerRef.current);
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      gapTimerRef.current = null;
      reconnectTimerRef.current = null;
      resetMutationLifecycleManager();
      resetSyncFSM();
    };
  }, [boardId, authToken, handleEffect]);

  // ──────────────────────────────────────────────────────────────────────────
  // Public API
  // ──────────────────────────────────────────────────────────────────────────
  const triggerManualReconnect = useCallback(() => {
    // The SyncStateMachine has no dedicated MANUAL_RECONNECT message — a manual
    // user retry is the same shape as the auto-reconnect loop's first attempt,
    // so we send RECONNECT_ATTEMPT with attempt=0. The FSM routes it through the
    // reconnect path and emits the SCHEDULE_RECONNECT effect.
    getSyncFSM().send({ type: "RECONNECT_ATTEMPT", attempt: 0 });
  }, []);

  const triggerFullResync = useCallback(() => {
    getSyncFSM().send({ type: "RESYNC_REQUIRED" });
  }, []);

  return { triggerManualReconnect, triggerFullResync };
}
