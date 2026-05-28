"use client";

// apps/web/src/features/shell/sidebar/BoardLink.tsx
//
// A single board row used by both the Starred and Recent sections.
//
// • Title navigates to /workspaces/[workspaceSlug]/boards/[boardId].
//   The path may not exist yet (board pages are at /board/[boardId]
//   pre-F4); `Link` falls back gracefully to a 404 in that case.
//   Once F4 lands and a future phase moves board pages under the
//   (app) tree, this hard-coded path becomes correct without
//   touching this file.
// • Star icon toggles the user's starred state via the
//   userBoardMetadata.toggleStar mutation. Optimistic update flips
//   the icon immediately; on error we toast and revert.
//
// The toggle is intentionally lightweight (no React Query cache
// surgery beyond the optimistic flip) because the canonical state
// is held in the parent sidebar's bootstrap query and the next
// re-fetch (60s staleTime or invalidate-on-mutation) reconciles.

import Link from "next/link";
import { useState } from "react";
import { Star } from "lucide-react";
import { toast } from "sonner";

import { trpc } from "../../../utils/trpc";

interface BoardLinkProps {
  boardId: string;
  boardTitle: string;
  workspaceId: string;
  workspaceSlug: string;
  isStarred: boolean;
  /**
   * Optional secondary line — the Recent section uses it for
   * "X روز پیش"; the Starred section omits it.
   */
  secondaryText?: string;
}

export function BoardLink({
  boardId,
  boardTitle,
  workspaceSlug,
  isStarred,
  secondaryText,
}: BoardLinkProps) {
  const utils = trpc.useUtils();
  const [optimisticStarred, setOptimisticStarred] = useState(isStarred);

  const toggleStar = trpc.v1.public.userBoardMetadata.toggleStar.useMutation({
    onMutate: () => {
      // Capture for rollback on error.
      const previous = optimisticStarred;
      setOptimisticStarred((s) => !s);
      return { previous };
    },
    onError: (err, _vars, ctx) => {
      // Revert optimistic state if the server rejected the toggle.
      if (ctx?.previous !== undefined) {
        setOptimisticStarred(ctx.previous);
      }
      toast.error(err.message ?? "تغییر وضعیت ستاره ناموفق بود");
    },
    onSettled: () => {
      // Refresh the bootstrap query so other sections (Starred section,
      // workspaces list) stay in sync. The 60s staleTime would
      // eventually catch this, but invalidating now feels snappier.
      utils.v1.public.sidebar.bootstrap.invalidate();
    },
  });

  function handleStarClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    toggleStar.mutate({ boardId });
  }

  // The board path under (app) is not yet in scope for F4 —
  // app/board/[boardId]/page.tsx still lives at the root level. Link
  // there directly so existing routes continue to work; a future
  // featurelet will move board pages under the (app) tree.
  const boardHref = `/board/${boardId}`;

  return (
    <li>
      <div
        className="
          group flex items-center justify-between gap-1 rounded-md px-2 py-1.5 text-sm
          text-slate-700 hover:bg-slate-100
        "
      >
        <Link
          href={boardHref}
          className="
            min-w-0 flex-1 truncate
            focus-visible:outline-none focus-visible:ring-2
            focus-visible:ring-blue-500 focus-visible:rounded-sm
          "
          title={`${boardTitle} — /${workspaceSlug}`}
          dir="auto"
        >
          <span className="truncate">{boardTitle}</span>
          {secondaryText && (
            <span className="ms-2 text-xs text-slate-400">{secondaryText}</span>
          )}
        </Link>

        <button
          type="button"
          onClick={handleStarClick}
          aria-label={
            optimisticStarred
              ? "حذف از موارد ستاره‌دار"
              : "افزودن به موارد ستاره‌دار"
          }
          aria-pressed={optimisticStarred}
          disabled={toggleStar.isPending}
          className="
            flex-shrink-0 rounded p-0.5 text-slate-300 hover:text-amber-500
            disabled:cursor-not-allowed disabled:opacity-50
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500
            data-[starred=true]:text-amber-500
          "
          data-starred={optimisticStarred}
        >
          <Star
            className="h-3.5 w-3.5"
            fill={optimisticStarred ? "currentColor" : "none"}
            aria-hidden="true"
          />
        </button>
      </div>
    </li>
  );
}
