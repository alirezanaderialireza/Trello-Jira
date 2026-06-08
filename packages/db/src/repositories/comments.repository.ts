// packages/db/src/repositories/comments.repository.ts
//
// Phase 1.2 (F1.2.4.a) — Drizzle implementation of the CommentsRepository
// port from @repo/domain/comments.
//
// Mirrors DrizzleChecklistsRepository from F1.2.3.a:
//   • Reads  accept FindOptions<DbTx> for tenant + tx scoping.
//   • Writes always take an explicit `tx` so the caller can compose them
//     with outboxRepository.append in the same transaction (atomic outbox).
//   • findByCardId / findByCardIdWithAuthors support cursor-based pagination
//     (newest-first, desc createdAt) for the list procedure.
//   • findByIdWithAuthor / findByCardIdWithAuthors JOIN to the users table
//     so the UI gets displayName + avatarUrl in a single round-trip.

import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";

import type {
  BoardId,
  CardId,
  TenantId,
  UserId,
  FindOptions,
} from "@repo/domain";
import type {
  CommentDeletePatch,
  CommentEntity,
  CommentId,
  CommentPatch,
  CommentsRepository,
  CommentWithAuthor,
} from "@repo/domain";

import { comments } from "../schema/comments";
import { users }    from "../schema/users";
import { notDeleted } from "../lib/softDeleteFilter";
import type { DbTx } from "./board.repository";

// ============================================================================
// DrizzleCommentsRepository
// ============================================================================

export class DrizzleCommentsRepository
  implements CommentsRepository<DbTx>
{
  constructor(private readonly db: DbTx) {}

  // ──────────────────────────────────────────────────────────────────────────
  // Reads
  // ──────────────────────────────────────────────────────────────────────────

  async findById(
    id:       CommentId,
    options?: FindOptions<DbTx>,
  ): Promise<CommentEntity | null> {
    const db = options?.tx ?? this.db;

    const conditions = [eq(comments.id, id), notDeleted(comments)];
    if (options?.tenantId) {
      conditions.push(eq(comments.tenantId, options.tenantId));
    }

    const rows = await db
      .select()
      .from(comments)
      .where(and(...conditions))
      .limit(1);

    return rows[0] ? this.mapToDomain(rows[0]) : null;
  }

  async findByIdWithAuthor(
    id:       CommentId,
    options?: FindOptions<DbTx>,
  ): Promise<CommentWithAuthor | null> {
    const db = options?.tx ?? this.db;

    const conditions = [eq(comments.id, id), notDeleted(comments)];
    if (options?.tenantId) {
      conditions.push(eq(comments.tenantId, options.tenantId));
    }

    const rows = await db
      .select({
        // comment columns
        id:          comments.id,
        tenantId:    comments.tenantId,
        cardId:      comments.cardId,
        boardId:     comments.boardId,
        authorId:    comments.authorId,
        body:        comments.body,
        revision:    comments.revision,
        createdAt:   comments.createdAt,
        updatedAt:   comments.updatedAt,
        editedAt:    comments.editedAt,
        deletedAt:   comments.deletedAt,
        deletedBy:   comments.deletedBy,
        // author projection
        authorDisplayName: users.displayName,
        authorAvatarUrl:   users.avatarUrl,
      })
      .from(comments)
      // LEFT JOIN so we still return the comment even if the user row was
      // hard-deleted (edge case — users are soft-deleted in practice).
      .leftJoin(users, sql`${users.id}::text = ${comments.authorId}`)
      .where(and(...conditions))
      .limit(1);

    return rows[0] ? this.mapWithAuthorToDomain(rows[0]) : null;
  }

  async findByCardId(
    cardId:  CardId,
    options: FindOptions<DbTx> & { limit: number; cursor?: CommentId },
  ): Promise<CommentEntity[]> {
    const db = options.tx ?? this.db;

    const conditions = [
      eq(comments.cardId, cardId),
      notDeleted(comments),
    ];
    if (options.tenantId) {
      conditions.push(eq(comments.tenantId, options.tenantId));
    }
    // Cursor: fetch comments older than the cursor row (createdAt DESC)
    if (options.cursor) {
      // Sub-select the createdAt of the cursor row; rows must be strictly
      // older (lt = less-than on timestamps in DESC order means "before").
      const cursorRows = await db
        .select({ createdAt: comments.createdAt })
        .from(comments)
        .where(eq(comments.id, options.cursor))
        .limit(1);
      const cursorTs = cursorRows[0]?.createdAt;
      if (cursorTs) {
        conditions.push(lt(comments.createdAt, cursorTs));
      }
    }

    const rows = await db
      .select()
      .from(comments)
      .where(and(...conditions))
      .orderBy(desc(comments.createdAt))
      .limit(options.limit + 1); // +1 so caller can detect hasMore

    return rows.map((row: typeof comments.$inferSelect) =>
      this.mapToDomain(row),
    );
  }

  async findByCardIdWithAuthors(
    cardId:  CardId,
    options: FindOptions<DbTx> & { limit: number; cursor?: CommentId },
  ): Promise<CommentWithAuthor[]> {
    const db = options.tx ?? this.db;

    const conditions = [
      eq(comments.cardId, cardId),
      notDeleted(comments),
    ];
    if (options.tenantId) {
      conditions.push(eq(comments.tenantId, options.tenantId));
    }
    if (options.cursor) {
      const cursorRows = await db
        .select({ createdAt: comments.createdAt })
        .from(comments)
        .where(eq(comments.id, options.cursor))
        .limit(1);
      const cursorTs = cursorRows[0]?.createdAt;
      if (cursorTs) {
        conditions.push(lt(comments.createdAt, cursorTs));
      }
    }

    const rows = await db
      .select({
        id:          comments.id,
        tenantId:    comments.tenantId,
        cardId:      comments.cardId,
        boardId:     comments.boardId,
        authorId:    comments.authorId,
        body:        comments.body,
        revision:    comments.revision,
        createdAt:   comments.createdAt,
        updatedAt:   comments.updatedAt,
        editedAt:    comments.editedAt,
        deletedAt:   comments.deletedAt,
        deletedBy:   comments.deletedBy,
        authorDisplayName: users.displayName,
        authorAvatarUrl:   users.avatarUrl,
      })
      .from(comments)
      .leftJoin(users, sql`${users.id}::text = ${comments.authorId}`)
      .where(and(...conditions))
      .orderBy(desc(comments.createdAt))
      .limit(options.limit + 1);

    return rows.map((row: any) => this.mapWithAuthorToDomain(row));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Writes
  // ──────────────────────────────────────────────────────────────────────────

  async create(tx: DbTx, entity: CommentEntity): Promise<void> {
    await tx.insert(comments).values({
      id:        entity.id,
      tenantId:  entity.tenantId,
      cardId:    entity.cardId,
      boardId:   entity.boardId,
      authorId:  entity.authorId,
      body:      entity.body,
      revision:  entity.revision,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
      editedAt:  entity.editedAt,
      deletedAt: null,
      deletedBy: null,
    });
  }

  async update(
    tx:    DbTx,
    id:    CommentId,
    patch: CommentPatch,
  ): Promise<void> {
    if (Object.keys(patch).length === 0) return;

    const updates: Record<string, unknown> = {};
    if (patch.body      !== undefined) updates.body      = patch.body;
    if (patch.editedAt  !== undefined) updates.editedAt  = patch.editedAt;
    if (patch.updatedAt !== undefined) updates.updatedAt = patch.updatedAt;
    if (patch.revision  !== undefined) updates.revision  = patch.revision;

    await tx
      .update(comments)
      .set(updates)
      .where(and(eq(comments.id, id), notDeleted(comments)));
  }

  async softDelete(
    tx:    DbTx,
    id:    CommentId,
    patch: CommentDeletePatch,
  ): Promise<void> {
    await tx
      .update(comments)
      .set({
        deletedAt: patch.deletedAt,
        deletedBy: patch.deletedBy,
        updatedAt: patch.updatedAt,
        revision:  patch.revision,
      })
      .where(and(eq(comments.id, id), notDeleted(comments)));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Mapping
  // ──────────────────────────────────────────────────────────────────────────

  private mapToDomain(row: typeof comments.$inferSelect): CommentEntity {
    return {
      id:        row.id        as CommentId,
      tenantId:  row.tenantId  as TenantId,
      cardId:    row.cardId    as CardId,
      boardId:   row.boardId   as BoardId,
      authorId:  row.authorId  as UserId,
      body:      row.body,
      revision:  row.revision,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      editedAt:  row.editedAt  ?? null,
      deletedAt: row.deletedAt ?? null,
      deletedBy: (row.deletedBy ?? null) as UserId | null,
    };
  }

  private mapWithAuthorToDomain(row: any): CommentWithAuthor {
    return {
      ...this.mapToDomain(row as typeof comments.$inferSelect),
      authorDisplayName: row.authorDisplayName ?? "کاربر ناشناس",
      authorAvatarUrl:   row.authorAvatarUrl   ?? null,
    };
  }
}
