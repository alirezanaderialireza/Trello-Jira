// apps/web/src/features/board/store/mutations/attachments/useRemoveAttachment.ts
//
// Phase 1.2 (F1.2.8) — fixed to use v1.public.attachment.remove.
// (was: boardApi.removeAttachment → (trpc as any).attachment.remove — route
//  never existed → runtime crash on first click)

import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

interface RemoveAttachmentVariables {
  attachmentId:  string;
  cardId:        string;
  boardId:       string;
  correlationId: string;
}

export function useRemoveAttachment() {
  return useOptimisticMutation<RemoveAttachmentVariables, any>({
    mutationFn: (vars) =>
      boardApi.removeAttachment({
        attachmentId:   vars.attachmentId,
        boardId:        vars.boardId,
        cardId:         vars.cardId,
        idempotencyKey: vars.correlationId,
        correlationId:  vars.correlationId,
      }),

    targetSnapshot: (vars) => ({ cards: [vars.cardId] }),

    generateEnvelope: (vars, state) => {
      if (!state.attachments[vars.attachmentId]) return null;
      return createOptimisticEnvelope(
        "attachment.removed",
        { attachmentId: vars.attachmentId, cardId: vars.cardId, boardId: vars.boardId },
        vars.attachmentId, "attachment", 0, vars.correlationId,
      );
    },
    errorMessage: "حذف پیوست با خطا مواجه شد.",
  });
}
