// packages/api/src/routers/notification.router.ts
//
// Phase 1.2 (F1.2.9) — Watch + Notifications (Inbox).
//
// Two procedure families:
//   • Inbox (user-scoped, no board): list / markRead / markAllRead.
//       protectedProcedure — RLS scopes rows to the request's user+tenant
//       via the notifications_user_* policies (current_user_id() GUC).
//   • Watch (board-scoped): watchCard / unwatchCard / isWatching.
//       boardProtectedProcedure — board membership enforced, plus a
//       topology guard (card.boardId === input.boardId).
//
// API surface (mounted at v1.public.notification.*):
//   list({ cursor?, limit? })          → { notifications, nextCursor, unreadCount }
//   markRead({ notificationId })        → { success }
//   markAllRead()                       → { success }
//   watchCard({ boardId, cardId })      → { watching: true }
//   unwatchCard({ boardId, cardId })    → { watching: false }
//   isWatching({ boardId, cardId })     → { watching: boolean }

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";

import { router, protectedProcedure, boardProtectedProcedure } from "../trpc";
import {
  DrizzleNotificationsRepository,
  DrizzleCardWatchersRepository,
  cards,
  type NotificationEntity,
} from "@repo/db";

// ─── Schemas ─────────────────────────────────────────────────────────────────

const IdSchema = z.string().uuid();

// ─── DTO ─────────────────────────────────────────────────────────────────────

export interface NotificationDto {
  id:         string;
  type:       string;
  entityType: string;
  entityId:   string;
  boardId:    string | null;
  cardId:     string | null;
  actorId:    string;
  actorName:  string | null;
  title:      string;
  body:       string | null;
  read:       boolean;
  createdAt:  string;
}

function toDto(n: NotificationEntity): NotificationDto {
  return {
    id:         n.id,
    type:       n.type,
    entityType: n.entityType,
    entityId:   n.entityId,
    boardId:    n.boardId,
    cardId:     n.cardId,
    actorId:    n.actorId,
    actorName:  n.actorName,
    title:      n.title,
    body:       n.body,
    read:       n.readAt !== null,
    createdAt:  n.createdAt.toISOString(),
  };
}

// ─── Topology guard helper ─────────────────────────────────────────────────────
// Confirms the card exists, belongs to the request's tenant, and lives on the
// board the caller claims. Returns nothing — throws on mismatch.
async function assertCardOnBoard(
  ctx: any,
  cardId: string,
  boardId: string,
): Promise<void> {
  const cardRow = await ctx.infra.db.query.cards.findFirst({
    where: and(
      eq(cards.id, cardId),
      eq(cards.tenantId, ctx.session.tenantId),
      isNull(cards.deletedAt),
    ),
    columns: { id: true, boardId: true },
  });
  if (!cardRow) {
    throw new TRPCError({ code: "NOT_FOUND", message: "کارت یافت نشد." });
  }
  if (cardRow.boardId !== boardId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "کارت به این برد تعلق ندارد." });
  }
}

// ─── Router ─────────────────────────────────────────────────────────────────

export const notificationRouter = router({

  // ──────────────────────────────────────────────────────────────────────────
  // list — cursor-paginated inbox, newest-first, with unread count
  // ──────────────────────────────────────────────────────────────────────────

  list: protectedProcedure
    .input(
      z.object({
        cursor: IdSchema.optional(),
        limit:  z.number().int().min(1).max(50).default(20),
      }).strict().optional(),
    )
    .query(async ({ input, ctx }) => {
      const limit  = input?.limit ?? 20;
      const userId = ctx.session.user.id;
      const tenantId = ctx.session.tenantId;
      const repo = new DrizzleNotificationsRepository(ctx.infra.db);

      const rows = await repo.findByUser(userId, tenantId, {
        tx:     ctx.infra.db,
        limit,
        cursor: input?.cursor,
      });

      const hasMore    = rows.length > limit;
      const data       = hasMore ? rows.slice(0, limit) : rows;
      const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;

      const unreadCount = await repo.countUnread(userId, tenantId, ctx.infra.db);

      return {
        notifications: data.map(toDto),
        nextCursor,
        unreadCount,
      };
    }),

  // ──────────────────────────────────────────────────────────────────────────
  // markRead — mark a single notification read
  // ──────────────────────────────────────────────────────────────────────────

  markRead: protectedProcedure
    .input(z.object({ notificationId: IdSchema }).strict())
    .mutation(async ({ input, ctx }) => {
      const repo = new DrizzleNotificationsRepository(ctx.infra.db);
      await repo.markRead(input.notificationId, ctx.session.user.id, ctx.infra.db);
      return { success: true as const };
    }),

  // ──────────────────────────────────────────────────────────────────────────
  // markAllRead — mark every unread notification read
  // ──────────────────────────────────────────────────────────────────────────

  markAllRead: protectedProcedure
    .mutation(async ({ ctx }) => {
      const repo = new DrizzleNotificationsRepository(ctx.infra.db);
      await repo.markAllRead(ctx.session.user.id, ctx.session.tenantId, ctx.infra.db);
      return { success: true as const };
    }),

  // ──────────────────────────────────────────────────────────────────────────
  // watchCard — start watching a card (idempotent)
  // ──────────────────────────────────────────────────────────────────────────

  watchCard: boardProtectedProcedure
    .input(z.object({ boardId: IdSchema, cardId: IdSchema }).strict())
    .mutation(async ({ input, ctx }) => {
      await assertCardOnBoard(ctx, input.cardId, input.boardId);
      const repo = new DrizzleCardWatchersRepository(ctx.infra.db);
      await repo.watch(
        input.cardId,
        ctx.session.user.id,
        ctx.session.tenantId,
        ctx.infra.db,
      );
      return { watching: true as const };
    }),

  // ──────────────────────────────────────────────────────────────────────────
  // unwatchCard — stop watching a card
  // ──────────────────────────────────────────────────────────────────────────

  unwatchCard: boardProtectedProcedure
    .input(z.object({ boardId: IdSchema, cardId: IdSchema }).strict())
    .mutation(async ({ input, ctx }) => {
      await assertCardOnBoard(ctx, input.cardId, input.boardId);
      const repo = new DrizzleCardWatchersRepository(ctx.infra.db);
      await repo.unwatch(input.cardId, ctx.session.user.id, ctx.infra.db);
      return { watching: false as const };
    }),

  // ──────────────────────────────────────────────────────────────────────────
  // isWatching — is the caller watching this card?
  // ──────────────────────────────────────────────────────────────────────────

  isWatching: boardProtectedProcedure
    .input(z.object({ boardId: IdSchema, cardId: IdSchema }).strict())
    .query(async ({ input, ctx }) => {
      const repo = new DrizzleCardWatchersRepository(ctx.infra.db);
      const watching = await repo.isWatching(
        input.cardId,
        ctx.session.user.id,
        { tx: ctx.infra.db, tenantId: ctx.session.tenantId },
      );
      return { watching };
    }),
});
