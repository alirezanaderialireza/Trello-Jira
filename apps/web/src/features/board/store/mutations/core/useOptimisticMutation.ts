// apps/web/src/features/board/store/mutations/core/useOptimisticMutation.ts

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useBoardStore, type BoardStoreState } from "../../useBoardStore";
import { createSnapshot, type SnapshotTarget } from "./createSnapshot";
import type { ClientEventEnvelope } from "../../event-application/types";

// ============================================================================
// 🛡️ Configuration Types
// ============================================================================

/**
 * 🌟 قرارداد ورودی‌های موتور خوش‌بینانه
 * برای تضمین Idempotency، تمام Mutationها باید دارای correlationId باشند.
 */
export interface OptimisticMutationConfig<TVariables extends { correlationId: string }, TData> {
  // ۱. تابع اصلی که درخواست را به سرور می‌فرستد (tRPC)
  mutationFn: (variables: TVariables) => Promise<TData>;
  
  // ۲. کلید کوئری‌هایی که باید هنگام شروع Mutation متوقف (Cancel) شوند تا تداخل پیش نیاید
  queryKeyToCancel?: unknown[];
  
  // ۳. تابعی که مشخص می‌کند از چه چیزهایی باید اسنپ‌شاتِ عمیق گرفته شود
  targetSnapshot: (variables: TVariables, state: BoardStoreState) => SnapshotTarget;
  
  // ۴. تابعی که رویداد خوش‌بینانه (Canonical Event) را تولید می‌کند
  generateEnvelope: (variables: TVariables, state: BoardStoreState) => ClientEventEnvelope | null;
  
  // ۵. پیام‌های سفارشی برای سیستم Toast
  successMessage?: string;
  errorMessage?: string;
}

// ============================================================================
// 🚀 The Optimistic Engine (Phase 2.5)
// ============================================================================

export function useOptimisticMutation<TVariables extends { correlationId: string }, TData>(
  config: OptimisticMutationConfig<TVariables, TData>
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: config.mutationFn,

    // ------------------------------------------------------------------------
    // 🎬 1. ON MUTATE: قبل از ارسال ریکوئست به سرور اجرا می‌شود
    // ------------------------------------------------------------------------
    onMutate: async (variables) => {
      // 🛑 ۱. متوقف کردن کوئری‌های در حال اجرا (جلوگیری از Race Condition)
      if (config.queryKeyToCancel) {
        await queryClient.cancelQueries({ queryKey: config.queryKeyToCancel });
      }

      const store = useBoardStore.getState();

      // 📸 ۲. گرفتن Snapshot ایزوله و O(1) از موجودیت‌های هدف
      const target = config.targetSnapshot(variables, store);
      const snapshot = createSnapshot(store, target);

      // ✉️ ۳. تولید پاکتِ رویدادِ خوش‌بینانه (Client Envelope)
      const envelope = config.generateEnvelope(variables, store);

      // 🌟 aggregateId برای aggregate-bound rollback ذخیره می‌شود (در صورت عدم وجود
      // envelope هم null باقی می‌ماند که در onError قبل از rollback چک می‌شود).
      const aggregateId = envelope?.event.aggregateId ?? null;

      if (envelope) {
        // 🗄️ ۴. ثبت تراکنش در Pending Registry (برای پیگیری وضعیت و رول‌بک احتمالی)
        store.registerPendingMutation({
          correlationId: variables.correlationId,
          type: envelope.event.type,
          createdAt: Date.now(),
          aggregateId: envelope.event.aggregateId,
          rollbackSnapshot: snapshot, // اسنپ‌شات در دل تراکنش ذخیره می‌شود
          retryCount: 0,
          status: "pending",
          optimisticVersion: envelope.event.version,
        });

        // ⚡ ۵. اعمال آنی رویداد در UI (جادوی Optimistic Update)
        store.applyEvent(envelope, { mode: "live" });
      }

      // 📦 بازگرداندن اسنپ‌شات، correlationId و aggregateId به context
      // تا در onError برای rollback aggregate-bound در دسترس باشد.
      return { snapshot, correlationId: variables.correlationId, aggregateId };
    },

    // ------------------------------------------------------------------------
    // 🚨 2. ON ERROR: اگر ریکوئست tRPC فیلد شود یا اینترنت قطع شود
    // ------------------------------------------------------------------------
    onError: (err, variables, context) => {
      console.error(`[OptimisticEngine] Mutation failed for ${variables.correlationId}`, err);

      const store = useBoardStore.getState();

      if (context?.correlationId) {
        // 🔴 ۱. تغییر وضعیت تراکنش به Failed
        store.updatePendingMutationStatus(context.correlationId, "failed");
        
        // 🛡️ ۲. رول‌بک اتمیک! 
        // استور چک می‌کند که اگر دیتای سرور جدیدتر از اسنپ‌شات نباشد، آن را برمی‌گرداند.
        // 🌟 aggregateId را پاس می‌دهیم تا cleanup فقط محدود به همین mutation باشد
        // و mutationهای موازی روی همین لیست را آسیب نزند.
        if (context.snapshot) {
          store.restoreSnapshot(context.snapshot, context.aggregateId ?? undefined);
        }
      }

      // 🔔 ۳. نمایش خطا به کاربر
      toast.error(config.errorMessage || "عملیات با خطا مواجه شد. تغییرات لغو شدند.", {
        description: "لطفاً اتصال اینترنت خود را بررسی کنید.",
      });
    },

    // ------------------------------------------------------------------------
    // ✅ 3. ON SUCCESS: وقتی سرور درخواست را تایید می‌کند
    // ------------------------------------------------------------------------
    onSuccess: (data, variables) => {
      const store = useBoardStore.getState();
      
      /**
       * 🌟 Reconciliation Note:
       * در معماری ما، حذف قطعیِ تراکنش از Pending Registry توسط پیامِ WebSocket 
       * (در متد applyWebsocketEvent) انجام می‌شود تا از یکپارچگی مطمئن شویم.
       * اینجا فقط وضعیت آن را به acked تغییر می‌دهیم.
       */
      store.updatePendingMutationStatus(variables.correlationId, "acked");

      if (config.successMessage) {
        toast.success(config.successMessage);
      }
    },

    // ------------------------------------------------------------------------
    // 🧹 4. ON SETTLED: چه موفق چه ناموفق، در نهایت اجرا می‌شود
    // ------------------------------------------------------------------------
    onSettled: () => {
      // می‌توانیم در اینجا کوئری‌ها را Invalidate کنیم، اما چون ما از
      // وب‌ساکت و Gap Detection استفاده می‌کنیم، نیازی به Invalidate کورکورانه نداریم.
    }
  });
}