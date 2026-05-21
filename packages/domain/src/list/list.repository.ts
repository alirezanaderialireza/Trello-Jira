import { List } from "./types";

/**
 * 🚀 ListRepository Interface - 10/10 Enterprise Edition
 * * اصول رعایت‌شده:
 * - Generic Transaction Support (Tx)
 * - Strict Tenant Fencing (ایزولاسیون مشتری)
 * - O(1) Performance Fetchers
 * - OCC Enforced (قفل خوش‌بینانه برای LexoRank)
 */
export interface ListRepository<Tx = unknown> {
  
  // ==========================================================================
  // 📥 Read Operations (Queries)
  // ==========================================================================

  /**
   * 🌟 دریافت لیست با پشتیبانی از Row-Level Lock (forUpdate)
   */
  findById(
    id: string, 
    options?: { tx?: Tx; forUpdate?: boolean; tenantId?: string }
  ): Promise<List | null>;

  /**
   * 🌟 دریافت تمام لیست‌های یک بورد با حصار امنیتی
   */
  getByBoardId(
    options: { boardId: string; tenantId: string; tx?: Tx }
  ): Promise<List[]>;

  /**
   * 🌟 پرفورمنس O(1): فقط آخرین لیست را برای تولید LexoRank می‌آورد
   */
  getLastListInBoard(
    options: { boardId: string; tenantId: string; tx?: Tx }
  ): Promise<List | null>;

  // ==========================================================================
  // 💾 Write Operations (Commands)
  // ==========================================================================

  /**
   * 🌟 استفاده از create به جای save برای جلوگیری از باگ‌های Upsert در ORM
   */
  create(list: List, tx?: Tx): Promise<void>;

  update(list: List, tx?: Tx): Promise<void>;

  /**
   * 🪦 حذف ایمن (با پشتیبانی از Soft Delete و OCC)
   */
  delete(
    id: string, 
    tenantId: string, 
    options?: { expectedRevision?: number; softDelete?: boolean; tx?: Tx }
  ): Promise<void>;

  // ==========================================================================
  // 🔄 Fractional Indexing / Positioning (LexoRank)
  // ==========================================================================

  /**
   * 🌟 جابجایی یکپارچه‌ی لیست با تضمین جلوگیری از تصادف (Collision)
   */
  updatePosition(
    params: { listId: string; boardId: string; position: string; expectedRevision: number; tenantId: string },
    tx?: Tx
  ): Promise<void>;

  /**
   * 🌟 سیستم خودترمیم (Rebalancing) برای زمان‌هایی که فضای رشته‌ی LexoRank پُر می‌شود
   */
  bulkUpdatePositions(
    updates: { id: string; position: string; expectedRevision: number }[],
    tenantId: string,
    tx?: Tx
  ): Promise<void>;

  // ==========================================================================
  // 🔐 Security & Constraints
  // ==========================================================================

  /**
   * 🔄 افزایش اتمیک ورژن لیست 
   * (وقتی کارتی درون این لیست جابجا می‌شود، ورژن لیست باید بالا برود تا کلاینت‌ها آپدیت شوند)
   */
  incrementRevision(tx: Tx, listId: string): Promise<number>;
}