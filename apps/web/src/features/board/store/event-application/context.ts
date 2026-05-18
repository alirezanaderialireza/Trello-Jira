// apps/web/src/features/board/store/event-application/context.ts

/**
 * ------------------------------------------------------------------
 * Reducer Runtime Modes
 * ------------------------------------------------------------------
 *
 * Reducerها باید Pure باقی بمانند،
 * اما Runtime می‌تواند Context اجرای متفاوتی داشته باشد.
 *
 * این Modeها مشخص می‌کنند Event
 * در چه سناریویی در حال Apply شدن است.
 * ------------------------------------------------------------------
 */

export type ReducerMode =
  /**
   * اجرای نرمال و زنده سیستم.
   * مثال:
   * - drag & drop
   * - realtime websocket events
   * - optimistic mutations
   */
  | "live"

  /**
   * بازپخش رویدادها بعد از:
   * - reconnect
   * - offline recovery
   * - local persistence restore
   */
  | "replay"

  /**
   * بازگردانی وضعیت پس از:
   * - server rejection
   * - OCC conflict
   * - failed mutation
   * - invalid optimistic update
   */
  | "rollback"

  /**
   * هیدریشن اولیه استور.
   * مثال:
   * - SSR hydration
   * - IndexedDB bootstrap
   * - persisted snapshot restore
   */
  | "hydration";

/**
 * ------------------------------------------------------------------
 * Reducer Context
 * ------------------------------------------------------------------
 *
 * Context بخشی از Domain Event نیست.
 * این آبجکت فقط اطلاعات Runtime لازم برای اجرای Reducerها را فراهم می‌کند.
 *
 * Reducerها باید:
 * - deterministic
 * - replay-safe
 * - side-effect free
 * باقی بمانند.
 *
 * بنابراین Context فقط نقش "Execution Hint" دارد.
 * ------------------------------------------------------------------
 */

export interface ReducerContext {
  /**
   * ----------------------------------------------------------------
   * Current Runtime Mode
   * ----------------------------------------------------------------
   */
  readonly mode: ReducerMode;

  /**
   * ----------------------------------------------------------------
   * Current Active User
   * ----------------------------------------------------------------
   *
   * برای جلوگیری از Echo شدن رویدادهای realtime.
   *
   * مثال:
   * - کاربر A کارت را جابجا می‌کند
   * - optimistic event فوراً اعمال می‌شود
   * - سپس همان event از websocket برمی‌گردد
   *
   * با currentUserId می‌توان تشخیص داد
   * این event قبلاً locally apply شده است.
   * ----------------------------------------------------------------
   */
  readonly currentUserId?: string;
}