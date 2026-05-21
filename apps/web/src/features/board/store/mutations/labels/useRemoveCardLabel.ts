// apps/web/src/features/board/store/mutations/labels/useRemoveCardLabel.ts
import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

interface RemoveCardLabelVariables {
  cardId: string;
  boardId: string;
  labelId: string;
  correlationId: string;
}

export function useRemoveCardLabel() {
  return useOptimisticMutation<RemoveCardLabelVariables, any>({
    mutationFn: (vars) =>
      boardApi.removeCardLabel({ cardId: vars.cardId, labelId: vars.labelId, mutationId: vars.correlationId }),

    targetSnapshot: (vars) => ({ cards: [vars.cardId] }),

    generateEnvelope: (vars, state) => {
      const card = state.cards[vars.cardId];
      if (!card) return null;
      return createOptimisticEnvelope(
        "card.label_removed",
        { cardId: vars.cardId, boardId: vars.boardId, labelId: vars.labelId },
        vars.cardId, "card", card.revision, vars.correlationId,
      );
    },
    errorMessage: "حذف لیبل از کارت با خطا مواجه شد.",
  });
}
