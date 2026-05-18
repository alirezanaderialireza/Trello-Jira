// apps/web/src/features/board/store/mutations/lists/useDeleteList.ts

import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

// ============================================================================
// 🛡️ Types
// ============================================================================
interface DeleteListVariables {
  listId: string;
  boardId: string;
  correlationId: string;
}

// ============================================================================
// 🚀 Mutation Hook
// ============================================================================
export function useDeleteList() {
  return useOptimisticMutation<DeleteListVariables, any>({
    
    // ۱. ارسال درخواست حذف به بک‌اند (tRPC)
    mutationFn: async (vars) => {
      return boardApi.deleteList({
        listId: vars.listId,
        mutationId: vars.correlationId,
      });
    },

    // ۲. اسنپ‌شات سنگین و حیاتی برای رول‌بک (🌟)
    targetSnapshot: (vars, state) => {
      // پیدا کردن تمام کارت‌هایی که داخل این لیست هستند
      const cardsInThisList = state.cardsByList[vars.listId] || [];

      return {
        // بازگردانی ترتیب لیست‌ها در کل بورد
        includeListOrder: true,
        
        // بازگردانی اطلاعات خود لیست و آرایه کارت‌های متصل به آن
        lists: [vars.listId],
        
        // بک‌آپ‌گیری عمیق از تک‌تک کارت‌های داخل لیست تا اگر رول‌بک شد، دیتایشان از بین نرفته باشد
        cards: cardsInThisList,
      };
    },

    // ۳. تولید رویداد Canonical برای حذف آنی از UI
    generateEnvelope: (vars, state) => {
      const list = state.lists[vars.listId];
      if (!list) return null;

      return createOptimisticEnvelope(
        "list.deleted",
        {
          listId: vars.listId,
          boardId: vars.boardId,
        },
        vars.listId,       // aggregateId
        "list",            // aggregateType
        list.revision,     // ورژن فعلی لیست
        vars.correlationId
      );
    },

    // ۴. مدیریت خطا
    errorMessage: "حذف لیست با خطا مواجه شد. لیست و کارت‌های آن بازیابی شدند.",
  });
}