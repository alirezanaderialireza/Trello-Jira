"use client";

// apps/web/src/features/board/engine/useBoardEngine.ts
//
// Phase 1.3 (F1.3.3) — the board facade.
//
// Composes the four internal engines into the single object the UI consumes,
// so BoardView never touches the store, dnd-kit, the sync orchestrator, or
// presence directly. The powerful core engines (sync FSM, positioning,
// mutation lifecycle) are mounted but untouched (D9).
//
//   useBoardState        → list order + initBoard
//   useDragEngine        → dnd-kit lifecycle + intent debounce + overlay meta
//   useSyncOrchestrator  → FSM + WebSocket + MutationLifecycleManager (existing)
//   usePendingGC         → sweep stale pending mutations
//   useBoardPresence     → presence heartbeat + local userId
//   useResilience        → memory/virtualization/mobile (wired in F1.3.4)

import { useBoardState } from "./useBoardState";
import { useDragEngine, type DragType, type DragMeta } from "./useDragEngine";
import { useResilience } from "./useResilience";
import { useViewportShiftGuard } from "./useViewportShiftGuard";
import { useSyncOrchestrator } from "../store/sync/useSyncOrchestrator";
import { usePendingGC } from "../store/mutations/core/usePendingGC";
import { useBoardPresence } from "../hooks/useBoardPresence";

export interface BoardEngine {
  listOrder: string[];
  initBoard: (lists: any[], sequence: string) => void;
  dndProps: ReturnType<typeof useDragEngine>["dndProps"];
  activeId: string | null;
  activeType: DragType | null;
  dragMeta: DragMeta | null;
  isDragging: boolean;
  triggerManualReconnect: () => void;
  presenceUserId: string | null;
}

export function useBoardEngine(boardId: string, authToken?: string): BoardEngine {
  const { listOrder, initBoard } = useBoardState();

  const drag = useDragEngine(boardId);

  // Existing orchestrator — mounts the FSM + WS + lifecycle manager.
  const { triggerManualReconnect } = useSyncOrchestrator({ boardId, authToken });

  // Sweep stale pending mutations every 60s.
  usePendingGC(60_000);

  // Presence heartbeat; returns the local userId so we can hide our own avatar.
  const { userId: presenceUserId } = useBoardPresence(boardId);

  // F1.3.4 — resilience: virtualization drag-trap flag + tab-lifecycle seam.
  useResilience(boardId, drag.isDragging);
  // F1.3.4 — mobile viewport-shift guard (touch devices only).
  useViewportShiftGuard();

  return {
    listOrder,
    initBoard,
    dndProps: drag.dndProps,
    activeId: drag.activeId,
    activeType: drag.activeType,
    dragMeta: drag.dragMeta,
    isDragging: drag.isDragging,
    triggerManualReconnect,
    presenceUserId,
  };
}
