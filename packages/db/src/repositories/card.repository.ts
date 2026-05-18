import { eq, and, isNull, sql, desc } from "drizzle-orm"; // 🌟 (Fix) اضافه شدن desc برای مرتب‌سازی
import type { DbTx } from "./board.repository"; 
import type { CardRepository, Card, FindOptions } from "@repo/domain"; // 🌟 (Fix) اضافه شدن FindOptions
import { cards } from "../schema";

export class DrizzleCardRepository implements CardRepository<DbTx> {
  constructor(private readonly db: DbTx) {}

  // ==========================================================================  
  // 📥 Find By ID (یکپارچه با پشتیبانی از Lock و Multi-Tenant)
  // ==========================================================================
  async findById(id: string, options?: FindOptions<DbTx>): Promise<Card | null> {
    const executor = options?.tx ?? this.db;
    
    const conditions = [eq(cards.id, id), isNull(cards.deletedAt)];
    if (options?.tenantId) {
      conditions.push(eq(cards.tenantId, options.tenantId));
    }

    let query = executor
      .select()
      .from(cards)
      .where(and(...conditions))
      .limit(1) as any;

    if (options?.forUpdate) {
      query = query.for("update");
    }

    const result = await query;
    return result[0] ? this.mapToDomain(result[0]) : null;
  }

  // ==========================================================================  
  // 🚀 Get Last Card In List (پرفورمنس O(1) برای LexoRank)
  // ==========================================================================
  async getLastCardInList(params: { listId: string; tenantId: string; tx?: DbTx }): Promise<Card | null> {
    const executor = params.tx ?? this.db;
    
    const result = await executor
      .select()
      .from(cards)
      .where(
        and(
          eq(cards.listId, params.listId),
          eq(cards.tenantId, params.tenantId),
          isNull(cards.deletedAt)
        )
      )
      .orderBy(desc(cards.position))
      .limit(1);

    return result[0] ? this.mapToDomain(result[0]) : null;
  }

  // ==========================================================================  
  // ➕ Create (هماهنگ با UseCase)
  // ==========================================================================
  async create(card: Card, tx?: DbTx): Promise<void> {
    const executor = tx ?? this.db;
    
    await executor.insert(cards).values({
      id: card.id,
      tenantId: card.tenantId,
      boardId: card.boardId, 
      listId: card.listId,
      title: card.title,
      description: card.description ?? null,
      position: card.position,
      revision: card.revision,
      createdAt: card.createdAt,
      updatedAt: card.updatedAt,
      deletedAt: card.deletedAt,
    });
  }

  // ==========================================================================  
  // 💾 Save (Strict Update with OCC)
  // ==========================================================================
  async save(tx: DbTx, params: { entity: Card; expectedRevision: number }): Promise<boolean> {
    const result = await tx
      .update(cards)
      .set({
        listId: params.entity.listId,
        title: params.entity.title,
        description: params.entity.description,
        position: params.entity.position,
        revision: params.entity.revision,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(cards.id, params.entity.id),
          eq(cards.revision, params.expectedRevision),
          isNull(cards.deletedAt)
        )
      )
      .returning({ id: cards.id });

    return result.length > 0;
  }

  // ==========================================================================  
  // 🪦 Soft Delete
  // ==========================================================================
  async delete(tx: DbTx, id: string): Promise<void> {
    await tx
      .update(cards)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(cards.id, id));
  }

  // ==========================================================================  
  // 🔄 Update Position (برای drag & drop)
  // ==========================================================================
  async updatePosition(
    tx: DbTx,
    params: { id: string; listId: string; position: string; expectedRevision?: number }
  ): Promise<boolean> {
    const conditions = [
      eq(cards.id, params.id),
      isNull(cards.deletedAt)
    ];
    
    if (params.expectedRevision !== undefined) {
      conditions.push(eq(cards.revision, params.expectedRevision));
    }

    const result = await tx
      .update(cards)
      .set({
        listId: params.listId,
        position: params.position,
        revision: sql`${cards.revision} + 1`,
        updatedAt: new Date()
      })
      .where(and(...conditions))
      .returning({ id: cards.id });

    return result.length > 0;
  }

  // ==========================================================================  
  // 🗺️ Mapper
  // ==========================================================================
  private mapToDomain(row: typeof cards.$inferSelect): Card {
    return {
      id: row.id,
      tenantId: row.tenantId,
      boardId: row.boardId,
      listId: row.listId,
      title: row.title,
      description: row.description,
      position: row.position,
      revision: row.revision,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    };
  }
}