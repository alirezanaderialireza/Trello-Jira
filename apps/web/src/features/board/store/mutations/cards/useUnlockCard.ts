// apps/web/src/features/board/store/mutations/cards/useUnlockCard.ts
import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

interface UnlockCardVariables {
  cardId: string;
  boardId: string;
  unlockedBy: string;
  correlationId: string;
}

export function useUnlockCard() {
  return useOptimisticMutation<UnlockCardVariables, any>({
    mutationFn: (vars) =>
      boardApi.unlockCard({ cardId: vars.cardId, mutationId: vars.correlationId }),

    targetSnapshot: (vars) => ({ cards: [vars.cardId] }),

    generateEnvelope: (vars, state) => {
      const card = state.cards[vars.cardId];
      if (!card) return null;
      return createOptimisticEnvelope(
        "card.unlocked",
        { cardId: vars.cardId, boardId: vars.boardId, unlockedBy: vars.unlockedBy },
        vars.cardId, "card", card.revision, vars.correlationId,
      );
    },
    errorMessage: "باز کردن قفل کارت با خطا مواجه شد.",
  });
}
