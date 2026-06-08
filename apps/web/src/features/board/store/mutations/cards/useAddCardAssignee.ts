// apps/web/src/features/board/store/mutations/cards/useAddCardAssignee.ts
//
// Phase 1.2 (F1.2.5) — fixed to use v1.public.cardAssignee.addAssignee
// (was: cardApi.addAssignee which never existed → runtime crash).
// Now includes boardId + idempotencyKey + assignedBy in the v2 envelope.

import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

interface AddCardAssigneeVariables {
  cardId:        string;
  boardId:       string;
  assigneeId:    string;
  /** userId of the current viewer — written to optimistic assignedBy. */
  actorId:       string;
  correlationId: string;
}

export function useAddCardAssignee() {
  return useOptimisticMutation<AddCardAssigneeVariables, any>({
    mutationFn: (vars) =>
      boardApi.addCardAssignee({
        cardId:         vars.cardId,
        boardId:        vars.boardId,
        assigneeId:     vars.assigneeId,
        idempotencyKey: vars.correlationId,
        correlationId:  vars.correlationId,
      }),

    targetSnapshot: (vars) => ({ cards: [vars.cardId] }),

    generateEnvelope: (vars, state) => {
      const card = state.cards[vars.cardId];
      if (!card) return null;
      return createOptimisticEnvelope(
        "card.assignee_added",
        {
          cardId:     vars.cardId,
          boardId:    vars.boardId,
          assigneeId: vars.assigneeId,
          assignedBy: vars.actorId, // v2 field
        },
        vars.cardId,
        "card",
        card.revision,
        vars.correlationId,
      );
    },
    errorMessage: "افزودن مسئول به کارت با خطا مواجه شد.",
  });
}
