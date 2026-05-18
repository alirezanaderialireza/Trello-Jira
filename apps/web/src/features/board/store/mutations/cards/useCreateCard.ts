// apps/web/src/features/board/store/mutations/cards/useCreateCard.ts

import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

// ============================================================================
// 🛡️ Types
// ============================================================================
interface CreateCardVariables {
  boardId: string;
  listId: string;
  title: string;
  correlationId: string;
}

// ============================================================================
// 🚀 Mutation Hook
// ============================================================================
export function useCreateCard() {
  return useOptimisticMutation<CreateCardVariables, any>({
    
    // ۱. ارسال ریکوئست به بک‌اند tRPC
    mutationFn: async (vars) => {
      return boardApi.createCard({
        listId: vars.listId,
        title: vars.title,
        mutationId: vars.correlationId,
      });
    },

    // ۲. اسنپ‌شات هوشمند (فقط از لیستی که کارت به آن اضافه می‌شود کپی می‌گیریم)
    targetSnapshot: (vars) => ({
      lists: [vars.listId],
    }),

    // ۳. تولید رویداد Canonical برای اعمال آنی در UI
    generateEnvelope: (vars, state) => {
      // بررسی وجود لیست در استور
      const list = state.lists[vars.listId];
      if (!list) return null;

      // 🌟 تولید یک ID موقت برای کلاینت تا زمانی که سرور ID اصلی را برگرداند
      const tempCardId = crypto.randomUUID();

      // 🌟 محاسبه یک پوزیشن موقت (Optimistic Position)
      // توجه: سرور در نهایت LexoRank دقیق را محاسبه کرده و در Reconciliation آپدیت می‌کند.
      const cardsInList = state.cardsByList[vars.listId] || [];
      const lastCardId = cardsInList[cardsInList.length - 1];
      const lastCardPosition = lastCardId && state.cards[lastCardId] 
        ? state.cards[lastCardId].position 
        : "a"; // پوزیشن پیش‌فرض اگر لیست خالی باشد
      
      const optimisticPosition = lastCardPosition + "V"; 

      // ✉️ ساخت پاکت رویداد
      return createOptimisticEnvelope(
        "card.created",
        {
          cardId: tempCardId,
          listId: vars.listId,
          boardId: vars.boardId,
          title: vars.title,
          position: optimisticPosition,
        },
        tempCardId,   // aggregateId (شناسه کارتی که در حال ساخت است)
        "card",       // aggregateType
        0,            // currentRevision (چون تازه در حال ساخت است، ورژن اولیه ۰ است)
        vars.correlationId
      );
    },

    // ۴. پیام‌های UI (اختیاری)
    errorMessage: "ساخت کارت با خطا مواجه شد. تغییرات لغو شدند.",
    // successMessage را اینجا نمی‌دهیم تا UI کاربر را با نوتیفیکیشن‌های زیاد خسته نکنیم
  });
}