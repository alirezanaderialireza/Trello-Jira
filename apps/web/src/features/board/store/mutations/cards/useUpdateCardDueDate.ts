// apps/web/src/features/board/store/mutations/cards/useUpdateCardDueDate.ts
//
// Optimistic mutation: set or clear the due date on a card.
//
// Variables (Phase 1.2 — F1.2.2)
//   • boardId      — required by the boardProtectedProcedure middleware
//                    (boardMemberGuard reads it from rawInput).
//   • cardId       — the card being mutated.
//   • dueDate      — `YYYY-MM-DD` DateOnly, or null to clear. NOT an
//                    ISO datetime (the previous stub used the wrong
//                    format; this is the F1.2.2 correction).
//   • correlationId — reused as the server idempotency key.
//
// Optimistic envelope shape mirrors the v2 server event payload:
//   { cardId, boardId, oldDueDate, newDueDate, updatedBy }
//
// `oldDueDate` is read from the local store snapshot so the activity
// timeline projection sees the correct delta even before the server
// echo arrives. `updatedBy` is left as an empty placeholder — the
// dispatcher reducer doesn't read it for state derivation, and the
// live event from the server reconciles within ~50ms.

import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

interface UpdateCardDueDateVariables {
  cardId: string;
  boardId: string;
  /** `YYYY-MM-DD` (DateOnly) or null to clear. */
  dueDate: string | null;
  correlationId: string;
}

export function useUpdateCardDueDate() {
  return useOptimisticMutation<UpdateCardDueDateVariables, any>({
    mutationFn: (vars) =>
      boardApi.setCardDueDate({
        cardId:         vars.cardId,
        boardId:        vars.boardId,
        dueDate:        vars.dueDate,
        idempotencyKey: vars.correlationId,
        correlationId:  vars.correlationId,
      }),

    targetSnapshot: (vars) => ({ cards: [vars.cardId] }),

    generateEnvelope: (vars, state) => {
      const card = state.cards[vars.cardId];
      if (!card) return null;
      return createOptimisticEnvelope(
        "card.due_date_updated",
        {
          cardId:     vars.cardId,
          boardId:    vars.boardId,
          // v2 payload — old/new pair so the activity timeline can
          // render "changed from X to Y" without re-reading state.
          oldDueDate: card.dueDate ?? null,
          newDueDate: vars.dueDate,
          // Server reconciles via the live event within ~50ms. No
          // reducer reads this for state derivation, so an empty
          // placeholder is harmless.
          updatedBy:  "",
        },
        vars.cardId,
        "card",
        card.revision,
        vars.correlationId,
      );
    },
    errorMessage: "تنظیم تاریخ سررسید با خطا مواجه شد.",
  });
}
