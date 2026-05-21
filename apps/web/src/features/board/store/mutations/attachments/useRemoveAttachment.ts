// apps/web/src/features/board/store/mutations/attachments/useRemoveAttachment.ts
import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

interface RemoveAttachmentVariables {
  attachmentId: string;
  cardId: string;
  boardId: string;
  correlationId: string;
}

export function useRemoveAttachment() {
  return useOptimisticMutation<RemoveAttachmentVariables, any>({
    mutationFn: (vars) =>
      boardApi.removeAttachment({ attachmentId: vars.attachmentId, mutationId: vars.correlationId }),

    targetSnapshot: (vars) => ({ cards: [vars.cardId] }),

    generateEnvelope: (vars, state) => {
      if (!state.attachments[vars.attachmentId]) return null;
      return createOptimisticEnvelope(
        "attachment.removed",
        { attachmentId: vars.attachmentId, cardId: vars.cardId, boardId: vars.boardId },
        vars.attachmentId, "attachment", 0, vars.correlationId,
      );
    },
    errorMessage: "حذف فایل با خطا مواجه شد.",
  });
}
