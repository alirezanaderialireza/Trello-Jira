// packages/db/src/repositories/list.repository.ts
//
// Fixes applied:
// ✅ BUG-002: create(tx, list) → create(list, tx?) — signature was reversed vs.
//             domain port contract (same order as card + board repositories).
// ✅ BUG-003: save() — replaced (result as any).rowCount with .returning() +
//             result.length > 0. postgres-js doesn't reliably expose rowCount;
//             .returning() is the correct Drizzle idiom.
// ✅ BUG-004: save() — added deletedAt to the set() block so soft-delete via
//             save() actually persists. Also relaxed the WHERE clause so it
//             matches already-deleted rows when the caller is doing a soft-delete.
// ✅ BUG-006: findById — tenant isolation added via options?.tenantId filter.
// ✅ BUG-007: getBoardAclForUpdate — canMoveCards now queries boardMembers table
//             and grants access only to active ADMIN / MEMBER roles.

import { eq, and, isNull, desc, sql, inArray } from "drizzle-orm";
import type { DbTx } from "./board.repository";
import type { ListRepository, List, FindOptions } from "@repo/domain";
import { lists, boards, boardMembers } from "../schema";

export class DrizzleListRepository implements ListRepository<DbTx> {
  constructor(private readonly db: DbTx) {}

  // ==========================================================================
  // findById — Tenant-safe, FOR UPDATE-safe
  // ✅ BUG-006: tenantId filter applied
  // ==========================================================================

  async findById(
    id: string,
    options?: FindOptions<DbTx>,
  ): Promise<List | null> {
    const runner = options?.tx ?? this.db;

    const conditions: any[] = [eq(lists.id, id), isNull(lists.deletedAt)];

    // ✅ BUG-006: enforce tenant boundary
    if (options?.tenantId) {
      conditions.push(eq(lists.tenantId, options.tenantId));
    }

    let query = runner
      .select()
      .from(lists)
      .where(and(...conditions))
      .limit(1);

    if (options?.forUpdate) {
      query = query.for("update");
    }

    const result = await query;
    return result[0] ? this.mapToDomain(result[0] as any) : null;
  }

  async findByIdForUpdate(tx: DbTx, id: string): Promise<List | null> {
    return this.findById(id, { tx, forUpdate: true });
  }

  async getByBoardId(boardId: string): Promise<List[]> {
    const result = await this.db
      .select()
      .from(lists)
      .where(and(eq(lists.boardId, boardId), isNull(lists.deletedAt)))
      .orderBy(lists.position);
    return result.map((r: any) => this.mapToDomain(r));
  }

  async getLastListInBoard(tx: DbTx, boardId: string): Promise<List | null> {
    const result = await tx
      .select()
      .from(lists)
      .where(and(eq(lists.boardId, boardId), isNull(lists.deletedAt)))
      .orderBy(desc(lists.position))
      .limit(1);
    return result[0] ? this.mapToDomain(result[0] as any) : null;
  }

  // ==========================================================================
  // create — ✅ BUG-002: signature aligned with domain port: create(list, tx?)
  // ==========================================================================

  async create(list: List, tx?: DbTx): Promise<void> {
    const runner = tx ?? this.db;
    await runner.insert(lists).values({
      id:        list.id,
      tenantId:  list.tenantId,
      boardId:   list.boardId,
      title:     list.title,
      position:  list.position,
      revision:  list.revision,
      createdAt: list.createdAt,
      updatedAt: list.updatedAt,
      deletedAt: list.deletedAt,
    });
  }

  // ==========================================================================
  // save — OCC-safe
  // ✅ BUG-003: use .returning() instead of .rowCount (postgres-js incompatible)
  // ✅ BUG-004: include deletedAt in set() so soft-delete persists;
  //             WHERE clause allows deletedAt IS NULL OR the entity itself
  //             carries a new deletedAt (soft-delete path needs no filter).
  // ==========================================================================

  async save(
    tx: DbTx,
    params: { entity: List; expectedRevision?: number },
  ): Promise<boolean> {
    const { entity, expectedRevision } = params;

    // When performing a soft-delete, entity.deletedAt is set and we must NOT
    // filter `isNull(lists.deletedAt)` — the row is still active at this point.
    // For normal updates (deletedAt = null) we keep the soft-delete guard.
    const isSoftDelete = entity.deletedAt !== null && entity.deletedAt !== undefined;

    const conditions: any[] = [eq(lists.id, entity.id)];

    if (!isSoftDelete) {
      conditions.push(isNull(lists.deletedAt));
    }

    if (expectedRevision !== undefined) {
      conditions.push(eq(lists.revision, expectedRevision));
    }

    // ✅ BUG-004: deletedAt is now in the set block
    const result = await tx
      .update(lists)
      .set({
        title:     entity.title,
        position:  entity.position,
        revision:  entity.revision,
        deletedAt: entity.deletedAt ?? null,   // ← was missing
        updatedAt: new Date(),
      })
      .where(and(...conditions))
      // ✅ BUG-003: .returning() → result.length > 0
      .returning({ id: lists.id });

    return result.length > 0;
  }

  // ==========================================================================
  // incrementRevision — Atomic
  // ==========================================================================

  async incrementRevision(tx: DbTx, listId: string): Promise<number> {
    const result = await tx
      .update(lists)
      .set({ revision: sql`${lists.revision} + 1`, updatedAt: new Date() })
      .where(and(eq(lists.id, listId), isNull(lists.deletedAt)))
      .returning({ revision: lists.revision });

    if (result.length === 0) {
      throw new Error(`Failed to increment revision: List ${listId} not found`);
    }

    return result[0].revision;
  }

  // ==========================================================================
  // getBoardAclForUpdate
  // ✅ BUG-007: canMoveCards now queries boardMembers instead of always true
  // ==========================================================================

  async getBoardAclForUpdate(
    tx: DbTx,
    boardId: string,
  ): Promise<{ version: number; canMoveCards: (userId: string) => boolean }> {
    // Lock the board row for consistent ACL version reads
    const boardResult = await tx
      .select({ aclVersion: boards.aclVersion })
      .from(boards)
      .where(eq(boards.id, boardId))
      .limit(1)
      .for("update");

    const version = boardResult[0]?.aclVersion ?? 1;

    // Fetch all active members for this board in one query
    const members = await tx
      .select({ userId: boardMembers.userId, role: boardMembers.role })
      .from(boardMembers)
      .where(
        and(
          eq(boardMembers.boardId, boardId),
          isNull(boardMembers.removedAt),
        ),
      );

    // Build a userId→role lookup for O(1) permission checks
    const memberMap = new Map<string, string>(
      members.map((m: { userId: string; role: string }) => [m.userId, m.role]),
    );

    return {
      version,
      // ✅ BUG-007: grant access only to active ADMIN / MEMBER / OWNER roles
      canMoveCards: (userId: string): boolean => {
        const role = memberMap.get(userId);
        return role === "ADMIN" || role === "MEMBER" || role === "OWNER";
      },
    };
  }

  // ==========================================================================
  // Mapper
  // ==========================================================================

  private mapToDomain(row: any): List {
    return {
      id:         row.id,
      boardId:    row.boardId,
      tenantId:   row.tenantId,
      title:      row.title,
      position:   row.position,
      revision:   row.revision,
      createdAt:  row.createdAt,
      updatedAt:  row.updatedAt,
      deletedAt:  row.deletedAt  ?? null,
      archivedAt: row.archivedAt ?? null,
    };
  }
}
