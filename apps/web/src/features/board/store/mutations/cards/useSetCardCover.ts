// apps/web/src/features/board/store/mutations/cards/useSetCardCover.ts
//
// Phase 1.2 (F1.2.7 / F1.2.8) — optimistic mutation for setting or
// clearing the card cover (color, gradient, or image attachment).
//
// CoverData shape:
//   { type: "color" | "gradient", id: string }       — palette presets
//   { type: "image", id: attachmentId, url: string } — from F1.2.8
//
// The router (v1.public.cover.setCover) is introduced in F1.2.7 PR #72.
// Until that PR merges the mutation is a graceful no-op on main.

import { useMutation }   from "@tanstack/react-query";
import { toast }         from "sonner";
import { useBoardStore } from "../../useBoardStore";

type CoverData = { type: string; id: string; url?: string } | null;

interface SetCardCoverVars {
  cardId:        string;
  boardId:       string;
  coverData:     CoverData;
  correlationId: string;
}

export function useSetCardCover() {
  const updateCard = useBoardStore((s) => s.updateCard);

  return useMutation({
    mutationFn: async (vars: SetCardCoverVars) => {
      // Defensive: if the cover router isn't mounted yet (pre-F1.2.7 merge)
      // the call will fail with a 404/trpc-error. We catch and surface a toast.
      const { trpc } = await import("../../../../../utils/trpc");
      return (trpc as any).v1.public.cover.setCover.mutateAsync({
        cardId:         vars.cardId,
        boardId:        vars.boardId,
        coverData:      vars.coverData,
        idempotencyKey: vars.correlationId,
      });
    },

    onMutate: (vars) => {
      const prev = useBoardStore.getState().cards[vars.cardId]?.coverData ?? null;
      updateCard(vars.cardId, { coverData: vars.coverData });
      return { prev };
    },

    onError: (err: any, vars, ctx) => {
      if (ctx?.prev !== undefined) updateCard(vars.cardId, { coverData: ctx.prev });
      toast.error(err?.message ?? "تنظیم پوشش کارت با خطا مواجه شد.");
    },
  });
}
