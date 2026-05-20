// apps/web/src/features/board/store/mutations/checklists/useUpdateChecklistItem.ts
import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

interface UpdateChecklistItemVariables {
  checklistId: string;
  cardId: string;
  boardId: string;
  itemId: string;
  title?: string;
  completed?: boolean;
  correlationId: string;
}

export function useUpdateChecklistItem() {
  return useOptimisticMutation<UpdateChecklistItemVariables, any>({
    mutationFn: (vars) =>
      boardApi.updateChecklistItem({
        checklistId: vars.checklistId,
        itemId: vars.itemId,
        title: vars.title,
        completed: vars.completed,
        mutationId: vars.correlationId,
      }),

    targetSnapshot: (vars) => ({ cards: [vars.cardId] }),

    generateEnvelope: (vars, state) => {
      const checklist = state.checklists[vars.checklistId];
      if (!checklist) return null;
      const changes: { title?: string; completed?: boolean } = {};
      if (vars.title     !== undefined) changes.title     = vars.title;
      if (vars.completed !== undefined) changes.completed = vars.completed;
      return createOptimisticEnvelope(
        "checklist.item_updated",
        { checklistId: vars.checklistId, cardId: vars.cardId, boardId: vars.boardId, itemId: vars.itemId, changes },
        vars.checklistId, "checklist", checklist.revision, vars.correlationId,
      );
    },
    errorMessage: "ویرایش آیتم چک‌لیست با خطا مواجه شد.",
  });
}
