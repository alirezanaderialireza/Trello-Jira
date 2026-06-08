// packages/api/src/routers/card-features/cover.router.ts
//
// Phase 1.2 (F1.2.7) — Card Cover router.
// One procedure: setCover (set or clear the color/gradient cover).
// Exact mirror of due-date.router.ts pattern.

import crypto from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, isNull } from "drizzle-orm";

import { router, boardProtectedProcedure } from "../../trpc";
import { cards } from "@repo/db";

import {
  setCardCover,
  type CardId,
  type BoardId,
  type TenantId,
  type UserId,
  type MutationId,
  type JsonObject,
  type OutboxEvent,
  type CoverData,
} from "@repo/domain";

// ============================================================================
// Schemas
// ============================================================================

const CoverDataSchema = z.object({
  type: z.enum(["color", "gradient"]),
  id:   z.string().min(1).max(64),
}).nullable();

const SetCoverInputSchema = z.object({
  cardId:         z.string().uuid(),
  boardId:        z.string().uuid(),
  coverData:      CoverDataSchema,
  idempotencyKey: z.string().uuid(),
  correlationId:  z.string().min(1).max(128).optional(),
}).strict();

// ============================================================================
// Helpers (mirrors due-date.router.ts exactly)
// ============================================================================

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

const IDEMPOTENCY_SCHEMA_VERSION = "card.cover.v2";

async function withIdempotency<T>(
  tx: any,
  idempotencyRepo: {
    findByMutationId: (tx: any, id: any) => Promise<any>;
    save:             (tx: any, rec: any) => Promise<void>;
  },
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

export const coverRouter = router({
  setCover: boardProtectedProcedure
    .input(SetCoverInputSchema)
    .mutation(async ({ input, ctx }) => {
      return await withIdempotency(
        ctx.infra.db,
        ctx.repos.idempotency,
        input.idempotencyKey,
        async () => {
          const cardRow = await ctx.infra.db.query.cards.findFirst({
            where: and(
              eq(cards.id,       input.cardId),
              eq(cards.tenantId, ctx.session.tenantId),
              isNull(cards.deletedAt),
            ),
            columns: { id: true, boardId: true, tenantId: true, coverData: true },
          });

          if (!cardRow) {
            throw new TRPCError({ code: "NOT_FOUND", message: "کارت یافت نشد." });
          }
          if (cardRow.boardId !== input.boardId) {
            throw new TRPCError({ code: "BAD_REQUEST", message: "کارت به این برد تعلق ندارد." });
          }

          const currentCover = (cardRow.coverData ?? null) as CoverData | null;
          const newCover     = input.coverData as CoverData | null;

          const eventId = crypto.randomUUID();
          const now     = new Date();

          const result = setCardCover({
            card: {
              id:        cardRow.id       as CardId,
              boardId:   cardRow.boardId  as BoardId,
              tenantId:  cardRow.tenantId as TenantId,
              coverData: currentCover,
            },
            newCover,
            actorId:       ctx.session.user.id as UserId,
            now,
            eventId,
            correlationId: input.correlationId,
          });

          if (result.noOp) {
            return { success: true as const, noOp: true as const, coverData: currentCover };
          }

          await ctx.infra.db
            .update(cards)
            .set({ coverData: result.patch.coverData, updatedAt: now })
            .where(eq(cards.id, cardRow.id));

          await ctx.repos.outbox.append(ctx.infra.db, toOutboxEvent(result.event));

          return { success: true as const, noOp: false as const, coverData: result.patch.coverData };
        },
      );
    }),
});
