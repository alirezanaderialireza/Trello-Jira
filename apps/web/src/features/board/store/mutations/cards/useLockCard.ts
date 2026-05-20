// apps/web/src/features/board/store/mutations/cards/useLockCard.ts
import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

interface LockCardVariables {
  cardId: string;
  boardId: string;
  lockedBy: string; // userId performing the lock
  correlationId: string;
}

export function useLockCard() {
  return useOptimisticMutation<LockCardVariables, any>({
    mutationFn: (vars) =>
      boardApi.lockCard({ cardId: vars.cardId, mutationId: vars.correlationId }),

    targetSnapshot: (vars) => ({ cards: [vars.cardId] }),

    generateEnvelope: (vars, state) => {
      const card = state.cards[vars.cardId];
      if (!card) return null;
      return createOptimisticEnvelope(
        "card.locked",
        { cardId: vars.cardId, boardId: vars.boardId, lockedBy: vars.lockedBy },
        vars.cardId, "card", card.revision, vars.correlationId,
      );
    },
    errorMessage: "قفل کارت با خطا مواجه شد.",
  });
}
