"use client";

// apps/web/src/features/board/components/BoardCanvas.tsx
//
// Phase 1.3 (F1.3.3) — the scrollable list rail.
//
// Renders the ordered lists inside a horizontal SortableContext plus the
// "add list" form. Owns the delete-card-with-undo callback wiring so BoardView
// stays presentational.
//
// Virtualization decision (D5): boards with > 10 lists are swapped to
// VirtualizedBoard in F1.3.4. Until then everything renders normally so
// dnd-kit behaves identically to before.

import {
  SortableContext,
  horizontalListSortingStrategy,
} from "@dnd-kit/sortable";

import { ListColumn } from "./ListColumn";
import CreateListForm from "./create-list-form";
import { ListErrorBoundary } from "../../../components/error/ErrorBoundary";
import { useDeleteCardWithUndo } from "../hooks/useDeleteCardWithUndo";

interface BoardCanvasProps {
  listOrder: string[];
  boardId: string;
}

export function BoardCanvas({ listOrder, boardId }: BoardCanvasProps) {
  const onDeleteCard = useDeleteCardWithUndo();

  return (
    <div className="flex items-start gap-4 overflow-x-auto h-full pb-8 px-4 pt-4 scrollbar-hide">
      <SortableContext items={listOrder} strategy={horizontalListSortingStrategy}>
        {listOrder.map((listId) => (
          <ListErrorBoundary key={listId} listId={listId}>
            <ListColumn listId={listId} boardId={boardId} onDeleteCard={onDeleteCard} />
          </ListErrorBoundary>
        ))}
      </SortableContext>

      <CreateListForm boardId={boardId} />
    </div>
  );
}
