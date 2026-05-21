"use client";

import { useEffect, useRef } from "react";
import { useBoardStore } from "../store/useBoardStore";
import { usePendingGC } from "../store/mutations/core/usePendingGC";
import { boardSocket } from "../api/realtime/boardSocketClient";
import type { ListDto, CardDto } from "../store/useBoardStore";

// ============================================================================
// 🛡️ Types
// ============================================================================
interface BoardPageProps {
  boardId: string;
  // دیتایی که سرور در حالت SSR (از طریق tRPC یا Fetch) برای لود اولیه می‌فرستد
  initialLists: (ListDto & { cards: CardDto[] })[];
  initialSequence: string;
  // توکن احراز هویت برای وب‌ساکت (اختیاری، اگر از Cookie استفاده نمی‌کنید)
  authToken?: string; 
}

// ============================================================================
// 🚀 Main Board Component
// ============================================================================
export function BoardPage({ boardId, initialLists, initialSequence, authToken }: BoardPageProps) {
  // جلوگیری از Hydration مجدد در زمان Re-render های React
  const isHydrated = useRef(false);
  
  // استخراج توابع و استیت‌های حیاتی از استور
  const initBoard = useBoardStore((state) => state.initBoard);
  const syncStatus = useBoardStore((state) => state.syncStatus);
  const listOrder = useBoardStore((state) => state.listOrder);

  // ==========================================================================
  // 📥 1. Hydration (تزریق دیتای سرور به استور کلاینت)
  // ==========================================================================
  if (!isHydrated.current) {
    // مقداردهی اولیه استور با دیتای مرتب‌شده‌ی دیتابیس
    initBoard(initialLists, initialSequence);
    isHydrated.current = true;
  }

  // ==========================================================================
  // 🧹 2. Start Background Workers (Garbage Collector)
  // ==========================================================================
  // این هوک به صورت نامحسوس تراکنش‌های گیرکرده را هر ۶۰ ثانیه پاک می‌کند
  usePendingGC(60000);

  // ==========================================================================
  // 🔌 3. WebSocket Connection Management
  // ==========================================================================
  useEffect(() => {
    // به محض باز شدن صفحه، به رومِ این بورد در سرور وصل شو
    boardSocket.connect(boardId, authToken);

    // Cleanup: وقتی کاربر صفحه بورد را می‌بندد، مودبانه کانکشن را قطع کن
    return () => {
      boardSocket.disconnect();
    };
  }, [boardId, authToken]);

  // ==========================================================================
  // 🎨 4. Render
  // ==========================================================================
  return (
    <div className="flex flex-col h-screen bg-slate-900 text-slate-100 overflow-hidden">
      
      {/* 🌟 Header & Sync Status Indicator */}
      <header className="flex items-center justify-between px-6 py-3 bg-slate-800/50 border-b border-slate-700">
        <h1 className="text-xl font-bold text-white">My Workspace</h1>
        
        {/* نمایش وضعیت اتصال و سینک بودن بورد به کاربر (مثل Linear یا Notion) */}
        <div className="flex items-center gap-2 text-sm font-medium">
          {syncStatus === "healthy" && (
            <span className="flex items-center gap-1 text-emerald-400">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              Synced
            </span>
          )}
          {syncStatus === "reconnecting" && (
            <span className="text-amber-400 animate-pulse">Reconnecting...</span>
          )}
          {syncStatus === "gap_detected" && (
            <span className="text-amber-400">Syncing changes...</span>
          )}
          {syncStatus === "desynced" && (
            <span className="text-rose-400">Offline</span>
          )}
        </div>
      </header>

      {/* 🌟 Board Canvas (The Drag & Drop Area) */}
      <main className="flex-1 overflow-x-auto overflow-y-hidden p-6">
        <div className="flex h-full items-start gap-4">
          
          {/* رندر کردن لیست‌ها بر اساس آرایه‌ی listOrder */}
          {listOrder.map((listId) => (
            // اینجا کامپوننت List خودت رو قرار میدی
            // <ListContainer key={listId} listId={listId} />
            <div key={listId} className="w-72 shrink-0 bg-slate-800 rounded-lg p-3">
              <p className="text-slate-400 text-sm text-center border border-dashed border-slate-600 p-4 rounded">
                List {listId.substring(0, 5)}...
                <br />
                (Replace with ListComponent)
              </p>
            </div>
          ))}

          {/* دکمه ساخت لیست جدید */}
          <button className="w-72 shrink-0 bg-white/5 hover:bg-white/10 transition-colors rounded-lg p-3 flex items-center gap-2 text-slate-300 font-medium">
            <span className="text-lg">+</span> Add another list
          </button>
          
        </div>
      </main>

    </div>
  );
}