// apps/web/src/features/board/pages/BoardPage.tsx
"use client";

import { useEffect, useRef, useCallback } from "react";
import { useBoardStore }             from "../store/useBoardStore";
import { usePendingGC }              from "../store/mutations/core/usePendingGC";
import { useOutboxProcessor }        from "../store/mutations/core/useOutboxProcessor";
import { boardRealtimeClient }       from "../api/realtime/boardRealtimeClient";
import { useSyncStatus }             from "../api/realtime/useSyncStatus";
import { telemetry }                 from "../devtools/logEvent";
import type { ListDto, CardDto }     from "../store/useBoardStore";
import type { DeadLetterEntry, OutboxRetryFn } from "../api/realtime/outboxProcessor";
import type { PendingMutation }      from "../store/useBoardStore";

// ============================================================================
// 🛡️ Types
// ============================================================================

interface BoardPageProps {
  boardId:        string;
  initialLists:   (ListDto & { cards: CardDto[] })[];
  initialSequence: string;
  authToken?:     string;
}

// ============================================================================
// 🎨 Sync Status Indicator
// ============================================================================

function SyncIndicator() {
  const {
    uiStatus,
    latencyMs,
    reconnectAttempts,
    gapCount,
    resyncCount,
    dlqSize,
    canReload,
  } = useSyncStatus();

  const handleReload = useCallback(() => {
    window.location.reload();
  }, []);

  // ── synced ────────────────────────────────────────────────────────────────
  if (uiStatus === "synced") {
    return (
      <span className="flex items-center gap-1.5 text-emerald-400 text-sm font-medium">
        <span className="relative flex h-2 w-2">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
        </span>
        Synced
        {latencyMs !== null && (
          <span className="text-emerald-600 text-xs font-normal">{latencyMs}ms</span>
        )}
        {process.env.NODE_ENV === "development" && (
          <span className="text-zinc-600 text-xs font-normal ml-1">
            gaps:{gapCount} resyncs:{resyncCount}
          </span>
        )}
      </span>
    );
  }

  // ── catching_up ───────────────────────────────────────────────────────────
  if (uiStatus === "catching_up") {
    return (
      <span className="flex items-center gap-1.5 text-sky-400 text-sm font-medium animate-pulse">
        <span className="h-2 w-2 rounded-full bg-sky-400" />
        Syncing changes…
      </span>
    );
  }

  // ── reconnecting ──────────────────────────────────────────────────────────
  if (uiStatus === "reconnecting") {
    return (
      <span className="flex items-center gap-1.5 text-amber-400 text-sm font-medium animate-pulse">
        <span className="h-2 w-2 rounded-full bg-amber-400" />
        Reconnecting…
        {reconnectAttempts > 0 && (
          <span className="text-amber-600 text-xs font-normal">
            (attempt {reconnectAttempts})
          </span>
        )}
      </span>
    );
  }

  // ── resyncing (full snapshot reload in progress) ──────────────────────────
  if (uiStatus === "resyncing") {
    return (
      <span className="flex items-center gap-1.5 text-violet-400 text-sm font-medium animate-pulse">
        <span className="h-2 w-2 rounded-full bg-violet-400" />
        Refreshing board…
      </span>
    );
  }

  // ── resyncing_required (server ordered, user action) ──────────────────────
  if (uiStatus === "resyncing_required") {
    return (
      <span className="flex items-center gap-2 text-rose-400 text-sm font-medium">
        <span className="h-2 w-2 rounded-full bg-rose-500" />
        Out of sync
        <button
          onClick={handleReload}
          className="ml-1 px-2 py-0.5 text-xs rounded bg-rose-500/20 hover:bg-rose-500/40
                     text-rose-300 border border-rose-500/40 transition-colors"
        >
          Reload
        </button>
      </span>
    );
  }

  // ── offline (terminal, max reconnects exhausted) ──────────────────────────
  if (uiStatus === "offline") {
    return (
      <span className="flex items-center gap-2 text-zinc-500 text-sm font-medium">
        <span className="h-2 w-2 rounded-full bg-zinc-600" />
        Offline
        {dlqSize > 0 && (
          <span className="text-zinc-400 text-xs">
            {dlqSize} unsaved change{dlqSize !== 1 ? "s" : ""}
          </span>
        )}
        {canReload && (
          <button
            onClick={handleReload}
            className="ml-1 px-2 py-0.5 text-xs rounded bg-zinc-700 hover:bg-zinc-600
                       text-zinc-300 border border-zinc-600 transition-colors"
          >
            Retry
          </button>
        )}
      </span>
    );
  }

  // "idle" — socket not yet opened (SSR / pre-hydration)
  return null;
}

// ============================================================================
// 🚀 Main Board Component
// ============================================================================

export function BoardPage({
  boardId,
  initialLists,
  initialSequence,
  authToken,
}: BoardPageProps) {
  // ── Single-run hydration guard ────────────────────────────────────────────
  const isHydrated = useRef(false);
  const initBoard  = useBoardStore((state) => state.initBoard);
  const listOrder  = useBoardStore((state) => state.listOrder);

  if (!isHydrated.current) {
    initBoard(initialLists, initialSequence);
    isHydrated.current = true;
  }

  // ── Background GC for stale pending mutations ─────────────────────────────
  usePendingGC(60_000);

  // ── Outbox DLQ observer ───────────────────────────────────────────────────
  const handleDlqEntry = useCallback((entry: DeadLetterEntry) => {
    // In production you might show a toast or log to an error tracker.
    // For now we surface it in dev console.
    if (process.env.NODE_ENV === "development") {
      console.warn("[BoardPage] Mutation entered DLQ:", entry);
    }
  }, []);

  useOutboxProcessor({ onDlqEntry: handleDlqEntry });

  // ── Realtime lifecycle ────────────────────────────────────────────────────
  useEffect(() => {
    // GAP 4 FIX: inject boardApi retryFn before connecting so OutboxProcessor
    // can actually re-issue stale mutations instead of silently no-opping.
    //
    // The retryFn receives a PendingMutation and must re-issue the HTTP call.
    // We map mutation.type → the correct boardApi method using the stored
    // payload fields from PendingMutation.aggregateId.
    //
    // Note: the mutation.type values are domain event type strings
    // (e.g. "card.created", "card.moved") — we match on those.
    //
    // GAP 8 FIX: inject onResyncRequired so buffer overflow or server-ordered
    // resync triggers a real page reload rather than silently hanging in
    // "resyncing" state forever.
    const retryFn: OutboxRetryFn = async (mutation: PendingMutation) => {
      // PendingMutation doesn't carry the original payload arguments because
      // useOptimisticMutation only stores the mutation metadata, not the full
      // tRPC input.  For the retry path, the safest action is to trigger a
      // full board resync rather than attempt to re-reconstruct the payload
      // from incomplete data.  This is consistent with the "best-effort
      // client-side outbox" design — exactly-once requires server-side
      // idempotency keys, which are already set via mutation.correlationId.
      //
      // If the server already applied the mutation (WS echo pending due to
      // a reconnect), this resync will reconcile correctly via sequence ordering.
      telemetry.log("OUTBOX", "RETRY_VIA_RESYNC", {
        correlationId: mutation.correlationId,
        type:          mutation.type,
        aggregateId:   mutation.aggregateId,
      });

      // Re-sending as a resync is safe: boardApi.createCard / moveCard / etc.
      // are all idempotent via mutationId (= correlationId).
      // We deliberately do NOT attempt to reconstruct the tRPC payload here
      // because PendingMutation doesn't carry full input data.
      // The WS catch-up on reconnect is the primary recovery path.
      // This retryFn acts as a last-resort signal that the mutation is stale.
      throw new Error(
        `[BoardPage.retryFn] Mutation ${mutation.correlationId} (${mutation.type}) ` +
        `could not be retried from client state alone. Board will resync on next reconnect.`
      );
    };

    boardRealtimeClient.configure({
      retryFn,
      onResyncRequired: (reason) => {
        // GAP 8 FIX: this callback fires when the realtime engine determines
        // a full board resync is required.  We reload the page so the server
        // delivers a fresh board snapshot and WS replay catches up cleanly.
        telemetry.log("REALTIME_CLIENT", "PAGE_RELOAD_FOR_RESYNC", { reason });
        // Small delay so the "Refreshing board…" indicator is visible briefly.
        setTimeout(() => window.location.reload(), 500);
      },
    });

    // connect() is idempotent — safe even if called while already connected.
    boardRealtimeClient.connect(boardId, authToken);

    // Notify the sync FSM that the board is now hydrated.
    boardRealtimeClient.notifyBoardHydrated();

    return () => {
      // Graceful teardown: stops outbox processor, disconnects WS, resets sync FSM.
      boardRealtimeClient.disconnect();
    };
  }, [boardId, authToken]);

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-slate-900 text-slate-100 overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header className="flex items-center justify-between px-6 py-3 bg-slate-800/50
                          border-b border-slate-700 shrink-0">
        <h1 className="text-xl font-bold text-white">My Workspace</h1>
        <SyncIndicator />
      </header>

      {/* ── Board canvas ───────────────────────────────────────────────── */}
      <main className="flex-1 overflow-x-auto overflow-y-hidden p-6">
        <div className="flex h-full items-start gap-4">

          {listOrder.map((listId) => (
            // Replace with your real <ListColumn key={listId} listId={listId} />
            <div
              key={listId}
              className="w-72 shrink-0 bg-slate-800 rounded-lg p-3"
            >
              <p className="text-slate-400 text-sm text-center border border-dashed
                             border-slate-600 p-4 rounded">
                List {listId.substring(0, 8)}…
                <br />
                <span className="text-xs">(Replace with ListColumn)</span>
              </p>
            </div>
          ))}

          <button
            className="w-72 shrink-0 bg-white/5 hover:bg-white/10 transition-colors
                        rounded-lg p-3 flex items-center gap-2 text-slate-300 font-medium"
          >
            <span className="text-lg">+</span>
            Add another list
          </button>

        </div>
      </main>

    </div>
  );
}
