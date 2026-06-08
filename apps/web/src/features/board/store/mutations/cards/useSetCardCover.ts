// apps/web/src/features/board/store/mutations/cards/useSetCardCover.ts
//
// Phase 1.2 (F1.2.7) — optimistic mutation for setting/clearing card cover.
// Mirrors useUpdateCardDueDate exactly.

import { useMutation }    from "@tanstack/react-query";
import { toast }          from "sonner";
import { useBoardStore }  from "../../useBoardStore";
import { boardApi }       from "../../../api/services/boardApi";

interface SetCardCoverVariables {
  cardId:     string;
  boardId:    string;
  coverData:  { type: string; id: string } | null;
  correlationId: string;
}

export function useSetCardCover() {
  const updateCard = useBoardStore((s) => s.updateCard);

  return useMutation({
    mutationFn: (vars: SetCardCoverVariables) =>
      boardApi.setCardCover({
        cardId:         vars.cardId,
        boardId:        vars.boardId,
        coverData:      vars.coverData,
        idempotencyKey: vars.correlationId,
        correlationId:  vars.correlationId,
      }),

    onMutate: (vars) => {
      const prevCover = useBoardStore.getState().cards[vars.cardId]?.coverData ?? null;
      // Optimistic update
      updateCard(vars.cardId, { coverData: vars.coverData });
      return { prevCover };
    },

    onError: (_err, vars, context) => {
      // Rollback
      updateCard(vars.cardId, { coverData: context?.prevCover ?? null });
      toast.error("تنظیم پوشش کارت با خطا مواجه شد.");
    },
  });
}
