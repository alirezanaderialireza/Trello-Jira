// apps/web/src/features/board/store/mutations/lists/useUpdateList.ts

import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

// ============================================================================
// 🛡️ Types
// ============================================================================
interface UpdateListVariables {
  listId: string;
  boardId: string;
  title: string;
  correlationId: string;
}

// ============================================================================
// 🚀 Mutation Hook
// ============================================================================
export function useUpdateList() {
  return useOptimisticMutation<UpdateListVariables, any>({
    
    // ۱. فراخوانی روت tRPC برای آپدیت عنوان لیست
    mutationFn: async (vars) => {
      return boardApi.updateList({
        listId: vars.listId,
        title: vars.title,
        mutationId: vars.correlationId,
      });
    },

    // ۲. اسنپ‌شات از وضعیت فعلی لیست (برای رول‌بک در صورت خطا)
    targetSnapshot: (vars) => ({
      lists: [vars.listId],
    }),

    // ۳. تولید رویداد کلاینت برای تغییر آنی عنوان در UI
    generateEnvelope: (vars, state) => {
      const list = state.lists[vars.listId];
      if (!list) return null;

      // مطابق با ساختار ListUpdatedPayload در فایل list.events.ts دامین
      return createOptimisticEnvelope(
        "list.updated",
        {
          listId: vars.listId,
          boardId: vars.boardId,
          changes: {
            title: vars.title,
          },
        },
        vars.listId,       // aggregateId
        "list",            // aggregateType
        list.revision,
        vars.correlationId
      );
    },

    // ۴. مدیریت خطا
    errorMessage: "تغییر نام لیست انجام نشد. وضعیت به حالت قبل بازگشت.",
  });
}