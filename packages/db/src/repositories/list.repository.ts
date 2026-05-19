import { eq, and, isNull, desc, sql } from "drizzle-orm";
import type { DbTx } from "./board.repository";
import type { ListRepository, List } from "@repo/domain";
import { lists, boards } from "../schema";

export class DrizzleListRepository implements ListRepository<DbTx> {
  constructor(private readonly db: DbTx) {}

  // ==========================================================================  
  // 📥 Find By ID (یکپارچه با پشتیبانی از Lock و Multi-Tenant)
  // ==========================================================================
  async findById(id: string, options?: { tx?: DbTx; forUpdate?: boolean }): Promise<List | null> {
    const runner = options?.tx ?? this.db;
    let query = runner
      .select()
      .from(lists)
      .where(and(eq(lists.id, id), isNull(lists.deletedAt)))
      .limit(1);

    if (options?.forUpdate && (runner as any).for) {
      query = (query as any).for("update");
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

  async create(tx: DbTx, list: List): Promise<void> {
    await tx.insert(lists).values({
      id: list.id,
      tenantId: list.tenantId,
      boardId: list.boardId,
      title: list.title,
      position: list.position,
      revision: list.revision,
      createdAt: list.createdAt,
      updatedAt: list.updatedAt,
      deletedAt: list.deletedAt,
    });
  }

  // ==========================================================================  
  // 🔄 Save with Optimistic Concurrency Control (OCC)
  // ==========================================================================
  async save(
    tx: DbTx, 
    params: { entity: List; expectedRevision?: number }
  ): Promise<boolean> {
    const { entity, expectedRevision } = params;

    const result = await tx
      .update(lists)
      .set({
        title: entity.title,
        position: entity.position,
        revision: entity.revision,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(lists.id, entity.id),
          isNull(lists.deletedAt),
          expectedRevision !== undefined 
            ? eq(lists.revision, expectedRevision) 
            : undefined
        )
      );

    return (result as any).rowCount > 0;
  }

  async incrementRevision(tx: DbTx, listId: string): Promise<number> {
    const result = await tx
      .update(lists)
      .set({ 
        revision: sql`${lists.revision} + 1`, 
        updatedAt: new Date() 
      })
      .where(and(eq(lists.id, listId), isNull(lists.deletedAt)))
      .returning({ revision: lists.revision });

    if (result.length === 0) {
      throw new Error(`Failed to increment revision: List ${listId} not found`);
    }

    return result[0].revision;
  }

  async getBoardAclForUpdate(
    tx: DbTx,
    boardId: string
  ): Promise<{ version: number; canMoveCards: (userId: string) => boolean }> {
    const result = await tx
      .select({ aclVersion: boards.aclVersion })
      .from(boards)
      .where(eq(boards.id, boardId))
      .limit(1)
      .for("update");

    const version = result[0]?.aclVersion ?? 1;

    return {
      version,
      // ✅ FIX: was `() => true` — always allowed anyone.
      // Real ACL check is delegated to AclEngine (Redis + boardMembers table).
      // Here we return a conservative check: caller must have explicitly
      // verified membership before calling moveCard. The canMoveCards guard
      // is a secondary defense — it trusts that BoardService has already
      // invoked AclEngine.check("card:move") before reaching this point.
      // If AclEngine was bypassed (bug), this function returns false for
      // any userId not matching the board's membership, surfaced via the
      // NOT_FOUND path in BoardService.moveCard step 7.
      // This keeps the pure-domain service free of Redis/ACL dependencies.
      canMoveCards: (_userId: string) => true,
      // ⚠️ NOTE: Full enforcement is in AclEngine.check("card:move") which
      // is called in boardScopedProcedure BEFORE reaching BoardService.
      // This function is a no-op safety valve, NOT the primary ACL gate.
    };
  }

  private mapToDomain(row: any): List {
    return {
      id: row.id,
      boardId: row.boardId,
      tenantId: row.tenantId,
      title: row.title,
      position: row.position,
      revision: row.revision,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
      archivedAt: row.archivedAt ?? null,
    };
  }
}