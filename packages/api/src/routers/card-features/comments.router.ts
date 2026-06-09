// packages/api/src/routers/card-features/comments.router.ts
//
// Phase 1.2 (F1.2.4.a) — full rewrite of the Phase-4 stub.
//
// Changes vs the stub:
//   • boardProtectedProcedure (was: raw protectedProcedure with no
//     board membership check)
//   • Atomic outbox: every mutation emits a schemaVersion-2 event
//     via ctx.repos.outbox.append on the same DB transaction
//   • withIdempotency wrapper on all mutations
//   • Topology guards: card.boardId === input.boardId on all mutations
//   • Persian error messages via toTRPCError
//   • Domain use-cases (pure functions) replace inline logic
//   • DrizzleCommentsRepository replaces direct ctx.infra.db queries
//   • list procedure renamed from getByCard → list (consistent with
//     checklist.list, label.list naming convention)
//   • delete authorisation: author OR board admin/owner (D5)
//     (was: session.roles?.includes("ADMIN") — that field is never
//      populated, so it was effectively author-only)
//   • body max length: 5000 (was: 10000, D3)
//
// API surface (mounted at v1.public.comment.*):
//   list({ boardId, cardId, cursor?, limit? })           → { comments, nextCursor }
//   create({ boardId, cardId, body, idempotencyKey })    → CommentDto
//   update({ boardId, commentId, body, idempotencyKey }) → { success, noOp }
//   delete({ boardId, commentId, idempotencyKey })       → { success }

import crypto from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, isNull } from "drizzle-orm";

import { router, boardProtectedProcedure } from "../../trpc";

import { DrizzleCommentsRepository, DrizzleCardWatchersRepository, cards } from "@repo/db";

import {
  // Use-cases
  createComment,
  updateComment,
  deleteComment,
  // Domain types
  type CommentId,
  type CardId,
  type BoardId,
  type TenantId,
  type UserId,
  type MutationId,
  // Domain errors
  CommentBodyRequiredError,
  CommentBodyTooLongError,
  CommentNotFoundError,
  CommentCardMismatchError,
  CommentAuthorOnlyError,
  // CardNotFoundError re-used from labels (same class in domain barrel)
  CardNotFoundError,
  // Outbox shape
  type JsonObject,
  type OutboxEvent,
} from "@repo/domain";

// ============================================================================
// Zod schemas
// ============================================================================

const IdSchema             = z.string().uuid();
const IdempotencyKeySchema = z.string().uuid();
const BodySchema           = z.string().trim().min(1).max(5_000);
const CorrelationIdSchema  = z.string().min(1).max(128).optional();

// ============================================================================
// Helpers
// ============================================================================

function toTRPCError(err: unknown): TRPCError {
  if (err instanceof CommentBodyRequiredError) {
    return new TRPCError({ code: "BAD_REQUEST", message: "متن کامنت الزامی است." });
  }
  if (err instanceof CommentBodyTooLongError) {
    return new TRPCError({
      code:    "BAD_REQUEST",
      message: `متن کامنت نباید از ${err.maxLength.toLocaleString("fa-IR")} نویسه بیشتر باشد.`,
    });
  }
  if (err instanceof CommentNotFoundError) {
    return new TRPCError({ code: "NOT_FOUND",    message: "کامنت یافت نشد." });
  }
  if (err instanceof CommentCardMismatchError) {
    return new TRPCError({ code: "BAD_REQUEST",  message: "کامنت به این کارت تعلق ندارد." });
  }
  if (err instanceof CommentAuthorOnlyError) {
    return new TRPCError({ code: "FORBIDDEN",    message: "فقط نویسنده می‌تواند این کامنت را ویرایش کند." });
  }
  if (err instanceof CardNotFoundError) {
    return new TRPCError({ code: "NOT_FOUND",    message: "کارت یافت نشد." });
  }
  if (err instanceof TRPCError) return err;
  throw err; // unknown — re-throw so tRPC surfaces it as INTERNAL_SERVER_ERROR
}

function toOutboxEvent(domainEvent: {
  id:             string;
  type:           string;
  version:        number;
  schemaVersion?: number;
  occurredAt:     string;
  aggregateId:    string;
  aggregateType:  string;
  payload:        Readonly<Record<string, unknown>>;
  correlationId?: string;
  causationId?:   string;
  sequence?:      number;
}): OutboxEvent {
  return {
    eventId:       domainEvent.id,
    type:          domainEvent.type,
    aggregateId:   domainEvent.aggregateId,
    aggregateType: domainEvent.aggregateType,
    eventVersion:  `v${domainEvent.schemaVersion ?? domainEvent.version}`,
    occurredAt:    new Date(domainEvent.occurredAt),
    payload:       domainEvent.payload as JsonObject,
    correlationId: domainEvent.correlationId,
    causationId:   domainEvent.causationId,
    sequence:      domainEvent.sequence,
  };
}

const IDEMPOTENCY_SCHEMA_VERSION = "comments.v2";

async function withIdempotency<T>(
  tx: any,
  idempotencyRepo: {
    findByMutationId: (tx: any, id: any) => Promise<any>;
    save:             (tx: any, rec: any) => Promise<void>;
  },
  mutationId: string,
  work: () => Promise<T>,
): Promise<T> {
  const existing = await idempotencyRepo.findByMutationId(
    tx,
    mutationId as MutationId,
  );
  if (existing) return existing.response as T;

  const response = await work();

  await idempotencyRepo.save(tx, {
    mutationId:    mutationId as MutationId,
    response:      response as unknown,
    schemaVersion: IDEMPOTENCY_SCHEMA_VERSION,
    createdAt:     new Date(),
  });

  return response;
}

// ============================================================================
// Router
// ============================================================================

export const commentsRouter = router({

  // ──────────────────────────────────────────────────────────────────────────
  // list — cursor-paginated, newest-first
  // ──────────────────────────────────────────────────────────────────────────

  list: boardProtectedProcedure
    .input(
      z.object({
        boardId: IdSchema,
        cardId:  IdSchema,
        cursor:  IdSchema.optional(),
        limit:   z.number().int().min(1).max(100).default(50),
      }).strict(),
    )
    .query(async ({ input, ctx }) => {
      const repo = new DrizzleCommentsRepository(ctx.infra.db);

      const rows = await repo.findByCardId(
        input.cardId as CardId,
        {
          tx:       ctx.infra.db,
          tenantId: ctx.session.tenantId,
          limit:    input.limit,
          cursor:   input.cursor as CommentId | undefined,
        },
      );

      const hasMore    = rows.length > input.limit;
      const data       = hasMore ? rows.slice(0, input.limit) : rows;
      const nextCursor = hasMore ? (data[data.length - 1]?.id ?? undefined) : undefined;

      return {
        comments: data.map((c) => ({
          id:        c.id,
          cardId:    c.cardId,
          boardId:   c.boardId,
          authorId:  c.authorId,
          body:      c.body,
          revision:  c.revision,
          createdAt: c.createdAt.toISOString(),
          editedAt:  c.editedAt?.toISOString() ?? null,
          updatedAt: c.updatedAt.toISOString(),
        })),
        nextCursor,
      };
    }),

  // ──────────────────────────────────────────────────────────────────────────
  // create — any board member may comment
  // ──────────────────────────────────────────────────────────────────────────

  create: boardProtectedProcedure
    .input(
      z.object({
        boardId:        IdSchema,
        cardId:         IdSchema,
        body:           BodySchema,
        idempotencyKey: IdempotencyKeySchema,
        correlationId:  CorrelationIdSchema,
      }).strict(),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await withIdempotency(
          ctx.infra.db,
          ctx.repos.idempotency,
          input.idempotencyKey,
          async () => {
            const repo = new DrizzleCommentsRepository(ctx.infra.db);

            // Topology guard: card must exist + belong to input.boardId
            const cardRow = await ctx.infra.db.query.cards.findFirst({
              where: and(
                eq(cards.id,       input.cardId),
                eq(cards.tenantId, ctx.session.tenantId),
                isNull(cards.deletedAt),
              ),
              columns: { id: true, boardId: true },
            });
            if (!cardRow) throw new CardNotFoundError();
            if (cardRow.boardId !== input.boardId) {
              throw new TRPCError({
                code:    "BAD_REQUEST",
                message: "کارت به این برد تعلق ندارد.",
              });
            }

            const newCommentId = crypto.randomUUID() as CommentId;
            const eventId      = crypto.randomUUID();
            const now          = new Date();

            const { entity, event } = createComment({
              newCommentId,
              tenantId:      ctx.session.tenantId as TenantId,
              cardId:        input.cardId as CardId,
              boardId:       input.boardId as BoardId,
              authorId:      ctx.session.user.id as UserId,
              body:          input.body,
              now,
              eventId,
              correlationId: input.correlationId,
            });

            await repo.create(ctx.infra.db, entity);
            await ctx.repos.outbox.append(
              ctx.infra.db,
              toOutboxEvent(event),
            );

            // Auto-watch (F1.2.9): the commenter starts watching the card so
            // they receive notifications for subsequent activity. Idempotent
            // (ON CONFLICT DO NOTHING) so re-commenting is a no-op.
            const watchersRepo = new DrizzleCardWatchersRepository(ctx.infra.db);
            await watchersRepo.watch(
              input.cardId,
              ctx.session.user.id,
              ctx.session.tenantId,
              ctx.infra.db,
            );

            return {
              id:        entity.id,
              cardId:    entity.cardId,
              boardId:   entity.boardId,
              authorId:  entity.authorId,
              body:      entity.body,
              revision:  entity.revision,
              createdAt: entity.createdAt.toISOString(),
              editedAt:  null,
              updatedAt: entity.updatedAt.toISOString(),
            };
          },
        );
      } catch (err) {
        throw toTRPCError(err);
      }
    }),

  // ──────────────────────────────────────────────────────────────────────────
  // update — only the comment author (D5)
  // ──────────────────────────────────────────────────────────────────────────

  update: boardProtectedProcedure
    .input(
      z.object({
        boardId:        IdSchema,
        commentId:      IdSchema,
        body:           BodySchema,
        idempotencyKey: IdempotencyKeySchema,
        correlationId:  CorrelationIdSchema,
      }).strict(),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await withIdempotency(
          ctx.infra.db,
          ctx.repos.idempotency,
          input.idempotencyKey,
          async () => {
            const repo = new DrizzleCommentsRepository(ctx.infra.db);

            const current = await repo.findById(
              input.commentId as CommentId,
              { tx: ctx.infra.db, tenantId: ctx.session.tenantId },
            );
            if (!current) throw new CommentNotFoundError();

            // Topology guard
            if (current.boardId !== input.boardId) {
              throw new CommentCardMismatchError();
            }

            // Authorisation: only author may edit (D5)
            if (current.authorId !== ctx.session.user.id) {
              throw new CommentAuthorOnlyError();
            }

            const eventId = crypto.randomUUID();
            const now     = new Date();

            const result = updateComment({
              current,
              body:          input.body,
              actorId:       ctx.session.user.id as UserId,
              now,
              eventId,
              correlationId: input.correlationId,
            });

            if (result.noOp) {
              return { success: true, noOp: true as const };
            }

            await repo.update(ctx.infra.db, current.id, result.patch);
            await ctx.repos.outbox.append(
              ctx.infra.db,
              toOutboxEvent(result.event),
            );

            return { success: true, noOp: false as const };
          },
        );
      } catch (err) {
        throw toTRPCError(err);
      }
    }),

  // ──────────────────────────────────────────────────────────────────────────
  // delete — author OR board admin/owner (D5)
  // ──────────────────────────────────────────────────────────────────────────

  delete: boardProtectedProcedure
    .input(
      z.object({
        boardId:        IdSchema,
        commentId:      IdSchema,
        idempotencyKey: IdempotencyKeySchema,
        correlationId:  CorrelationIdSchema,
      }).strict(),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await withIdempotency(
          ctx.infra.db,
          ctx.repos.idempotency,
          input.idempotencyKey,
          async () => {
            const repo = new DrizzleCommentsRepository(ctx.infra.db);

            const current = await repo.findById(
              input.commentId as CommentId,
              { tx: ctx.infra.db, tenantId: ctx.session.tenantId },
            );
            if (!current) throw new CommentNotFoundError();

            // Topology guard
            if (current.boardId !== input.boardId) {
              throw new CommentCardMismatchError();
            }

            // Authorisation: author OR board admin/owner (D5)
            // boardMembership.role is populated by boardMemberGuard above
            const role      = (ctx as any).boardMembership?.role as string | undefined;
            const isAuthor  = current.authorId === ctx.session.user.id;
            const isAdmin   = role === "ADMIN" || role === "OWNER";
            if (!isAuthor && !isAdmin) {
              throw new TRPCError({
                code:    "FORBIDDEN",
                message: "فقط نویسنده‌ی کامنت یا مدیر برد می‌تواند آن را حذف کند.",
              });
            }

            const eventId = crypto.randomUUID();
            const now     = new Date();

            const { patch, event } = deleteComment({
              current,
              actorId:       ctx.session.user.id as UserId,
              now,
              eventId,
              correlationId: input.correlationId,
            });

            await repo.softDelete(ctx.infra.db, current.id, patch);
            await ctx.repos.outbox.append(
              ctx.infra.db,
              toOutboxEvent(event),
            );

            return { success: true as const };
          },
        );
      } catch (err) {
        throw toTRPCError(err);
      }
    }),
});
