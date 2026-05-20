// apps/web/src/features/board/store/mutations/checklists/useDeleteChecklist.ts
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
      boardApi.deleteChecklist({ checklistId: vars.checklistId, mutationId: vars.correlationId }),

    targetSnapshot: (vars) => ({ cards: [vars.cardId] }),

    generateEnvelope: (vars, state) => {
      const checklist = state.checklists[vars.checklistId];
      if (!checklist) return null;
      return createOptimisticEnvelope(
        "checklist.deleted",
        { checklistId: vars.checklistId, cardId: vars.cardId, boardId: vars.boardId },
        vars.checklistId, "checklist", checklist.revision, vars.correlationId,
      );
    },
    errorMessage: "حذف چک‌لیست با خطا مواجه شد.",
  });
}
