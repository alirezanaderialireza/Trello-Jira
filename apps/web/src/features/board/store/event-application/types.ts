// apps/web/src/features/board/store/event-application/types.ts

// 🌟 (Fix): ایمپورت مستقیماً از ریشه دامین انجام می‌شود
import type { AppDomainEvent } from "@repo/domain";

/**
 * ------------------------------------------------------------------
 * Client Event Envelope
 * ------------------------------------------------------------------
 *
 * Domain Event باید کاملاً Pure و Environment-agnostic باقی بماند.
 * این Envelope متادیتاهای Runtime / Client-side را به رویداد وصل می‌کند
 * بدون اینکه خود Event آلوده به concerns مربوط به UI، Offline،
 * Optimistic State یا Reconciliation شود.
 *
 * این لایه پایه‌ی:
 * - Offline-first replay
 * - Optimistic UI
 * - Reconciliation
 * - Echo prevention
 * - WebSocket sync
 * - Local-only state transitions
 * است.
 * ------------------------------------------------------------------
 */

export interface ClientEventEnvelope<
  TEvent extends AppDomainEvent = AppDomainEvent,
> {
  /**
   * ----------------------------------------------------------------
   * Pure Domain Event
   * ----------------------------------------------------------------
   * رویداد اصلی سیستم.
   * Immutable + Replay-safe + Deterministic
   * ----------------------------------------------------------------
   */
  readonly event: TEvent;

  /**
   * ----------------------------------------------------------------
   * Runtime Execution Metadata
   * ----------------------------------------------------------------
   * اطلاعاتی درباره نحوه اجرای Event در Runtime کلاینت.
   * این داده‌ها بخشی از Domain نیستند.
   * ----------------------------------------------------------------
   */

  /**
   * آیا این Event هنوز فقط در کلاینت اعمال شده
   * و منتظر تایید سرور است؟
   */
  readonly optimistic?: boolean;

  /**
   * آیا سرور این Event را تایید کرده؟
   * معمولاً بعد از دریافت ACK یا Sync Replay.
   */
  readonly acknowledged?: boolean;

  /**
   * آیا این Event در حال Replay شدن است؟
   * مثال:
   * - بعد از reconnect
   * - hydration از IndexedDB
   * - recovery بعد از crash
   */
  readonly replayed?: boolean;

  /**
   * آیا این Event فقط مخصوص کلاینت است
   * و نباید به سرور ارسال شود؟
   *
   * مثال:
   * - modal opened
   * - panel resized
   * - local selection changed
   */
  readonly localOnly?: boolean;

  /**
   * ----------------------------------------------------------------
   * Reconciliation Metadata
   * ----------------------------------------------------------------
   */

  /**
   * شناسه‌ای برای match کردن نسخه Optimistic
   * با نسخه نهایی تاییدشده‌ی سرور.
   *
   * مثال:
   * optimistic:
   * localCorrelationId = "tmp-123"
   *
   * server ACK:
   * localCorrelationId = "tmp-123"
   */
  readonly localCorrelationId?: string;
}