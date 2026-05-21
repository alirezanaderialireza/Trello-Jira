// apps/web/src/features/board/store/mutations/labels/useAddCardLabel.ts
import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

interface AddCardLabelVariables {
  cardId: string;
  boardId: string;
  labelId: string;
  correlationId: string;
}

export function useAddCardLabel() {
  return useOptimisticMutation<AddCardLabelVariables, any>({
    mutationFn: (vars) =>
      boardApi.addCardLabel({ cardId: vars.cardId, labelId: vars.labelId, mutationId: vars.correlationId }),

    targetSnapshot: (vars) => ({ cards: [vars.cardId] }),

    generateEnvelope: (vars, state) => {
      const card = state.cards[vars.cardId];
      if (!card) return null;
      return createOptimisticEnvelope(
        "card.label_added",
        { cardId: vars.cardId, boardId: vars.boardId, labelId: vars.labelId },
        vars.cardId, "card", card.revision, vars.correlationId,
      );
    },
    errorMessage: "افزودن لیبل به کارت با خطا مواجه شد.",
  });
}
