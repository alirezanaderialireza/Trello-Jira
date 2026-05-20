// apps/web/src/features/board/store/mutations/checklists/useRemoveChecklistItem.ts
import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

interface RemoveChecklistItemVariables {
  checklistId: string;
  cardId: string;
  boardId: string;
  itemId: string;
  correlationId: string;
}

export function useRemoveChecklistItem() {
  return useOptimisticMutation<RemoveChecklistItemVariables, any>({
    mutationFn: (vars) =>
      boardApi.removeChecklistItem({ checklistId: vars.checklistId, itemId: vars.itemId, mutationId: vars.correlationId }),

    targetSnapshot: (vars) => ({ cards: [vars.cardId] }),

    generateEnvelope: (vars, state) => {
      const checklist = state.checklists[vars.checklistId];
      if (!checklist) return null;
      return createOptimisticEnvelope(
        "checklist.item_removed",
        { checklistId: vars.checklistId, cardId: vars.cardId, boardId: vars.boardId, itemId: vars.itemId },
        vars.checklistId, "checklist", checklist.revision, vars.correlationId,
      );
    },
    errorMessage: "حذف آیتم چک‌لیست با خطا مواجه شد.",
  });
}
