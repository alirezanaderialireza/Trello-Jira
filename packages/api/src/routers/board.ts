// packages/api/src/routers/board.ts
//
// Fixes applied:
// ✅ #B-01: getFullBoard projection shape mismatch fixed.
//           BoardReadModels.getBoardProjection returns:
//           { data: { id, title, boardSequence, lists[] }, hasAccess }
//           Old code tried to read p.title / p.boardSequence / p.aclVersion
//           from a casted `projection` object — those fields live on `projection.data`.
// ✅ #B-02: moveCard: DomainFailure uses `.code` not `.reason` — fixed mapper input.
// ✅ #B-03: moveCard: boardSequence is Sequence (branded number) — Number() cast added.
// ✅ #B-04: FORBIDDEN was missing from mapDomainErrorToClient switch — added.
// ✅ #B-05: moveList route added — calls ctx.services.commands.moveList.execute().

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

const EntityIdSchema    = z.string().uuid("Invalid entity id");
const MutationIdSchema  = z.string().min(1).max(128);
const CursorSchema      = z.string().max(1024);
const MoveModeSchema    = z.enum(["APPEND", "PREPEND", "INSERT_BETWEEN", "REORDER_SAME_LIST"]);

// ============================================================================
// Client Contracts
// ============================================================================

export type ClientMoveResult =
  | { success: true;  sequence: number; listRevisions: Record<string, number> }
  | {
      success:   false;
      reason:    "SYNC_CONFLICT" | "INVALID_REQUEST" | "UNAUTHORIZED" | "SERVER_ERROR";
      retryable: boolean;
      message:   string;
    };

// ============================================================================
// Router
// ============================================================================

export const boardRouter = router({

  // ==========================================================================
  // GET FULL BOARD
  // ==========================================================================

  getFullBoard: protectedProcedure
    .input(z.object({
      id: EntityIdSchema,
      listPagination: z.record(
        z.string(),
        z.object({
          cursor: CursorSchema.optional(),
          limit:  z.number().int().min(1).max(100).default(50),
        }),
      ).optional(),
    }))
    .query(async ({ input, ctx }) => {
      const projection = await ctx.readModels.getBoardProjection({
        boardId:       input.id,
        tenantId:      ctx.session.tenantId as TenantId,
        userId:        ctx.session.user.id as UserId,
        listPagination: input.listPagination as any,
        correlationId: ctx.metadata?.requestId as CorrelationId,
      });

      if (!projection || !projection.hasAccess || !projection.data) {
        throw new TRPCError({
          code:    projection?.hasAccess === false ? "FORBIDDEN" : "NOT_FOUND",
          message: "Board not found or access denied.",
        });
      }

      // ✅ #B-01: all fields live on projection.data — not on projection itself
      const data = projection.data as {
        id:            string;
        title:         string;
        boardSequence: number;
        lists:         unknown[];
      };

      return {
        id:            data.id,
        title:         data.title,
        lists:         data.lists,
        boardSequence: data.boardSequence ?? 0,
        aclVersion:    1, // BoardReadModels doesn't return aclVersion here — safe default
      };
    }),

  // ==========================================================================
  // MOVE CARD
  // ==========================================================================

  moveCard: protectedProcedure
    .input(
      z.object({
        cardId:                 EntityIdSchema,
        targetListId:           EntityIdSchema,
        mode:                   MoveModeSchema,
        prevId:                 EntityIdSchema.optional(),
        nextId:                 EntityIdSchema.optional(),
        expectedListRevisions:  z.record(z.string(), z.number().int().nonnegative()).optional(),
        mutationId:             MutationIdSchema,
      }).superRefine((value, ctx) => {
        if (value.mode === "APPEND" && value.nextId) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["nextId"], message: "APPEND cannot have nextId" });
        }
        if (value.mode === "PREPEND" && value.prevId) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["prevId"], message: "PREPEND cannot have prevId" });
        }
        if (value.mode === "INSERT_BETWEEN" && (!value.prevId || !value.nextId)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["mode"], message: "INSERT_BETWEEN requires prevId and nextId" });
        }
      }),
    )
    .mutation(async ({ input, ctx }): Promise<ClientMoveResult> => {
      const command: MoveCardCommand = {
        cardId:                input.cardId as CardId,
        targetListId:          input.targetListId as ListId,
        mode:                  input.mode,
        prevId:                input.prevId as CardId | undefined,
        nextId:                input.nextId as CardId | undefined,
        expectedListRevisions: input.expectedListRevisions as
          | Readonly<Partial<Record<ListId, Revision>>>
          | undefined,
        tenantId:     ctx.session.tenantId as TenantId,
        userId:       ctx.session.user.id as UserId,
        mutationId:   input.mutationId as MutationId,
        correlationId: ctx.metadata?.requestId as CorrelationId,
        traceId:      ctx.metadata?.traceId as TraceId,
        spanId:       ctx.metadata?.spanId as SpanId,
        issuedAt:     new Date(),
      };

      let result: MoveCardResult;
      try {
        result = await ctx.services.board.moveCard(command);
      } catch {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to move card." });
      }

      if (result.success) {
        const listRevisions: Record<string, number> = {};
        for (const [listId, rev] of Object.entries(result.updatedListRevisions ?? {})) {
          listRevisions[listId] = rev as number;
        }
        return {
          success:      true,
          // ✅ #B-03: Sequence is a branded number — Number() cast
          sequence:     Number(result.boardSequence),
          listRevisions,
        };
      }

      // ✅ #B-02: DomainFailure uses .code not .reason
      const failure = result as DomainFailure;
      return mapDomainErrorToClient(failure.code as DomainErrorReason);
    }),

  // ==========================================================================
  // ✅ #B-05: MOVE LIST
  // ==========================================================================

  moveList: protectedProcedure
    .input(z.object({
      boardId:     EntityIdSchema,
      listId:      EntityIdSchema,
      newPosition: z.string().min(1).max(512),
      mutationId:  MutationIdSchema,
    }))
    .mutation(async ({ input, ctx }): Promise<ClientMoveResult> => {
      try {
        const result = await ctx.services.commands.moveList.execute({
          boardId:       input.boardId,
          listId:        input.listId,
          newPosition:   input.newPosition,
          mutationId:    input.mutationId,
          tenantId:      ctx.session.tenantId,
          userId:        ctx.session.user.id,
          correlationId: ctx.metadata?.requestId,
        });

        if (result.success) {
          return {
            success:      true,
            sequence:     result.boardSequence,
            listRevisions: result.updatedListRevisions ?? {},
          };
        }

        return mapDomainErrorToClient(result.reason as DomainErrorReason);
      } catch {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to move list." });
      }
    }),
});

// ============================================================================
// Domain Error Mapping
// ============================================================================

function mapDomainErrorToClient(reason: DomainErrorReason): ClientMoveResult {
  switch (reason) {
    case "STALE_REVISION":
    case "COMMAND_EXPIRED":
      return { success: false, reason: "SYNC_CONFLICT",   retryable: true,  message: "State changed. Sync required." };

    case "ACL_MISMATCH":
    case "UNAUTHORIZED":
    // ✅ #B-04: FORBIDDEN was missing
    case "FORBIDDEN":
      return { success: false, reason: "UNAUTHORIZED",    retryable: false, message: "Access denied." };

    case "NOT_FOUND":
    case "INVALID_CHAIN":
    case "CORRUPTED_CHAIN":
    case "TOPOLOGY_MISMATCH":
    case "CROSS_BOARD_VIOLATION":
    case "BOARD_ARCHIVED":
    case "LIST_LIMIT_REACHED":
    case "INVALID_REQUEST_PAYLOAD":
      return { success: false, reason: "INVALID_REQUEST", retryable: false, message: "Invalid operation." };

    case "DEADLOCK_DETECTED":
    case "OUTBOX_LAGGING":
      return { success: false, reason: "SERVER_ERROR",    retryable: true,  message: "Temporary processing issue." };

    case "GAP_UNRECOVERABLE":
      return { success: false, reason: "SERVER_ERROR",    retryable: false, message: "Synchronization failed." };

    default: {
      const _exhaustive: never = reason;
      void _exhaustive;
      return { success: false, reason: "SERVER_ERROR",    retryable: false, message: "Unknown error." };
    }
  }
}
