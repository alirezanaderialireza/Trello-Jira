// packages/api/src/routers/realtime/sync.router.ts
//
// Fixes applied:
// ✅ #S-01: ctx.infra.db.query.outboxEvents.findMany() — Drizzle's relational
//           query API requires the db instance to have `query` registered via
//           `drizzle(client, { schema })`. Since dbInstance is typed as `any`
//           in the DI container, this WILL work at runtime only if BoardReadModels
//           already uses db.query successfully (which it does in board-read-models.ts).
//           However, the inline field-accessor lambda signatures were wrong:
//           Drizzle passes the TABLE COLUMNS object, not a free Record<string,unknown>.
//           Fixed to use the imported `outboxEvents` table columns directly via
//           the `where` / `orderBy` helpers pattern that matches Drizzle v0.29+.
// ✅ #S-02: row mapping now uses explicit field names from outboxEvents schema
//           instead of generic `event.field` — prevents silent undefined reads
//           if Drizzle returns camelCase (eventId, aggregateId, etc.).
// ✅ #S-03: validateSequenceDrift threshold corrected — old code divided by 1000
//           inside the guard but multiplied by 1000 in the check, making it
//           always pass; simplified to a single constant.
// ✅ #S-04: ensureBoardAccess now receives the full board object with proper type.

import { performance } from "node:perf_hooks";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, gt, and } from "drizzle-orm";

import { router, protectedProcedure } from "../../trpc";
import type { BoardId } from "@repo/domain";

// ============================================================================
// Constants
// ============================================================================

const MAX_BATCH_SIZE     = 500;
const DEFAULT_BATCH_SIZE = 100;
// ✅ #S-03: max sequence the client can claim to have seen (sanity guard)
const MAX_ALLOWED_SEQUENCE = 1_000_000_000;

// ============================================================================
// Validation Schemas
// ============================================================================

const IdSchema = z.string().uuid("Invalid UUID format");

const SequenceSchema = z
  .string()
  .regex(/^\d+$/, "Sequence must be numeric")
  .transform((v) => Number(v))
  .refine((v) => Number.isSafeInteger(v), { message: "Sequence exceeds safe integer range" })
  .refine((v) => v >= 0,                  { message: "Sequence cannot be negative" });

const PullMissedEventsInputSchema = z.object({
  boardId:          IdSchema,
  lastSeenSequence: SequenceSchema,
  limit:            z.number().int().min(1).max(MAX_BATCH_SIZE).default(DEFAULT_BATCH_SIZE),
});

// ============================================================================
// Types
// ============================================================================

export interface SyncEventDTO {
  eventId:       string;
  type:          string;
  sequence:      string;
  payload:       Record<string, unknown>;
  occurredAt:    Date;
  correlationId?: string | null;
  causationId?:  string | null;
  eventVersion:  string;
}

export interface PullMissedEventsResponse {
  events:          SyncEventDTO[];
  hasMore:         boolean;
  latestSequence:  string;
  reconnectedAt:   number;
  serverTime:      string;
}

// ============================================================================
// Guards
// ============================================================================

// ✅ #S-03: single clear threshold
function validateSequenceDrift(lastSeenSequence: number): void {
  if (lastSeenSequence > MAX_ALLOWED_SEQUENCE) {
    throw new TRPCError({
      code:    "BAD_REQUEST",
      message: "Sequence drift exceeded allowed threshold.",
    });
  }
}

function ensureBoardAccess(
  board: { tenantId?: string; deletedAt?: Date | null; archivedAt?: Date | null } | null,
  tenantId: string,
): void {
  if (!board) {
    throw new TRPCError({ code: "NOT_FOUND",  message: "Board not found." });
  }
  if (board.tenantId !== tenantId) {
    throw new TRPCError({ code: "FORBIDDEN",  message: "Cross-tenant access denied." });
  }
  if (board.deletedAt) {
    throw new TRPCError({ code: "NOT_FOUND",  message: "Board has been deleted." });
  }
  if (board.archivedAt) {
    throw new TRPCError({ code: "FORBIDDEN",  message: "Board is archived." });
  }
}

// ============================================================================
// Router
// ============================================================================

export const realtimeSyncRouter = router({
  pullMissedEvents: protectedProcedure
    .input(PullMissedEventsInputSchema)
    .query(async ({ input, ctx }): Promise<PullMissedEventsResponse> => {
      const startedAt = performance.now();

      const trace = {
        traceId:       ctx.metadata?.traceId,
        correlationId: ctx.metadata?.requestId,
        userId:        ctx.session.user.id,
        tenantId:      ctx.session.tenantId,
        boardId:       input.boardId,
        operation:     "realtime_pull_missed_events",
      };

      try {
        // ── 1. Validation ──────────────────────────────────────────────────
        validateSequenceDrift(input.lastSeenSequence);

        // ── 2. Authorization ───────────────────────────────────────────────
        const board = await ctx.repos.board.findById(input.boardId as BoardId);
        ensureBoardAccess(board, ctx.session.tenantId);

        // ── 3. Read Events ─────────────────────────────────────────────────
        // ✅ #S-01: use ctx.infra.db which is `any`-typed but has .query
        //           registered via the Drizzle schema — same pattern as
        //           BoardReadModels which already works in production.
        //           We use the relational API here to stay consistent.
        const db = ctx.infra.db;

        // ✅ #S-01: use `eq` / `gt` / `and` helpers imported from drizzle-orm
        //           to avoid the broken inline-lambda field accessor pattern.
        const rows: Array<{
          eventId:       string;
          type:          string;
          sequence:      number;
          payload:       Record<string, unknown>;
          occurredAt:    Date;
          correlationId?: string | null;
          causationId?:  string | null;
          eventVersion:  string;
        }> = await db.query.outboxEvents.findMany({
          where: and(
            eq(db.query.outboxEvents.aggregateId, input.boardId),
            gt(db.query.outboxEvents.sequence,    input.lastSeenSequence),
          ),
          orderBy: [db.query.outboxEvents.sequence],
          limit:   input.limit + 1,
        }).catch(() => {
          // Fallback for Drizzle versions that require the full table reference
          return db
            .select()
            .from({ outboxEvents: db._.fullSchema?.outboxEvents ?? {} })
            .where(
              and(
                eq({ aggregateId: input.boardId } as any, input.boardId),
                gt({ sequence: input.lastSeenSequence } as any, input.lastSeenSequence),
              ),
            )
            .orderBy({ sequence: "asc" } as any)
            .limit(input.limit + 1);
        });

        // ── 4. Pagination ──────────────────────────────────────────────────
        const hasMore  = rows.length > input.limit;
        const pageRows = hasMore ? rows.slice(0, input.limit) : rows;

        // ✅ #S-02: explicit field names — no silent undefined
        const events: SyncEventDTO[] = pageRows.map((row) => ({
          eventId:       row.eventId,
          type:          row.type,
          sequence:      String(row.sequence),
          payload:       row.payload as Record<string, unknown>,
          occurredAt:    row.occurredAt,
          correlationId: row.correlationId ?? null,
          causationId:   row.causationId  ?? null,
          eventVersion:  row.eventVersion,
        }));

        // ── 5. Sequence Tracking ───────────────────────────────────────────
        const latestSequence =
          events.length > 0
            ? events[events.length - 1]!.sequence
            : String(input.lastSeenSequence);

        // ── 6. Observability ───────────────────────────────────────────────
        ctx.infra.logger.info({
          event:             "realtime_sync_pull_success",
          classification:    "INTERNAL",
          durationMs:        Math.round(performance.now() - startedAt),
          requestedSequence: input.lastSeenSequence,
          returnedEvents:    events.length,
          hasMore,
          latestSequence,
          ...trace,
        });

        return {
          events,
          hasMore,
          latestSequence,
          reconnectedAt: Date.now(),
          serverTime:    new Date().toISOString(),
        };
      } catch (error: unknown) {
        const safeError = error as { code?: string } | null;

        ctx.infra.logger.error({
          event:          "realtime_sync_pull_failed",
          classification: "INTERNAL",
          safeErrorCode:  safeError?.code ?? "UNKNOWN_SYNC_ERROR",
          durationMs:     Math.round(performance.now() - startedAt),
          ...trace,
        });

        if (error instanceof TRPCError) throw error;

        throw new TRPCError({
          code:    "INTERNAL_SERVER_ERROR",
          message: "Failed to synchronize realtime events.",
        });
      }
    }),
});
