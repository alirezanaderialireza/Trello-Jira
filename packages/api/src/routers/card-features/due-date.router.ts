// packages/api/src/routers/card-features/due-date.router.ts
//
// Phase 1.2 (F1.2.2) — card due-date router.
//
// One procedure (`setDueDate`) that handles both set and clear:
//   • dueDate: "YYYY-MM-DD" → set
//   • dueDate: null         → clear
// Replaces the F1.2.1-era stub which:
//   • Stored the date inside `cards.accounting_data` JSONB (JSON-typed
//     escape hatch) instead of a real column.
//   • Used the wrong wire format (ISO datetime, not DateOnly).
//   • Ran on raw `protectedProcedure` (no board-membership guard).
//   • Emitted no outbox event.
//   • Was unreachable from the live UI — `boardApi.updateCardDueDate`
//     called `cardApi.updateDueDate` which doesn't exist on the card
//     router. Audit in the F1.2.2 PR description.
//
// New router properties (mirror the F1.2.1 labels router):
//   • boardProtectedProcedure for read + write (D6 — any board member
//     may set or clear).
//   • Atomic outbox: the cards.due_date update + outbox emit run on
//     the same RLS-enforced ctx.infra.db (the tx the
//     tenantContextMiddleware opens).
//   • idempotencyKey (UUID) per mutation — replays return the cached
//     response instead of re-executing.
//   • Topology guard: the use case rejects a cardId whose card.boardId
//     doesn't match the input.boardId; RLS is the second layer.
//   • Persian error messages with English machine codes.

import crypto from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, isNull } from "drizzle-orm";

import { router, boardProtectedProcedure } from "../../trpc";

import { cards } from "@repo/db";

import {
  setCardDueDate,
  type BoardId,
  type CardId,
  type DateOnly,
  type MutationId,
  type TenantId,
  type UserId,
  type JsonObject,
  type OutboxEvent,
} from "@repo/domain";

// ============================================================================
// Zod schemas
// ============================================================================

const IdSchema             = z.string().uuid();
const IdempotencyKeySchema = z.string().uuid();

// DateOnly wire format: strict YYYY-MM-DD. Empty string is rejected;
// callers signal "clear" by sending null. The use case re-validates
// equality semantics; this regex is the first wall against unparseable
// payloads.
const DateOnlyWireSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "INVALID_DATE_FORMAT")
  .nullable();

const SetDueDateInputSchema = z
  .object({
    cardId:         IdSchema,
    boardId:        IdSchema, // required by boardMemberGuard
    dueDate:        DateOnlyWireSchema,
    idempotencyKey: IdempotencyKeySchema,
    correlationId:  z.string().min(1).max(128).optional(),
  })
  .strict();

// ============================================================================
// toOutboxEvent — domain event → OutboxEvent shape
// ============================================================================
// Mirrors the helper in labels.router.ts so a single mental model
// applies across card-features routers. Differences vs. inline:
// `version` field is the legacy aggregate-version on DomainEvent base;
// `schemaVersion` is the semantic payload version (2 for F1.2.2).

function toOutboxEvent(domainEvent: {
  id: string;
  type: string;
  version: number;
  schemaVersion?: number;
  occurredAt: string;
  aggregateId: string;
  aggregateType: string;
  payload: Readonly<Record<string, unknown>>;
  correlationId?: string;
  causationId?: string;
  sequence?: number;
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

const IDEMPOTENCY_SCHEMA_VERSION = "card.due_date.v2";

/**
 * Idempotency wrapper. Pulled out of labels.router.ts as a local copy
 * — labels' helper isn't exported, and hoisting it to a shared utility
 * is out of scope for F1.2.2 (Master Contract Rule 4). Both copies
 * share the same shape, so a future shared `withIdempotency`
 * extraction can replace both.
 */
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

export const dueDateRouter = router({
  // ──────────────────────────────────────────────────────────────────────────
  // setDueDate — set or clear the due date on a card
  // ──────────────────────────────────────────────────────────────────────────
  setDueDate: boardProtectedProcedure
    .input(SetDueDateInputSchema)
    .mutation(async ({ input, ctx }) => {
      return await withIdempotency(
        ctx.infra.db,
        ctx.repos.idempotency,
        input.idempotencyKey,
        async () => {
          // Load the card. The query is RLS-enforced via
          // tenantContextMiddleware (ctx.infra.db is the tx with the
          // GUC set), so cross-tenant rows are unreachable.
          const cardRow = await ctx.infra.db.query.cards.findFirst({
            where: and(
              eq(cards.id, input.cardId),
              eq(cards.tenantId, ctx.session.tenantId),
              isNull(cards.deletedAt),
            ),
            columns: {
              id:       true,
              boardId:  true,
              tenantId: true,
              dueDate:  true,
            },
          });
          if (!cardRow) {
            throw new TRPCError({
              code:    "NOT_FOUND",
              message: "کارت یافت نشد.",
            });
          }

          // Topology guard — defence-in-depth alongside RLS. If the
          // client sends a cardId whose card.boardId doesn't match the
          // input.boardId, refuse: the boardMemberGuard validated
          // membership on input.boardId, not on card.boardId.
          if (cardRow.boardId !== input.boardId) {
            throw new TRPCError({
              code:    "BAD_REQUEST",
              message: "کارت به این برد تعلق ندارد.",
            });
          }

          // Drizzle's `date()` column reads back as a `string`
          // (YYYY-MM-DD) | null, which is exactly the DateOnly wire
          // shape. Brand it for the use case.
          const currentDueDate = (cardRow.dueDate ?? null) as DateOnly | null;
          const newDueDate     = (input.dueDate ?? null)   as DateOnly | null;

          const eventId = crypto.randomUUID();
          const now     = new Date();

          const result = setCardDueDate({
            card: {
              id:       cardRow.id       as CardId,
              boardId:  cardRow.boardId  as BoardId,
              tenantId: cardRow.tenantId as TenantId,
              dueDate:  currentDueDate,
            },
            newDueDate,
            actorId:       ctx.session.user.id as UserId,
            now,
            eventId,
            correlationId: input.correlationId,
          });

          if (result.noOp) {
            // No change — return the current value to keep client
            // optimistic state correct without re-emitting an event.
            return {
              success: true as const,
              noOp:    true as const,
              dueDate: currentDueDate,
            };
          }

          // Atomic write + outbox emit on the same tx.
          await ctx.infra.db
            .update(cards)
            .set({
              dueDate:   result.patch.dueDate,
              updatedAt: now,
            })
            .where(eq(cards.id, cardRow.id));

          await ctx.repos.outbox.append(
            ctx.infra.db,
            toOutboxEvent(result.event),
          );

          return {
            success: true as const,
            noOp:    false as const,
            dueDate: result.patch.dueDate,
          };
        },
      );
    }),
});
