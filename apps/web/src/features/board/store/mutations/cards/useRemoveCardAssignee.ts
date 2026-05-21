// apps/web/src/features/board/store/mutations/cards/useRemoveCardAssignee.ts
import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

interface RemoveCardAssigneeVariables {
  cardId: string;
  boardId: string;
  assigneeId: string;
  correlationId: string;
}

export function useRemoveCardAssignee() {
  return useOptimisticMutation<RemoveCardAssigneeVariables, any>({
    mutationFn: (vars) =>
      boardApi.removeCardAssignee({ cardId: vars.cardId, assigneeId: vars.assigneeId, mutationId: vars.correlationId }),

    targetSnapshot: (vars) => ({ cards: [vars.cardId] }),

    generateEnvelope: (vars, state) => {
      const card = state.cards[vars.cardId];
      if (!card) return null;
      return createOptimisticEnvelope(
        "card.assignee_removed",
        { cardId: vars.cardId, boardId: vars.boardId, assigneeId: vars.assigneeId },
        vars.cardId, "card", card.revision, vars.correlationId,
      );
    },
    errorMessage: "حذف مسئول از کارت با خطا مواجه شد.",
  });
}
