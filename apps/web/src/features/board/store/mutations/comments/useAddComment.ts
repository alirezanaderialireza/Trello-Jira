// apps/web/src/features/board/store/mutations/comments/useAddComment.ts
//
// Phase 1.2 (F1.2.4.a) — updated to v2 contract:
//   • boardApi.createComment (was: addComment with mutationId)
//   • idempotencyKey instead of mutationId
//   • boardId added to boardApi call
//   • optimistic envelope now includes revision: 1 (v2 payload shape)
//   • aggregateType stays "comment" for optimistic rollback scoping
//     (the real event uses aggregateType "card" — the reconciler maps
//      both via correlationId so this mismatch is harmless for the
//      optimistic layer)

import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

interface AddCommentVariables {
  cardId:        string;
  boardId:       string;
  authorId:      string;
  body:          string;
  correlationId: string;
}

export function useAddComment() {
  return useOptimisticMutation<AddCommentVariables, any>({
    mutationFn: (vars) =>
      boardApi.createComment({
        cardId:         vars.cardId,
        boardId:        vars.boardId,
        body:           vars.body,
        idempotencyKey: vars.correlationId,
        correlationId:  vars.correlationId,
      }),

    targetSnapshot: (vars) => ({ cards: [vars.cardId] }),

    generateEnvelope: (vars, state) => {
      if (!state.cards[vars.cardId]) return null;
      const tempId = crypto.randomUUID();
      const nowIso = new Date().toISOString();
      return createOptimisticEnvelope(
        "comment.created",
        {
          commentId:  tempId,
          cardId:     vars.cardId,
          boardId:    vars.boardId,
          authorId:   vars.authorId,
          body:       vars.body,
          createdAt:  nowIso,
          revision:   1, // v2 field
        },
        tempId,
        "comment",
        0,
        vars.correlationId,
      );
    },
    errorMessage: "ارسال کامنت با خطا مواجه شد.",
  });
}
