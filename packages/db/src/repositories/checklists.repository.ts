// packages/db/src/repositories/checklists.repository.ts
//
// Drizzle implementation of the `ChecklistsRepository` port from
// @repo/domain/checklists. Mirrors the F1.2.1 labels-repository
// pattern: writes accept an explicit tx so the caller can compose
// them with `outboxRepository.append` in the same transaction
// (atomic outbox); reads accept a `FindOptions` for tenant + tx
// scoping.

import { and, asc, eq, isNull, sql } from "drizzle-orm";

import type {
  BoardId,
  CardId,
  TenantId,
  UserId,
  FindOptions,
} from "@repo/domain";
import type { Position } from "@repo/domain";
import type {
  ChecklistEntity,
  ChecklistId,
  ChecklistItemEntity,
  ChecklistItemId,
  ChecklistItemPatch,
  ChecklistPatch,
  ChecklistsRepository,
} from "@repo/domain";

import { checklists, checklistItems } from "../schema/checklists";
import { notDeleted } from "../lib/softDeleteFilter";
import type { DbTx } from "./board.repository";

// ============================================================================
// DrizzleChecklistsRepository
// ============================================================================

export class DrizzleChecklistsRepository
  implements ChecklistsRepository<DbTx>
{
  constructor(private readonly db: DbTx) {}

  // ──────────────────────────────────────────────────────────────────────────
  // Reads — checklists
  // ──────────────────────────────────────────────────────────────────────────

  async findChecklistById(
    id: ChecklistId,
    options?: FindOptions<DbTx>,
  ): Promise<ChecklistEntity | null> {
    const db = options?.tx ?? this.db;

    const conditions = [eq(checklists.id, id), notDeleted(checklists)];
    if (options?.tenantId) {
      conditions.push(eq(checklists.tenantId, options.tenantId));
    }

    const rows = await db
      .select()
      .from(checklists)
      .where(and(...conditions))
      .limit(1);

    return rows[0] ? this.mapChecklistToDomain(rows[0]) : null;
  }

  async findChecklistsByCardId(
    cardId: CardId,
    options?: FindOptions<DbTx>,
  ): Promise<ChecklistEntity[]> {
    const db = options?.tx ?? this.db;

    const conditions = [eq(checklists.cardId, cardId), notDeleted(checklists)];
    if (options?.tenantId) {
      conditions.push(eq(checklists.tenantId, options.tenantId));
    }

    const rows = await db
      .select()
      .from(checklists)
      .where(and(...conditions))
      .orderBy(asc(checklists.position));

    return rows.map((row: typeof checklists.$inferSelect) =>
      this.mapChecklistToDomain(row),
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Reads — items
  // ──────────────────────────────────────────────────────────────────────────

  async findItemById(
    id: ChecklistItemId,
    options?: FindOptions<DbTx>,
  ): Promise<ChecklistItemEntity | null> {
    const db = options?.tx ?? this.db;

    const conditions = [eq(checklistItems.id, id)];
    if (options?.tenantId) {
      conditions.push(eq(checklistItems.tenantId, options.tenantId));
    }

    const rows = await db
      .select()
      .from(checklistItems)
      .where(and(...conditions))
      .limit(1);

    return rows[0] ? this.mapItemToDomain(rows[0]) : null;
  }

  async findItemsByChecklistId(
    checklistId: ChecklistId,
    options?: FindOptions<DbTx>,
  ): Promise<ChecklistItemEntity[]> {
    const db = options?.tx ?? this.db;

    const conditions = [eq(checklistItems.checklistId, checklistId)];
    if (options?.tenantId) {
      conditions.push(eq(checklistItems.tenantId, options.tenantId));
    }

    const rows = await db
      .select()
      .from(checklistItems)
      .where(and(...conditions))
      .orderBy(asc(checklistItems.position));

    return rows.map((row: typeof checklistItems.$inferSelect) =>
      this.mapItemToDomain(row),
    );
  }

  /**
   * Counts the items belonging to a checklist. Used by the delete-
   * confirm flow so the UI can display "این چک‌لیست X مورد دارد"
   * before the mutation runs.
   */
  async countItemsByChecklistId(
    checklistId: ChecklistId,
    options?: FindOptions<DbTx>,
  ): Promise<number> {
    const db = options?.tx ?? this.db;

    const conditions = [eq(checklistItems.checklistId, checklistId)];
    if (options?.tenantId) {
      conditions.push(eq(checklistItems.tenantId, options.tenantId));
    }

    const rows = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(checklistItems)
      .where(and(...conditions));

    return rows[0]?.count ?? 0;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Writes — checklists
  // ──────────────────────────────────────────────────────────────────────────

  async createChecklist(tx: DbTx, entity: ChecklistEntity): Promise<void> {
    await tx.insert(checklists).values({
      id:        entity.id,
      tenantId:  entity.tenantId,
      cardId:    entity.cardId,
      boardId:   entity.boardId,
      title:     entity.title,
      position:  entity.position,
      createdAt: entity.createdAt,
      createdBy: entity.createdBy,
      updatedAt: entity.updatedAt,
    });
  }

  async updateChecklist(
    tx: DbTx,
    id: ChecklistId,
    patch: ChecklistPatch,
  ): Promise<void> {
    if (Object.keys(patch).length === 0) return;

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.title    !== undefined) updates.title    = patch.title;
    if (patch.position !== undefined) updates.position = patch.position;

    await tx
      .update(checklists)
      .set(updates)
      .where(and(eq(checklists.id, id), notDeleted(checklists)));
  }

  async softDeleteChecklist(tx: DbTx, id: ChecklistId): Promise<void> {
    const now = new Date();
    await tx
      .update(checklists)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(checklists.id, id), notDeleted(checklists)));
  }

  /**
   * Hard-deletes every item belonging to the checklist. Used in
   * conjunction with softDeleteChecklist so the soft-deleted checklist
   * vanishes from every read path immediately, even though the
   * checklist row itself survives until the janitor purges it
   * (Phase 1.5).
   *
   * Hard-delete on items (not soft) is intentional: items carry no
   * business state worth retaining, and soft-deleting them would force
   * every read path to also filter `deleted_at IS NULL` on items,
   * doubling the predicate cost without benefit (same rationale as
   * labels' card_labels in F1.2.1).
   */
  async hardDeleteItemsByChecklistId(
    tx: DbTx,
    checklistId: ChecklistId,
  ): Promise<void> {
    await tx
      .delete(checklistItems)
      .where(eq(checklistItems.checklistId, checklistId));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Writes — items
  // ──────────────────────────────────────────────────────────────────────────

  async createItem(tx: DbTx, entity: ChecklistItemEntity): Promise<void> {
    await tx.insert(checklistItems).values({
      id:          entity.id,
      tenantId:    entity.tenantId,
      checklistId: entity.checklistId,
      text:        entity.text,
      isDone:      entity.isDone,
      position:    entity.position,
      createdAt:   entity.createdAt,
      createdBy:   entity.createdBy,
      updatedAt:   entity.updatedAt,
    });
  }

  async updateItem(
    tx: DbTx,
    id: ChecklistItemId,
    patch: ChecklistItemPatch,
  ): Promise<void> {
    if (Object.keys(patch).length === 0) return;

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.text     !== undefined) updates.text     = patch.text;
    if (patch.isDone   !== undefined) updates.isDone   = patch.isDone;
    if (patch.position !== undefined) updates.position = patch.position;

    await tx
      .update(checklistItems)
      .set(updates)
      .where(eq(checklistItems.id, id));
  }

  async removeItem(tx: DbTx, id: ChecklistItemId): Promise<void> {
    await tx.delete(checklistItems).where(eq(checklistItems.id, id));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Mapping
  // ──────────────────────────────────────────────────────────────────────────

  private mapChecklistToDomain(
    row: typeof checklists.$inferSelect,
  ): ChecklistEntity {
    return {
      id:        row.id        as ChecklistId,
      tenantId:  row.tenantId  as TenantId,
      cardId:    row.cardId    as CardId,
      boardId:   row.boardId   as BoardId,
      title:     row.title,
      position:  row.position  as Position,
      createdAt: row.createdAt,
      createdBy: row.createdBy as UserId,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt ?? null,
    };
  }

  private mapItemToDomain(
    row: typeof checklistItems.$inferSelect,
  ): ChecklistItemEntity {
    return {
      id:          row.id          as ChecklistItemId,
      tenantId:    row.tenantId    as TenantId,
      checklistId: row.checklistId as ChecklistId,
      text:        row.text,
      isDone:      row.isDone,
      position:    row.position    as Position,
      createdAt:   row.createdAt,
      createdBy:   row.createdBy   as UserId,
      updatedAt:   row.updatedAt,
    };
  }
}
