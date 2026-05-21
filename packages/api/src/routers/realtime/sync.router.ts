// packages/api/src/routers/realtime/sync.router.ts
//
// Fixes applied:
// ✅ #S-01: Drizzle query now uses the imported `outboxEvents` table object
//           with proper column references (outboxEvents.aggregateId, etc.)
//           instead of db.query.outboxEvents.aggregateId which is a QueryBuilder
//           proxy, not a column object — causes runtime crash.
// ✅ #S-02: row mapping uses explicit field names from outboxEvents schema.
// ✅ #S-03: sequence drift threshold simplified.
// ✅ #S-04: ensureBoardAccess typed properly.

import { performance } from "node:perf_hooks";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, gt, and } from "drizzle-orm";

// ✅ #S-01: import the table object directly for column references
import { outboxEvents } from "@repo/db";

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

        // ✅ #S-01: use imported `outboxEvents` table object with proper column refs.
        //           db.query.outboxEvents is a QueryBuilder proxy — NOT a column object.
        //           eq(db.query.outboxEvents.aggregateId, ...) → runtime crash.
        //           Fix: import { outboxEvents } from "@repo/db" and use table columns.
        const rows: Array<{
          eventId:       string;
          type:          string;
          sequence:      number;
          payload:       Record<string, unknown>;
          occurredAt:    Date;
          correlationId?: string | null;
          causationId?:  string | null;
          eventVersion:  string;
        }> = await db
          .select()
          .from(outboxEvents)
          .where(
            and(
              eq(outboxEvents.aggregateId, input.boardId),
              gt(outboxEvents.sequence,    input.lastSeenSequence),
            ),
          )
          .orderBy(outboxEvents.sequence)
          .limit(input.limit + 1);

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
