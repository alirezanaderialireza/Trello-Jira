import { Card } from "./types"; 

/**
 * 🚀 CardRepository Interface - 10/10 Edition
 * - استفاده از Generic Tx برای تراکنش‌های دیتابیس (بدون وابستگی به ORM)
 * - Tenant Fencing (حصارکشی امنیتی مشتریان)
 * - OCC Enforced (پشتیبانی از قفل خوش‌بینانه)
 */
export interface CardRepository<Tx = unknown> {
  
  // ==========================================================================
  // 📥 Read Operations
  // ==========================================================================
  
  findById(
    id: string, 
    options?: { tx?: Tx; forUpdate?: boolean; includeDeleted?: boolean; tenantId?: string }
  ): Promise<Card | null>;

  getByListId(
    options: { listId: string; tenantId: string; cursor?: string; limit?: number; tx?: Tx }
  ): Promise<Card[]>;

  // 🌟 (Fix 2) حیاتی برای پرفورمنس O(1) در زمان ساخت کارت
  getLastCardInList(
    options: { listId: string; tenantId: string; tx?: Tx }
  ): Promise<Card | null>;

  // ==========================================================================
  // 💾 Write Operations (Strict OCC)
  // ==========================================================================
  
  // 🌟 به جای save از create استفاده می‌کنیم تا جلوی باگ Upsert گرفته شود
  create(card: Card, tx?: Tx): Promise<void>;

  update(card: Card, tx?: Tx): Promise<void>;

  delete(
    cardId: string, 
    tenantId: string, // 🌟 حصار امنیتی
    options?: { expectedRevision?: number; softDelete?: boolean; tx?: Tx }
  ): Promise<void>;

  // ==========================================================================
  // 🔄 Fractional Indexing / Positioning (LexoRank)
  // ==========================================================================
  
  /**
   * آپدیت پوزیشن یک کارت (تضمین جلوگیری از تصادف با expectedRevision)
   */
  updatePosition(
    params: { cardId: string; listId: string; position: string; expectedRevision: number; tenantId: string },
    tx?: Tx
  ): Promise<void>;

  /**
   * Bulk update برای Rebalancing کارت‌ها (زمانی که فضای LexoRank تمام می‌شود)
   */
  bulkUpdatePositions(
    updates: { id: string; position: string; expectedRevision: number }[],
    tenantId: string,
    tx?: Tx
  ): Promise<void>;

  // ==========================================================================
  // 🔐 Security & Constraints
  // ==========================================================================
  
  validateCardAccess(
    tx: Tx, 
    params: { cardId: string; tenantId: string; userId: string }
  ): Promise<boolean>;

  incrementRevision(tx: Tx, cardId: string): Promise<number>;
}