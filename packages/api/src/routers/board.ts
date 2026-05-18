// packages/api/src/routers/board.ts

import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { router, protectedProcedure } from "../trpc";

import type {
  DomainErrorReason,
  MoveCardCommand,
  MoveCardResult,
  DomainFailure,
  CardId,
  ListId,
  TenantId,
  UserId,
  MutationId,
  TraceId,
  CorrelationId,
  SpanId,
  Revision,
} from "@repo/domain";

// ============================================================================
// Shared Schemas
// ============================================================================

const EntityIdSchema = z.string().uuid("Invalid entity id");
const MutationIdSchema = z.string().min(1).max(128);
const CursorSchema = z.string().max(1024);

const MoveModeSchema = z.enum([
  "APPEND",
  "PREPEND",
  "INSERT_BETWEEN",
  "REORDER_SAME_LIST",
]);

// ============================================================================
// Client Contracts
// ============================================================================

export type ClientMoveResult =
  | { success: true; sequence: number; listRevisions: Record<string, number> }
  | {
      success: false;
      reason: "SYNC_CONFLICT" | "INVALID_REQUEST" | "UNAUTHORIZED" | "SERVER_ERROR";
      retryable: boolean;
      message: string;
    };

// ============================================================================
// Router
// ============================================================================

export const boardRouter = router({
  // ==========================================================================
  // GET FULL BOARD
  // ==========================================================================
  // ✅ fix: قبلاً فقط projection.data (array از lists) برمی‌گرداند.
  // حالا { id, title, lists, boardSequence } برمی‌گردانیم — که BoardView نیاز دارد.
  // ==========================================================================

  getFullBoard: protectedProcedure
    .input(
      z.object({
        id: EntityIdSchema,
        listPagination: z
          .record(
            z.string(),
            z.object({
              cursor: CursorSchema.optional(),
              limit: z.number().int().min(1).max(100).default(50),
            }),
          )
          .optional(),
      }),
    )
    .query(async ({ input, ctx }) => {
      const projection = await ctx.readModels.getBoardProjection({
        boardId: input.id,
        tenantId: ctx.session.tenantId as TenantId,
        userId: ctx.session.user.id as UserId,
        listPagination: input.listPagination,
        correlationId: ctx.metadata?.requestId as CorrelationId,
      });

      if (!projection || !projection.hasAccess || !projection.data) {
        throw new TRPCError({
          code: projection?.hasAccess === false ? "FORBIDDEN" : "NOT_FOUND",
          message: "Board not found or access denied.",
        });
      }

      // ✅ fix: بعد از guard، TypeScript میداند data وجود دارد
      // boardSequence و aclVersion فقط روی شاخه hasAccess=true وجود دارند
      const p = projection as typeof projection & {
        boardSequence?: number;
        aclVersion?: number;
        title?: string;
      };

      return {
        id: input.id,
        title: p.title ?? "Board",
        lists: projection.data,
        boardSequence: p.boardSequence ?? 0,
        aclVersion: p.aclVersion ?? 1,
      };
    }),

  // ==========================================================================
  // MOVE CARD
  // ==========================================================================

  moveCard: protectedProcedure
    .input(
      z
        .object({
          cardId: EntityIdSchema,
          targetListId: EntityIdSchema,
          mode: MoveModeSchema,
          prevId: EntityIdSchema.optional(),
          nextId: EntityIdSchema.optional(),
          expectedListRevisions: z
            .record(z.string(), z.number().int().nonnegative())
            .optional(),
          mutationId: MutationIdSchema,
        })
        .superRefine((value, ctx) => {
          if (value.mode === "APPEND" && value.nextId) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["nextId"],
              message: "APPEND cannot have nextId",
            });
          }
          if (value.mode === "PREPEND" && value.prevId) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["prevId"],
              message: "PREPEND cannot have prevId",
            });
          }
          if (value.mode === "INSERT_BETWEEN" && (!value.prevId || !value.nextId)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["mode"],
              message: "INSERT_BETWEEN requires prevId and nextId",
            });
          }
        }),
    )
    .mutation(async ({ input, ctx }): Promise<ClientMoveResult> => {
      const command: MoveCardCommand = {
        cardId: input.cardId as CardId,
        targetListId: input.targetListId as ListId,
        mode: input.mode,
        prevId: input.prevId as CardId | undefined,
        nextId: input.nextId as CardId | undefined,
        expectedListRevisions: input.expectedListRevisions as
          | Readonly<Partial<Record<ListId, Revision>>>
          | undefined,
        tenantId: ctx.session.tenantId as TenantId,
        userId: ctx.session.user.id as UserId,
        mutationId: input.mutationId as MutationId,
        correlationId: ctx.metadata?.requestId as CorrelationId,
        traceId: ctx.metadata?.traceId as TraceId,
        spanId: ctx.metadata?.spanId as SpanId,
        issuedAt: new Date(),
      };

      let result: MoveCardResult;

      try {
        result = await ctx.services.board.moveCard(command);
      } catch {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to move card.",
        });
      }

      if (result.success) {
        const listRevisions: Record<string, number> = {};
        for (const [listId, rev] of Object.entries(
          result.updatedListRevisions || {},
        )) {
          listRevisions[listId] = rev as number;
        }
        return {
          success: true,
          // ✅ fix: boardSequence نوع Sequence branded است — Number() cast
          sequence: Number(result.boardSequence),
          listRevisions,
        };
      }

      // ✅ fix: DomainFailure دارد .code نه .reason
      const failure = result as DomainFailure;
      return mapDomainErrorToClient(failure.code as DomainErrorReason);
    }),
});

// ============================================================================
// Domain Error Mapping
// ============================================================================

function mapDomainErrorToClient(reason: DomainErrorReason): ClientMoveResult {
  switch (reason) {
    case "STALE_REVISION":
    case "COMMAND_EXPIRED":
      return {
        success: false,
        reason: "SYNC_CONFLICT",
        retryable: true,
        message: "State changed. Sync required.",
      };

    case "ACL_MISMATCH":
    case "UNAUTHORIZED":
    // ✅ fix: FORBIDDEN در DomainErrorReason هست ولی case نداشت
    case "FORBIDDEN":
      return {
        success: false,
        reason: "UNAUTHORIZED",
        retryable: false,
        message: "Access denied.",
      };

    case "NOT_FOUND":
    case "INVALID_CHAIN":
    case "CORRUPTED_CHAIN":
    case "TOPOLOGY_MISMATCH":
    case "CROSS_BOARD_VIOLATION":
    case "BOARD_ARCHIVED":
    case "LIST_LIMIT_REACHED":
    case "INVALID_REQUEST_PAYLOAD":
      return {
        success: false,
        reason: "INVALID_REQUEST",
        retryable: false,
        message: "Invalid operation.",
      };

    case "DEADLOCK_DETECTED":
    case "OUTBOX_LAGGING":
      return {
        success: false,
        reason: "SERVER_ERROR",
        retryable: true,
        message: "Temporary processing issue.",
      };

    case "GAP_UNRECOVERABLE":
      return {
        success: false,
        reason: "SERVER_ERROR",
        retryable: false,
        message: "Synchronization failed.",
      };

    default: {
      const _exhaustive: never = reason;
      void _exhaustive;
      return {
        success: false,
        reason: "SERVER_ERROR",
        retryable: false,
        message: "Unknown error.",
      };
    }
  }
}