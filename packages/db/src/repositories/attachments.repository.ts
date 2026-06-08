// packages/db/src/repositories/attachments.repository.ts
//
// Phase 1.2 (F1.2.8) — Drizzle implementation of AttachmentsRepository.
// Mirrors DrizzleCommentsRepository / DrizzleCardAssigneesRepository patterns.

import { and, asc, eq, isNull, sql } from "drizzle-orm";

import type {
  BoardId,
  CardId,
  TenantId,
  FindOptions,
} from "@repo/domain";
import type {
  AttachmentEntity,
  AttachmentId,
  AttachmentType,
  AttachmentsRepository,
} from "@repo/domain";

import { attachments } from "../schema/attachments";
import { notDeleted }  from "../lib/softDeleteFilter";
import type { DbTx }   from "./board.repository";

// ============================================================================
// DrizzleAttachmentsRepository
// ============================================================================

export class DrizzleAttachmentsRepository
  implements AttachmentsRepository<DbTx>
{
  constructor(private readonly db: DbTx) {}

  // ──────────────────────────────────────────────────────────────────────────
  // Reads
  // ──────────────────────────────────────────────────────────────────────────

  async findById(
    id:       AttachmentId,
    options?: FindOptions<DbTx>,
  ): Promise<AttachmentEntity | null> {
    const db = options?.tx ?? this.db;
    const conditions = [eq(attachments.id, id), notDeleted(attachments)];
    if (options?.tenantId) {
      conditions.push(eq(attachments.tenantId, options.tenantId));
    }
    const rows = await db
      .select()
      .from(attachments)
      .where(and(...conditions))
      .limit(1);
    return rows[0] ? this.mapToDomain(rows[0]) : null;
  }

  async findByCardId(
    cardId:   CardId,
    options?: FindOptions<DbTx>,
  ): Promise<AttachmentEntity[]> {
    const db = options?.tx ?? this.db;
    const conditions = [
      eq(attachments.cardId, cardId),
      notDeleted(attachments),
    ];
    if (options?.tenantId) {
      conditions.push(eq(attachments.tenantId, options.tenantId));
    }
    const rows = await db
      .select()
      .from(attachments)
      .where(and(...conditions))
      .orderBy(asc(attachments.createdAt));
    return rows.map((r: typeof attachments.$inferSelect) => this.mapToDomain(r));
  }

  async countByCardId(
    cardId:   CardId,
    options?: FindOptions<DbTx>,
  ): Promise<number> {
    const db = options?.tx ?? this.db;
    const conditions = [
      eq(attachments.cardId, cardId),
      notDeleted(attachments),
    ];
    if (options?.tenantId) {
      conditions.push(eq(attachments.tenantId, options.tenantId));
    }
    const rows = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(attachments)
      .where(and(...conditions));
    return rows[0]?.count ?? 0;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Writes
  // ──────────────────────────────────────────────────────────────────────────

  async create(tx: DbTx, entity: AttachmentEntity): Promise<void> {
    await tx.insert(attachments).values({
      id:         entity.id,
      tenantId:   entity.tenantId,
      cardId:     entity.cardId,
      boardId:    entity.boardId,
      type:       entity.type,
      url:        entity.url,
      objectKey:  entity.objectKey,
      mimeType:   entity.mimeType,
      fileName:   entity.fileName,
      sizeBytes:  entity.sizeBytes,
      title:      entity.title,
      uploadedBy: entity.uploadedBy,
      createdAt:  entity.createdAt,
      deletedAt:  null,
    });
  }

  async softDelete(tx: DbTx, id: AttachmentId): Promise<void> {
    await tx
      .update(attachments)
      .set({ deletedAt: new Date() })
      .where(and(eq(attachments.id, id), notDeleted(attachments)));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Mapping
  // ──────────────────────────────────────────────────────────────────────────

  private mapToDomain(row: typeof attachments.$inferSelect): AttachmentEntity {
    return {
      id:         row.id         as AttachmentId,
      tenantId:   row.tenantId   as TenantId,
      cardId:     row.cardId     as CardId,
      boardId:    row.boardId    as BoardId,
      type:       row.type       as AttachmentType,
      url:        row.url,
      objectKey:  row.objectKey  ?? null,
      mimeType:   row.mimeType   ?? null,
      fileName:   row.fileName,
      sizeBytes:  row.sizeBytes  ?? null,
      title:      row.title      ?? null,
      uploadedBy: row.uploadedBy,
      createdAt:  row.createdAt,
      deletedAt:  row.deletedAt  ?? null,
    };
  }
}
