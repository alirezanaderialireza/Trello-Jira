// apps/web/src/features/board/store/mutations/labels/useAddCardLabel.ts
//
// Applies a label to a card. The router procedure was renamed from
// `addToCard` to `applyToCard` in F1.2.1; the boardApi service
// translates the call. Event type is unchanged — `card.label_added`
// (D13 keeps snake_case for project-wide consistency).

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
      boardApi.addCardLabel({
        boardId:        vars.boardId,
        cardId:         vars.cardId,
        labelId:        vars.labelId,
        idempotencyKey: vars.correlationId,
        correlationId:  vars.correlationId,
      }),

    targetSnapshot: (vars) => ({ cards: [vars.cardId] }),

    generateEnvelope: (vars, state) => {
      const card = state.cards[vars.cardId];
      if (!card) return null;
      return createOptimisticEnvelope(
        "card.label_added",
        {
          cardId:    vars.cardId,
          boardId:   vars.boardId,
          labelId:   vars.labelId,
          appliedBy: "", // server reconciles via the live event
        },
        vars.cardId,
        "card",
        card.revision,
        vars.correlationId,
      );
    },
    errorMessage: "افزودن برچسب به کارت با خطا مواجه شد.",
  });
}
