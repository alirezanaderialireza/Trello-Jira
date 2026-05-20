// apps/web/src/features/board/store/mutations/comments/useUpdateComment.ts
import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

interface UpdateCommentVariables {
  commentId: string;
  cardId: string;
  boardId: string;
  body: string;
  correlationId: string;
}

export function useUpdateComment() {
  return useOptimisticMutation<UpdateCommentVariables, any>({
    mutationFn: (vars) =>
      boardApi.updateComment({ commentId: vars.commentId, body: vars.body, mutationId: vars.correlationId }),

    targetSnapshot: (_vars) => ({}),

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
        vars.commentId, "comment", comment.revision, vars.correlationId,
      );
    },
    errorMessage: "ویرایش کامنت با خطا مواجه شد.",
  });
}
