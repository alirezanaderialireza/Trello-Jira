// apps/web/src/features/board/store/mutations/checklists/useCreateChecklist.ts
//
// Phase 1.2 (F1.2.3.a) — adapted to v2 procedure / event:
//   • boardApi.createChecklist now sends `boardId` (required by
//     boardProtectedProcedure's boardMemberGuard) plus
//     `idempotencyKey` (was `mutationId`).
//   • Variable `name` renamed to `title` to match the v2 contract.
//   • Optimistic envelope payload upgraded to v2 shape (title +
//     position placeholder + createdBy placeholder).

import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

interface CreateChecklistVariables {
  cardId: string;
  boardId: string;
  title: string;
  correlationId: string;
}

const OPTIMISTIC_POSITION_PLACEHOLDER = "z"; // sorts last; server reconciles

export function useCreateChecklist() {
  return useOptimisticMutation<CreateChecklistVariables, any>({
    mutationFn: (vars) =>
      boardApi.createChecklist({
        cardId:         vars.cardId,
        boardId:        vars.boardId,
        title:          vars.title,
        idempotencyKey: vars.correlationId,
        correlationId:  vars.correlationId,
      }),

    targetSnapshot: (vars) => ({ cards: [vars.cardId] }),

    generateEnvelope: (vars) => {
      const tempId = crypto.randomUUID();
      return createOptimisticEnvelope(
        "checklist.created",
        {
          checklistId: tempId,
          cardId:      vars.cardId,
          boardId:     vars.boardId,
          title:       vars.title,
          position:    OPTIMISTIC_POSITION_PLACEHOLDER,
          createdBy:   "", // server reconciles via the live event
        },
        vars.cardId,
        "card",
        0,
        vars.correlationId,
      );
    },
    errorMessage: "ساخت چک‌لیست با خطا مواجه شد.",
  });
}
