// apps/web/src/features/board/store/mutations/checklists/useAddChecklistItem.ts
import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

interface AddChecklistItemVariables {
  checklistId: string;
  cardId: string;
  boardId: string;
  title: string;
  correlationId: string;
}

export function useAddChecklistItem() {
  return useOptimisticMutation<AddChecklistItemVariables, any>({
    mutationFn: (vars) =>
      boardApi.addChecklistItem({ checklistId: vars.checklistId, title: vars.title, mutationId: vars.correlationId }),

    targetSnapshot: (vars) => ({ cards: [vars.cardId] }),

    generateEnvelope: (vars, state) => {
      const checklist = state.checklists[vars.checklistId];
      if (!checklist) return null;
      const tempItemId = crypto.randomUUID();
      return createOptimisticEnvelope(
        "checklist.item_added",
        {
          checklistId: vars.checklistId,
          cardId: vars.cardId,
          boardId: vars.boardId,
          item: { id: tempItemId, title: vars.title, completed: false },
        },
        vars.checklistId, "checklist", checklist.revision, vars.correlationId,
      );
    },
    errorMessage: "افزودن آیتم به چک‌لیست با خطا مواجه شد.",
  });
}
