// apps/web/src/features/board/store/mutations/checklists/useUpdateChecklist.ts
//
// Phase 1.2 (F1.2.3.b) — D12 rename + reorder of a parent checklist.
//
// Mirrors useUpdateChecklistItem exactly — same field-mask approach
// (title? / position?), same optimistic envelope pattern. Used by:
//   a) inline rename of the checklist title (ChecklistRow)
//   b) drag-and-drop reorder of checklists within a card (ChecklistManager)

import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

interface UpdateChecklistVariables {
  checklistId: string;
  cardId: string;
  boardId: string;
  title?: string;
  position?: string;
  correlationId: string;
}

export function useUpdateChecklist() {
  return useOptimisticMutation<UpdateChecklistVariables, any>({
    mutationFn: (vars) =>
      boardApi.updateChecklist({
        checklistId:    vars.checklistId,
        boardId:        vars.boardId,
        title:          vars.title,
        position:       vars.position,
        idempotencyKey: vars.correlationId,
        correlationId:  vars.correlationId,
      }),

    targetSnapshot: (vars) => ({ cards: [vars.cardId] }),

    generateEnvelope: (vars, state) => {
      const checklist = state.checklists[vars.checklistId];
      if (!checklist) return null;
      return createOptimisticEnvelope(
        "checklist.updated",
        {
          checklistId: vars.checklistId,
          cardId:      vars.cardId,
          boardId:     vars.boardId,
          changes: {
            ...(vars.title    !== undefined && { title:    vars.title }),
            ...(vars.position !== undefined && { position: vars.position }),
          },
        },
        vars.cardId,
        "card",
        checklist.revision,
        vars.correlationId,
      );
    },
    errorMessage: "ویرایش چک‌لیست با خطا مواجه شد.",
  });
}
