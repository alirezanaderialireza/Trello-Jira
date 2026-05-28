// packages/api/src/routers/card-features/labels.router.ts
//
// Phase 1.2 (F1.2.1) — labels & card-label junction router.
//
// Six procedures, all RLS-enforced via boardProtectedProcedure (which
// composes loadShedding + ALS + observability + timeout + auth + tenant
// guard + tenantContextMiddleware + boardMemberGuard). Mutations either
// stay on boardProtectedProcedure with an inline rule (`update` —
// creator OR admin) or upgrade to `boardAdminProcedure` (`delete`).
//
// Every mutation:
//   • Accepts an `idempotencyKey` (UUID) and short-circuits to the
//     stored response on retry — survives client reconnects, queue
//     replays, and the realtime patch loop.
//   • Emits its outbox event in the SAME transaction as the DB write
//     (atomic-outbox pattern). The `tenantContextMiddleware` already
//     opened the tx and swapped `ctx.infra.db` to point at it; both
//     repository writes and `ctx.repos.outbox.append(ctx.infra.db, …)`
//     therefore share the same handle.
//
// Note on ctx typing: tenantContextMiddleware opens the tx via
// `ctx.runInTenantTx(cb)`, whose generic return type erases the
// ctx-extension at the type level. Runtime-only fields (`ctx.infra.db`,
// `ctx.boardMembership`, `ctx.resolveBoardWorkspaceId`) survive in the
// procedure handler but tsc doesn't see them. The codebase convention
// — followed e.g. by board-management.ts and board-members.ts — is to
// reach for `ctx.infra.db` (which the same middleware swaps to the tx)
// for DB access and to cast `(ctx as any).boardMembership` for the
// role check. We keep that convention here.
//   • Translates `LabelDomainError`s into `TRPCError` with English code
//     + Persian message — the `code` is what programs branch on, the
//     `message` is what the toast surfaces (D8/D11/D14 contract).
//
// Position is generated server-side on `create` for simplicity (no
// duplicate-position races) and accepted client-side on `update` so
// drag-and-drop reorder in F1.2.1.b can compute LexoRank locally for
// optimistic UI.

import crypto from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, isNull } from "drizzle-orm";

import {
  router,
  boardProtectedProcedure,
  boardAdminProcedure,
} from "../../trpc";

import { DrizzleLabelsRepository, cards } from "@repo/db";

import {
  // Use cases
  createLabel,
  updateLabel,
  deleteLabel,
  applyLabelToCard,
  removeLabelFromCard,
  // Domain types
  COLOR_TOKENS,
  type LabelId,
  // Branded IDs
  type BoardId,
  type CardId,
  type MutationId,
  type TenantId,
  type UserId,
  // Domain errors
  CardNotFoundError,
  DuplicateLabelNameError,
  InvalidColorTokenError,
  LabelBoardMismatchError,
  LabelNameRequiredError,
  LabelNameTooLongError,
  LabelNotFoundError,
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
// `z.enum` over the canonical token list gives compile-time exhaustiveness:
// adding a token to COLOR_TOKENS surfaces every place it must be wired.
const ColorTokenSchema     = z.enum(COLOR_TOKENS);
const NameSchema           = z.string().min(1).max(50);
const PositionSchema       = z.string().min(1).max(255);

// ============================================================================
// Helpers
// ============================================================================

/**
 * Translates a domain error into a TRPCError. Each branch carries the
 * English machine code (for client-side conditional handling) and a
 * Persian human message (for the toast). This is the only place where
 * the cross-tier mapping lives so a future error rename touches one
 * file, not seven.
 */
function toTRPCError(err: unknown): TRPCError {
  if (err instanceof LabelNameRequiredError) {
    return new TRPCError({ code: "BAD_REQUEST", message: "نام برچسب الزامی است." });
  }
  if (err instanceof LabelNameTooLongError) {
    return new TRPCError({
      code:    "BAD_REQUEST",
      message: "نام برچسب نباید از ۵۰ کاراکتر بیشتر باشد.",
    });
  }
  if (err instanceof DuplicateLabelNameError) {
    return new TRPCError({ code: "CONFLICT", message: "این نام برچسب قبلاً وجود دارد." });
  }
  if (err instanceof InvalidColorTokenError) {
    return new TRPCError({ code: "BAD_REQUEST", message: "رنگ انتخابی نامعتبر است." });
  }
  if (err instanceof LabelNotFoundError) {
    return new TRPCError({ code: "NOT_FOUND", message: "برچسب یافت نشد." });
  }
  if (err instanceof CardNotFoundError) {
    return new TRPCError({ code: "NOT_FOUND", message: "کارت یافت نشد." });
  }
  if (err instanceof LabelBoardMismatchError) {
    return new TRPCError({
      code:    "BAD_REQUEST",
      message: "برچسب به این برد تعلق ندارد.",
    });
  }
  // Re-throw unknown errors unchanged so the global error formatter
  // surfaces a stack trace in development and a redacted INTERNAL in prod.
  if (err instanceof TRPCError) return err;
  throw err;
}

/**
 * Maps a domain event (from a use-case output) into the OutboxEvent
 * shape consumed by `repos.outbox.append`. The two interfaces are
 * structurally similar but differ in field naming
 * (`id` vs `eventId`, `version` vs `eventVersion`) and in
 * `occurredAt` (ISO string vs Date).
 */
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

const IDEMPOTENCY_SCHEMA_VERSION = "labels.v2";

/**
 * Idempotency wrapper used by every mutation. Looks up the prior
 * response by `mutationId` inside the same RLS-enforced tx; on miss,
 * runs `work()` and persists its return value. The `idempotency_keys`
 * table has no tenant_id (it's globally unique by mutationId), so the
 * lookup is unaffected by RLS — this is intentional and matches the
 * existing pattern from BoardService.
 *
 * Takes the tx and the idempotency repo as explicit arguments instead
 * of pulling them off `ctx`, because tenantContextMiddleware's
 * `runInTenantTx` wrapper opaque-ifies the ctx extension at the type
 * level (ctx.infra.db exists at runtime but isn't visible to tsc). Callers
 * pass `ctx.infra.db` and `ctx.repos.idempotency` — both surface
 * through the standard middleware chain.
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
  if (existing) {
    return existing.response as T;
  }

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

export const labelsRouter = router({
  // ──────────────────────────────────────────────────────────────────────────
  // list — board-scoped read
  // ──────────────────────────────────────────────────────────────────────────

  list: boardProtectedProcedure
    .input(z.object({ boardId: IdSchema }).strict())
    .query(async ({ input, ctx }) => {
      const repo   = new DrizzleLabelsRepository(ctx.infra.db);
      const labels = await repo.findByBoardId(input.boardId as BoardId, {
        tx:       ctx.infra.db,
        tenantId: ctx.session.tenantId,
      });

      // Strip Date objects from the wire — superjson handles them, but
      // serialising explicitly keeps the contract obvious to readers.
      return labels.map((l) => ({
        id:         l.id,
        boardId:    l.boardId,
        name:       l.name,
        colorToken: l.colorToken,
        position:   l.position,
        createdBy:  l.createdBy,
        createdAt:  l.createdAt.toISOString(),
        updatedAt:  l.updatedAt.toISOString(),
      }));
    }),

  // ──────────────────────────────────────────────────────────────────────────
  // listByCard — labels currently applied to a specific card
  // ──────────────────────────────────────────────────────────────────────────
  // Kept as a convenience read for the card-detail UI. Joins through
  // card_labels → labels with the labels.deleted_at filter, so a card
  // that referenced a soft-deleted label cleanly drops it from the
  // result without the UI having to know.

  listByCard: boardProtectedProcedure
    .input(z.object({ boardId: IdSchema, cardId: IdSchema }).strict())
    .query(async ({ input, ctx }) => {
      const repo   = new DrizzleLabelsRepository(ctx.infra.db);
      const labels = await repo.findCardLabelsByCardId(input.cardId as CardId, {
        tx:       ctx.infra.db,
        tenantId: ctx.session.tenantId,
      });
      return labels.map((l) => ({
        id:         l.id,
        boardId:    l.boardId,
        name:       l.name,
        colorToken: l.colorToken,
        position:   l.position,
      }));
    }),

  // ──────────────────────────────────────────────────────────────────────────
  // create — any board member may create a new label
  // ──────────────────────────────────────────────────────────────────────────

  create: boardProtectedProcedure
    .input(
      z.object({
        boardId:        IdSchema,
        name:           NameSchema,
        colorToken:     ColorTokenSchema,
        idempotencyKey: IdempotencyKeySchema,
        correlationId:  z.string().min(1).max(128).optional(),
      }).strict(),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await withIdempotency(ctx.infra.db, ctx.repos.idempotency, input.idempotencyKey, async () => {
          const repo = new DrizzleLabelsRepository(ctx.infra.db);

          // Resolve existing labels — needed for case-insensitive
          // duplicate detection AND for choosing the next LexoRank
          // position (append at the end).
          const existing = await repo.findByBoardId(input.boardId as BoardId, {
            tx:       ctx.infra.db,
            tenantId: ctx.session.tenantId,
          });

          const lastLabel    = existing[existing.length - 1];
          const lastPosition = lastLabel?.position;
          const newPosition  = getNewPosition(lastPosition, undefined);

          const existingNamesLower = existing.map((l) =>
            l.name.toLocaleLowerCase("fa-IR"),
          );

          const newLabelId = crypto.randomUUID() as LabelId;
          const eventId    = crypto.randomUUID();
          const now        = new Date();

          const { entity, event } = createLabel({
            newLabelId,
            tenantId:           ctx.session.tenantId as TenantId,
            boardId:            input.boardId as BoardId,
            name:               input.name,
            colorToken:         input.colorToken,
            position:           newPosition,
            createdBy:          ctx.session.user.id as UserId,
            now,
            existingNamesLower,
            eventId,
            correlationId:      input.correlationId,
          });

          // Atomic write + outbox emit ───────────────────────────────────
          await repo.create(ctx.infra.db, entity);
          await ctx.repos.outbox.append(ctx.infra.db, toOutboxEvent(event));

          return {
            id:         entity.id,
            boardId:    entity.boardId,
            name:       entity.name,
            colorToken: entity.colorToken,
            position:   entity.position,
            createdBy:  entity.createdBy,
            createdAt:  entity.createdAt.toISOString(),
            updatedAt:  entity.updatedAt.toISOString(),
          };
        });
      } catch (err) {
        throw toTRPCError(err);
      }
    }),

  // ──────────────────────────────────────────────────────────────────────────
  // update — creator OR board admin (D8)
  // ──────────────────────────────────────────────────────────────────────────
  // The role check stays inline because "creator OR admin" is not a
  // pure role assertion and doesn't fit the boardAdminProcedure
  // pattern. Order: load current label first, then check
  // `current.createdBy === actor || role admin-grade`.

  update: boardProtectedProcedure
    .input(
      z.object({
        labelId:        IdSchema,
        name:           NameSchema.optional(),
        colorToken:     ColorTokenSchema.optional(),
        position:       PositionSchema.optional(),
        idempotencyKey: IdempotencyKeySchema,
        correlationId:  z.string().min(1).max(128).optional(),
      }).strict(),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await withIdempotency(ctx.infra.db, ctx.repos.idempotency, input.idempotencyKey, async () => {
          const repo = new DrizzleLabelsRepository(ctx.infra.db);

          const current = await repo.findById(input.labelId as LabelId, {
            tx:       ctx.infra.db,
            tenantId: ctx.session.tenantId,
          });
          if (!current) throw new LabelNotFoundError();

          // Authorization — creator OR board admin/owner
          const role     = (ctx as any).boardMembership?.role as string | undefined;
          const isCreator = current.createdBy === ctx.session.user.id;
          const isAdmin   = role === "ADMIN" || role === "OWNER";
          if (!isCreator && !isAdmin) {
            throw new TRPCError({
              code:    "FORBIDDEN",
              message: "فقط سازنده‌ی برچسب یا مدیر برد می‌تواند آن را ویرایش کند.",
            });
          }

          // Resolve other labels for duplicate check (excluding self)
          const others = (
            await repo.findByBoardId(current.boardId, {
              tx:       ctx.infra.db,
              tenantId: ctx.session.tenantId,
            })
          ).filter((l) => l.id !== current.id);

          const otherExistingNamesLower = others.map((l) =>
            l.name.toLocaleLowerCase("fa-IR"),
          );

          const eventId = crypto.randomUUID();
          const now     = new Date();

          const { patch, event, noOp } = updateLabel({
            current,
            patch: {
              name:       input.name,
              colorToken: input.colorToken,
              position:   input.position,
            },
            actorId:                 ctx.session.user.id as UserId,
            now,
            eventId,
            correlationId:           input.correlationId,
            otherExistingNamesLower,
          });

          if (noOp) {
            return { success: true, noOp: true as const };
          }

          await repo.update(ctx.infra.db, current.id, patch);
          await ctx.repos.outbox.append(ctx.infra.db, toOutboxEvent(event));

          return { success: true, noOp: false as const };
        });
      } catch (err) {
        throw toTRPCError(err);
      }
    }),

  // ──────────────────────────────────────────────────────────────────────────
  // delete — board admin only (D8)
  // ──────────────────────────────────────────────────────────────────────────
  // Soft-deletes the label (`deleted_at = now()`) and hard-deletes
  // every junction row pointing at it in the SAME transaction. The
  // outbox event carries `affectedCardCount` so the UI can show a
  // confirmation toast ("برچسب از N کارت حذف شد").
  //
  // Uses boardAdminProcedure (D12) — the role check is enforced by
  // the procedure builder before we even reach this handler.

  delete: boardAdminProcedure
    .input(
      z.object({
        labelId:        IdSchema,
        idempotencyKey: IdempotencyKeySchema,
        correlationId:  z.string().min(1).max(128).optional(),
      }).strict(),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await withIdempotency(ctx.infra.db, ctx.repos.idempotency, input.idempotencyKey, async () => {
          const repo = new DrizzleLabelsRepository(ctx.infra.db);

          const current = await repo.findById(input.labelId as LabelId, {
            tx:       ctx.infra.db,
            tenantId: ctx.session.tenantId,
          });
          if (!current) throw new LabelNotFoundError();

          // Count BEFORE we drop the junction rows so the event payload
          // and the response carry the impacted-card count for the
          // confirmation UI.
          const affectedCardCount = await repo.countCardsWithLabel(current.id, {
            tx:       ctx.infra.db,
            tenantId: ctx.session.tenantId,
          });

          const eventId = crypto.randomUUID();
          const now     = new Date();

          const { event } = deleteLabel({
            current,
            affectedCardCount,
            actorId:       ctx.session.user.id as UserId,
            now,
            eventId,
            correlationId: input.correlationId,
          });

          // Order matters: junction rows first (so a concurrent
          // SELECT inside the tx never sees an orphaned junction
          // pointing at a soft-deleted label), then the soft-delete
          // on the label itself, then the outbox emit.
          await repo.hardDeleteJunctionByLabelId(ctx.infra.db, current.id);
          await repo.softDelete(ctx.infra.db, current.id);
          await ctx.repos.outbox.append(ctx.infra.db, toOutboxEvent(event));

          return { success: true as const, affectedCardCount };
        });
      } catch (err) {
        throw toTRPCError(err);
      }
    }),

  // ──────────────────────────────────────────────────────────────────────────
  // applyToCard — any board member (D8)
  // ──────────────────────────────────────────────────────────────────────────

  applyToCard: boardProtectedProcedure
    .input(
      z.object({
        boardId:        IdSchema,
        cardId:         IdSchema,
        labelId:        IdSchema,
        idempotencyKey: IdempotencyKeySchema,
        correlationId:  z.string().min(1).max(128).optional(),
      }).strict(),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await withIdempotency(ctx.infra.db, ctx.repos.idempotency, input.idempotencyKey, async () => {
          const repo = new DrizzleLabelsRepository(ctx.infra.db);

          const label = await repo.findById(input.labelId as LabelId, {
            tx:       ctx.infra.db,
            tenantId: ctx.session.tenantId,
          });
          if (!label) throw new LabelNotFoundError();

          // We don't carry a Card repository in this slice — the cards
          // table is queried directly via ctx.infra.db for the existence +
          // boardId check. This avoids a circular dep between the
          // labels feature and the card slice.
          const cardRow = await ctx.infra.db.query.cards.findFirst({
            where: and(
              eq(cards.id, input.cardId),
              eq(cards.tenantId, ctx.session.tenantId),
              isNull(cards.deletedAt),
            ),
            columns: { id: true, boardId: true, tenantId: true },
          });
          if (!cardRow) throw new CardNotFoundError();

          // Idempotency at the application layer (use case): we still
          // get atomic protection from the junction's composite PK
          // and the repo's ON CONFLICT DO NOTHING.
          const existingLink = await repo.findCardLabelLink(
            { cardId: input.cardId as CardId, labelId: label.id },
            { tx: ctx.infra.db, tenantId: ctx.session.tenantId },
          );

          const eventId = crypto.randomUUID();
          const now     = new Date();

          const result = applyLabelToCard({
            cardId:         input.cardId as CardId,
            card: {
              id:       cardRow.id as CardId,
              boardId:  cardRow.boardId as string,
              tenantId: cardRow.tenantId as TenantId,
            },
            label,
            appliedBy:      ctx.session.user.id as UserId,
            now,
            eventId,
            correlationId:  input.correlationId,
            alreadyApplied: existingLink !== null,
          });

          if (result.noOp) {
            // Treat the duplicate apply as a quiet success (matches
            // EC2). The client's optimistic envelope already moved
            // forward; surfacing an error here would force a needless
            // rollback.
            return { success: true as const, applied: false };
          }

          const { inserted } = await repo.applyLabelToCard(
            ctx.infra.db,
            result.link,
          );
          // We only emit the outbox event when an actual insert
          // happened. If a concurrent insert won the race
          // (inserted=false), the other transaction emits its own
          // event — we'd duplicate the activity timeline otherwise.
          if (inserted) {
            await ctx.repos.outbox.append(ctx.infra.db, toOutboxEvent(result.event));
          }

          return { success: true as const, applied: inserted };
        });
      } catch (err) {
        throw toTRPCError(err);
      }
    }),

  // ──────────────────────────────────────────────────────────────────────────
  // removeFromCard — any board member (D8)
  // ──────────────────────────────────────────────────────────────────────────

  removeFromCard: boardProtectedProcedure
    .input(
      z.object({
        boardId:        IdSchema,
        cardId:         IdSchema,
        labelId:        IdSchema,
        idempotencyKey: IdempotencyKeySchema,
        correlationId:  z.string().min(1).max(128).optional(),
      }).strict(),
    )
    .mutation(async ({ input, ctx }) => {
      try {
        return await withIdempotency(ctx.infra.db, ctx.repos.idempotency, input.idempotencyKey, async () => {
          const repo = new DrizzleLabelsRepository(ctx.infra.db);

          const link = await repo.findCardLabelLink(
            {
              cardId:  input.cardId as CardId,
              labelId: input.labelId as LabelId,
            },
            { tx: ctx.infra.db, tenantId: ctx.session.tenantId },
          );

          const eventId = crypto.randomUUID();
          const now     = new Date();

          const result = removeLabelFromCard({
            cardId:        input.cardId as CardId,
            labelId:       input.labelId as LabelId,
            boardId:       input.boardId,
            tenantId:      ctx.session.tenantId as TenantId,
            actorId:       ctx.session.user.id as UserId,
            now,
            eventId,
            correlationId: input.correlationId,
            notPresent:    link === null,
          });

          if (result.noOp) {
            return { success: true as const, removed: false };
          }

          const { removed } = await repo.removeLabelFromCard(ctx.infra.db, {
            cardId:  input.cardId as CardId,
            labelId: input.labelId as LabelId,
          });
          if (removed) {
            await ctx.repos.outbox.append(ctx.infra.db, toOutboxEvent(result.event));
          }

          return { success: true as const, removed };
        });
      } catch (err) {
        throw toTRPCError(err);
      }
    }),
});
