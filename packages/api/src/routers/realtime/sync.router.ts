// packages/api/src/routers/realtime/sync.router.ts

import { performance } from "node:perf_hooks";

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, gt } from "drizzle-orm";

// 🌟 Use the explicit table reference (not `db.query.outboxEvents`).
//   `db.query.X` requires `relations()` declared for the table — outboxEvents
//   has none today, so reaching through `db.query` is fragile and would
//   evaluate to `undefined` in some Drizzle setups. Using the table object
//   directly is type-safe and runtime-safe.
import { outboxEvents } from "@repo/db";

import { router, protectedProcedure } from "../../trpc";

// ============================================================================
// Constants
// ============================================================================

const MAX_BATCH_SIZE = 500;
const DEFAULT_BATCH_SIZE = 100;
const MAX_SEQUENCE_DRIFT = 1_000_000;

// ============================================================================
// Validation Schemas
// ============================================================================

const IdSchema = z.string().uuid("Invalid UUID format");

const SequenceSchema = z
  .string()
  .regex(/^\d+$/, "Sequence must be numeric")
  .transform((value) => Number(value))
  .refine((value) => Number.isSafeInteger(value), {
    message: "Sequence exceeds safe integer range",
  })
  .refine((value) => value >= 0, {
    message: "Sequence cannot be negative",
  });

const PullMissedEventsInputSchema = z.object({
  boardId: IdSchema,
  lastSeenSequence: SequenceSchema,
  limit: z.number().int().min(1).max(MAX_BATCH_SIZE).default(DEFAULT_BATCH_SIZE),
});

// ============================================================================
// Types
// ============================================================================

export interface SyncEventDTO {
  eventId: string;
  type: string;
  sequence: string;
  payload: Record<string, unknown>;
  occurredAt: Date;
  correlationId?: string | null;
  causationId?: string | null;
  eventVersion: string;
}

export interface PullMissedEventsResponse {
  events: SyncEventDTO[];
  hasMore: boolean;
  latestSequence: string;
  reconnectedAt: number;
  serverTime: string;
}

// ============================================================================
// Guards
// ============================================================================

function validateSequenceDrift(lastSeenSequence: number): void {
  if (lastSeenSequence > MAX_SEQUENCE_DRIFT * 1000) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Sequence drift exceeded allowed threshold.",
    });
  }
}

function ensureBoardAccess(board: unknown, tenantId: string): void {
  const b = board as {
    tenantId?: string;
    deletedAt?: Date | null;
    archivedAt?: Date | null;
  } | null;

  if (!b) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Board not found." });
  }
  if (b.tenantId !== tenantId) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Cross-tenant access denied." });
  }
  if (b.deletedAt) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Board has been deleted." });
  }
  if (b.archivedAt) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Board is archived." });
  }
}

// ============================================================================
// Realtime Sync Router
// ============================================================================

export const realtimeSyncRouter = router({
  pullMissedEvents: protectedProcedure
    .input(PullMissedEventsInputSchema)
    .query(async ({ input, ctx }): Promise<PullMissedEventsResponse> => {
      const startedAt = performance.now();

      const trace = {
        traceId: ctx.metadata?.traceId,
        correlationId: ctx.metadata?.requestId,
        userId: ctx.session.user.id,
        tenantId: ctx.session.tenantId,
        boardId: input.boardId,
        operation: "realtime_pull_missed_events",
      };

      try {
        // ----------------------------------------------------------------
        // 1. Validation
        // ----------------------------------------------------------------
        validateSequenceDrift(input.lastSeenSequence);

        // ----------------------------------------------------------------
        // 2. Authorization
        // ----------------------------------------------------------------
        const board = await ctx.repos.board.findById(
          input.boardId as import("@repo/domain").BoardId,
        );
        ensureBoardAccess(board, ctx.session.tenantId);

        // ----------------------------------------------------------------
        // 3. Read Events  (explicit table reference, not db.query.*)
        // ----------------------------------------------------------------
        const rows = await ctx.infra.db
          .select({
            eventId: outboxEvents.eventId,
            type: outboxEvents.type,
            sequence: outboxEvents.sequence,
            payload: outboxEvents.payload,
            occurredAt: outboxEvents.occurredAt,
            correlationId: outboxEvents.correlationId,
            causationId: outboxEvents.causationId,
            eventVersion: outboxEvents.eventVersion,
          })
          .from(outboxEvents)
          .where(
            and(
              eq(outboxEvents.aggregateId, input.boardId),
              gt(outboxEvents.sequence, input.lastSeenSequence),
            ),
          )
          .orderBy(asc(outboxEvents.sequence))
          .limit(input.limit + 1);

        // ----------------------------------------------------------------
        // 4. Pagination
        // ----------------------------------------------------------------
        const hasMore = rows.length > input.limit;
        const pageRows = hasMore ? rows.slice(0, input.limit) : rows;

        const events: SyncEventDTO[] = pageRows.map((row) => ({
          eventId: row.eventId,
          type: row.type,
          sequence: String(row.sequence),
          payload: (row.payload as Record<string, unknown>) ?? {},
          occurredAt: row.occurredAt,
          correlationId: row.correlationId ?? null,
          causationId: row.causationId ?? null,
          eventVersion: row.eventVersion,
        }));

        // ----------------------------------------------------------------
        // 5. Sequence Tracking
        // ----------------------------------------------------------------
        const latestSequence =
          events.length > 0
            ? events[events.length - 1]!.sequence
            : String(input.lastSeenSequence);

        // ----------------------------------------------------------------
        // 6. Observability
        // ----------------------------------------------------------------
        ctx.infra.logger.info({
          event: "realtime_sync_pull_success",
          classification: "INTERNAL",
          durationMs: Math.round(performance.now() - startedAt),
          requestedSequence: input.lastSeenSequence,
          returnedEvents: events.length,
          hasMore,
          latestSequence,
          ...trace,
        });

        return {
          events,
          hasMore,
          latestSequence,
          reconnectedAt: Date.now(),
          serverTime: new Date().toISOString(),
        };
      } catch (error: unknown) {
        const safeError = error as { code?: string } | null;

        ctx.infra.logger.error({
          event: "realtime_sync_pull_failed",
          classification: "INTERNAL",
          safeErrorCode: safeError?.code ?? "UNKNOWN_SYNC_ERROR",
          durationMs: Math.round(performance.now() - startedAt),
          ...trace,
        });

        if (error instanceof TRPCError) throw error;

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to synchronize realtime events.",
        });
      }
    }),
});
