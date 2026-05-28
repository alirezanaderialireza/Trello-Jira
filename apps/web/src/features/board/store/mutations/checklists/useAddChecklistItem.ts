// apps/web/src/features/board/store/mutations/checklists/useAddChecklistItem.ts
//
// Phase 1.2 (F1.2.3.a) — adapted to v2 procedure / event:
//   • Variable `title` renamed to `text` per D6 (items can be sentences).
//   • boardApi.addChecklistItem now requires boardId.
//   • Optimistic envelope payload upgraded: flattened item shape
//     (no nested `item` object), +position placeholder, +addedBy
//     placeholder, +isDone (always false on add).

import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

interface AddChecklistItemVariables {
  checklistId: string;
  cardId: string;
  boardId: string;
  text: string;
  correlationId: string;
}

const OPTIMISTIC_POSITION_PLACEHOLDER = "z";

export function useAddChecklistItem() {
  return useOptimisticMutation<AddChecklistItemVariables, any>({
    mutationFn: (vars) =>
      boardApi.addChecklistItem({
        checklistId:    vars.checklistId,
        boardId:        vars.boardId,
        text:           vars.text,
        idempotencyKey: vars.correlationId,
        correlationId:  vars.correlationId,
      }),

    targetSnapshot: (vars) => ({ cards: [vars.cardId] }),

    generateEnvelope: (vars, state) => {
      const checklist = state.checklists[vars.checklistId];
      if (!checklist) return null;
      const tempItemId = crypto.randomUUID();
      return createOptimisticEnvelope(
        "checklist.item_added",
        {
          checklistItemId: tempItemId,
          checklistId:     vars.checklistId,
          cardId:          vars.cardId,
          boardId:         vars.boardId,
          text:            vars.text,
          isDone:          false,
          position:        OPTIMISTIC_POSITION_PLACEHOLDER,
          addedBy:         "", // server reconciles via the live event
        },
        vars.cardId,
        "card",
        checklist.revision,
        vars.correlationId,
      );
    },
    errorMessage: "افزودن مورد به چک‌لیست با خطا مواجه شد.",
  });
}
