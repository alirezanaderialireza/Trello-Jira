// packages/api/src/routers/card-features/checklists.router.ts
//
// Phase 1.2 (F1.2.3.a) — checklists & items router.
//
// Eight procedures, all RLS-enforced via boardProtectedProcedure
// (which composes loadShedding + ALS + observability + timeout + auth
// + tenant guard + tenantContextMiddleware + boardMemberGuard).
// Authorisation per F1.2.3.a D13: every mutation rides on
// boardProtectedProcedure (any board member may act); the delete
// endpoint adds an inline "creator OR admin/owner" check because the
// rule isn't a pure role assertion (same pattern as labels.update in
// F1.2.1).
//
// Replaces the F1.2.1-era stub which:
//   • used raw protectedProcedure (no board membership check)
//   • emitted no outbox events
//   • had no idempotency
//   • referenced a Drizzle relation `with: { items: true }` that was
//     never declared (would crash at runtime)
//
// Atomic outbox + idempotency mirror the labels router from F1.2.1.

import crypto from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, isNull } from "drizzle-orm";

import { router, boardProtectedProcedure } from "../../trpc";

import { DrizzleChecklistsRepository, cards } from "@repo/db";

import {
  // Use cases
  createChecklist,
  updateChecklist,
  deleteChecklist,
  addChecklistItem,
  updateChecklistItem,
  removeChecklistItem,
  // Domain types
  type ChecklistId,
  type ChecklistItemId,
  // Branded IDs
  type BoardId,
  type CardId,
  type MutationId,
  type TenantId,
  type UserId,
  // Domain errors
  CardNotFoundError,
  ChecklistCardMismatchError,
  ChecklistItemNotFoundError,
  ChecklistItemTextRequiredError,
  ChecklistItemTextTooLongError,
  ChecklistNotFoundError,
  ChecklistTitleRequiredError,
  ChecklistTitleTooLongError,
  DuplicateChecklistTitleError,
  // Ordering
  getNewPosition,
  // Outbox port shape
  type JsonObject,
  type OutboxEvent,
} from "@repo/domain";

// ============================================================================
// Zod schemas
// ============================================================================

const IdSchema             = z.string().uuid();
const IdempotencyKeySchema = z.string().uuid();
const TitleSchema          = z.string().min(1).max(100);
const TextSchema           = z.string().min(1).max(500);
const PositionSchema       = z.string().min(1).max(255);
const CorrelationIdSchema  = z.string().min(1).max(128).optional();

// ============================================================================
// Helpers
// ============================================================================

function toTRPCError(err: unknown): TRPCError {
  if (err instanceof ChecklistTitleRequiredError) {
    return new TRPCError({ code: "BAD_REQUEST", message: "عنوان چک‌لیست الزامی است." });
  }
  if (err instanceof ChecklistTitleTooLongError) {
    return new TRPCError({
      code:    "BAD_REQUEST",
      message: "عنوان چک‌لیست نباید از ۱۰۰ نویسه بیشتر باشد.",
    });
  }
  if (err instanceof DuplicateChecklistTitleError) {
    return new TRPCError({ code: "CONFLICT", message: "این عنوان چک‌لیست قبلاً در این کارت وجود دارد." });
  }
  if (err instanceof ChecklistItemTextRequiredError) {
    return new TRPCError({ code: "BAD_REQUEST", message: "متن مورد الزامی است." });
  }
  if (err instanceof ChecklistItemTextTooLongError) {
    return new TRPCError({
      code:    "BAD_REQUEST",
      message: "متن مورد نباید از ۵۰۰ نویسه بیشتر باشد.",
    });
  }
  if (err instanceof ChecklistNotFoundError) {
    return new TRPCError({ code: "NOT_FOUND", message: "چک‌لیست یافت نشد." });
  }
  if (err instanceof ChecklistItemNotFoundError) {
    return new TRPCError({ code: "NOT_FOUND", message: "مورد چک‌لیست یافت نشد." });
  }
  if (err instanceof CardNotFoundError) {
    return new TRPCError({ code: "NOT_FOUND", message: "کارت یافت نشد." });
  }
  if (err instanceof ChecklistCardMismatchError) {
    return new TRPCError({
      code:    "BAD_REQUEST",
      message: "چک‌لیست به این کارت تعلق ندارد.",
    });
  }
  if (err instanceof TRPCError) return err;
  throw err;
}

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

const IDEMPOTENCY_SCHEMA_VERSION = "checklists.v2";

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

export const checklistsRouter = router({
  // ──────────────────────────────────────────────────────────────────────────
  // list — checklists for a card
  // ──────────────────────────────────────────────────────────────────────────

  list: boardProtectedProcedure
    .input(z.object({ boardId: IdSchema, cardId: IdSchema }).strict())
    .query(async ({ input, ctx }) => {
      const repo = new DrizzleChecklistsRepository(ctx.infra.db);
      const list = await repo.findChecklistsByCardId(input.cardId as CardId, {
        tx:       ctx.infra.db,
        tenantId: ctx.session.tenantId,
      });

      return list.map((c) => ({
        id:        c.id,
        cardId:    c.cardId,
        boardId:   c.boardId,
        title:     c.title,
        position:  c.position,
        createdBy: c.createdBy,
        createdAt: c.createdAt.toISOString(),
        updatedAt: c.updatedAt.toISOString(),
      }));
    }),

  // ──────────────────────────────────────────────────────────────────────────
  // listItems — items for a checklist
  // ──────────────────────────────────────────────────────────────────────────

  listItems: boardProtectedProcedure
    .input(z.object({ boardId: IdSchema, checklistId: IdSchema }).strict())
    .query(async ({ input, ctx }) => {
      const repo = new DrizzleChecklistsRepository(ctx.infra.db);
      const items = await repo.findItemsByChecklistId(
        input.checklistId as ChecklistId,
        { tx: ctx.infra.db, tenantId: ctx.session.tenantId },
      );

      return items.map((i) => ({
        id:          i.id,
        checklistId: i.checklistId,
        text:        i.text,
        isDone:      i.isDone,
        position:    i.position,
        createdBy:   i.createdBy,
        createdAt:   i.createdAt.toISOString(),
        updatedAt:   i.updatedAt.toISOString(),
      }));
    }),

  // ──────────────────────────────────────────────────────────────────────────
  // create — any board member may create a checklist on a card
  // ──────────────────────────────────────────────────────────────────────────

  create: boardProtectedProcedure
    .input(
      z.object({
        boardId:        IdSchema,
        cardId:         IdSchema,
        title:          TitleSchema,
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
            const repo = new DrizzleChecklistsRepository(ctx.infra.db);

            // Verify the card exists and belongs to the input.boardId
            // (RLS prevents cross-tenant; this catches stale boardId).
            const cardRow = await ctx.infra.db.query.cards.findFirst({
              where: and(
                eq(cards.id, input.cardId),
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

            const existing = await repo.findChecklistsByCardId(
              input.cardId as CardId,
              { tx: ctx.infra.db, tenantId: ctx.session.tenantId },
            );

            const lastChecklist = existing[existing.length - 1];
            const lastPosition  = lastChecklist?.position;
            const newPosition   = getNewPosition(lastPosition, undefined);

            const existingTitlesLower = existing.map((c) =>
              c.title.toLocaleLowerCase("fa-IR"),
            );

            const newChecklistId = crypto.randomUUID() as ChecklistId;
            const eventId        = crypto.randomUUID();
            const now            = new Date();

            const { entity, event } = createChecklist({
              newChecklistId,
              tenantId:      ctx.session.tenantId as TenantId,
              cardId:        input.cardId as CardId,
              boardId:       input.boardId as BoardId,
              title:         input.title,
              position:      newPosition,
              createdBy:     ctx.session.user.id as UserId,
              now,
              existingTitlesLower,
              eventId,
              correlationId: input.correlationId,
            });

            await repo.createChecklist(ctx.infra.db, entity);
            await ctx.repos.outbox.append(
              ctx.infra.db,
              toOutboxEvent(event),
            );

            return {
              id:        entity.id,
              cardId:    entity.cardId,
              boardId:   entity.boardId,
              title:     entity.title,
              position:  entity.position,
              createdBy: entity.createdBy,
              createdAt: entity.createdAt.toISOString(),
              updatedAt: entity.updatedAt.toISOString(),
            };
          },
        );
      } catch (err) {
        throw toTRPCError(err);
      }
    }),

  // ──────────────────────────────────────────────────────────────────────────
  // updateChecklist — D12 reorder + rename via field mask
  // ──────────────────────────────────────────────────────────────────────────

  updateChecklist: boardProtectedProcedure
    .input(
      z.object({
        boardId:        IdSchema,
        checklistId:    IdSchema,
        title:          TitleSchema.optional(),
        position:       PositionSchema.optional(),
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
            const repo = new DrizzleChecklistsRepository(ctx.infra.db);

            const current = await repo.findChecklistById(
              input.checklistId as ChecklistId,
              { tx: ctx.infra.db, tenantId: ctx.session.tenantId },
            );
            if (!current) throw new ChecklistNotFoundError();

            // Topology guard.
            if (current.boardId !== input.boardId) {
              throw new TRPCError({
                code:    "BAD_REQUEST",
                message: "چک‌لیست به این برد تعلق ندارد.",
              });
            }

            // Resolve siblings for duplicate check (excluding self).
            const siblings = (
              await repo.findChecklistsByCardId(current.cardId, {
                tx:       ctx.infra.db,
                tenantId: ctx.session.tenantId,
              })
            ).filter((c) => c.id !== current.id);

            const otherExistingTitlesLower = siblings.map((c) =>
              c.title.toLocaleLowerCase("fa-IR"),
            );

            const eventId = crypto.randomUUID();
            const now     = new Date();

            const { patch, event, noOp } = updateChecklist({
              current,
              patch: {
                title:    input.title,
                position: input.position,
              },
              actorId:        ctx.session.user.id as UserId,
              now,
              eventId,
              correlationId:  input.correlationId,
              otherExistingTitlesLower,
            });

            if (noOp) {
              return { success: true, noOp: true as const };
            }

            await repo.updateChecklist(ctx.infra.db, current.id, patch);
            await ctx.repos.outbox.append(
              ctx.infra.db,
              toOutboxEvent(event),
            );

            return { success: true, noOp: false as const };
          },
        );
      } catch (err) {
        throw toTRPCError(err);
      }
    }),

  // ──────────────────────────────────────────────────────────────────────────
  // deleteChecklist — creator OR admin/owner (D13)
  // ──────────────────────────────────────────────────────────────────────────

  deleteChecklist: boardProtectedProcedure
    .input(
      z.object({
        boardId:        IdSchema,
        checklistId:    IdSchema,
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
            const repo = new DrizzleChecklistsRepository(ctx.infra.db);

            const current = await repo.findChecklistById(
              input.checklistId as ChecklistId,
              { tx: ctx.infra.db, tenantId: ctx.session.tenantId },
            );
            if (!current) throw new ChecklistNotFoundError();

            if (current.boardId !== input.boardId) {
              throw new TRPCError({
                code:    "BAD_REQUEST",
                message: "چک‌لیست به این برد تعلق ندارد.",
              });
            }

            // Authorisation — creator OR board admin/owner (D13).
            // Same inline-check pattern as labels.update; not a pure
            // role assertion so it doesn't fit boardAdminProcedure.
            const role     = (ctx as any).boardMembership?.role as string | undefined;
            const isCreator = current.createdBy === ctx.session.user.id;
            const isAdmin   = role === "ADMIN" || role === "OWNER";
            if (!isCreator && !isAdmin) {
              throw new TRPCError({
                code:    "FORBIDDEN",
                message:
                  "فقط سازنده‌ی چک‌لیست یا مدیر برد می‌تواند آن را حذف کند.",
              });
            }

            const affectedItemCount = await repo.countItemsByChecklistId(
              current.id,
              { tx: ctx.infra.db, tenantId: ctx.session.tenantId },
            );

            const eventId = crypto.randomUUID();
            const now     = new Date();

            const { event } = deleteChecklist({
              current,
              affectedItemCount,
              actorId:       ctx.session.user.id as UserId,
              now,
              eventId,
              correlationId: input.correlationId,
            });

            // Order: items first (so a concurrent SELECT inside the tx
            // never sees orphaned items pointing at a soft-deleted
            // checklist), then the soft-delete on the checklist
            // itself, then the outbox emit.
            await repo.hardDeleteItemsByChecklistId(ctx.infra.db, current.id);
            await repo.softDeleteChecklist(ctx.infra.db, current.id);
            await ctx.repos.outbox.append(
              ctx.infra.db,
              toOutboxEvent(event),
            );

            return { success: true as const, affectedItemCount };
          },
        );
      } catch (err) {
        throw toTRPCError(err);
      }
    }),

  // ──────────────────────────────────────────────────────────────────────────
  // addItem — append item to a checklist
  // ──────────────────────────────────────────────────────────────────────────

  addItem: boardProtectedProcedure
    .input(
      z.object({
        boardId:        IdSchema,
        checklistId:    IdSchema,
        text:           TextSchema,
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
            const repo = new DrizzleChecklistsRepository(ctx.infra.db);

            const checklist = await repo.findChecklistById(
              input.checklistId as ChecklistId,
              { tx: ctx.infra.db, tenantId: ctx.session.tenantId },
            );
            if (!checklist) throw new ChecklistNotFoundError();

            if (checklist.boardId !== input.boardId) {
              throw new TRPCError({
                code:    "BAD_REQUEST",
                message: "چک‌لیست به این برد تعلق ندارد.",
              });
            }

            const items = await repo.findItemsByChecklistId(checklist.id, {
              tx:       ctx.infra.db,
              tenantId: ctx.session.tenantId,
            });
            const lastItem     = items[items.length - 1];
            const lastPosition = lastItem?.position;
            const newPosition  = getNewPosition(lastPosition, undefined);

            const newItemId = crypto.randomUUID() as ChecklistItemId;
            const eventId   = crypto.randomUUID();
            const now       = new Date();

            const { entity, event } = addChecklistItem({
              newItemId,
              checklist,
              text:          input.text,
              position:      newPosition,
              addedBy:       ctx.session.user.id as UserId,
              now,
              eventId,
              correlationId: input.correlationId,
            });

            await repo.createItem(ctx.infra.db, entity);
            await ctx.repos.outbox.append(
              ctx.infra.db,
              toOutboxEvent(event),
            );

            return {
              id:          entity.id,
              checklistId: entity.checklistId,
              text:        entity.text,
              isDone:      entity.isDone,
              position:    entity.position,
              createdBy:   entity.createdBy,
              createdAt:   entity.createdAt.toISOString(),
              updatedAt:   entity.updatedAt.toISOString(),
            };
          },
        );
      } catch (err) {
        throw toTRPCError(err);
      }
    }),

  // ──────────────────────────────────────────────────────────────────────────
  // updateItem — toggle isDone (D10) / reorder (D11) / rename via field mask
  // ──────────────────────────────────────────────────────────────────────────

  updateItem: boardProtectedProcedure
    .input(
      z.object({
        boardId:         IdSchema,
        checklistItemId: IdSchema,
        text:            TextSchema.optional(),
        isDone:          z.boolean().optional(),
        position:        PositionSchema.optional(),
        idempotencyKey:  IdempotencyKeySchema,
        correlationId:   CorrelationIdSchema,
      }).strict(),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await withIdempotency(
          ctx.infra.db,
          ctx.repos.idempotency,
          input.idempotencyKey,
          async () => {
            const repo = new DrizzleChecklistsRepository(ctx.infra.db);

            const item = await repo.findItemById(
              input.checklistItemId as ChecklistItemId,
              { tx: ctx.infra.db, tenantId: ctx.session.tenantId },
            );
            if (!item) throw new ChecklistItemNotFoundError();

            const checklist = await repo.findChecklistById(item.checklistId, {
              tx:       ctx.infra.db,
              tenantId: ctx.session.tenantId,
            });
            if (!checklist) throw new ChecklistNotFoundError();

            if (checklist.boardId !== input.boardId) {
              throw new TRPCError({
                code:    "BAD_REQUEST",
                message: "چک‌لیست به این برد تعلق ندارد.",
              });
            }

            const eventId = crypto.randomUUID();
            const now     = new Date();

            const { patch, event, noOp } = updateChecklistItem({
              current:   item,
              checklist,
              patch: {
                text:     input.text,
                isDone:   input.isDone,
                position: input.position,
              },
              actorId:        ctx.session.user.id as UserId,
              now,
              eventId,
              correlationId:  input.correlationId,
            });

            if (noOp) {
              return { success: true, noOp: true as const };
            }

            await repo.updateItem(ctx.infra.db, item.id, patch);
            await ctx.repos.outbox.append(
              ctx.infra.db,
              toOutboxEvent(event),
            );

            return { success: true, noOp: false as const };
          },
        );
      } catch (err) {
        throw toTRPCError(err);
      }
    }),

  // ──────────────────────────────────────────────────────────────────────────
  // removeItem — delete an item
  // ──────────────────────────────────────────────────────────────────────────

  removeItem: boardProtectedProcedure
    .input(
      z.object({
        boardId:         IdSchema,
        checklistItemId: IdSchema,
        idempotencyKey:  IdempotencyKeySchema,
        correlationId:   CorrelationIdSchema,
      }).strict(),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await withIdempotency(
          ctx.infra.db,
          ctx.repos.idempotency,
          input.idempotencyKey,
          async () => {
            const repo = new DrizzleChecklistsRepository(ctx.infra.db);

            const item = await repo.findItemById(
              input.checklistItemId as ChecklistItemId,
              { tx: ctx.infra.db, tenantId: ctx.session.tenantId },
            );
            if (!item) throw new ChecklistItemNotFoundError();

            const checklist = await repo.findChecklistById(item.checklistId, {
              tx:       ctx.infra.db,
              tenantId: ctx.session.tenantId,
            });
            if (!checklist) throw new ChecklistNotFoundError();

            if (checklist.boardId !== input.boardId) {
              throw new TRPCError({
                code:    "BAD_REQUEST",
                message: "چک‌لیست به این برد تعلق ندارد.",
              });
            }

            const eventId = crypto.randomUUID();
            const now     = new Date();

            const { event } = removeChecklistItem({
              item,
              checklist,
              actorId:       ctx.session.user.id as UserId,
              now,
              eventId,
              correlationId: input.correlationId,
            });

            await repo.removeItem(ctx.infra.db, item.id);
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
