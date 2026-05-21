// packages/api/src/routers/list.ts

import { z } from "zod";
import { router, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";

import type { DomainErrorReason } from "@repo/domain";

// ============================================================================
// Validation Layer
// ============================================================================

const EntityIdSchema = z.string().uuid("Invalid UUID format");

const MutationIdSchema = z.string().trim().min(10).max(128);

const OpaqueCursorSchema = z.string().max(1024);

const SequenceSchema = z.string().regex(/^\d+$/);

const rejectMixedScriptsAndBidi = (value: string) => {
  if (/[\u202A-\u202E\u2066-\u2069]/.test(value)) return false;
  if (/[\u0400-\u04FF]/.test(value) && /[a-zA-Z]/.test(value)) return false;
  return true;
};

const SafeTextSchema = z
  .string()
  .transform((v) => v.normalize("NFKC"))
  .transform((v) => v.replace(/[\u200B-\u200D\uFEFF]/g, ""))
  .refine(rejectMixedScriptsAndBidi, "Invalid characters detected")
  .pipe(z.string().trim().min(1).max(100));

// ============================================================================
// Public Contracts
// ============================================================================

export type ConsistencyTier =
  | "STRONG"
  | "EVENTUAL_READ_YOUR_WRITES"
  | "DEGRADED_READONLY";

export type ClientCapabilities =
  | "DELTA_SYNC"
  | "SNAPSHOT_RECOVERY"
  | "COMPRESSION_V1";

export type ClientListMutationResult =
  | {
      success: true;
      listId: string;
      boardRevision: number;
      boardSequence: number;
      aclVersion: number;
      schemaVersion: "v1";
      consistency: ConsistencyTier;
      replayed: boolean;
      originalMutationId?: string;
    }
  | {
      success: false;
      reason: ClientFailureReason;
      retryable: boolean;
      message: string;
      schemaVersion: "v1";
    };

type ClientFailureReason =
  | "SYNC_CONFLICT"
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "RATE_LIMITED"
  | "RELOAD_REQUIRED"
  | "SNAPSHOT_REQUIRED"
  | "REALTIME_DEGRADED"
  | "SERVER_ERROR"
  | "INVALID_REQUEST";

// ============================================================================
// Router
// ============================================================================

export const listRouter = router({
  // ==========================================================================
  // READ MODEL
  // ==========================================================================

  getByBoard: protectedProcedure
    .input(
      z
        .object({
          boardId: EntityIdSchema,

          listPagination: z
            .record(
              EntityIdSchema,
              z.object({
                cursor: OpaqueCursorSchema.optional(),
                limit: z.number().min(1).max(100).default(50),
              }),
            )
            .optional(),

          clientAclVersion: z.number().int().nonnegative().nullable().optional(),

          minSequence: SequenceSchema.optional(),

          capabilities: z
            .array(z.enum(["DELTA_SYNC", "SNAPSHOT_RECOVERY", "COMPRESSION_V1"]))
            .optional(),
        })
        .refine(
          (data) => {
            if (!data.listPagination) return true;
            return (
              Object.values(data.listPagination).reduce(
                (acc, curr) => acc + (curr.limit || 50),
                0,
              ) <= 1000
            );
          },
          { message: "Payload complexity exceeded" },
        ),
    )
    .query(async ({ input, ctx }) => {
      const traceContext = {
        traceId: ctx.metadata.traceId,
        spanId: ctx.metadata.spanId,
        correlationId: ctx.metadata.requestId,
      };

      try {
        const projection = await ctx.readModels.list.getListsByBoard({
          boardId: input.boardId,
          userId: ctx.session.user.id,
          tenantId: ctx.session.tenantId,
          listPagination: input.listPagination,
          minSequence: input.minSequence,
          abortSignal: ctx.reqSignal,
          ...traceContext,
        });

        if (!projection?.hasAccess || !projection?.data) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Board not found." });
        }

        if (
          input.clientAclVersion != null &&
          projection.aclVersion > input.clientAclVersion
        ) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Permissions changed.",
          });
        }

        const lagMs = Date.now() - projection.lastUpdatedTs;

        return {
          lists: projection.data,
          boardSequence: projection.boardSequence,
          projectionSequence: projection.projectionSequence,
          aclVersion: projection.aclVersion,
          projectionLagMs: lagMs,
          consistency: projection.isDegraded
            ? "DEGRADED_READONLY"
            : "EVENTUAL_READ_YOUR_WRITES",
        };
      } catch (error: unknown) {
        const safeError = error as { message?: string } | null;
        ctx.infra.logger.error({
          event: "list_projection_failed",
          boardId: input.boardId,
          error: safeError?.message ?? "UNKNOWN",
          ...traceContext,
        });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Could not fetch lists.",
        });
      }
    }),

  // ==========================================================================
  // CREATE LIST
  // ==========================================================================

  create: protectedProcedure
    .input(
      z.object({
        boardId: EntityIdSchema,
        title: SafeTextSchema,
        expectedBoardRevision: z.number().int().positive().optional(),
        expectedAclVersion: z.number().int().nonnegative().optional(),
        mutationId: MutationIdSchema,
      }),
    )
    .mutation(async ({ input, ctx }): Promise<ClientListMutationResult> => {
      const traceContext = {
        traceId: ctx.metadata.traceId,
        spanId: ctx.metadata.spanId,
        correlationId: ctx.metadata.requestId,
      };

      try {
        const result = await ctx.services.commands.createList.execute({
          boardId: input.boardId,
          title: input.title,
          expectedBoardRevision: input.expectedBoardRevision,
          expectedAclVersion: input.expectedAclVersion,
          mutationId: input.mutationId,
          userId: ctx.session.user.id,
          tenantId: ctx.session.tenantId,
          ...traceContext,
        });

        if (result.success) {
          return {
            success: true,
            listId: result.listId,
            boardRevision: result.boardRevision,
            // ✅ fix: CreateListResult.boardSequence نوع string است (String(boardSequence))
            // ClientListMutationResult.boardSequence نوع number می‌خواهد
            boardSequence: Number(result.boardSequence),
            aclVersion: result.aclVersion,
            consistency: result.consistencyTier ?? "EVENTUAL_READ_YOUR_WRITES",
            replayed: result.isReplayed ?? false,
            originalMutationId: result.isReplayed ? input.mutationId : undefined,
            schemaVersion: "v1",
          };
        }

        return mapDomainErrorToClient(result.reason);
      } catch (error: unknown) {
        const safeError = error as { message?: string } | null;
        ctx.infra.logger.error({
          event: "create_list_failed",
          boardId: input.boardId,
          error: safeError?.message ?? "UNKNOWN",
          ...traceContext,
        });
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Could not create list.",
        });
      }
    }),
});

// ============================================================================
// Error Mapper
// ============================================================================

function mapDomainErrorToClient(reason: DomainErrorReason): ClientListMutationResult {
  switch (reason) {
    case "STALE_REVISION":
    case "COMMAND_EXPIRED":
    case "CARD_LOCKED":
      return {
        success: false,
        reason: "SYNC_CONFLICT",
        retryable: true,
        message: "Syncing latest changes...",
        schemaVersion: "v1",
      };

    case "ACL_MISMATCH":
      return {
        success: false,
        reason: "RELOAD_REQUIRED",
        retryable: false,
        message: "Permissions changed.",
        schemaVersion: "v1",
      };

    case "GAP_UNRECOVERABLE":
      return {
        success: false,
        reason: "SNAPSHOT_REQUIRED",
        retryable: false,
        message: "Workspace refresh required.",
        schemaVersion: "v1",
      };

    case "OUTBOX_LAGGING":
      return {
        success: false,
        reason: "REALTIME_DEGRADED",
        retryable: true,
        message: "Realtime temporarily degraded.",
        schemaVersion: "v1",
      };

    case "NOT_FOUND":
      return {
        success: false,
        reason: "NOT_FOUND",
        retryable: false,
        message: "Resource not found.",
        schemaVersion: "v1",
      };

    case "UNAUTHORIZED":
    case "FORBIDDEN":
      return {
        success: false,
        reason: "UNAUTHORIZED",
        retryable: false,
        message: "Permission denied.",
        schemaVersion: "v1",
      };

    case "LIST_LIMIT_REACHED":
    case "BOARD_ARCHIVED":
      return {
        success: false,
        reason: "INVALID_REQUEST",
        retryable: false,
        message: "Operation not allowed.",
        schemaVersion: "v1",
      };

    case "DEADLOCK_DETECTED":
      return {
        success: false,
        reason: "SERVER_ERROR",
        retryable: true,
        message: "Temporary contention detected.",
        schemaVersion: "v1",
      };

    case "CROSS_BOARD_VIOLATION":
    case "INVALID_REQUEST_PAYLOAD":
    case "INVALID_CHAIN":
    case "CORRUPTED_CHAIN":
    case "TOPOLOGY_MISMATCH":
      return {
        success: false,
        reason: "INVALID_REQUEST",
        retryable: false,
        message: "Invalid request.",
        schemaVersion: "v1",
      };

    default: {
      const exhaustive: never = reason;
      void exhaustive;
      return {
        success: false,
        reason: "SERVER_ERROR",
        retryable: false,
        message: "Unexpected server error.",
        schemaVersion: "v1",
      };
    }
  }
}