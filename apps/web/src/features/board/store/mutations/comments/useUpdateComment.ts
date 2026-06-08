// apps/web/src/features/board/store/mutations/comments/useUpdateComment.ts
//
// Phase 1.2 (F1.2.4.a) — updated to v2 contract:
//   • boardApi.updateComment now requires boardId + idempotencyKey
//   • optimistic envelope matches v2 CommentUpdatedPayload

import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

interface UpdateCommentVariables {
  commentId:     string;
  cardId:        string;
  boardId:       string;
  body:          string;
  correlationId: string;
}

export function useUpdateComment() {
  return useOptimisticMutation<UpdateCommentVariables, any>({
    mutationFn: (vars) =>
      boardApi.updateComment({
        commentId:      vars.commentId,
        boardId:        vars.boardId,
        body:           vars.body,
        idempotencyKey: vars.correlationId,
        correlationId:  vars.correlationId,
      }),

    targetSnapshot: (vars) => ({ cards: [vars.cardId] }),

    generateEnvelope: (vars, state) => {
      const comment = state.comments[vars.commentId];
      if (!comment) return null;
      return createOptimisticEnvelope(
        "comment.updated",
        {
          commentId: vars.commentId,
          cardId:    vars.cardId,
          boardId:   vars.boardId,
          body:      vars.body,
          editedAt:  new Date().toISOString(),
        },
        vars.commentId,
        "comment",
        comment.revision,
        vars.correlationId,
      );
    },
    errorMessage: "ویرایش کامنت با خطا مواجه شد.",
  });
}
