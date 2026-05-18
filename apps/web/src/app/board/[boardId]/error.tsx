"use client"; // 🌟 Error boundary ها در Next.js حتماً باید کلاینت باشن

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function BoardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
    // اینجا می‌تونی ارور رو به سرویس‌هایی مثل Sentry یا Datadog بفرستی
    console.error("Board Level Error:", error);
  }, [error]);

  return (
    <div className="h-screen flex flex-col items-center justify-center bg-[#fbfbfd] p-4 text-[#1d1d1f]">
      <div className="max-w-md w-full bg-white p-8 rounded-2xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] border border-gray-100 text-center">
        {/* آیکون ارور (مینیمال) */}
        <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-6">
          <svg className="w-8 h-8 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>

        <h2 className="text-xl font-semibold mb-2 tracking-tight">
          Oops! Something went wrong.
        </h2>
        
        <p className="text-gray-500 text-sm mb-8 leading-relaxed">
          {/* نمایش پیام اروری که از سمت بک‌اند (TRPCError) فرستادیم */}
          {error.message || "We couldn't load this board. Please try again later."}
        </p>

        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button
            onClick={() => router.push("/")} // یا ریدایرکت به داشبورد لیست بوردها
            className="px-5 py-2.5 rounded-lg text-sm font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 transition-colors"
          >
            Go to Dashboard
          </button>
          
          <button
            onClick={() => reset()} // تلاش مجدد برای رندر صفحه
            className="px-5 py-2.5 rounded-lg text-sm font-medium text-white bg-[#0A2540] hover:bg-[#0A2540]/90 transition-colors shadow-sm"
          >
            Try Again
          </button>
        </div>
      </div>
    </div>
  );
}