// packages/domain/src/events/index.ts

/**
 * ------------------------------------------------------------------
 * Domain Events Public API
 * ------------------------------------------------------------------
 * این فایل نقطه خروج (Entry/Exit point) پکیج دامین است.
 * هیچ فایلی در فرانت‌اند یا بک‌اند نباید مستقیماً به فایل‌های داخلی (مثل card.events.ts) وصل شود.
 * همه چیز در کل Monorepo باید فقط از همین `index.ts` خوانده شود.
 * ------------------------------------------------------------------
 */

export * from "./base";
export * from "./card.events";
export * from "./list.events";
export * from "./board.events";


// وارد کردن Union Type های مربوط به هر Aggregate
import type { CardEvent } from "./card.events";
import type { ListEvent } from "./list.events";
import type { BoardEvent } from "./board.events"; // (اگر فایلش را داری/می‌سازی)

/**
 * ------------------------------------------------------------------
 * AppDomainEvent (The Master Union Type)
 * ------------------------------------------------------------------
 * این تایپ ستون فقراتِ تایپ‌اسکریپت در معماری Event-Driven ماست.
 * * 🌟 مزیت این الگو:
 * فردا اگر رویداد `LabelEvent` را به سیستم اضافه کنی، فقط کافیست
 * آن را به این Union اضافه کنی. کل سیستم (از کاهنده‌های فرانت‌اند 
 * تا هندلرهای بک‌اند) بلافاصله تایپ‌های جدید را می‌شناسند.
 * ------------------------------------------------------------------
 */
export type AppDomainEvent = 
  | CardEvent 
  | ListEvent
  | BoardEvent;