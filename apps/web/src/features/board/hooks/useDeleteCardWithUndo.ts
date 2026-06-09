"use client";

// apps/web/src/features/board/hooks/useDeleteCardWithUndo.ts
//
// Phase 1.3 (F1.3.3) — extracted from BoardView. Optimistic card delete with
// an Undo toast: the row disappears immediately; on toast auto-close the
// server delete is sent; Undo (or a server failure) restores the snapshot.
//
// Behaviour preserved verbatim from the original BoardView implementation —
// this is the delete-undo snapshot feature, which is separate from the
// drag move rollback that now lives in the mutation lifecycle manager.

import { useCallback } from "react";
import { toast } from "sonner";

import { useBoardStore } from "../store/useBoardStore";
import { deleteCardAction } from "../actions/board.actions";

export function useDeleteCardWithUndo() {
  const deleteCardStore = useBoardStore((s: any) => s.deleteCard);

  return useCallback(
    (cardId: string) => {
      const state = useBoardStore.getState() as any;
      const previousState = {
        cards: structuredClone(state.cards),
        lists: structuredClone(state.lists),
        cardsByList: structuredClone(state.cardsByList),
        listOrder: structuredClone(state.listOrder),
      };

      const undoneRef = { current: false };

      deleteCardStore(cardId);

      toast("کارت حذف شد", {
        action: {
          label: "بازگردانی",
          onClick: () => {
            undoneRef.current = true;
            useBoardStore.setState(previousState);
          },
        },
        onAutoClose: async () => {
          if (undoneRef.current) return;
          try {
            await deleteCardAction({ id: cardId, mutationId: crypto.randomUUID() });
          } catch {
            toast.error("حذف کارت ناموفق بود؛ در حال بازگردانی.");
            useBoardStore.setState(previousState);
          }
        },
      });
    },
    [deleteCardStore],
  );
}
