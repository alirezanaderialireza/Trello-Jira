// packages/domain/src/events/base.ts

/**
 * 🌟 [ارتقا ۱]: تعریف تمامی انواع رویدادهای مجاز در سیستم
 * این کار باعث می‌شود در Dispatcher و Mutations هیچ خطای تایپی (Typo) رخ ندهد.
 */
export type DomainEventType = 
  | "card.created" | "card.moved" | "card.updated" | "card.deleted"
  | "list.created" | "list.moved" | "list.updated" | "list.deleted"
  | "board.created" | "board.renamed" | "board.archived" | "board.unarchived" | "board.visibility_changed";

export type AggregateType = "board" | "list" | "card";

/**
 * ------------------------------------------------------------------
 * The Canonical Domain Event Base (Production-Grade)
 * ------------------------------------------------------------------
 * این قراردادِ پایه‌ی تمام رویدادهای سیستم توست.
 * هیچ رویدادی حق ندارد در سیستم حرکت کند مگر اینکه این ساختار را رعایت کرده باشد.
 * ------------------------------------------------------------------
 */
export interface DomainEvent<
  TType extends DomainEventType = DomainEventType,
  TPayload = unknown
> {
  // ==========================================
  // 1. Event Identification
  // ==========================================
  
  /** شناسه منحصربه‌فرد خودِ رویداد (UUID) */
  readonly id: string;
  
  /** * نام رویداد (مثلاً "card.moved")
   * 🌟 به لطف DomainEventType، اینجا Autocomplete کامل داریم.
   */
  readonly type: TType;

  // ==========================================
  // 2. Ordering, Concurrency & Versioning
  // ==========================================
  
  /** * 🌟 ورژن قطعی موجودیت (Canonical Aggregate Version).
   * این تنها Source of Truth برای سیستم Stale Protection است.
   */
  readonly version: number;

  /** تاریخ و زمان وقوع رویداد به فرمت ISO8601 UTC */
  readonly occurredAt: string;

  /** * 🌟 ورژن اسکیما برای مدیریت تکامل رویدادها در آینده (Migrations)
   * (جایگزین eventVersion انتقالی شد)
   */
  readonly schemaVersion?: number;

  // ==========================================
  // 3. State Changes
  // ==========================================
  
  /** * دیتای اصلی رویداد. 
   * 🌟 Readonly بودنِ عمیق برای تضمین Purity در Reducerها.
   */
  readonly payload: Readonly<TPayload>;

  // ==========================================
  // 4. Distributed System Metadata
  // ==========================================
  
  /** شناسه موجودیتی که تغییر کرده (Root Aggregate ID) */
  readonly aggregateId: string;
  
  /** نوع موجودیت */
  readonly aggregateType: AggregateType;

  /** ترتیب جهانی (Global Sequence) در دیتابیس یا Message Broker */
  readonly sequence?: number;

  /** شناسه کاربری که رویداد را رقم زده */
  readonly actorId?: string;

  /** شناسه تیم/سازمان برای جداسازی داده‌ها (Multi-tenancy) */
  readonly tenantId?: string;

  /** * Correlation ID: برای Optimistic UI و ردیابی تراکنش از کلاینت تا سرور.
   */
  readonly correlationId?: string;

  /** Causation ID: شناسه رویدادِ علت (برای زنجیره‌های رویداد) */
  readonly causationId?: string;
}