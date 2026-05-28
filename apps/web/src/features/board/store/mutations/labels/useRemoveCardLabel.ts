// apps/web/src/features/board/store/mutations/labels/useRemoveCardLabel.ts
//
// Removes a label from a card. Procedure name unchanged
// (`removeFromCard`); event type unchanged (`card.label_removed`).
// boardId is now part of the input so the server can include it in
// the realtime broadcast routing without an extra DB lookup.

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
      boardApi.removeCardLabel({
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
        "card.label_removed",
        {
          cardId:  vars.cardId,
          boardId: vars.boardId,
          labelId: vars.labelId,
        },
        vars.cardId,
        "card",
        card.revision,
        vars.correlationId,
      );
    },
    errorMessage: "حذف برچسب از کارت با خطا مواجه شد.",
  });
}
