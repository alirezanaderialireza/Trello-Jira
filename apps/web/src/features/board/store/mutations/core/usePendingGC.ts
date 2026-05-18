// apps/web/src/features/board/store/mutations/core/usePendingGC.ts

import { useEffect } from "react";
import { useBoardStore } from "../../useBoardStore";

/**
 * 🧹 Pending Garbage Collector (GC) Hook
 * * وظیفه: پاکسازی دوره‌ای تراکنش‌های معلق و تاریخ‌گذشته از مموری مرورگر.
 * این هوک باید فقط در یک کامپوننتِ سطح بالا (مثل خودِ Board یا Layout آن) فراخوانی شود 
 * تا در کل زمان باز بودن بورد، در پس‌زمینه کار کند.
 * * @param intervalMs فاصله زمانی بین هر بار پاکسازی (پیش‌فرض: ۶۰ ثانیه)
 */
export function usePendingGC(intervalMs: number = 60000) {
  useEffect(() => {
    const store = useBoardStore.getState();

    // ۱. اجرای یک‌باره هنگام مانت شدن (مثلاً وقتی کاربر بعد از آفلاین بودن صفحه را رفرش می‌کند)
    store.gcPendingMutations();

    // ۲. راه‌اندازی تایمر چرخشی
    const intervalId = setInterval(() => {
      store.gcPendingMutations();
      
      // لاگ برای محیط توسعه (Development) تا خیالت راحت باشد که GC در حال کار است
      if (process.env.NODE_ENV === "development") {
        const currentPendingCount = Object.keys(useBoardStore.getState().pendingMutations).length;
        if (currentPendingCount > 0) {
          console.debug(`[PendingGC] Cleaned up stale mutations. Remaining active: ${currentPendingCount}`);
        }
      }
    }, intervalMs);

    // ۳. تمیزکاری (Cleanup) هنگام خارج شدن کاربر از صفحه بورد
    return () => clearInterval(intervalId);
  }, [intervalMs]);
}