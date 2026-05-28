// apps/web/src/features/board/store/mutations/checklists/useUpdateChecklistItem.ts
//
// Phase 1.2 (F1.2.3.a) — adapted to v2 procedure / event:
//   • Field-mask payload: text? / isDone? / position? all optional.
//     Single procedure handles toggle (D10), reorder (D11), and
//     rename — no separate toggle endpoint.
//   • Wire-level rename: `title → text`, `completed → isDone`.
//   • boardApi.updateChecklistItem now requires boardId.

import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

interface UpdateChecklistItemVariables {
  checklistId: string;
  checklistItemId: string;
  cardId: string;
  boardId: string;
  text?: string;
  isDone?: boolean;
  position?: string;
  correlationId: string;
}

export function useUpdateChecklistItem() {
  return useOptimisticMutation<UpdateChecklistItemVariables, any>({
    mutationFn: (vars) =>
      boardApi.updateChecklistItem({
        checklistItemId: vars.checklistItemId,
        boardId:         vars.boardId,
        text:            vars.text,
        isDone:          vars.isDone,
        position:        vars.position,
        idempotencyKey:  vars.correlationId,
        correlationId:   vars.correlationId,
      }),

    targetSnapshot: (vars) => ({ cards: [vars.cardId] }),

    generateEnvelope: (vars, state) => {
      const checklist = state.checklists[vars.checklistId];
      if (!checklist) return null;
      return createOptimisticEnvelope(
        "checklist.item_updated",
        {
          checklistItemId: vars.checklistItemId,
          checklistId:     vars.checklistId,
          cardId:          vars.cardId,
          boardId:         vars.boardId,
          changes: {
            ...(vars.text     !== undefined && { text:     vars.text }),
            ...(vars.isDone   !== undefined && { isDone:   vars.isDone }),
            ...(vars.position !== undefined && { position: vars.position }),
          },
        },
        vars.cardId,
        "card",
        checklist.revision,
        vars.correlationId,
      );
    },
    errorMessage: "ویرایش مورد چک‌لیست با خطا مواجه شد.",
  });
}
