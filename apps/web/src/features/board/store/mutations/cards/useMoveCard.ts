// apps/web/src/features/board/store/mutations/cards/useMoveCard.ts

import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

// ============================================================================
// 🛡️ Types
// ============================================================================
interface MoveCardVariables {
  cardId: string;
  boardId: string;
  fromListId: string;
  toListId: string;
  
  // 🌟 دیتای مورد نیاز برای موتور LexoRank در بک‌اند
  mode: "APPEND" | "PREPEND" | "INSERT_BETWEEN" | "REORDER_SAME_LIST";
  prevId?: string;
  nextId?: string;
  
  // 🌟 دیتای موقت برای آپدیت در لحظه (۶۰ فریم بر ثانیه) در UI
  optimisticPosition: string; 
  
  correlationId: string;
}

// ============================================================================
// 🚀 Mutation Hook
// ============================================================================
export function useMoveCard() {
  return useOptimisticMutation<MoveCardVariables, any>({
    
    // ۱. ارسال ریکوئست به روتر قدرتمند MoveCard در tRPC
    mutationFn: async (vars) => {
      // برای رعایت کامل OCC (قفل خوش‌بینانه)، ورژن لیست‌های درگیر را می‌گیریم
      const store = (await import("../../useBoardStore")).useBoardStore.getState();
      const expectedListRevisions: Record<string, number> = {};
      
      const fromList = store.lists[vars.fromListId];
      const toList = store.lists[vars.toListId];
      
      if (fromList) expectedListRevisions[fromList.id] = fromList.revision;
      if (toList && toList.id !== fromList?.id) expectedListRevisions[toList.id] = toList.revision;

      return boardApi.moveCard({
        cardId: vars.cardId,
        targetListId: vars.toListId,
        mode: vars.mode,
        prevId: vars.prevId,
        nextId: vars.nextId,
        expectedListRevisions, // محافظت در برابر Race Condition
        mutationId: vars.correlationId,
      });
    },

    // ۲. اسنپ‌شات هوشمند (رول‌بکِ بی‌نقص)
    targetSnapshot: (vars) => ({
      // کپی از خود کارت
      cards: [vars.cardId],
      // کپی از وضعیت هر دو لیست مبدا و مقصد (تا اگر خطا داد، کارت دقیقاً به لیست اول برگردد)
      lists: vars.fromListId === vars.toListId 
        ? [vars.fromListId] 
        : [vars.fromListId, vars.toListId],
    }),

    // ۳. تولید رویداد Canonical برای موتور دیسپچر
    generateEnvelope: (vars, state) => {
      const card = state.cards[vars.cardId];
      if (!card) return null;

      // 🌟 طبق فایل card.events.ts که فرستادی، این پی‌لود کاملاً استاندارد است
      return createOptimisticEnvelope(
        "card.moved",
        {
          cardId: vars.cardId,
          boardId: vars.boardId,
          fromListId: vars.fromListId,
          toListId: vars.toListId,
          oldPosition: card.position,
          newPosition: vars.optimisticPosition, // موقعیت موقت تا زمان تایید سرور
        },
        vars.cardId,           // aggregateId
        "card",                // aggregateType
        card.revision,         // ورژن فعلی (در رویداد +1 می‌شود)
        vars.correlationId
      );
    },

    // ۴. مدیریت خطا
    errorMessage: "جابجایی کارت با خطا مواجه شد. کارت به جای قبلی بازگشت.",
  });
}