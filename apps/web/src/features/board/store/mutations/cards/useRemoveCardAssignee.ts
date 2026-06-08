// apps/web/src/features/board/store/mutations/cards/useRemoveCardAssignee.ts
//
// Phase 1.2 (F1.2.5) — fixed to use v1.public.cardAssignee.removeAssignee
// (was: cardApi.removeAssignee which never existed → runtime crash).
// Now includes boardId + idempotencyKey + removedBy in the v2 envelope.

import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

interface RemoveCardAssigneeVariables {
  cardId:        string;
  boardId:       string;
  assigneeId:    string;
  /** userId of the current viewer — written to optimistic removedBy. */
  actorId:       string;
  correlationId: string;
}

export function useRemoveCardAssignee() {
  return useOptimisticMutation<RemoveCardAssigneeVariables, any>({
    mutationFn: (vars) =>
      boardApi.removeCardAssignee({
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
        "card.assignee_removed",
        {
          cardId:     vars.cardId,
          boardId:    vars.boardId,
          assigneeId: vars.assigneeId,
          removedBy:  vars.actorId, // v2 field
        },
        vars.cardId,
        "card",
        card.revision,
        vars.correlationId,
      );
    },
    errorMessage: "حذف مسئول از کارت با خطا مواجه شد.",
  });
}
