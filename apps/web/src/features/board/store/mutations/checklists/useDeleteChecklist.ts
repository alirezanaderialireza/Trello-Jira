// apps/web/src/features/board/store/mutations/checklists/useDeleteChecklist.ts
//
// Phase 1.2 (F1.2.3.a) — adapted to v2 procedure / event.
// boardApi.deleteChecklist now requires boardId (boardProtectedProcedure)
// and idempotencyKey. The optimistic envelope's affectedItemCount is a
// placeholder 0 — the server's response carries the real count for
// the success toast.

import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

interface DeleteChecklistVariables {
  checklistId: string;
  cardId: string;
  boardId: string;
  correlationId: string;
}

export function useDeleteChecklist() {
  return useOptimisticMutation<DeleteChecklistVariables, any>({
    mutationFn: (vars) =>
      boardApi.deleteChecklist({
        checklistId:    vars.checklistId,
        boardId:        vars.boardId,
        idempotencyKey: vars.correlationId,
        correlationId:  vars.correlationId,
      }),

    targetSnapshot: (vars) => ({ cards: [vars.cardId] }),

    generateEnvelope: (vars, state) => {
      const checklist = state.checklists[vars.checklistId];
      if (!checklist) return null;
      return createOptimisticEnvelope(
        "checklist.deleted",
        {
          checklistId:       vars.checklistId,
          cardId:            vars.cardId,
          boardId:           vars.boardId,
          // Placeholder — server's response carries the real count.
          affectedItemCount: 0,
        },
        vars.cardId,
        "card",
        checklist.revision,
        vars.correlationId,
      );
    },
    errorMessage: "حذف چک‌لیست با خطا مواجه شد.",
  });
}
