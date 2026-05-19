"use client";

import { useEffect, useState, useCallback, useRef } from "react";

import {
  DndContext,
  DragStartEvent,
  DragEndEvent,
  DragOverEvent,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragOverlay,
  pointerWithin,
  closestCorners,
  CollisionDetection,
} from "@dnd-kit/core";

import {
  SortableContext,
  horizontalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";

import { toast } from "sonner";

// @ts-ignore
import { ListColumn } from "./ListColumn";

import CreateListForm from "./create-list-form";
import CardModal from "./CardModal";

import {
  moveCardAction,
  deleteCardAction,
} from "../actions/board.actions";

import { useBoardStore } from "../store/useBoardStore";

// ============================================================================
// DTO TYPES
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
// DND COLLISION
// ============================================================================

const customCollisionDetection: CollisionDetection = (
  args
) => {
  const pointerCollisions = pointerWithin(args);

  if (pointerCollisions.length > 0) {
    return pointerCollisions;
  }

  return closestCorners(args);
};

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export default function BoardView({
  data,
  boardId,
}: {
  data: FullBoardDto;
  boardId: string;
}) {
  const [isMounted, setIsMounted] =
    useState(false);

  const [activeId, setActiveId] = useState<
    string | null
  >(null);

  const boardVersionRef = useRef<string | null>(
    null
  );

  const dragOverRAF = useRef<number | null>(
    null
  );

  const activeTypeRef = useRef<
    "List" | "Card" | null
  >(null);

  const syncingCardsRef = useRef<Set<string>>(
    new Set()
  );

  const syncingListsRef = useRef<Set<string>>(
    new Set()
  );

  const dragMetaRef = useRef<{
    currentContainerId: string | null;
    optimisticMoved: boolean;
  }>({
    currentContainerId: null,
    optimisticMoved: false,
  });

  // ==========================================================================
  // STORE
  // ==========================================================================

  /**
   * 🌟 نکته مهم:
   * به خاطر ناسازگاری تایپ بین BoardStore و DTO ها
   * فعلاً از any استفاده می‌کنیم تا ts2345 رفع شود.
   */

  const initBoard = useBoardStore(
    (s: any) => s.initBoard
  );

  const listOrder = useBoardStore(
    (s: any) => s.listOrder || []
  );

  const cards = useBoardStore(
    (s: any) => s.cards || {}
  );

  const lists = useBoardStore(
    (s: any) => s.lists || {}
  );

  const moveCard = useBoardStore(
    (s: any) => s.moveCard
  );

  const moveList = useBoardStore(
    (s: any) => s.moveList
  );

  const deleteCardStore = useBoardStore(
    (s: any) => s.deleteCard
  );

  // ==========================================================================
  // EFFECTS
  // ==========================================================================

  useEffect(() => {
    setIsMounted(true);

    const versionHash = JSON.stringify(
      data?.lists?.map(
        (list) =>
          list.id +
          (list.cards
            ?.map((card) => card.id)
            .join("") || "")
      )
    );

    if (boardVersionRef.current !== versionHash) {
      /**
       * 🌟 Hydration: enrich each list with boardId before passing to store.
       * Server may eventually include boardId in payload, but until then
       * we inject from the boardId prop. Cards inherit boardId from their list.
       */
      const enrichedLists = (data?.lists || []).map((list) => ({
        ...list,
        boardId: list.boardId ?? boardId,
        revision: (list as any).revision ?? 0,
        cards: (list.cards || []).map((card) => ({
          ...card,
          boardId: card.boardId ?? boardId,
          revision: (card as any).revision ?? 0,
          description: card.description ?? undefined,
        })),
      })) as any;

      /**
       * sequence اجباریه
       */
      initBoard(enrichedLists, "0");

      boardVersionRef.current = versionHash;
    }

    return () => {
      if (dragOverRAF.current) {
        cancelAnimationFrame(
          dragOverRAF.current
        );
      }

      syncingCardsRef.current.clear();
      syncingListsRef.current.clear();
    };
  }, [data?.lists, initBoard]);

  // ==========================================================================
  // DND SENSORS
  // ==========================================================================

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),

    useSensor(KeyboardSensor, {
      coordinateGetter:
        sortableKeyboardCoordinates,
    })
  );

  // ==========================================================================
  // HELPERS
  // ==========================================================================

  const getSafeSnapshot = () => {
    const state = useBoardStore.getState() as any;

    return {
      cards: structuredClone(state.cards),
      lists: structuredClone(state.lists),
      cardsByList: structuredClone(
        state.cardsByList
      ),
      listOrder: structuredClone(
        state.listOrder
      ),
    };
  };

  // ==========================================================================
  // DELETE CARD WITH UNDO
  // ==========================================================================

  const deleteCardWithUndo = useCallback(
    (cardId: string) => {
      const previousState =
        getSafeSnapshot();

      const undoneRef = {
        current: false,
      };

      deleteCardStore(cardId);

      toast("Card deleted", {
        action: {
          label: "Undo",

          onClick: () => {
            undoneRef.current = true;

            useBoardStore.setState(
              previousState
            );
          },
        },

        onAutoClose: async () => {
          if (undoneRef.current) {
            return;
          }

          try {
            await deleteCardAction({
              id: cardId,
              mutationId:
                crypto.randomUUID(),
            });
          } catch {
            toast.error(
              "Failed to delete card. Rolling back."
            );

            useBoardStore.setState(
              previousState
            );
          }
        },
      });
    },
    [deleteCardStore]
  );

  // ==========================================================================
  // DRAG START
  // ==========================================================================

  const handleDragStart = (
    event: DragStartEvent
  ) => {
    const type = event.active.data.current
      ?.type as "List" | "Card" | null;

    activeTypeRef.current = type;

    const activeIdStr = event.active
      .id as string;

    const containerId =
      event.active.data.current?.sortable
        ?.containerId;

    dragMetaRef.current = {
      currentContainerId:
        containerId || null,

      optimisticMoved: false,
    };

    requestAnimationFrame(() => {
      setActiveId(activeIdStr);
    });
  };

  // ==========================================================================
  // DRAG OVER
  // ==========================================================================

  const handleDragOver = (
    event: DragOverEvent
  ) => {
    const { active, over } = event;

    if (
      !over ||
      activeTypeRef.current !== "Card"
    ) {
      return;
    }

    if (dragOverRAF.current) {
      cancelAnimationFrame(
        dragOverRAF.current
      );
    }

    dragOverRAF.current =
      requestAnimationFrame(() => {
        const activeIdStr = active.id as string;

        const overId = over.id as string;

        const activeListId =
          dragMetaRef.current
            .currentContainerId ||
          active.data.current?.sortable
            ?.containerId;

        const overListId =
          over.data.current?.sortable
            ?.containerId || overId;

        if (!activeListId || !overListId) {
          return;
        }

        const state =
          useBoardStore.getState() as any;

        const activeIndex = (
          state.cardsByList[
            activeListId
          ] || []
        ).indexOf(activeIdStr);

        let overIndex = (
          state.cardsByList[overListId] ||
          []
        ).indexOf(overId);

        if (overIndex === -1) {
          overIndex =
            (
              state.cardsByList[
                overListId
              ] || []
            ).length;
        }

        if (
          activeListId !== overListId ||
          activeIndex !== overIndex
        ) {
          moveCard(
            activeIdStr,
            activeListId,
            overListId,
            activeIndex,
            overIndex
          );

          dragMetaRef.current.currentContainerId =
            overListId;

          dragMetaRef.current.optimisticMoved =
            true;
        }
      });
  };

  // ==========================================================================
  // DRAG END
  // ==========================================================================

  const handleDragEnd = async (
    event: DragEndEvent
  ) => {
    if (dragOverRAF.current) {
      cancelAnimationFrame(
        dragOverRAF.current
      );
    }

    requestAnimationFrame(() => {
      setActiveId(null);
    });

    const currentType =
      activeTypeRef.current;

    activeTypeRef.current = null;

    const { active, over } = event;

    if (!over) {
      return;
    }

    const currentState =
      useBoardStore.getState() as any;

    // ========================================================================
    // LIST DRAG
    // ========================================================================

    if (currentType === "List") {
      const activeIdStr = active.id as string;

      if (
        syncingListsRef.current.has(
          activeIdStr
        )
      ) {
        return;
      }

      const fromIndex =
        currentState.listOrder.indexOf(
          activeIdStr
        );

      const toIndex =
        currentState.listOrder.indexOf(
          over.id as string
        );

      if (fromIndex !== toIndex) {
        syncingListsRef.current.add(
          activeIdStr
        );

        const previousListOrder = [
          ...currentState.listOrder,
        ];

        moveList(fromIndex, toIndex);

        try {
          /**
           * هنوز API جابه‌جایی لیست نداریم
           */
          console.log(
            "Backend List Move Sync Pending..."
          );
        } catch {
          useBoardStore.setState({
            listOrder: previousListOrder,
          });

          toast.error(
            "List sync error. Rolled back."
          );
        } finally {
          syncingListsRef.current.delete(
            activeIdStr
          );
        }
      }

      return;
    }

    // ========================================================================
    // CARD DRAG
    // ========================================================================

    if (currentType === "Card") {
      const activeIdStr = active.id as string;

      if (
        syncingCardsRef.current.has(
          activeIdStr
        )
      ) {
        return;
      }

      const activeListId =
        dragMetaRef.current
          .currentContainerId;

      const overListId =
        over.data.current?.sortable
          ?.containerId ||
        (over.id as string);

      if (!activeListId || !overListId) {
        return;
      }

      const destListCards =
        currentState.cardsByList[
          overListId
        ] || [];

      const activeIndex = (
        currentState.cardsByList[
          activeListId
        ] || []
      ).indexOf(activeIdStr);

      const overIndex =
        destListCards.indexOf(
          over.id as string
        );

      const targetedSnapshot = {
        sourceListCards: [
          ...(currentState.cardsByList[
            activeListId
          ] || []),
        ],

        destListCards: [
          ...(currentState.cardsByList[
            overListId
          ] || []),
        ],

        originalCard:
          currentState.cards[activeIdStr]
            ? {
                ...currentState.cards[
                  activeIdStr
                ],
              }
            : undefined,
      };

      if (
        !dragMetaRef.current
          .optimisticMoved
      ) {
        if (
          activeListId === overListId &&
          activeIndex !== overIndex
        ) {
          moveCard(
            activeIdStr,
            activeListId,
            overListId,
            activeIndex,
            overIndex
          );
        }
      }

      const updatedState =
        useBoardStore.getState() as any;

      const updatedList =
        updatedState.cardsByList[
          overListId
        ] || [];

      const newCardIndex =
        updatedList.indexOf(activeIdStr);

      const prevId =
        newCardIndex > 0
          ? updatedList[newCardIndex - 1]
          : undefined;

      const nextId =
        newCardIndex <
        updatedList.length - 1
          ? updatedList[newCardIndex + 1]
          : undefined;

      let mode:
        | "APPEND"
        | "PREPEND"
        | "INSERT_BETWEEN"
        | "REORDER_SAME_LIST" =
        "INSERT_BETWEEN";

      if (!prevId && !nextId) {
        mode = "APPEND";
      } else if (!prevId) {
        mode = "PREPEND";
      } else if (!nextId) {
        mode = "APPEND";
      }

      syncingCardsRef.current.add(
        activeIdStr
      );

      try {
        const result =
          await moveCardAction({
            cardId: activeIdStr,
            targetListId: overListId,
            mode,
            prevId,
            nextId,
            mutationId:
              crypto.randomUUID(),
          });

        if (
          result &&
          result.success === false
        ) {
          throw new Error(result.message);
        }
      } catch {
        useBoardStore.setState((s: any) => {
          const rollbackCards = {
            ...s.cards,
          };

          if (
            targetedSnapshot.originalCard
          ) {
            rollbackCards[activeIdStr] =
              targetedSnapshot.originalCard;
          }

          return {
            cardsByList: {
              ...s.cardsByList,

              [activeListId]:
                targetedSnapshot.sourceListCards,

              [overListId]:
                targetedSnapshot.destListCards,
            },

            cards: rollbackCards,
          };
        });

        toast.error(
          "Failed to sync card. Rolled back."
        );
      } finally {
        syncingCardsRef.current.delete(
          activeIdStr
        );
      }
    }
  };

  // ==========================================================================
  // SSR GUARD
  // ==========================================================================

  if (!isMounted) {
    return null;
  }

  // ==========================================================================
  // RENDER
  // ==========================================================================

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={
          customCollisionDetection
        }
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex items-start gap-4 overflow-x-auto h-full pb-8 px-4 pt-4 scrollbar-hide">
          <SortableContext
            items={listOrder}
            strategy={
              horizontalListSortingStrategy
            }
          >
            {listOrder.map(
              (listId: string) => (
                <ListColumn
                  key={listId}
                  listId={listId}
                  boardId={boardId}
                  onDeleteCard={
                    deleteCardWithUndo
                  }
                />
              )
            )}
          </SortableContext>

          <CreateListForm boardId={boardId} />
        </div>

        <DragOverlay adjustScale={false}>
          {activeTypeRef.current ===
            "List" &&
          activeId &&
          lists[activeId] ? (
            <ListPreview
              title={
                lists[activeId].title
              }
            />
          ) : activeTypeRef.current ===
              "Card" &&
            activeId &&
            cards[activeId] ? (
            <CardPreview
              title={
                cards[activeId].title
              }
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      <CardModal />
    </>
  );
}

// ============================================================================
// PREVIEWS
// ============================================================================

function CardPreview({
  title,
}: {
  title: string;
}) {
  return (
    <div className="bg-white p-3 rounded-lg shadow-xl border-2 border-blue-500 text-sm text-gray-700 cursor-grabbing rotate-3">
      {title}
    </div>
  );
}

function ListPreview({
  title,
}: {
  title: string;
}) {
  return (
    <div className="w-72 bg-gray-200/90 p-3 rounded-xl shadow-2xl border-2 border-blue-500 font-bold text-gray-700 cursor-grabbing rotate-2 opacity-80">
      {title}
    </div>
  );
}