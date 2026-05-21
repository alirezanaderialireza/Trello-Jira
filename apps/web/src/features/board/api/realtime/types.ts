// apps/web/src/features/board/api/realtime/types.ts

import type { AppDomainEvent } from "@repo/domain";

/**
 * 📡 WebSocket Message Types
 * انواع پیام‌هایی که بین کلاینت و سرور رد و بدل می‌شوند.
 */
export interface WsEvent {
  sequence: string;
  type: string;
  payload: any; // یا AppDomainEvent اگه ایمپورتش کردی
}
export type WsMessageType = 
  | "SUBSCRIBE"        // درخواست کلاینت برای گوش دادن به یک بورد
  | "UNSUBSCRIBE"      // لغو اشتراک
  | "EVENT"            // رویدادهای دامین (کارت، لیست و غیره)
  | "SYSTEM"           // پیام‌های سیستمی (خطا، تایید اتصال)
  | "HEARTBEAT"        // برای زنده نگه داشتن کانکشن
  | "RESYNC_REQUIRED"; // وقتی Gap غیرقابل جبران باشد

/**
 * 📦 The Real-time Envelope (Server to Client)
 * ساختار پیامی که از سمت سرور وب‌ساکت دریافت می‌شود.
 */
export interface RealtimeMessage {
  // نوع پیام برای دیسپچ کردن در کلاینت
  type: WsMessageType;

  // 🔢 توالی جهانی (Sequence) برای سیستم Gap Detection
  // این مقدار باید به صورت String باشد چون BigInt در JSON پشتیبانی نمی‌شود.
  sequence?: string;

  // ✉️ بدنه اصلی رویداد دامین (اگر نوع پیام EVENT باشد)
  payload?: AppDomainEvent;

  // دیتای اضافی سیستمی (مثل کد خطا یا پیام متنی)
  meta?: {
    timestamp: string;
    reason?: string;
    connectionId?: string;
  };
}

/**
 * 📥 Client Request Payload
 * ساختار درخواستی که کلاینت به سمت سرور می‌فرستد.
 */
export interface RealtimeRequest {
  action: "subscribe" | "unsubscribe" | "ping";
  boardId: string;
  // آخرین توالی که کلاینت دریافت کرده (برای سیستم بازسازی خودکار تاریخچه)
  lastSequence?: string;
  token?: string;
}

/**
 * 🚦 Connection Health Status
 * وضعیت فیزیکی و منطقی اتصال به سرور
 */
export type RealtimeStatus = 
  | "CONNECTING"   // در حال تلاش برای برقراری اتصال
  | "CONNECTED"    // متصل و آماده دریافت
  | "DISCONNECTED" // قطع شده
  | "RECONNECTING" // در حال تلاش مجدد خودکار
  | "SUBSCRIBED"   // متصل به اتاقِ بورد خاص
  | "ERROR";       // خطای سیستمی

/**
 * 🛠️ Gap Analysis Result
 * خروجی سیستم تحلیل توالی پیام‌ها
 */
export interface SequenceGap {
  detected: boolean;
  missingCount: number;
  expectedSeq: bigint;
  receivedSeq: bigint;
}