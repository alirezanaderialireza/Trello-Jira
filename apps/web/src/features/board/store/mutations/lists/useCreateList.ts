// apps/web/src/features/board/store/mutations/lists/useCreateList.ts

import { useOptimisticMutation } from "../core/useOptimisticMutation";
import { createOptimisticEnvelope } from "../utils/createOptimisticEnvelope";
import { boardApi } from "../../../api/services/boardApi";

// ============================================================================
// 🛡️ Types
// ============================================================================
interface CreateListVariables {
  boardId: string;
  title: string;
  correlationId: string;
}

// ============================================================================
// 🚀 Mutation Hook
// ============================================================================
export function useCreateList() {
  return useOptimisticMutation<CreateListVariables, any>({
    
    // ۱. ارسال درخواست ساخت لیست به بک‌اند tRPC
    mutationFn: async (vars) => {
      // برای رعایت OCC، ورژن فعلی بورد را از استور می‌گیریم
      const store = (await import("../../useBoardStore")).useBoardStore.getState();
      
      return boardApi.createList({
        boardId: vars.boardId,
        title: vars.title,
        mutationId: vars.correlationId,
        // (اختیاری) ارسال ورژن بورد برای اطمینان از همگام بودن
        expectedBoardRevision: Number(store.boardSequence) 
      });
    },

    // ۲. اسنپ‌شات هوشمند (🌟 بسیار مهم برای لیست‌ها)
    targetSnapshot: (vars) => ({
      // ما باید از ترتیب کل لیست‌ها اسنپ‌شات بگیریم، چون لیست جدید به انتهای بورد اضافه می‌شود
      includeListOrder: true,
      // همچنین وضعیت کل لیست‌ها را نگه می‌داریم تا در صورت رول‌بک، یکپارچگی حفظ شود
      lists: [], 
    }),

    // ۳. تولید رویداد کلاینت برای نمایش آنی لیست در بورد
    generateEnvelope: (vars, state) => {
      const tempListId = crypto.randomUUID();

      // 🌟 محاسبه پوزیشن موقت برای لیست (ته صف)
      const lastListId = state.listOrder[state.listOrder.length - 1];
      const lastListPosition = lastListId && state.lists[lastListId]
        ? state.lists[lastListId].position
        : "a"; // اگر بورد کاملاً خالی باشد
      
      const optimisticPosition = lastListPosition + "V";

      // ✉️ ساخت پاکت رویداد مطابق با استانداردهای دامین (list.events.ts)
      return createOptimisticEnvelope(
        "list.created",
        {
          listId: tempListId,
          boardId: vars.boardId,
          title: vars.title,
          position: optimisticPosition,
        },
        tempListId,   // aggregateId
        "list",       // aggregateType
        0,            // currentRevision (موجودیت جدید)
        vars.correlationId
      );
    },

    // ۴. مدیریت خطا و پیام‌های سیستم
    errorMessage: "ساخت لیست جدید با خطا مواجه شد.",
  });
}