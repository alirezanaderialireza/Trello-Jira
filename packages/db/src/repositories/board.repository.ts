// packages/db/src/repositories/board.repository.ts
//
// Fixes applied:
// ✅ BUG-001: findById — query.for("update") return value was discarded.
//             Drizzle's .for() is immutable — it returns a NEW query object.
//             Old code: query.for("update") → result thrown away, lock never applied.
//             Fix: reassign → query = query.for("update")
// ✅ BUG-008: save() — added expectedRevision OCC guard.
//             Without it a stale in-memory entity silently overwrites the latest
//             DB state (lost-update anomaly under concurrent edits).
//             save() now returns boolean so callers can detect conflicts.

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
  // findById — Tenant-safe, Soft Delete-aware, FOR UPDATE-safe
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

    // ✅ BUG-001: reassign so the lock is actually applied
    let query = db
      .select()
      .from(boards)
      .where(and(...conditions))
      .limit(1);

    if (options?.forUpdate) {
      query = query.for("update");   // ← was: query.for("update") (discarded)
    }

    const result = await query;
    return result[0] ? this.mapToDomain(result[0]) : null;
  }

  // ==========================================================================
  // create — aligned with domain port: create(board, tx?)
  // ==========================================================================

  async create(board: Board, tx?: DbTx): Promise<void> {
    const db = tx ?? this.db;
    await db.insert(boards).values({
      id:         board.id,
      tenantId:   board.tenantId,
      title:      board.title,
      revision:   board.revision,
      aclVersion: board.aclVersion,
      archivedAt: board.archivedAt ?? null,
      createdAt:  board.createdAt,
      updatedAt:  board.updatedAt,
      deletedAt:  board.deletedAt ?? null,
    });
  }

  // ==========================================================================
  // save — OCC-safe
  // ✅ BUG-008: added expectedRevision guard; returns boolean for conflict detection
  // ==========================================================================

  async save(tx: DbTx, board: Board, expectedRevision?: number): Promise<boolean> {
    const conditions: ReturnType<typeof eq>[] = [
      eq(boards.id, board.id),
      isNull(boards.deletedAt),
    ];

    if (expectedRevision !== undefined) {
      conditions.push(eq(boards.revision, expectedRevision));
    }

    const result = await tx
      .update(boards)
      .set({
        title:      board.title,
        revision:   board.revision,
        aclVersion: board.aclVersion,
        archivedAt: board.archivedAt ?? null,
        deletedAt:  board.deletedAt  ?? null,
        updatedAt:  new Date(),
      })
      .where(and(...conditions))
      .returning({ id: boards.id });

    return result.length > 0;
  }

  // ==========================================================================
  // incrementRevision — Atomic, returns new revision
  // ==========================================================================

  async incrementRevision(tx: DbTx, boardId: BoardId): Promise<number> {
    const result = await tx
      .update(boards)
      .set({
        revision:  sql`${boards.revision} + 1`,
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
      id:         row.id         as BoardId,
      tenantId:   row.tenantId   as TenantId,
      title:      row.title,
      revision:   row.revision   as Revision,
      aclVersion: row.aclVersion,
      createdAt:  row.createdAt,
      updatedAt:  row.updatedAt,
      deletedAt:  row.deletedAt  ?? null,
      archivedAt: row.archivedAt ?? null,
    };
  }
}
