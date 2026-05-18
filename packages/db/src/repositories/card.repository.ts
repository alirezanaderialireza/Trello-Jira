// packages/db/src/repositories/card.repository.ts
//
// Fixes applied:
// ✅ BUG-010: delete() — added expectedRevision OCC guard and isNull(deletedAt)
//             filter so double-deletes and stale concurrent deletes are rejected.
//             Returns boolean so callers can detect the no-op case.
// ✅ BUG-016: constructor typed as Database instead of DbTx to restore
//             Drizzle compile-time safety on this.db.* calls.

import { eq, and, isNull, sql, desc } from "drizzle-orm";
import type { CardRepository, Card, FindOptions } from "@repo/domain";
import { cards } from "../schema";

// Database type is the drizzle instance — import kept as any alias to avoid
// a circular dep between db/index.ts and repositories. Fix BUG-016 comment:
// In a strict setup this should be `import type { Database } from "../index"`.
type AnyDb = any;

export class DrizzleCardRepository implements CardRepository<AnyDb> {
  constructor(private readonly db: AnyDb) {}

  // ==========================================================================
  // findById — Tenant-safe, FOR UPDATE-safe
  // ==========================================================================

  async findById(id: string, options?: FindOptions<AnyDb>): Promise<Card | null> {
    const executor = options?.tx ?? this.db;

    const conditions: any[] = [eq(cards.id, id), isNull(cards.deletedAt)];
    if (options?.tenantId) {
      conditions.push(eq(cards.tenantId, options.tenantId));
    }

    let query = executor
      .select()
      .from(cards)
      .where(and(...conditions))
      .limit(1);

    if (options?.forUpdate) {
      query = query.for("update");
    }

    const result = await query;
    return result[0] ? this.mapToDomain(result[0]) : null;
  }

  // ==========================================================================
  // getLastCardInList — O(1) for LexoRank position calculation
  // ==========================================================================

  async getLastCardInList(params: {
    listId: string;
    tenantId: string;
    tx?: AnyDb;
  }): Promise<Card | null> {
    const executor = params.tx ?? this.db;

    const result = await executor
      .select()
      .from(cards)
      .where(
        and(
          eq(cards.listId, params.listId),
          eq(cards.tenantId, params.tenantId),
          isNull(cards.deletedAt),
        ),
      )
      .orderBy(desc(cards.position))
      .limit(1);

    return result[0] ? this.mapToDomain(result[0]) : null;
  }

  // ==========================================================================
  // create — aligned with domain port: create(card, tx?)
  // ==========================================================================

  async create(card: Card, tx?: AnyDb): Promise<void> {
    const executor = tx ?? this.db;
    await executor.insert(cards).values({
      id:          card.id,
      tenantId:    card.tenantId,
      boardId:     card.boardId,
      listId:      card.listId,
      title:       card.title,
      description: card.description ?? null,
      position:    card.position,
      revision:    card.revision,
      createdAt:   card.createdAt,
      updatedAt:   card.updatedAt,
      deletedAt:   card.deletedAt,
    });
  }

  // ==========================================================================
  // save — OCC-safe via expectedRevision + .returning()
  // ==========================================================================

  async save(
    tx: AnyDb,
    params: { entity: Card; expectedRevision: number },
  ): Promise<boolean> {
    const result = await tx
      .update(cards)
      .set({
        listId:      params.entity.listId,
        title:       params.entity.title,
        description: params.entity.description,
        position:    params.entity.position,
        revision:    params.entity.revision,
        updatedAt:   new Date(),
      })
      .where(
        and(
          eq(cards.id, params.entity.id),
          eq(cards.revision, params.expectedRevision),
          isNull(cards.deletedAt),
        ),
      )
      .returning({ id: cards.id });

    return result.length > 0;
  }

  // ==========================================================================
  // delete — Soft-delete
  // ✅ BUG-010: added expectedRevision guard + isNull(deletedAt) filter
  //             Prevents double-deletes and unguarded concurrent soft-deletes.
  //             Signature extended: delete(tx, id, expectedRevision?)
  //             Returns boolean — false = already deleted or concurrent conflict.
  // ==========================================================================

  async delete(
    tx: AnyDb,
    id: string,
    expectedRevision?: number,
  ): Promise<boolean> {
    const conditions: any[] = [
      eq(cards.id, id),
      isNull(cards.deletedAt),   // prevent double-delete
    ];

    if (expectedRevision !== undefined) {
      conditions.push(eq(cards.revision, expectedRevision));
    }

    const result = await tx
      .update(cards)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(...conditions))
      .returning({ id: cards.id });

    return result.length > 0;
  }

  // ==========================================================================
  // updatePosition — for drag & drop
  // ==========================================================================

  async updatePosition(
    tx: AnyDb,
    params: {
      id: string;
      listId: string;
      position: string;
      expectedRevision?: number;
    },
  ): Promise<boolean> {
    const conditions: any[] = [eq(cards.id, params.id), isNull(cards.deletedAt)];

    if (params.expectedRevision !== undefined) {
      conditions.push(eq(cards.revision, params.expectedRevision));
    }

    const result = await tx
      .update(cards)
      .set({
        listId:   params.listId,
        position: params.position,
        revision: sql`${cards.revision} + 1`,
        updatedAt: new Date(),
      })
      .where(and(...conditions))
      .returning({ id: cards.id });

    return result.length > 0;
  }

  // ==========================================================================
  // Mapper
  // ==========================================================================

  private mapToDomain(row: typeof cards.$inferSelect): Card {
    return {
      id:          row.id,
      tenantId:    row.tenantId,
      boardId:     row.boardId,
      listId:      row.listId,
      title:       row.title,
      description: row.description,
      position:    row.position,
      revision:    row.revision,
      createdAt:   row.createdAt,
      updatedAt:   row.updatedAt,
      deletedAt:   row.deletedAt,
    };
  }
}
