"use client";

// apps/web/src/features/board/components/card-detail/comments/CommentsList.tsx
//
// Container that wires all comment sub-components together.
//
// Responsibilities:
//   • useHydrateComments — fetches + hydrates Zustand store
//   • Reads commentIds from store, derives ordered list
//   • Display order: OLDEST-FIRST (chronological) — API returns
//     newest-first (desc createdAt); we reverse after hydration.
//     The "Load older" CTA sits at the TOP and calls fetchNextPage.
//   • canManage = role === "ADMIN" || "OWNER"
//   • DeleteCommentDialog state

import { useMemo, useState } from "react";
import { Loader2, MessageSquare } from "lucide-react";

import type { CommentDto } from "../../../store/useBoardStore";
import { useBoardStore }         from "../../../store/useBoardStore";
import { useHydrateComments }    from "../../../store/hooks/useHydrateComments";
import { useDeleteComment }      from "../../../store/mutations/comments/useDeleteComment";

import { CommentItem }           from "./CommentItem";
import { CommentForm }           from "./CommentForm";
import { DeleteCommentDialog }   from "./DeleteCommentDialog";

// Atomic selector: commentIds for this card
const makeSelectCommentIds = (cardId: string) => (s: any): string[] =>
  s.commentsByCard[cardId] ?? [];
// Atomic selector: all comments map
const selectCommentsMap = (s: any): Record<string, CommentDto> => s.comments;

interface Props {
  cardId:        string;
  boardId:       string;
  currentUserId: string;
  /** "OWNER" | "ADMIN" | "MEMBER" */
  role:          string;
}

export function CommentsList({ cardId, boardId, currentUserId, role }: Props) {
  const canManage = role === "ADMIN" || role === "OWNER";

  // Hydration
  const { isLoading, isError, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useHydrateComments({ cardId, boardId });

  // Store reads
  const commentIds  = useBoardStore(useMemo(() => makeSelectCommentIds(cardId), [cardId]));
  const commentsMap = useBoardStore(selectCommentsMap);

  // Build ordered list: oldest-first (server returns newest-first, store
  // insertion order is newest-first because we hydrate in that order).
  // We reverse to get chronological display.
  const orderedComments = useMemo(() => {
    const list = commentIds
      .map((id) => commentsMap[id])
      .filter(Boolean) as CommentDto[];
    // Sort ascending by createdAt for oldest-first display
    return [...list].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }, [commentIds, commentsMap]);

  // Delete flow
  const [pendingDelete, setPendingDelete] = useState<CommentDto | null>(null);
  const deleteComment = useDeleteComment();

  function handleConfirmDelete() {
    if (!pendingDelete) return;
    deleteComment.mutate(
      {
        commentId:     pendingDelete.id,
        cardId,
        boardId,
        actorId:       currentUserId,
        correlationId: crypto.randomUUID(),
      },
      { onSuccess: () => setPendingDelete(null) },
    );
  }

  // ── Loading skeleton ────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div dir="rtl" className="space-y-4">
        {[1, 2, 3].map((n) => (
          <div key={n} className="flex gap-2.5 animate-pulse">
            <div className="h-8 w-8 flex-shrink-0 rounded-full bg-slate-700" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-24 rounded bg-slate-700" />
              <div className="h-3 w-full rounded bg-slate-700" />
              <div className="h-3 w-3/4 rounded bg-slate-700" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────

  if (isError) {
    return (
      <div dir="rtl" className="py-6 text-center text-sm text-red-400">
        بارگذاری کامنت‌ها با خطا مواجه شد. لطفاً صفحه را بازنشانی کنید.
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div dir="rtl" className="space-y-4">

      {/* Load older CTA — at the top since display is oldest-first */}
      {hasNextPage ? (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
            className="inline-flex items-center gap-1.5 rounded-md border border-slate-600 px-3 py-1.5 text-xs text-slate-400 hover:border-slate-500 hover:text-slate-300 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isFetchingNextPage ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                <span>در حال بارگذاری...</span>
              </>
            ) : (
              "نمایش کامنت‌های قدیمی‌تر"
            )}
          </button>
        </div>
      ) : null}

      {/* Empty state */}
      {orderedComments.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-8 text-center">
          <MessageSquare className="h-8 w-8 text-slate-600" aria-hidden="true" />
          <p className="text-sm text-slate-500">
            هنوز کامنتی نیست — اولین نفر باشید.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {orderedComments.map((comment) => (
            <CommentItem
              key={comment.id}
              comment={comment}
              currentUserId={currentUserId}
              canManage={canManage}
              onDelete={() => setPendingDelete(comment)}
            />
          ))}
        </div>
      )}

      {/* New comment form */}
      <div className="pt-2 border-t border-slate-700/50">
        <CommentForm
          cardId={cardId}
          boardId={boardId}
          currentUserId={currentUserId}
        />
      </div>

      {/* Delete confirm dialog */}
      <DeleteCommentDialog
        open={pendingDelete !== null}
        commentBody={pendingDelete?.body ?? ""}
        isSubmitting={deleteComment.isPending}
        onClose={() => setPendingDelete(null)}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}
