// apps/web/src/features/board/store/mutations/checklists/useCreateChecklist.ts
import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

interface CreateChecklistVariables {
  cardId: string;
  boardId: string;
  name: string;
  correlationId: string;
}

export function useCreateChecklist() {
  return useOptimisticMutation<CreateChecklistVariables, any>({
    mutationFn: (vars) =>
      boardApi.createChecklist({ cardId: vars.cardId, name: vars.name, mutationId: vars.correlationId }),

    targetSnapshot: (vars) => ({ cards: [vars.cardId] }),

    generateEnvelope: (vars, state) => {
      if (!state.cards[vars.cardId]) return null;
      const tempId = crypto.randomUUID();
      return createOptimisticEnvelope(
        "checklist.created",
        { checklistId: tempId, cardId: vars.cardId, boardId: vars.boardId, name: vars.name, items: [] },
        tempId, "checklist", 0, vars.correlationId,
      );
    },
    errorMessage: "ساخت چک‌لیست با خطا مواجه شد.",
  });
}
