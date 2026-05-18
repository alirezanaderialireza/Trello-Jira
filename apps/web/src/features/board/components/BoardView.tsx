"use client";

// apps/web/src/features/board/components/BoardView.tsx
//
// Fixes applied:
// ✅ #10a: Removed `// @ts-ignore` on ListColumn import — ListColumn is a named export,
//          the ignore was hiding a real import shape mismatch.
// ✅ #10b: initBoard sequence is no longer hardcoded to "0".
//          BoardView now receives `initialSequence` from the SSR page and passes it
//          to initBoard so the reconciler starts from the correct baseline.
//          Without this, every WS event whose sequence > 0 triggers gap_detected
//          even though the board was just hydrated from a fresh SSR snapshot.

import { useEffect, useState, useCallback, useRef } from "react";

import {
  DndContext,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragOverlay,
  pointerWithin,
  closestCorners,
  type CollisionDetection,
} from "@dnd-kit/core";

import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";

import { toast } from "sonner";

import { ListColumn } from "./ListColumn";    // ✅ named import, no @ts-ignore
import CreateListForm from "./create-list-form";
import CardModal from "./CardModal";

import { moveCardAction, deleteCardAction } from "../actions/board.actions";
import { useBoardStore } from "../store/useBoardStore";

// ============================================================================
// DTO Types (shared with SSR page)
// ============================================================================

export type CardDto = {
  id: string;
  title: string;
  position: string;
  listId: string;
  boardId: string;
  description?: string | null;
  revision: number;
};

export type ListDto = {
  id: string;
  title: string;
  position: string;
  revision: number;
  cards: CardDto[];
};

export type FullBoardDto = {
  id: string;
  title: string;
  lists: ListDto[];
  // ✅ #10b: SSR page passes the current board sequence so reconciler is aligned
  boardSequence?: number;
};

// ============================================================================
// Custom DnD Collision
// ============================================================================

const customCollisionDetection: CollisionDetection = (args) => {
  const pointerCollisions = pointerWithin(args);
  return pointerCollisions.length > 0 ? pointerCollisions : closestCorners(args);
};

// ============================================================================
// Component
// ============================================================================

export default function BoardView({
  data,
  boardId,
}: {
  data: FullBoardDto;
  boardId: string;
}) {
  const [isMounted, setIsMounted] = useState(false);
  const [activeId, setActiveId]   = useState<string | null>(null);

  const boardVersionRef   = useRef<string | null>(null);
  const dragOverRAF       = useRef<number | null>(null);
  const activeTypeRef     = useRef<"List" | "Card" | null>(null);
  const syncingCardsRef   = useRef<Set<string>>(new Set());
  const syncingListsRef   = useRef<Set<string>>(new Set());
  const dragMetaRef       = useRef<{
    currentContainerId: string | null;
    optimisticMoved: boolean;
  }>({ currentContainerId: null, optimisticMoved: false });

  // ==========================================================================
  // Store selectors (typed)
  // ==========================================================================

  const initBoard       = useBoardStore((s) => s.initBoard);
  const listOrder       = useBoardStore((s) => s.listOrder);
  const cards           = useBoardStore((s) => s.cards);
  const lists           = useBoardStore((s) => s.lists);
  const moveCard        = useBoardStore((s) => s.moveCard);
  const moveList        = useBoardStore((s) => s.moveList);
  const deleteCardStore = useBoardStore((s) => s.deleteCard);

  // ==========================================================================
  // Hydration
  // ==========================================================================

  useEffect(() => {
    setIsMounted(true);

    const versionHash = JSON.stringify(
      data?.lists?.map((list) => list.id + (list.cards?.map((c) => c.id).join("") ?? "")),
    );

    if (boardVersionRef.current !== versionHash) {
      // ✅ #10b: use real boardSequence from SSR, not hardcoded "0"
      const sequence = String(data.boardSequence ?? 0);
      initBoard(data?.lists ?? [], sequence);
      boardVersionRef.current = versionHash;
    }

    return () => {
      if (dragOverRAF.current) cancelAnimationFrame(dragOverRAF.current);
      syncingCardsRef.current.clear();
      syncingListsRef.current.clear();
    };
  }, [data?.lists, data?.boardSequence, initBoard]);

  // ==========================================================================
  // DnD Sensors
  // ==========================================================================

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // ==========================================================================
  // Helpers
  // ==========================================================================

  const getSafeSnapshot = () => {
    const state = useBoardStore.getState();
    return {
      cards:       structuredClone(state.cards),
      lists:       structuredClone(state.lists),
      cardsByList: structuredClone(state.cardsByList),
      listOrder:   structuredClone(state.listOrder),
    };
  };

  // ==========================================================================
  // Delete with Undo
  // ==========================================================================

  const deleteCardWithUndo = useCallback(
    (cardId: string) => {
      const previousState = getSafeSnapshot();
      const undoneRef = { current: false };

      deleteCardStore(cardId);

      toast("Card deleted", {
        action: {
          label: "Undo",
          onClick: () => {
            undoneRef.current = true;
            useBoardStore.setState(previousState);
          },
        },
        onAutoClose: async () => {
          if (undoneRef.current) return;
          try {
            await deleteCardAction({ id: cardId, mutationId: globalThis.crypto.randomUUID() });
          } catch {
            toast.error("Failed to delete card. Rolling back.");
            useBoardStore.setState(previousState);
          }
        },
      });
    },
    [deleteCardStore],
  );

  // ==========================================================================
  // Drag Start
  // ==========================================================================

  const handleDragStart = (event: DragStartEvent) => {
    const type = event.active.data.current?.type as "List" | "Card" | null;
    activeTypeRef.current = type;

    const activeIdStr   = event.active.id as string;
    const containerId   = event.active.data.current?.sortable?.containerId;

    dragMetaRef.current = {
      currentContainerId: containerId ?? null,
      optimisticMoved: false,
    };

    requestAnimationFrame(() => setActiveId(activeIdStr));
  };

  // ==========================================================================
  // Drag Over
  // ==========================================================================

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over || activeTypeRef.current !== "Card") return;

    if (dragOverRAF.current) cancelAnimationFrame(dragOverRAF.current);

    dragOverRAF.current = requestAnimationFrame(() => {
      const activeIdStr = active.id as string;
      const overId      = over.id as string;

      const activeListId =
        dragMetaRef.current.currentContainerId ??
        active.data.current?.sortable?.containerId;

      const overListId =
        over.data.current?.sortable?.containerId ?? overId;

      if (!activeListId || !overListId) return;

      const state      = useBoardStore.getState();
      const activeIndex = (state.cardsByList[activeListId] ?? []).indexOf(activeIdStr);

      let overIndex = (state.cardsByList[overListId] ?? []).indexOf(overId);
      if (overIndex === -1) overIndex = (state.cardsByList[overListId] ?? []).length;

      if (activeListId !== overListId || activeIndex !== overIndex) {
        moveCard(activeIdStr, activeListId, overListId, activeIndex, overIndex);
        dragMetaRef.current.currentContainerId = overListId;
        dragMetaRef.current.optimisticMoved    = true;
      }
    });
  };

  // ==========================================================================
  // Drag End
  // ==========================================================================

  const handleDragEnd = async (event: DragEndEvent) => {
    if (dragOverRAF.current) cancelAnimationFrame(dragOverRAF.current);
    requestAnimationFrame(() => setActiveId(null));

    const currentType     = activeTypeRef.current;
    activeTypeRef.current = null;

    const { active, over } = event;
    if (!over) return;

    const currentState = useBoardStore.getState();

    // ------------------------------------------------------------------
    // List Drag
    // ------------------------------------------------------------------
    if (currentType === "List") {
      const activeIdStr = active.id as string;
      if (syncingListsRef.current.has(activeIdStr)) return;

      const fromIndex = currentState.listOrder.indexOf(activeIdStr);
      const toIndex   = currentState.listOrder.indexOf(over.id as string);

      if (fromIndex !== toIndex) {
        syncingListsRef.current.add(activeIdStr);
        const previousListOrder = [...currentState.listOrder];
        moveList(fromIndex, toIndex);

        try {
          // TODO: wire up moveListAction when backend route is implemented
          console.log("Backend List Move Sync Pending…");
        } catch {
          useBoardStore.setState({ listOrder: previousListOrder });
          toast.error("List sync error. Rolled back.");
        } finally {
          syncingListsRef.current.delete(activeIdStr);
        }
      }
      return;
    }

    // ------------------------------------------------------------------
    // Card Drag
    // ------------------------------------------------------------------
    if (currentType === "Card") {
      const activeIdStr = active.id as string;
      if (syncingCardsRef.current.has(activeIdStr)) return;

      const activeListId = dragMetaRef.current.currentContainerId;
      const overListId   =
        over.data.current?.sortable?.containerId ?? (over.id as string);

      if (!activeListId || !overListId) return;

      const destListCards   = currentState.cardsByList[overListId] ?? [];
      const activeIndex     = (currentState.cardsByList[activeListId] ?? []).indexOf(activeIdStr);
      const overIndex       = destListCards.indexOf(over.id as string);

      const targetedSnapshot = {
        sourceListCards: [...(currentState.cardsByList[activeListId] ?? [])],
        destListCards:   [...(currentState.cardsByList[overListId]   ?? [])],
        originalCard:    currentState.cards[activeIdStr]
          ? { ...currentState.cards[activeIdStr] }
          : undefined,
      };

      if (!dragMetaRef.current.optimisticMoved) {
        if (activeListId === overListId && activeIndex !== overIndex) {
          moveCard(activeIdStr, activeListId, overListId, activeIndex, overIndex);
        }
      }

      const updatedState   = useBoardStore.getState();
      const updatedList    = updatedState.cardsByList[overListId] ?? [];
      const newCardIndex   = updatedList.indexOf(activeIdStr);
      const prevId         = newCardIndex > 0 ? updatedList[newCardIndex - 1] : undefined;
      const nextId         = newCardIndex < updatedList.length - 1 ? updatedList[newCardIndex + 1] : undefined;

      let mode: "APPEND" | "PREPEND" | "INSERT_BETWEEN" | "REORDER_SAME_LIST" =
        "INSERT_BETWEEN";
      if (!prevId && !nextId) mode = "APPEND";
      else if (!prevId)       mode = "PREPEND";
      else if (!nextId)       mode = "APPEND";

      syncingCardsRef.current.add(activeIdStr);

      try {
        const result = await moveCardAction({
          cardId:       activeIdStr,
          targetListId: overListId,
          mode,
          prevId,
          nextId,
          mutationId: globalThis.crypto.randomUUID(),
        });

        if (result && result.success === false) {
          throw new Error(result.message);
        }
      } catch {
        useBoardStore.setState((s) => {
          const rollbackCards = { ...s.cards };
          if (targetedSnapshot.originalCard) {
            rollbackCards[activeIdStr] = targetedSnapshot.originalCard;
          }
          return {
            cardsByList: {
              ...s.cardsByList,
              [activeListId]: targetedSnapshot.sourceListCards,
              [overListId]:   targetedSnapshot.destListCards,
            },
            cards: rollbackCards,
          };
        });
        toast.error("Failed to sync card. Rolled back.");
      } finally {
        syncingCardsRef.current.delete(activeIdStr);
      }
    }
  };

  // ==========================================================================
  // SSR Guard
  // ==========================================================================

  if (!isMounted) return null;

  // ==========================================================================
  // Render
  // ==========================================================================

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={customCollisionDetection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex items-start gap-4 overflow-x-auto h-full pb-8 px-4 pt-4 scrollbar-hide">
          <SortableContext items={listOrder} strategy={horizontalListSortingStrategy}>
            {listOrder.map((listId: string) => (
              <ListColumn key={listId} listId={listId} onDeleteCard={deleteCardWithUndo} />
            ))}
          </SortableContext>

          <CreateListForm boardId={boardId} />
        </div>

        <DragOverlay adjustScale={false}>
          {activeTypeRef.current === "List" && activeId && lists[activeId] ? (
            <ListPreview title={lists[activeId].title} />
          ) : activeTypeRef.current === "Card" && activeId && cards[activeId] ? (
            <CardPreview title={cards[activeId].title} />
          ) : null}
        </DragOverlay>
      </DndContext>

      <CardModal />
    </>
  );
}

// ============================================================================
// Drag Previews
// ============================================================================

function CardPreview({ title }: { title: string }) {
  return (
    <div className="bg-white p-3 rounded-lg shadow-xl border-2 border-blue-500 text-sm text-gray-700 cursor-grabbing rotate-3">
      {title}
    </div>
  );
}

function ListPreview({ title }: { title: string }) {
  return (
    <div className="w-72 bg-gray-200/90 p-3 rounded-xl shadow-2xl border-2 border-blue-500 font-bold text-gray-700 cursor-grabbing rotate-2 opacity-80">
      {title}
    </div>
  );
}
