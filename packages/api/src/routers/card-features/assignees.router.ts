// packages/api/src/routers/card-features/assignees.router.ts
//
// Phase 1.2 (F1.2.5) — Card Assignees router.
//
// Fixes the Phase-4 stub which wired boardApi → cardApi.addAssignee /
// cardApi.removeAssignee — those routes never existed and crashed at runtime.
//
// API surface (mounted at v1.public.cardAssignee.*):
//   list({ boardId, cardId })                                  → AssigneeDto[]
//   addAssignee({ boardId, cardId, assigneeId, idempotencyKey }) → { success, assignee }
//   removeAssignee({ boardId, cardId, assigneeId, idempotencyKey }) → { success }
//   listMyCards({ boardId? })                                  → { cardIds: string[] }
//
// All four on boardProtectedProcedure.

import crypto from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, isNull } from "drizzle-orm";

import { router, boardProtectedProcedure } from "../../trpc";
import { DrizzleCardAssigneesRepository, cards, cardAssignees } from "@repo/db";

import {
  addAssigneeToCard,
  removeAssigneeFromCard,
  AlreadyAssignedError,
  AssigneeNotBoardMemberError,
  CardLockedAssigneeError,
  MaxAssigneesError,
  NotAssignedError,
  CardNotFoundError,
  type CardId,
  type BoardId,
  type TenantId,
  type UserId,
  type AssigneeId,
  type MutationId,
  type JsonObject,
  type OutboxEvent,
} from "@repo/domain";

// ============================================================================
// Schemas
// ============================================================================

const IdSchema             = z.string().uuid();
const UserIdSchema         = z.string().min(1).max(128);
const IdempotencyKeySchema = z.string().uuid();
const CorrelationIdSchema  = z.string().min(1).max(128).optional();

// ============================================================================
// Helpers
// ============================================================================

function toTRPCError(err: unknown): TRPCError {
  if (err instanceof AssigneeNotBoardMemberError) {
    return new TRPCError({ code: "BAD_REQUEST", message: "کاربر عضو این برد نیست." });
  }
  if (err instanceof AlreadyAssignedError) {
    return new TRPCError({ code: "CONFLICT", message: "این کاربر قبلاً به کارت اضافه شده." });
  }
  if (err instanceof NotAssignedError) {
    return new TRPCError({ code: "NOT_FOUND", message: "این کاربر به این کارت اختصاص نیافته." });
  }
  if (err instanceof MaxAssigneesError) {
    return new TRPCError({
      code: "BAD_REQUEST",
      message: `تعداد مسئولین کارت از حد مجاز (${err.max}) بیشتر است.`,
    });
  }
  if (err instanceof CardLockedAssigneeError) {
    return new TRPCError({
      code: "FORBIDDEN",
      message: "این کارت قفل است؛ فقط مدیر می‌تواند مسئول را تغییر دهد.",
    });
  }
  if (err instanceof CardNotFoundError) {
    return new TRPCError({ code: "NOT_FOUND", message: "کارت یافت نشد." });
  }
  if (err instanceof TRPCError) return err;
  throw err;
}

function toOutboxEvent(ev: {
  id: string; type: string; version: number; schemaVersion?: number;
  occurredAt: string; aggregateId: string; aggregateType: string;
  payload: Readonly<Record<string, unknown>>;
  correlationId?: string; causationId?: string; sequence?: number;
}): OutboxEvent {
  return {
    eventId:       ev.id,
    type:          ev.type,
    aggregateId:   ev.aggregateId,
    aggregateType: ev.aggregateType,
    eventVersion:  `v${ev.schemaVersion ?? ev.version}`,
    occurredAt:    new Date(ev.occurredAt),
    payload:       ev.payload as JsonObject,
    correlationId: ev.correlationId,
    causationId:   ev.causationId,
    sequence:      ev.sequence,
  };
}

const IDEMPOTENCY_SCHEMA_VERSION = "card-assignees.v2";

async function withIdempotency<T>(
  tx: any,
  idempotencyRepo: { findByMutationId: (tx: any, id: any) => Promise<any>; save: (tx: any, rec: any) => Promise<void> },
  mutationId: string,
  work: () => Promise<T>,
): Promise<T> {
  const existing = await idempotencyRepo.findByMutationId(tx, mutationId as MutationId);
  if (existing) return existing.response as T;
  const response = await work();
  await idempotencyRepo.save(tx, {
    mutationId: mutationId as MutationId,
    response:   response as unknown,
    schemaVersion: IDEMPOTENCY_SCHEMA_VERSION,
    createdAt: new Date(),
  });
  return response;
}

// ============================================================================
// Router
// ============================================================================

export const assigneesRouter = router({

  // ── list ────────────────────────────────────────────────────────────────

  list: boardProtectedProcedure
    .input(z.object({ boardId: IdSchema, cardId: IdSchema }).strict())
    .query(async ({ input, ctx }) => {
      const repo = new DrizzleCardAssigneesRepository(ctx.infra.db);
      const assignees = await repo.findByCardIdWithUsers(
        input.cardId as CardId,
        { tx: ctx.infra.db, tenantId: ctx.session.tenantId },
      );
      return assignees;
    }),

  // ── addAssignee ─────────────────────────────────────────────────────────

  addAssignee: boardProtectedProcedure
    .input(
      z.object({
        boardId:        IdSchema,
        cardId:         IdSchema,
        assigneeId:     UserIdSchema,
        idempotencyKey: IdempotencyKeySchema,
        correlationId:  CorrelationIdSchema,
      }).strict(),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await withIdempotency(
          ctx.infra.db, ctx.repos.idempotency, input.idempotencyKey,
          async () => {
            const repo = new DrizzleCardAssigneesRepository(ctx.infra.db);

            // Topology guard: card must exist and belong to boardId.
            const cardRow = await ctx.infra.db.query.cards.findFirst({
              where: and(
                eq(cards.id, input.cardId),
                eq(cards.tenantId, ctx.session.tenantId),
                isNull(cards.deletedAt),
              ),
              columns: { id: true, boardId: true, isLocked: true },
            });
            if (!cardRow) throw new CardNotFoundError();
            if (cardRow.boardId !== input.boardId) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "کارت به این برد تعلق ندارد." });
            }

            const [isBoardMember, isAlreadyAssigned, currentCount] = await Promise.all([
              repo.isBoardMember(input.boardId as BoardId, input.assigneeId as AssigneeId, { tx: ctx.infra.db }),
              repo.isAssigned(input.cardId as CardId, input.assigneeId as AssigneeId, { tx: ctx.infra.db, tenantId: ctx.session.tenantId }),
              repo.countByCardId(input.cardId as CardId, { tx: ctx.infra.db, tenantId: ctx.session.tenantId }),
            ]);

            const role = (ctx as any).boardMembership?.role as string ?? "MEMBER";
            const eventId = crypto.randomUUID();
            const now = new Date();

            const { entity, event } = addAssigneeToCard({
              cardId:            input.cardId  as CardId,
              boardId:           input.boardId as BoardId,
              tenantId:          ctx.session.tenantId as TenantId,
              assigneeId:        input.assigneeId as UserId,
              assignedBy:        ctx.session.user.id as UserId,
              isCardLocked:      cardRow.isLocked ?? false,
              callerRole:        role,
              isAlreadyAssigned,
              isBoardMember,
              currentCount,
              now,
              eventId,
              correlationId: input.correlationId,
            });

            await repo.create(ctx.infra.db, entity);
            await ctx.repos.outbox.append(ctx.infra.db, toOutboxEvent(event));

            // Return assignee details for optimistic UI confirmation.
            const assignees = await repo.findByCardIdWithUsers(
              input.cardId as CardId,
              { tx: ctx.infra.db, tenantId: ctx.session.tenantId },
            );
            const assignee = assignees.find((a) => a.userId === input.assigneeId) ?? {
              userId: input.assigneeId, displayName: "کاربر", avatarUrl: null, email: "", assignedAt: now.toISOString(),
            };

            return { success: true as const, assignee };
          },
        );
      } catch (err) {
        throw toTRPCError(err);
      }
    }),

  // ── removeAssignee ──────────────────────────────────────────────────────

  removeAssignee: boardProtectedProcedure
    .input(
      z.object({
        boardId:        IdSchema,
        cardId:         IdSchema,
        assigneeId:     UserIdSchema,
        idempotencyKey: IdempotencyKeySchema,
        correlationId:  CorrelationIdSchema,
      }).strict(),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await withIdempotency(
          ctx.infra.db, ctx.repos.idempotency, input.idempotencyKey,
          async () => {
            const repo = new DrizzleCardAssigneesRepository(ctx.infra.db);

            // Topology guard.
            const cardRow = await ctx.infra.db.query.cards.findFirst({
              where: and(
                eq(cards.id, input.cardId),
                eq(cards.tenantId, ctx.session.tenantId),
                isNull(cards.deletedAt),
              ),
              columns: { id: true, boardId: true, isLocked: true },
            });
            if (!cardRow) throw new CardNotFoundError();
            if (cardRow.boardId !== input.boardId) {
              throw new TRPCError({ code: "BAD_REQUEST", message: "کارت به این برد تعلق ندارد." });
            }

            const isAssigned = await repo.isAssigned(
              input.cardId as CardId,
              input.assigneeId as AssigneeId,
              { tx: ctx.infra.db, tenantId: ctx.session.tenantId },
            );

            const role = (ctx as any).boardMembership?.role as string ?? "MEMBER";
            const eventId = crypto.randomUUID();
            const now = new Date();

            const { event } = removeAssigneeFromCard({
              cardId:       input.cardId  as CardId,
              boardId:      input.boardId as BoardId,
              tenantId:     ctx.session.tenantId as TenantId,
              assigneeId:   input.assigneeId as UserId,
              removedBy:    ctx.session.user.id as UserId,
              isCardLocked: cardRow.isLocked ?? false,
              callerRole:   role,
              isAssigned,
              now,
              eventId,
              correlationId: input.correlationId,
            });

            await repo.delete(ctx.infra.db, input.cardId as CardId, input.assigneeId as AssigneeId);
            await ctx.repos.outbox.append(ctx.infra.db, toOutboxEvent(event));

            return { success: true as const };
          },
        );
      } catch (err) {
        throw toTRPCError(err);
      }
    }),

  // ── listMyCards — for F1.5 sidebar filter ──────────────────────────────

  listMyCards: boardProtectedProcedure
    .input(z.object({ boardId: IdSchema }).strict())
    .query(async ({ input, ctx }) => {
      const rows = await ctx.infra.db
        .select({ cardId: cardAssignees.cardId })
        .from(cardAssignees)
        .where(
          and(
            eq(cardAssignees.userId,   ctx.session.user.id),
            eq(cardAssignees.tenantId, ctx.session.tenantId),
          ),
        );
      return { cardIds: rows.map((r: any) => r.cardId as string) };
    }),
});
