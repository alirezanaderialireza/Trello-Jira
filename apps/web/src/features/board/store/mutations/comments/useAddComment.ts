// apps/web/src/features/board/store/mutations/comments/useAddComment.ts
import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

interface AddCommentVariables {
  cardId: string;
  boardId: string;
  authorId: string;
  body: string;
  correlationId: string;
}

export function useAddComment() {
  return useOptimisticMutation<AddCommentVariables, any>({
    mutationFn: (vars) =>
      boardApi.addComment({ cardId: vars.cardId, body: vars.body, mutationId: vars.correlationId }),

    // Snapshot the card so the optimistic comment can be rolled back.
    targetSnapshot: (vars) => ({ cards: [vars.cardId] }),

    generateEnvelope: (vars, state) => {
      if (!state.cards[vars.cardId]) return null;
      const tempId  = crypto.randomUUID();
      const nowIso  = new Date().toISOString();
      return createOptimisticEnvelope(
        "comment.created",
        {
          commentId:  tempId,
          cardId:     vars.cardId,
          boardId:    vars.boardId,
          authorId:   vars.authorId,
          body:       vars.body,
          createdAt:  nowIso,
        },
        tempId, "comment", 0, vars.correlationId,
      );
    },
    errorMessage: "ارسال کامنت با خطا مواجه شد.",
  });
}
