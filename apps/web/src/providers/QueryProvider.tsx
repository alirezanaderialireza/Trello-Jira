"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";

/**
 * 🚀 QueryProvider - لایه‌ی مدیریت وضعیت شبکه
 * این کامپوننت هسته‌ی اصلی React Query را برای کل اپلیکیشن (از جمله tRPC) تنظیم می‌کند.
 */
export function QueryProvider({ children }: { children: ReactNode }) {
  // استفاده از useState برای اطمینان از اینکه QueryClient در سمت سرور (SSR) 
  // بین ریکوئست‌های کاربران مختلف به اشتراک گذاشته نمی‌شود.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            /**
             * 🛡️ تنظیمات حیاتی برای سیستم‌های Collaborative:
             * ما از وب‌ساکت برای دریافت لحظه‌ای تغییرات استفاده می‌کنیم، 
             * پس نباید اجازه دهیم React Query با هر بار کلیک یا تغییر تب، 
             * دیتا را دوباره Fetch کند. این کار باعث تداخل (Race Condition) می‌شود.
             */
            refetchOnWindowFocus: false, // جلوگیری از رفرش خودکار با تغییر تب مرورگر
            refetchOnReconnect: "always", // فقط هنگام وصل شدن مجدد اینترنت رفرش انجام شود
            
            staleTime: 5 * 60 * 1000, // دیتا تا ۵ دقیقه "تازه" محسوب شود
            gcTime: 10 * 60 * 1000,    // نگهداری دیتا در حافظه پنهان تا ۱۰ دقیقه
            
            retry: (failureCount, error: any) => {
              // برای خطاهای ۴۰۴ یا ۴۰۱ (عدم دسترسی) دوباره تلاش نکند
              if (error?.data?.httpStatus === 404 || error?.data?.httpStatus === 401) return false;
              return failureCount < 2;
            },
          },
          mutations: {
            /**
             * ⚡ تنظیمات Mutationها:
             * در صورت قطع لحظه‌ای شبکه، ریکوئست را بلافاصله با شکست مواجه نکند.
             */
            retry: 1,
            retryDelay: 1000,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}