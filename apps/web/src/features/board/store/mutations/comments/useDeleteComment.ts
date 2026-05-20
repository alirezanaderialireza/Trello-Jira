// apps/web/src/features/board/store/mutations/comments/useDeleteComment.ts
import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

interface DeleteCommentVariables {
  commentId: string;
  cardId: string;
  boardId: string;
  correlationId: string;
}

export function useDeleteComment() {
  return useOptimisticMutation<DeleteCommentVariables, any>({
    mutationFn: (vars) =>
      boardApi.deleteComment({ commentId: vars.commentId, mutationId: vars.correlationId }),

    targetSnapshot: (_vars) => ({}),

    generateEnvelope: (vars, state) => {
      const comment = state.comments[vars.commentId];
      if (!comment) return null;
      return createOptimisticEnvelope(
        "comment.deleted",
        { commentId: vars.commentId, cardId: vars.cardId, boardId: vars.boardId },
        vars.commentId, "comment", comment.revision, vars.correlationId,
      );
    },
    errorMessage: "حذف کامنت با خطا مواجه شد.",
  });
}
