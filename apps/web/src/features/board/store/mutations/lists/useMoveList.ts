// apps/web/src/features/board/store/mutations/lists/useMoveList.ts

import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

// ============================================================================
// 🛡️ Types
// ============================================================================
interface MoveListVariables {
  listId: string;
  boardId: string;
  
  // دیتای مورد نیاز برای محاسبات پوزیشن در کلاینت و سرور
  optimisticPosition: string;
  
  correlationId: string;
}

// ============================================================================
// 🚀 Mutation Hook
// ============================================================================
export function useMoveList() {
  return useOptimisticMutation<MoveListVariables, any>({
    
    // ۱. ارسال درخواست جابجایی به روت tRPC
    mutationFn: async (vars) => {
      return boardApi.moveList({
        boardId: vars.boardId,
        listId: vars.listId,
        newPosition: vars.optimisticPosition,
        mutationId: vars.correlationId,
      });
    },

    // ۲. اسنپ‌شات از ترتیب لیست‌ها (🌟 حیاتی برای رول‌بکِ جابجایی)
    targetSnapshot: (vars) => ({
      // ذخیره آرایه listOrder فعلی بورد
      includeListOrder: true,
      // ذخیره وضعیت خودِ لیستی که جابجا می‌شود
      lists: [vars.listId],
    }),

    // ۳. تولید رویداد Canonical برای آپدیت آنی UI
    generateEnvelope: (vars, state) => {
      const list = state.lists[vars.listId];
      if (!list) return null;

      // مطابق با قراردادهای دامین در فایل list.events.ts
      return createOptimisticEnvelope(
        "list.moved",
        {
          listId: vars.listId,
          boardId: vars.boardId,
          oldPosition: list.position,
          newPosition: vars.optimisticPosition,
        },
        vars.listId,       // aggregateId
        "list",           // aggregateType
        list.revision,
        vars.correlationId
      );
    },

    // ۴. مدیریت خطا
    errorMessage: "جابجایی لیست انجام نشد. بورد به حالت قبل بازگشت.",
  });
}