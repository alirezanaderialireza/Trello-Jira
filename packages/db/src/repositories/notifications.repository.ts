// packages/db/src/repositories/notifications.repository.ts
//
// Phase 1.2 (F1.2.9) — Drizzle implementation of the notifications inbox.
//
// Plain repository (no domain port). The outbox-worker writes rows (under a
// BYPASSRLS service role); the tRPC notification router reads + marks-read
// (under the request's user+tenant RLS).
//
//   • findByUser: cursor-paginated, newest-first (cursor = a notification id;
//     rows strictly older than the cursor row's created_at are returned).
//   • countUnread: read_at IS NULL count for the bell badge.
//   • markRead / markAllRead: set read_at = now() (only the owner's rows;
//     RLS enforces the user predicate, the explicit user_id filter is a
//     second layer).

import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";

import { notifications } from "../schema/notifications";
import type { DbTx } from "./board.repository";

export interface NotificationEntity {
  id:         string;
  tenantId:   string;
  userId:     string;
  type:       string;
  entityType: string;
  entityId:   string;
  boardId:    string | null;
  cardId:     string | null;
  actorId:    string;
  actorName:  string | null;
  title:      string;
  body:       string | null;
  readAt:     Date | null;
  createdAt:  Date;
}

export interface NotificationFindOptions {
  tx?:       DbTx;
  tenantId?: string;
  limit?:    number;
  cursor?:   string;
}

export class DrizzleNotificationsRepository {
  constructor(private readonly db: DbTx) {}

  // ──────────────────────────────────────────────────────────────────────────
  // Reads
  // ──────────────────────────────────────────────────────────────────────────

  async findByUser(
    userId:   string,
    tenantId: string,
    options?: NotificationFindOptions,
  ): Promise<NotificationEntity[]> {
    const db    = options?.tx ?? this.db;
    const limit = options?.limit ?? 20;

    const conditions = [
      eq(notifications.userId, userId),
      eq(notifications.tenantId, tenantId),
    ];

    // Cursor: rows strictly older than the cursor row (created_at DESC).
    if (options?.cursor) {
      const cursorRows = await db
        .select({ createdAt: notifications.createdAt })
        .from(notifications)
        .where(eq(notifications.id, options.cursor))
        .limit(1);
      const cursorTs = cursorRows[0]?.createdAt;
      if (cursorTs) {
        conditions.push(lt(notifications.createdAt, cursorTs));
      }
    }

    const rows = await db
      .select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt))
      .limit(limit + 1); // +1 so the caller can detect hasMore

    return rows.map((r: typeof notifications.$inferSelect) => this.mapToDomain(r));
  }

  async countUnread(
    userId:   string,
    tenantId: string,
    tx?:      DbTx,
  ): Promise<number> {
    const db = tx ?? this.db;
    const rows = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.tenantId, tenantId),
          isNull(notifications.readAt),
        ),
      );
    return rows[0]?.count ?? 0;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Writes
  // ──────────────────────────────────────────────────────────────────────────

  async create(
    tx:     DbTx,
    entity: Omit<NotificationEntity, "createdAt" | "readAt"> & {
      createdAt?: Date;
    },
  ): Promise<void> {
    await tx.insert(notifications).values({
      id:         entity.id,
      tenantId:   entity.tenantId,
      userId:     entity.userId,
      type:       entity.type,
      entityType: entity.entityType,
      entityId:   entity.entityId,
      boardId:    entity.boardId,
      cardId:     entity.cardId,
      actorId:    entity.actorId,
      actorName:  entity.actorName,
      title:      entity.title,
      body:       entity.body,
      createdAt:  entity.createdAt ?? new Date(),
    });
  }

  /** Mark a single notification read. Returns the number of rows affected. */
  async markRead(
    notificationId: string,
    userId:         string,
    tx:             DbTx,
  ): Promise<void> {
    await tx
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.userId, userId),
          isNull(notifications.readAt),
        ),
      );
  }

  /** Mark every unread notification for a user read. */
  async markAllRead(
    userId:   string,
    tenantId: string,
    tx:       DbTx,
  ): Promise<void> {
    await tx
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.tenantId, tenantId),
          isNull(notifications.readAt),
        ),
      );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Mapping
  // ──────────────────────────────────────────────────────────────────────────

  private mapToDomain(
    row: typeof notifications.$inferSelect,
  ): NotificationEntity {
    return {
      id:         row.id,
      tenantId:   row.tenantId,
      userId:     row.userId,
      type:       row.type,
      entityType: row.entityType,
      entityId:   row.entityId,
      boardId:    row.boardId ?? null,
      cardId:     row.cardId ?? null,
      actorId:    row.actorId,
      actorName:  row.actorName ?? null,
      title:      row.title,
      body:       row.body ?? null,
      readAt:     row.readAt ?? null,
      createdAt:  row.createdAt,
    };
  }
}
