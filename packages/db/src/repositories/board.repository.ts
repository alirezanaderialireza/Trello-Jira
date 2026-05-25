// packages/db/src/repositories/board.repository.ts

import { eq, and, inArray, sql } from "drizzle-orm";
import type {
  BoardRepository,
  Board,
  BoardId,
  TenantId,
  Revision,
  FindOptions,
} from "@repo/domain";
import { boards, workspaces } from "../schema";
import type { BoardVisibility } from "../schema/boards";
import { notArchived, notDeleted } from "../lib/softDeleteFilter";

// ============================================================================
// Transaction Type
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DbTx = any;

// ============================================================================
// D8 — cascade-filter helper
//
// A board whose parent workspace was soft-deleted must vanish from every
// read path even though `boards.deleted_at` is still NULL. Doing this at
// the DB layer (instead of relying on every router to remember) means the
// rule cannot be forgotten by a future feature.
//
// We express it as a `tenant_id IN (SELECT id FROM workspaces WHERE
// deleted_at IS NULL)` predicate so the SELECT shape is unchanged — no JOIN
// reshape, no `mapToDomain` rewrite. PostgreSQL plans this as a hash
// semi-join over the (tiny) workspaces table; cost is negligible.
// ============================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function activeWorkspaceTenantsSubquery(db: any) {
  return db
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(notDeleted(workspaces));
}

// ============================================================================
// DrizzleBoardRepository
// ============================================================================

export class DrizzleBoardRepository implements BoardRepository<DbTx> {
  constructor(private readonly db: DbTx) {}

  // ==========================================================================
  // findById — Tenant-safe, soft-delete-aware, archived-aware (opt-in),
  //            cascade-aware (D8).
  // ==========================================================================

  async findById(
    id: BoardId,
    options?: FindOptions<DbTx>,
  ): Promise<Board | null> {
    const db = options?.tx ?? this.db;
    const conditions = [
      eq(boards.id, id),
      notDeleted(boards),
      // D8 — if the parent workspace was soft-deleted, hide the board.
      inArray(boards.tenantId, activeWorkspaceTenantsSubquery(db)),
    ];

    if (options?.tenantId) {
      conditions.push(eq(boards.tenantId, options.tenantId));
    }

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
  // create — interface-aligned (board, tx?)
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
  // save — OCC-safe (legacy DbTx-first signature)
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
      .where(and(eq(boards.id, board.id), notDeleted(boards)));
  }

  // ==========================================================================
  // incrementRevision — atomic, returns new revision
  // ==========================================================================

  async incrementRevision(tx: DbTx, boardId: BoardId): Promise<number> {
    const result = await tx
      .update(boards)
      .set({
        revision: sql`${boards.revision} + 1`,
        updatedAt: new Date(),
      })
      .where(and(eq(boards.id, boardId), notDeleted(boards)))
      .returning({ revision: boards.revision });

    if (!result.length) {
      throw new Error(`Board not found for incrementRevision: ${boardId}`);
    }

    return result[0].revision as number;
  }

  // ==========================================================================
  // Phase 1.1 (F1) lifecycle helpers
  //
  // archive  → hide from sidebar/listing, keep readable on direct URL.
  // unarchive→ inverse.
  // softDelete → enter the 30-day grace window; sidebar invalidates.
  // restore  → exit the grace window.
  // setBackground / updateVisibility → settings drawer write paths.
  //
  // All four lifecycle setters intentionally do NOT join workspaces — a
  // soft-deleted workspace's boards are never updated again. The cascade
  // filter is for read paths only.
  // ==========================================================================

  async archive(id: BoardId, tx?: DbTx): Promise<void> {
    const db = tx ?? this.db;
    await db
      .update(boards)
      .set({ archivedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(boards.id, id), notDeleted(boards)));
  }

  async unarchive(id: BoardId, tx?: DbTx): Promise<void> {
    const db = tx ?? this.db;
    await db
      .update(boards)
      .set({ archivedAt: null, updatedAt: new Date() })
      .where(and(eq(boards.id, id), notDeleted(boards)));
  }

  async softDelete(id: BoardId, tx?: DbTx): Promise<void> {
    const db = tx ?? this.db;
    await db
      .update(boards)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(boards.id, id));
  }

  async restore(id: BoardId, tx?: DbTx): Promise<void> {
    const db = tx ?? this.db;
    await db
      .update(boards)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(eq(boards.id, id));
  }

  async setBackground(
    id: BoardId,
    data: Record<string, unknown> | null,
    tx?: DbTx,
  ): Promise<void> {
    const db = tx ?? this.db;
    await db
      .update(boards)
      .set({ backgroundData: data, updatedAt: new Date() })
      .where(and(eq(boards.id, id), notDeleted(boards)));
  }

  async updateVisibility(
    id: BoardId,
    visibility: BoardVisibility,
    tx?: DbTx,
  ): Promise<void> {
    const db = tx ?? this.db;
    await db
      .update(boards)
      .set({ visibility, updatedAt: new Date() })
      .where(and(eq(boards.id, id), notDeleted(boards)));
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

// Re-export so callers that compose `notArchived(boards)` outside the
// repository (e.g. router list handlers in F3) can use the same helper
// without importing from two places.
export { notArchived };
