// apps/web/src/features/board/store/mutations/cards/useUpdateCard.ts

import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

// ============================================================================
// 🛡️ Types
// ============================================================================
interface UpdateCardVariables {
  id: string;
  title?: string;
  description?: string;
  correlationId: string;
}

// ============================================================================
// 🚀 Mutation Hook
// ============================================================================
export function useUpdateCard() {
  return useOptimisticMutation<UpdateCardVariables, any>({
    
    // ۱. فراخوانی روت tRPC برای آپدیت کارت
    mutationFn: async (vars) => {
      const store = (await import("../../useBoardStore")).useBoardStore.getState();
      const currentCard = store.cards[vars.id];

      return boardApi.updateCard({
        id: vars.id,
        title: vars.title,
        description: vars.description,
        // ارسال ورژن فعلی برای جلوگیری از Conflict در دیتابیس
        expectedRevision: currentCard?.revision,
        mutationId: vars.correlationId,
      });
    },

    // ۲. اسنپ‌شات از خودِ کارت (برای رول‌بک در صورت بروز خطا)
    targetSnapshot: (vars) => ({
      cards: [vars.id],
    }),

    // ۳. تولید رویداد آپدیت برای اعمال آنی تغییرات در UI
    generateEnvelope: (vars, state) => {
      const currentCard = state.cards[vars.id];
      if (!currentCard) return null;

      return createOptimisticEnvelope(
        "card.updated",
        {
          cardId: vars.id,
          boardId: currentCard.boardId,
          changes: {
            ...(vars.title !== undefined && { title: vars.title }),
            ...(vars.description !== undefined && { description: vars.description }),
          },
        },
        vars.id,           // aggregateId
        "card",            // aggregateType
        currentCard.revision,
        vars.correlationId
      );
    },

    // ۴. مدیریت نوتیفیکیشن‌ها
    errorMessage: "ویرایش کارت انجام نشد. وضعیت به حالت قبل بازگشت.",
  });
}