// packages/api/src/routers/card-features/activity.router.ts
//
// Phase 1.2 (F1.2.6) — full rewrite of the Phase-4 stub.
//
// Changes vs the stub:
//   • Source: outbox_events (NOT audit_logs — all mutations emit to outbox)
//   • SQL JOINs: users (actor), labels (label name/color), lists (from/to)
//   • Returns ActivityEntry-shaped objects with enrichment fields
//   • boardProtectedProcedure (was: protectedProcedure)
//   • Cursor-based pagination via occurredAt timestamp
//   • Filters to card-relevant event topics only

import { z }    from "zod";
import { sql }  from "drizzle-orm";

import { router, boardProtectedProcedure } from "../../trpc";

const IdSchema     = z.string().uuid();
const CursorSchema = z.string().optional(); // ISO-8601 timestamp

// Event topic prefixes relevant to card activity.
// We include label.* because card.label_added/removed reference them.
const CARD_TOPICS_FILTER = sql`(
  o.type LIKE 'card.%'
  OR o.type LIKE 'comment.%'
  OR o.type LIKE 'checklist.%'
  OR o.type LIKE 'label.%'
)`;

export const activityRouter = router({

  // ──────────────────────────────────────────────────────────────────────────
  // getByCard — cursor-paginated activity for a single card
  // ──────────────────────────────────────────────────────────────────────────

  getByCard: boardProtectedProcedure
    .input(z.object({
      boardId: IdSchema,
      cardId:  IdSchema,
      cursor:  CursorSchema,
      limit:   z.number().int().min(1).max(50).default(20),
    }).strict())
    .query(async ({ input, ctx }) => {
      const { boardId, cardId, cursor, limit } = input;
      const tenantId = ctx.session.tenantId;

      const cursorClause = cursor
        ? sql`AND o.occurred_at < ${cursor}::timestamptz`
        : sql``;

      const rows = await ctx.infra.db.execute(sql`
        SELECT
          o.event_id                      AS id,
          o.type                          AS event_type,
          o.occurred_at                   AS timestamp,
          o.correlation_id,
          o.payload,
          o.payload->>'actorId'           AS actor_id_raw,
          o.payload->>'authorId'          AS author_id_raw,
          o.payload->>'createdBy'         AS created_by_raw,
          o.payload->>'assignedBy'        AS assigned_by_raw,
          o.payload->>'cardId'            AS card_id_raw,
          o.payload->>'boardId'           AS board_id_raw,
          u.id                            AS actor_db_id,
          u.display_name                  AS actor_name,
          u.avatar_url                    AS actor_avatar,
          l.name                          AS label_name,
          l.color_token                   AS label_color,
          fl.title                        AS from_list_title,
          tl.title                        AS to_list_title
        FROM outbox_events o
        LEFT JOIN users u ON u.id = COALESCE(
          o.payload->>'actorId',
          o.payload->>'authorId',
          o.payload->>'createdBy',
          o.payload->>'assignedBy'
        )
        LEFT JOIN labels l ON l.id = (o.payload->>'labelId')
          AND l.tenant_id = ${tenantId}
        LEFT JOIN lists fl ON fl.id = (o.payload->>'fromListId')
        LEFT JOIN lists tl ON tl.id = (o.payload->>'toListId')
        WHERE o.payload->>'cardId' = ${cardId}
          AND o.payload->>'boardId' = ${boardId}
          AND ${CARD_TOPICS_FILTER}
          ${cursorClause}
        ORDER BY o.occurred_at DESC
        LIMIT ${limit + 1}
      `);

      const rowsArr  = rows as any[];
      const hasMore  = rowsArr.length > limit;
      const data     = hasMore ? rowsArr.slice(0, limit) : rowsArr;
      const nextCursor = hasMore
        ? (data[data.length - 1]?.timestamp as string | undefined) ?? null
        : null;

      const events = data.map((row: any) => ({
        id:            row.id             as string,
        boardId:       (row.board_id_raw  as string) ?? boardId,
        actorId:       (row.actor_id_raw  as string)
                    ?? (row.author_id_raw as string)
                    ?? (row.created_by_raw as string)
                    ?? "system",
        tenantId,
        timestamp:     new Date(row.timestamp).toISOString(),
        correlationId: (row.correlation_id as string) ?? undefined,
        eventType:     row.event_type     as string,
        payload:       (typeof row.payload === "string"
                          ? JSON.parse(row.payload)
                          : row.payload) as Record<string, unknown>,
        // enrichment
        actorName:   (row.actor_name   as string  | null) ?? "کاربر حذف‌شده",
        actorAvatar: (row.actor_avatar as string  | null) ?? null,
        // label enrichment forwarded into payload so formatter can read it
        labelName:   (row.label_name  as string  | null) ?? null,
        labelColor:  (row.label_color as string  | null) ?? null,
        fromListTitle: (row.from_list_title as string | null) ?? null,
        toListTitle:   (row.to_list_title   as string | null) ?? null,
      }));

      return { events, nextCursor };
    }),

  // ──────────────────────────────────────────────────────────────────────────
  // getByBoard — board-level activity feed (for future board dashboard)
  // ──────────────────────────────────────────────────────────────────────────

  getByBoard: boardProtectedProcedure
    .input(z.object({
      boardId: IdSchema,
      cursor:  CursorSchema,
      limit:   z.number().int().min(1).max(50).default(20),
    }).strict())
    .query(async ({ input, ctx }) => {
      const { boardId, cursor, limit } = input;
      const tenantId = ctx.session.tenantId;

      const cursorClause = cursor
        ? sql`AND o.occurred_at < ${cursor}::timestamptz`
        : sql``;

      const rows = await ctx.infra.db.execute(sql`
        SELECT
          o.event_id                      AS id,
          o.type                          AS event_type,
          o.occurred_at                   AS timestamp,
          o.correlation_id,
          o.payload,
          o.payload->>'actorId'           AS actor_id_raw,
          o.payload->>'authorId'          AS author_id_raw,
          o.payload->>'createdBy'         AS created_by_raw,
          o.payload->>'cardId'            AS card_id_raw,
          o.payload->>'boardId'           AS board_id_raw,
          u.display_name                  AS actor_name,
          u.avatar_url                    AS actor_avatar
        FROM outbox_events o
        LEFT JOIN users u ON u.id = COALESCE(
          o.payload->>'actorId',
          o.payload->>'authorId',
          o.payload->>'createdBy'
        )
        WHERE o.payload->>'boardId' = ${boardId}
          AND ${CARD_TOPICS_FILTER}
          ${cursorClause}
        ORDER BY o.occurred_at DESC
        LIMIT ${limit + 1}
      `);

      const rowsArr  = rows as any[];
      const hasMore  = rowsArr.length > limit;
      const data     = hasMore ? rowsArr.slice(0, limit) : rowsArr;
      const nextCursor = hasMore
        ? (data[data.length - 1]?.timestamp as string | undefined) ?? null
        : null;

      const events = data.map((row: any) => ({
        id:            row.id             as string,
        boardId:       (row.board_id_raw  as string) ?? boardId,
        actorId:       (row.actor_id_raw  as string)
                    ?? (row.author_id_raw as string)
                    ?? (row.created_by_raw as string)
                    ?? "system",
        tenantId,
        timestamp:     new Date(row.timestamp).toISOString(),
        correlationId: (row.correlation_id as string) ?? undefined,
        eventType:     row.event_type     as string,
        payload:       (typeof row.payload === "string"
                          ? JSON.parse(row.payload)
                          : row.payload) as Record<string, unknown>,
        actorName:   (row.actor_name   as string  | null) ?? "کاربر حذف‌شده",
        actorAvatar: (row.actor_avatar as string  | null) ?? null,
      }));

      return { events, nextCursor };
    }),
});
