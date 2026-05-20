// apps/web/src/features/board/store/mutations/cards/useAddCardAssignee.ts
import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

interface AddCardAssigneeVariables {
  cardId: string;
  boardId: string;
  assigneeId: string;
  correlationId: string;
}

export function useAddCardAssignee() {
  return useOptimisticMutation<AddCardAssigneeVariables, any>({
    mutationFn: (vars) =>
      boardApi.addCardAssignee({ cardId: vars.cardId, assigneeId: vars.assigneeId, mutationId: vars.correlationId }),

    targetSnapshot: (vars) => ({ cards: [vars.cardId] }),

    generateEnvelope: (vars, state) => {
      const card = state.cards[vars.cardId];
      if (!card) return null;
      return createOptimisticEnvelope(
        "card.assignee_added",
        { cardId: vars.cardId, boardId: vars.boardId, assigneeId: vars.assigneeId },
        vars.cardId, "card", card.revision, vars.correlationId,
      );
    },
    errorMessage: "افزودن مسئول به کارت با خطا مواجه شد.",
  });
}
