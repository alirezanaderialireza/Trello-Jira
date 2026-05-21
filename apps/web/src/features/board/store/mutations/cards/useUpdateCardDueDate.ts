// apps/web/src/features/board/store/mutations/cards/useUpdateCardDueDate.ts
import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

interface UpdateCardDueDateVariables {
  cardId: string;
  boardId: string;
  /** ISO-8601 UTC string, or null to clear the due date. */
  dueDate: string | null;
  correlationId: string;
}

export function useUpdateCardDueDate() {
  return useOptimisticMutation<UpdateCardDueDateVariables, any>({
    mutationFn: (vars) =>
      boardApi.updateCardDueDate({ cardId: vars.cardId, dueDate: vars.dueDate, mutationId: vars.correlationId }),

    targetSnapshot: (vars) => ({ cards: [vars.cardId] }),

    generateEnvelope: (vars, state) => {
      const card = state.cards[vars.cardId];
      if (!card) return null;
      return createOptimisticEnvelope(
        "card.due_date_updated",
        { cardId: vars.cardId, boardId: vars.boardId, dueDate: vars.dueDate },
        vars.cardId, "card", card.revision, vars.correlationId,
      );
    },
    errorMessage: "تنظیم موعد کارت با خطا مواجه شد.",
  });
}
