"use client";

// apps/web/src/features/board/components/BoardStarButton.tsx
//
// Phase 1.4 (F1.4.4) — star/unstar toggle for the board header.
//
// Until now the only place to toggle a board's starred state was the
// sidebar row (BoardLink). The board page header had no affordance,
// even though the server plumbing (userBoardMetadata.toggleStar /
// getStarred) has existed since F1. This self-contained client
// component reuses the exact optimistic-toggle contract from BoardLink:
//
//   • derive the canonical starred flag from the cross-workspace
//     getStarred query,
//   • flip immediately on click (optimistic), rolling back + toasting
//     on error,
//   • on settle, invalidate both getStarred and the sidebar bootstrap
//     so the sidebar's Starred section stays in sync.

import { useState } from "react";
import { Star } from "lucide-react";
import { toast } from "sonner";

import { trpc } from "../../../utils/trpc";

interface BoardStarButtonProps {
  boardId: string;
  boardTitle: string;
}

export function BoardStarButton({ boardId, boardTitle }: BoardStarButtonProps) {
  const utils = trpc.useUtils();

  const { data: starred } =
    trpc.v1.public.userBoardMetadata.getStarred.useQuery();
  const isStarredServer = (starred ?? []).some((b) => b.boardId === boardId);

  // `null` means "defer to the server value"; a boolean means "we have a
  // pending optimistic override". Resetting to null on settle hands
  // control back to the (now-invalidated) query.
  const [optimistic, setOptimistic] = useState<boolean | null>(null);
  const isStarred = optimistic ?? isStarredServer;

  const toggle = trpc.v1.public.userBoardMetadata.toggleStar.useMutation({
    onMutate: () => {
      const prev = isStarred;
      setOptimistic(!isStarred);
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev !== undefined) setOptimistic(ctx.prev);
      toast.error(err.message ?? "تغییر وضعیت ستاره ناموفق بود");
    },
    onSettled: () => {
      setOptimistic(null);
      void utils.v1.public.userBoardMetadata.getStarred.invalidate();
      void utils.v1.public.sidebar.bootstrap.invalidate();
    },
  });

  return (
    <button
      type="button"
      onClick={() => toggle.mutate({ boardId })}
      disabled={toggle.isPending}
      aria-label={
        isStarred
          ? `حذف «${boardTitle}» از موارد ستاره‌دار`
          : `افزودن «${boardTitle}» به موارد ستاره‌دار`
      }
      aria-pressed={isStarred}
      className="
        flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md
        text-slate-400 hover:bg-slate-100 hover:text-amber-500
        disabled:cursor-not-allowed disabled:opacity-50
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
        data-[starred=true]:text-amber-500
      "
      data-starred={isStarred}
    >
      <Star
        className="h-5 w-5"
        fill={isStarred ? "currentColor" : "none"}
        aria-hidden="true"
      />
    </button>
  );
}
