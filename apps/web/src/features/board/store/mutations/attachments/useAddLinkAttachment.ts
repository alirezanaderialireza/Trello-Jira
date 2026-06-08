"use client";

// apps/web/src/features/board/store/mutations/attachments/useAddLinkAttachment.ts
//
// Phase 1.2 (F1.2.8) — add external link as attachment.

import { useMutation } from "@tanstack/react-query";
import { toast }        from "sonner";
import { trpc }         from "../../../../utils/trpc";

interface AddLinkVars {
  cardId:  string;
  boardId: string;
  url:     string;
  title?:  string;
}

export function useAddLinkAttachment() {
  return useMutation({
    mutationFn: (vars: AddLinkVars) =>
      (trpc as any).v1.public.attachment.addLink.mutateAsync({
        boardId:        vars.boardId,
        cardId:         vars.cardId,
        url:            vars.url,
        title:          vars.title ?? undefined,
        idempotencyKey: crypto.randomUUID(),
      }),

    onError: (err: any) => {
      toast.error(err?.message ?? "افزودن لینک با خطا مواجه شد.");
    },
  });
}
