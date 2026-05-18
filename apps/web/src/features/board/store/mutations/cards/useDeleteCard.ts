// apps/web/src/features/board/store/mutations/cards/useDeleteCard.ts

import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

// ============================================================================
// 🛡️ Types
// ============================================================================
interface DeleteCardVariables {
  id: string;
  correlationId: string;
}

// ============================================================================
// 🚀 Mutation Hook
// ============================================================================
export function useDeleteCard() {
  return useOptimisticMutation<DeleteCardVariables, any>({
    
    // ۱. ارسال درخواست حذف به بک‌اند (tRPC)
    mutationFn: async (vars) => {
      return boardApi.deleteCard({
        id: vars.id,
        mutationId: vars.correlationId,
      });
    },

    // ۲. اسنپ‌شات هوشمند برای رول‌بک (بسیار مهم 🌟)
    targetSnapshot: (vars, state) => {
      const card = state.cards[vars.id];
      if (!card) return {};
      
      return {
        // از خود کارت بک‌آپ می‌گیریم تا در صورت خطا، دیتای کارت برگردد
        cards: [vars.id],
        // از لیستِ کارت هم بک‌آپ می‌گیریم تا "ترتیب کارت‌ها در آن لیست" به هم نخورد
        lists: [card.listId], 
      };
    },

    // ۳. تولید رویداد Canonical برای حذف آنی از UI
    generateEnvelope: (vars, state) => {
      const card = state.cards[vars.id];
      if (!card) return null;

      return createOptimisticEnvelope(
        "card.deleted",
        {
          cardId: vars.id,
          // طبق فایل card.events.ts بک‌اند، رویداد حذف به boardId هم نیاز دارد
          boardId: card.boardId, 
        },
        vars.id,           // aggregateId
        "card",            // aggregateType
        card.revision,     // ورژن فعلی (که در رویداد +1 می‌شود)
        vars.correlationId
      );
    },

    // ۴. پیام خطا در صورت شکست عملیات
    errorMessage: "حذف کارت با خطا مواجه شد. کارت به لیست بازگشت.",
  });
}