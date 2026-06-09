"use client";

import { useMemo, memo } from "react";
import { useSortable, SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { MoreHorizontal } from "lucide-react";

// 🌟 مسیر ایمپورت‌ها بر اساس معماری جدید Feature-Sliced Design اصلاح شد
// Phase 1.3 (F1.3.1) — granular reads now come from the board-state engine
// instead of inline store selectors.
import { useListCardIds, useList } from "../engine/useBoardState";
import { CardItem } from "./CardItem";
import CreateCardForm from "./create-card-form"; // 🌟 @ts-ignore حذف شد چون باگ پراپ‌ها رفع شده است
import { CardErrorBoundary } from "../../../components/error/ErrorBoundary";

interface ListColumnProps {
  listId: string;
  boardId: string;
  onDeleteCard: (id: string) => void;
}

export const ListColumn = memo(function ListColumn({ listId, boardId, onDeleteCard }: ListColumnProps) {
  const cardIds = useListCardIds(listId);
  const list = useList(listId);

  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: listId,
    data: {
      type: "List",
      listId,
    },
  });

  const style = useMemo(() => ({
    transform: CSS.Translate.toString(transform),
    transition,
  }), [transform, transition]);

  if (!list) return null;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`w-72 shrink-0 flex flex-col bg-gray-100/80 rounded-xl h-fit max-h-full border border-gray-200/50 shadow-sm transition-opacity content-visibility-auto
        ${isDragging ? "opacity-30" : "opacity-100"}`}
    >
      <div
        {...attributes}
        {...listeners}
        role="button"
        tabIndex={0}
        aria-label={`لیست: ${list.title}، شامل ${cardIds.length} کارت. برای برداشتن، کلید فاصله را فشار دهید.`}
        aria-roledescription="لیست قابل جابجایی"
        className="p-3 flex items-center justify-between cursor-grab active:cursor-grabbing group outline-none focus-visible:ring-2 focus-visible:ring-blue-500 rounded-t-xl"
      >
        <div className="flex items-center gap-2">
          <h2 className="font-bold text-gray-700 text-sm px-1 italic line-clamp-1">
            {list.title}
          </h2>
          <span className="bg-gray-200 text-gray-500 px-2 py-0.5 rounded-full text-[10px] font-bold">
            {cardIds.length}
          </span>
        </div>
        <button 
          aria-label="گزینه‌های لیست"
          onPointerDown={(e) => e.stopPropagation()} 
          className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-gray-300"
        >
          <MoreHorizontal size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto overflow-x-hidden p-2 flex flex-col gap-2 min-h-[50px] scrollbar-thin scrollbar-thumb-gray-300">
        <SortableContext items={cardIds} strategy={verticalListSortingStrategy}>
          {cardIds.map((cardId: string) => (
            <CardErrorBoundary
              key={cardId}
              cardId={cardId}
            >
              <CardItem
                cardId={cardId}
                onDeleteCard={onDeleteCard}
              />
            </CardErrorBoundary>
          ))}
        </SortableContext>

        {cardIds.length === 0 && !isDragging && (
          <div className="flex flex-col items-center justify-center py-6 mx-1 border-2 border-dashed border-gray-300/50 rounded-lg bg-gray-50/50 text-gray-400">
            <span className="text-[10px] font-bold uppercase tracking-wider">Drop cards here</span>
          </div>
        )}
      </div>

      <div className="p-2">
        <CreateCardForm listId={listId} boardId={boardId} />
      </div>
    </div>
  );
});