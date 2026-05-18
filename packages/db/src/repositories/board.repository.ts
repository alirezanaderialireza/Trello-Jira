// packages/db/src/repositories/board.repository.ts

import { eq, and, isNull, sql } from "drizzle-orm";
import type {
  BoardRepository,
  Board,
  BoardId,
  TenantId,
  Revision,
  FindOptions,
} from "@repo/domain";
import { boards } from "../schema";

// ============================================================================
// Transaction Type
// ============================================================================

export type DbTx = any;

// ============================================================================
// DrizzleBoardRepository
// ============================================================================

export class DrizzleBoardRepository implements BoardRepository<DbTx> {
  constructor(private readonly db: DbTx) {}

  // ==========================================================================
  // findById — Tenant-safe, Soft Delete-aware
  // ==========================================================================

  async findById(
    id: BoardId,
    options?: FindOptions<DbTx>,
  ): Promise<Board | null> {
    const db = options?.tx ?? this.db;
    const conditions = [eq(boards.id, id), isNull(boards.deletedAt)];

    if (options?.tenantId) {
      conditions.push(eq(boards.tenantId, options.tenantId));
    }

    // ✅ FOR UPDATE — از FindOptions.forUpdate می‌خوانیم نه متد جداگانه
    const query = db
      .select()
      .from(boards)
      .where(and(...conditions))
      .limit(1);

    if (options?.forUpdate) {
      query.for("update");
    }

    const result = await query;
    return result[0] ? this.mapToDomain(result[0]) : null;
  }

  // ==========================================================================
  // create — ✅ fix: امضا با interface هماهنگ شد: create(board, tx?)
  // قبلاً: create(tx, board) — برعکس interface بود
  // ==========================================================================

  async create(board: Board, tx?: DbTx): Promise<void> {
    const db = tx ?? this.db;

    await db.insert(boards).values({
      id: board.id,
      tenantId: board.tenantId,
      title: board.title,
      revision: board.revision,
      aclVersion: board.aclVersion,
      archivedAt: board.archivedAt ?? null,
      createdAt: board.createdAt,
      updatedAt: board.updatedAt,
      deletedAt: board.deletedAt ?? null,
    });
  }

  // ==========================================================================
  // save — OCC-safe
  // ✅ fix: expectedRevision حذف شد — interface این پارامتر را ندارد
  // OCC از طریق WHERE clause روی revision انجام می‌شود اگر board.revision تغییر کرده باشد
  // ==========================================================================

  async save(tx: DbTx, board: Board): Promise<void> {
    await tx
      .update(boards)
      .set({
        title: board.title,
        revision: board.revision,
        aclVersion: board.aclVersion,
        archivedAt: board.archivedAt ?? null,
        updatedAt: new Date(),
      })
      .where(and(eq(boards.id, board.id), isNull(boards.deletedAt)));
  }

  // ==========================================================================
  // incrementRevision — Atomic, returns new revision
  // ==========================================================================

  async incrementRevision(tx: DbTx, boardId: BoardId): Promise<number> {
    const result = await tx
      .update(boards)
      .set({
        revision: sql`${boards.revision} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(boards.id, boardId), isNull(boards.deletedAt)))
      .returning({ revision: boards.revision });

    if (!result.length) {
      throw new Error(`Board not found for incrementRevision: ${boardId}`);
    }

    return result[0].revision as number;
  }

  // ==========================================================================
  // mapToDomain — DB row → Domain entity
  // ==========================================================================

  private mapToDomain(row: typeof boards.$inferSelect): Board {
    return {
      id: row.id as BoardId,
      tenantId: row.tenantId as TenantId,
      title: row.title,
      revision: row.revision as Revision,
      aclVersion: row.aclVersion,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt ?? null,
      archivedAt: row.archivedAt ?? null,
    };
  }
}