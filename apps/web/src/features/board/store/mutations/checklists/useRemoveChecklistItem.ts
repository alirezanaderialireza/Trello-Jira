// apps/web/src/features/board/store/mutations/checklists/useRemoveChecklistItem.ts
//
// Phase 1.2 (F1.2.3.a) — adapted to v2 procedure / event:
//   • Variable `itemId` renamed to `checklistItemId` to match the
//     server payload's flattened shape.
//   • boardApi.removeChecklistItem now requires boardId.

import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

interface RemoveChecklistItemVariables {
  checklistId: string;
  checklistItemId: string;
  cardId: string;
  boardId: string;
  correlationId: string;
}

export function useRemoveChecklistItem() {
  return useOptimisticMutation<RemoveChecklistItemVariables, any>({
    mutationFn: (vars) =>
      boardApi.removeChecklistItem({
        checklistItemId: vars.checklistItemId,
        boardId:         vars.boardId,
        idempotencyKey:  vars.correlationId,
        correlationId:   vars.correlationId,
      }),

    targetSnapshot: (vars) => ({ cards: [vars.cardId] }),

    generateEnvelope: (vars, state) => {
      const checklist = state.checklists[vars.checklistId];
      if (!checklist) return null;
      return createOptimisticEnvelope(
        "checklist.item_removed",
        {
          checklistItemId: vars.checklistItemId,
          checklistId:     vars.checklistId,
          cardId:          vars.cardId,
          boardId:         vars.boardId,
        },
        vars.cardId,
        "card",
        checklist.revision,
        vars.correlationId,
      );
    },
    errorMessage: "حذف مورد چک‌لیست با خطا مواجه شد.",
  });
}
