// packages/db/src/repositories/labels.repository.ts
//
// Drizzle implementation of the `LabelRepository` port from
// @repo/domain/labels. All writes accept an explicit `tx` so the
// caller can compose them with `outboxRepository.append` in the same
// transaction (atomic outbox pattern). Reads accept a `FindOptions`
// to opt into a tx + tenant filter, matching the convention from
// board.repository.ts.

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
  CardLabelLink,
  ColorToken,
  LabelEntity,
  LabelId,
  LabelPatch,
  LabelRepository,
} from "@repo/domain";

import { labels, cardLabels } from "../schema/labels";
import { notDeleted } from "../lib/softDeleteFilter";
import type { DbTx } from "./board.repository";

// ============================================================================
// DrizzleLabelsRepository
// ============================================================================

export class DrizzleLabelsRepository implements LabelRepository<DbTx> {
  constructor(private readonly db: DbTx) {}

  // ──────────────────────────────────────────────────────────────────────────
  // Reads
  // ──────────────────────────────────────────────────────────────────────────

  async findById(
    id: LabelId,
    options?: FindOptions<DbTx>,
  ): Promise<LabelEntity | null> {
    const db = options?.tx ?? this.db;

    const conditions = [eq(labels.id, id), notDeleted(labels)];
    if (options?.tenantId) {
      conditions.push(eq(labels.tenantId, options.tenantId));
    }

    const rows = await db
      .select()
      .from(labels)
      .where(and(...conditions))
      .limit(1);

    return rows[0] ? this.mapToDomain(rows[0]) : null;
  }

  async findByBoardId(
    boardId: BoardId,
    options?: FindOptions<DbTx>,
  ): Promise<LabelEntity[]> {
    const db = options?.tx ?? this.db;

    const conditions = [eq(labels.boardId, boardId), notDeleted(labels)];
    if (options?.tenantId) {
      conditions.push(eq(labels.tenantId, options.tenantId));
    }

    const rows = await db
      .select()
      .from(labels)
      .where(and(...conditions))
      .orderBy(asc(labels.position));

    return rows.map((row: typeof labels.$inferSelect) => this.mapToDomain(row));
  }

  /**
   * Fetches every label currently linked to a card via the junction.
   * Joins through `card_labels` to `labels`; the `notDeleted` filter
   * keeps soft-deleted labels out of the result so the UI never
   * renders a label that's been removed at the board level.
   *
   * Order: by `labels.position` so the card-detail and card-preview
   * surfaces show labels in the same order as the board's label
   * manager (D11 hybrid display).
   */
  async findCardLabelsByCardId(
    cardId: CardId,
    options?: FindOptions<DbTx>,
  ): Promise<LabelEntity[]> {
    const db = options?.tx ?? this.db;

    const conditions = [eq(cardLabels.cardId, cardId), notDeleted(labels)];
    if (options?.tenantId) {
      conditions.push(eq(cardLabels.tenantId, options.tenantId));
    }

    const rows = await db
      .select({
        id:         labels.id,
        tenantId:   labels.tenantId,
        boardId:    labels.boardId,
        name:       labels.name,
        colorToken: labels.colorToken,
        position:   labels.position,
        createdAt:  labels.createdAt,
        createdBy:  labels.createdBy,
        updatedAt:  labels.updatedAt,
        deletedAt:  labels.deletedAt,
      })
      .from(cardLabels)
      .innerJoin(labels, eq(cardLabels.labelId, labels.id))
      .where(and(...conditions))
      .orderBy(asc(labels.position));

    return rows.map((row: typeof labels.$inferSelect) => this.mapToDomain(row));
  }

  async findCardLabelLink(
    params: { cardId: CardId; labelId: LabelId },
    options?: FindOptions<DbTx>,
  ): Promise<CardLabelLink | null> {
    const db = options?.tx ?? this.db;

    const conditions = [
      eq(cardLabels.cardId, params.cardId),
      eq(cardLabels.labelId, params.labelId),
    ];
    if (options?.tenantId) {
      conditions.push(eq(cardLabels.tenantId, options.tenantId));
    }

    const rows = await db
      .select()
      .from(cardLabels)
      .where(and(...conditions))
      .limit(1);

    if (!rows[0]) return null;

    return {
      cardId:    rows[0].cardId    as CardId,
      labelId:   rows[0].labelId   as LabelId,
      tenantId:  rows[0].tenantId  as TenantId,
      appliedBy: rows[0].appliedBy as UserId,
      appliedAt: rows[0].appliedAt,
    };
  }

  /**
   * Counts how many cards the given label is currently applied to.
   * Used by the delete-confirm flow (D3) so the UI can display the
   * dialog "این برچسب در X کارت استفاده شده. حذف شود؟" before the
   * mutation runs.
   *
   * The tenant_id filter is redundant under RLS but cheap; we keep it
   * for defence in depth in case this is ever called outside the
   * tenant-context middleware.
   */
  async countCardsWithLabel(
    labelId: LabelId,
    options?: FindOptions<DbTx>,
  ): Promise<number> {
    const db = options?.tx ?? this.db;

    const conditions = [eq(cardLabels.labelId, labelId)];
    if (options?.tenantId) {
      conditions.push(eq(cardLabels.tenantId, options.tenantId));
    }

    const rows = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(cardLabels)
      .where(and(...conditions));

    return rows[0]?.count ?? 0;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Writes — every method takes an explicit tx for atomic-outbox composition
  // ──────────────────────────────────────────────────────────────────────────

  async create(tx: DbTx, entity: LabelEntity): Promise<void> {
    await tx.insert(labels).values({
      id:         entity.id,
      tenantId:   entity.tenantId,
      boardId:    entity.boardId,
      name:       entity.name,
      colorToken: entity.colorToken,
      position:   entity.position,
      createdAt:  entity.createdAt,
      createdBy:  entity.createdBy,
      updatedAt:  entity.updatedAt,
      // deletedAt omitted — DB default is NULL.
    });
  }

  async update(tx: DbTx, id: LabelId, patch: LabelPatch): Promise<void> {
    if (Object.keys(patch).length === 0) return;

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.name       !== undefined) updates.name       = patch.name;
    if (patch.colorToken !== undefined) updates.colorToken = patch.colorToken;
    if (patch.position   !== undefined) updates.position   = patch.position;

    await tx
      .update(labels)
      .set(updates)
      .where(and(eq(labels.id, id), notDeleted(labels)));
  }

  async softDelete(tx: DbTx, id: LabelId): Promise<void> {
    const now = new Date();
    await tx
      .update(labels)
      .set({ deletedAt: now, updatedAt: now })
      .where(and(eq(labels.id, id), notDeleted(labels)));
  }

  /**
   * Hard-deletes every junction row pointing at the given label. Used
   * by the delete flow alongside `softDelete` so the soft-deleted
   * label vanishes from every card immediately, even though the label
   * row itself survives until the janitor purges it (Phase 1.5).
   *
   * Hard-delete (not soft) on the junction is intentional: a junction
   * row carries no business state worth retaining, and soft-deleting
   * it would force every read path to also filter `notDeleted(card_labels)`,
   * doubling the predicate cost without benefit.
   */
  async hardDeleteJunctionByLabelId(tx: DbTx, labelId: LabelId): Promise<void> {
    await tx.delete(cardLabels).where(eq(cardLabels.labelId, labelId));
  }

  async applyLabelToCard(
    tx: DbTx,
    link: CardLabelLink,
  ): Promise<{ inserted: boolean }> {
    // ON CONFLICT DO NOTHING gives us atomic idempotency at the DB level
    // — even if two concurrent requests race past the use-case's
    // `alreadyApplied` check, only one row lands. `.returning()` lets us
    // tell the caller whether the row was actually inserted.
    const inserted = await tx
      .insert(cardLabels)
      .values({
        cardId:    link.cardId,
        labelId:   link.labelId,
        tenantId:  link.tenantId,
        appliedBy: link.appliedBy,
        appliedAt: link.appliedAt,
      })
      .onConflictDoNothing({
        target: [cardLabels.cardId, cardLabels.labelId],
      })
      .returning({ cardId: cardLabels.cardId });

    return { inserted: inserted.length > 0 };
  }

  async removeLabelFromCard(
    tx: DbTx,
    params: { cardId: CardId; labelId: LabelId },
  ): Promise<{ removed: boolean }> {
    const removed = await tx
      .delete(cardLabels)
      .where(
        and(
          eq(cardLabels.cardId, params.cardId),
          eq(cardLabels.labelId, params.labelId),
        ),
      )
      .returning({ cardId: cardLabels.cardId });

    return { removed: removed.length > 0 };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Mapping
  // ──────────────────────────────────────────────────────────────────────────

  private mapToDomain(row: typeof labels.$inferSelect): LabelEntity {
    return {
      id:         row.id         as LabelId,
      tenantId:   row.tenantId   as TenantId,
      boardId:    row.boardId    as BoardId,
      name:       row.name,
      colorToken: row.colorToken as ColorToken,
      position:   row.position   as Position,
      createdAt:  row.createdAt,
      createdBy:  row.createdBy  as UserId,
      updatedAt:  row.updatedAt,
      deletedAt:  row.deletedAt ?? null,
    };
  }
}
