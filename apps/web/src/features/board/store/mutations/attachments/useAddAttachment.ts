// apps/web/src/features/board/store/mutations/attachments/useAddAttachment.ts
import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

interface AddAttachmentVariables {
  cardId: string;
  boardId: string;
  uploadedBy: string;
  url: string;
  mimeType: string;
  fileName: string;
  sizeBytes: number;
  correlationId: string;
}

export function useAddAttachment() {
  return useOptimisticMutation<AddAttachmentVariables, any>({
    mutationFn: (vars) =>
      boardApi.addAttachment({
        cardId:    vars.cardId,
        url:       vars.url,
        mimeType:  vars.mimeType,
        fileName:  vars.fileName,
        sizeBytes: vars.sizeBytes,
        mutationId: vars.correlationId,
      }),

    targetSnapshot: (vars) => ({ cards: [vars.cardId] }),

    generateEnvelope: (vars, state) => {
      if (!state.cards[vars.cardId]) return null;
      const tempId = crypto.randomUUID();
      const nowIso = new Date().toISOString();
      return createOptimisticEnvelope(
        "attachment.added",
        {
          attachmentId: tempId,
          cardId:       vars.cardId,
          boardId:      vars.boardId,
          url:          vars.url,
          mimeType:     vars.mimeType,
          fileName:     vars.fileName,
          sizeBytes:    vars.sizeBytes,
          uploadedBy:   vars.uploadedBy,
          createdAt:    nowIso,
        },
        tempId, "attachment", 0, vars.correlationId,
      );
    },
    errorMessage: "آپلود فایل با خطا مواجه شد.",
  });
}
