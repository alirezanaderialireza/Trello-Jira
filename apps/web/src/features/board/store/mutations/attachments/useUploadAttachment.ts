"use client";

// apps/web/src/features/board/store/mutations/attachments/useUploadAttachment.ts
//
// Phase 1.2 (F1.2.8) — Three-step upload flow (D2):
//   1. requestUpload → get presigned PUT URL + objectKey + attachmentId
//   2. PUT file directly to R2/MinIO (no server buffer)
//   3. confirmUpload → save DB row + emit outbox event

import { useMutation } from "@tanstack/react-query";
import { toast }        from "sonner";
import { trpc }         from "../../../../utils/trpc";

interface UploadAttachmentVars {
  cardId:  string;
  boardId: string;
  file:    File;
}

export function useUploadAttachment() {
  return useMutation({
    mutationFn: async (vars: UploadAttachmentVars) => {
      const idempotencyKey = crypto.randomUUID();

      // ── Step 1: request presigned PUT URL ────────────────────────────────
      const { uploadUrl, objectKey, attachmentId } =
        await (trpc as any).v1.public.attachment.requestUpload.mutateAsync({
          boardId:        vars.boardId,
          cardId:         vars.cardId,
          fileName:       vars.file.name.slice(0, 255),
          fileSize:       vars.file.size,
          mimeType:       vars.file.type || "application/octet-stream",
          idempotencyKey,
        });

      // ── Step 2: PUT directly to storage ──────────────────────────────────
      const uploadRes = await fetch(uploadUrl as string, {
        method:  "PUT",
        body:    vars.file,
        headers: { "Content-Type": vars.file.type || "application/octet-stream" },
      });
      if (!uploadRes.ok) {
        throw new Error(`آپلود فایل ناموفق بود (${uploadRes.status}).`);
      }

      // ── Step 3: confirm ───────────────────────────────────────────────────
      return (trpc as any).v1.public.attachment.confirmUpload.mutateAsync({
        boardId:        vars.boardId,
        cardId:         vars.cardId,
        attachmentId,
        objectKey,
        fileName:       vars.file.name.slice(0, 255),
        mimeType:       vars.file.type || "application/octet-stream",
        fileSize:       vars.file.size,
        idempotencyKey: crypto.randomUUID(),
      });
    },

    onError: (err: any) => {
      toast.error(err?.message ?? "آپلود فایل با خطا مواجه شد.");
    },
  });
}
