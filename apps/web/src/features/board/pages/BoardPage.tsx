"use client";

// apps/web/src/features/board/pages/BoardPage.tsx
//
// Fixes applied:
// ✅ #15a: Removed the stub list renderer and integrated the real BoardView component.
//          The old file rendered `<div key={listId}>List {listId.substring(0,5)}...</div>`
//          which would break drag-and-drop and card rendering in production.
// ✅ #15b: BoardPage now accepts and forwards `initialSequence` to `initBoard`
//          so the reconciler is aligned with the SSR snapshot.
//          Previously `initBoard(initialLists, initialSequence)` was called but
//          BoardView was bypassed — the sequence was never reaching the store.

import { useEffect, useRef } from "react";
import { useBoardStore } from "../store/useBoardStore";
import { usePendingGC } from "../store/mutations/core/usePendingGC";
import { boardSocket } from "../api/realtime/boardSocketClient";
import type { ListDto, CardDto } from "../store/useBoardStore";
import BoardView, { type FullBoardDto } from "../components/BoardView";

// ============================================================================
// Types
// ============================================================================

interface BoardPageProps {
  boardId:         string;
  boardTitle:      string;
  initialLists:    (ListDto & { cards: CardDto[] })[];
  initialSequence: string;
  authToken?:      string;
}

// ============================================================================
// Component
// ============================================================================

export function BoardPage({
  boardId,
  boardTitle,
  initialLists,
  initialSequence,
  authToken,
}: BoardPageProps) {
  const isHydrated = useRef(false);

  const initBoard   = useBoardStore((s) => s.initBoard);
  const syncStatus  = useBoardStore((s) => s.syncStatus);

  // ==========================================================================
  // 1. Hydration (run once, synchronously before first render)
  // ==========================================================================

  if (!isHydrated.current) {
    initBoard(initialLists, initialSequence); // ✅ #15b real sequence
    isHydrated.current = true;
  }

  // ==========================================================================
  // 2. Garbage Collector
  // ==========================================================================

  usePendingGC(60_000);

  // ==========================================================================
  // 3. WebSocket
  // ==========================================================================

  useEffect(() => {
    boardSocket.connect(boardId, authToken);
    return () => { boardSocket.disconnect(); };
  }, [boardId, authToken]);

  // ==========================================================================
  // 4. Build FullBoardDto for BoardView
  //    BoardView does its own hydration guard; we still pass the SSR data so
  //    it can re-hydrate on hard navigation.
  // ==========================================================================

  const fullBoardDto: FullBoardDto = {
    id:             boardId,
    title:          boardTitle,
    lists:          initialLists as FullBoardDto["lists"],
    boardSequence:  Number(initialSequence),
  };

  // ==========================================================================
  // 5. Render
  // ==========================================================================

  return (
    <div className="flex flex-col h-screen bg-blue-600 overflow-hidden">
      {/* Header with sync status */}
      <header className="flex items-center justify-between px-6 py-3 bg-black/10 border-b border-white/10 shrink-0">
        <h1 className="text-xl font-bold text-white">{boardTitle}</h1>

        <div className="flex items-center gap-2 text-sm font-medium">
          {syncStatus === "healthy" && (
            <span className="flex items-center gap-1.5 text-emerald-300">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              Synced
            </span>
          )}
          {syncStatus === "reconnecting" && (
            <span className="text-yellow-300 animate-pulse">Reconnecting…</span>
          )}
          {syncStatus === "gap_detected" && (
            <span className="text-yellow-300">Syncing…</span>
          )}
          {syncStatus === "desynced" && (
            <span className="text-red-300">Offline</span>
          )}
        </div>
      </header>

      {/* ✅ #15a: real BoardView — DnD, cards, lists, modals */}
      <div className="flex-1 min-h-0">
        <BoardView data={fullBoardDto} boardId={boardId} />
      </div>
    </div>
  );
}
