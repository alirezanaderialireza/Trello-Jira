"use client";

// apps/web/src/features/board/components/BoardDragOverlay.tsx
//
// Phase 1.3 (F1.3.3) — the dragged-item clone shown inside dnd-kit's
// <DragOverlay>. For cards it is sized to the exact rect captured in
// onDragStart (dragMeta) so there is no layout shift when the drag begins (D6).

import { useCard, useList } from "../engine/useBoardState";
import type { DragType, DragMeta } from "../engine/useDragEngine";

interface BoardDragOverlayProps {
  activeId: string | null;
  activeType: DragType | null;
  dragMeta: DragMeta | null;
}

export function BoardDragOverlay({ activeId, activeType, dragMeta }: BoardDragOverlayProps) {
  // Hooks must run unconditionally — pass "" (→ undefined) when not applicable.
  const card = useCard(activeType === "Card" && activeId ? activeId : "");
  const list = useList(activeType === "List" && activeId ? activeId : "");

  if (!activeId) return null;

  if (activeType === "List" && list) {
    return (
      <div className="w-72 bg-gray-200/90 p-3 rounded-xl shadow-2xl border-2 border-blue-500 font-bold text-gray-700 cursor-grabbing rotate-2 opacity-80">
        {list.title}
      </div>
    );
  }

  if (activeType === "Card" && card) {
    return (
      <div
        style={dragMeta ? { width: dragMeta.width, height: dragMeta.height } : undefined}
        className="box-border overflow-hidden bg-white p-3 rounded-lg shadow-xl border-2 border-blue-500 text-sm text-gray-700 cursor-grabbing rotate-3"
      >
        {card.title}
      </div>
    );
  }

  return null;
}
