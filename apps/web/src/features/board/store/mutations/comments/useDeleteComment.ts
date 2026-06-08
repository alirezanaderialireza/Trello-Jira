// apps/web/src/features/board/store/mutations/comments/useDeleteComment.ts
//
// Phase 1.2 (F1.2.4.a) — updated to v2 contract:
//   • boardApi.deleteComment now requires boardId + idempotencyKey
//   • optimistic envelope carries v2 CommentDeletedPayload (+ deletedBy)

import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

interface DeleteCommentVariables {
  commentId:     string;
  cardId:        string;
  boardId:       string;
  /** The current viewer's userId — written to the optimistic deletedBy field. */
  actorId:       string;
  correlationId: string;
}

export function useDeleteComment() {
  return useOptimisticMutation<DeleteCommentVariables, any>({
    mutationFn: (vars) =>
      boardApi.deleteComment({
        commentId:      vars.commentId,
        boardId:        vars.boardId,
        idempotencyKey: vars.correlationId,
        correlationId:  vars.correlationId,
      }),

    targetSnapshot: (vars) => ({ cards: [vars.cardId] }),

    generateEnvelope: (vars, state) => {
      const comment = state.comments[vars.commentId];
      if (!comment) return null;
      return createOptimisticEnvelope(
        "comment.deleted",
        {
          commentId: vars.commentId,
          cardId:    vars.cardId,
          boardId:   vars.boardId,
          deletedBy: vars.actorId, // v2 field
        },
        vars.commentId,
        "comment",
        comment.revision,
        vars.correlationId,
      );
    },
    errorMessage: "حذف کامنت با خطا مواجه شد.",
  });
}
