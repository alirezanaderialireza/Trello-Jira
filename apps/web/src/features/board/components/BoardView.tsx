"use client";

// apps/web/src/features/board/components/BoardView.tsx
//
// Phase 1.3 (F1.3.3) — thin presentational shell.
//
// All logic now lives behind useBoardEngine (state + drag + sync + presence)
// and useHydrateBoard (server projection → store). This component only wires
// the engine output into the DnD context, the realtime status bar, the
// canvas, the drag overlay, and the card modal — each under its error
// boundary. Compare to the previous ~700-line version that inlined the entire
// drag lifecycle and a parallel server-action move path.

import { DndContext, DragOverlay } from "@dnd-kit/core";

import CardModal from "./CardModal";
import { BoardCanvas } from "./BoardCanvas";
import { BoardDragOverlay } from "./BoardDragOverlay";
import { BoardStarButton } from "./BoardStarButton";
import { ConnectionStatusBanner } from "./realtime/ConnectionStatusBanner";
import { PresenceAvatars } from "./realtime/PresenceAvatars";

import { useBoardEngine } from "../engine/useBoardEngine";
import { useHydrateBoard } from "../hooks/useHydrateBoard";
import {
  BoardErrorBoundary,
  ModalErrorBoundary,
} from "../../../components/error/ErrorBoundary";

// ============================================================================
// DTO TYPES (kept here — the route page imports FullBoardDto from this module)
// ============================================================================

export type CardDto = {
  id: string;
  boardId: string;
  title: string;
  position: string;
  listId: string;
  description?: string | null;
};

export type ListDto = {
  id: string;
  boardId: string;
  title: string;
  position: string;
  cards: CardDto[];
};

export type FullBoardDto = {
  id: string;
  title: string;
  lists: ListDto[];
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function BoardView({
  data,
  boardId,
  authToken,
}: {
  data: FullBoardDto;
  boardId: string;
  authToken?: string;
}) {
  const engine = useBoardEngine(boardId, authToken);
  const { isMounted } = useHydrateBoard(data, boardId, engine.initBoard);

  // SSR guard — the DnD tree is client-only.
  if (!isMounted) return null;

  return (
    <BoardErrorBoundary boardId={boardId}>
      {/*
        Realtime status bar — read-only views over the stores the engine
        already wired (sync orchestrator + presence). The "Live" pill widens
        into Reconnect/Reload affordances when the FSM degrades; the avatars
        show other users on this board (local user filtered out).
      */}
      <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-1">
        <div className="flex items-center gap-2">
          <BoardStarButton boardId={boardId} boardTitle={data.title} />
          <ConnectionStatusBanner onManualReconnect={engine.triggerManualReconnect} />
        </div>
        <PresenceAvatars currentUserId={engine.presenceUserId} />
      </div>

      <DndContext {...engine.dndProps}>
        <BoardCanvas listOrder={engine.listOrder} boardId={boardId} />

        <DragOverlay adjustScale={false}>
          <BoardDragOverlay
            activeId={engine.activeId}
            activeType={engine.activeType}
            dragMeta={engine.dragMeta}
          />
        </DragOverlay>
      </DndContext>

      <ModalErrorBoundary>
        <CardModal />
      </ModalErrorBoundary>
    </BoardErrorBoundary>
  );
}
