// packages/api/src/routers/card.ts

import { z } from "zod";
import { TRPCError } from "@trpc/server";

import {
  router,
  protectedProcedure,
} from "../trpc";

import type {
  DomainErrorReason,
} from "@repo/domain";

// ============================================================================
// 🛡️ Shared Schemas
// ============================================================================

const EntityIdSchema = z
  .string()
  .uuid("Invalid entity id");

const MutationIdSchema = z
  .string()
  .trim()
  .min(10)
  .max(128);

const CursorSchema = z
  .string()
  .max(1024);

const SequenceSchema = z
  .string()
  .regex(/^\d+$/);

const TitleSchema = z
  .string()
  .trim()
  .min(1)
  .max(255);

const DescriptionSchema = z
  .string()
  .trim()
  .max(50_000);

// ============================================================================
// 🛡️ Client Contracts
// ============================================================================

export type ClientCardMutationResult =
  | {
      success: true;
      cardId: string;
      listRevision: number;
      boardSequence: string;
      projectionSequence: string;
      aclVersion?: number;
    }
  | {
      success: false;
      reason:
        | "SYNC_CONFLICT"
        | "NOT_FOUND"
        | "UNAUTHORIZED"
        | "SERVER_ERROR"
        | "RELOAD_REQUIRED";
      retryable: boolean;
      message: string;
    };

// ============================================================================
// 🚀 Router
// ============================================================================

export const cardRouter = router({
  // ==========================================================================
  // 📥 GET BY LIST
  // ==========================================================================

  getByList:
    protectedProcedure
      .input(
        z.object({
          listId: EntityIdSchema,
          cursor: CursorSchema.optional(),
          limit: z.number().int().min(1).max(100).default(50),
          clientAclVersion: z.number().int().nonnegative().optional(),
          sinceSequence: SequenceSchema.optional(),
        })
      )
      .query(async ({ input, ctx }) => {
        const projection =
          await ctx.readModels.getCardsByList({
            listId: input.listId,
            tenantId: ctx.session.tenantId,
            userId: ctx.session.user.id,
            cursor: input.cursor,
            limit: input.limit,
            sinceSequence: input.sinceSequence,
            correlationId: ctx.metadata.requestId,
          });

        if (!projection || !projection.hasAccess) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "List not found.",
          });
        }

        if (
          input.clientAclVersion !== undefined &&
          projection.aclVersion > input.clientAclVersion
        ) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "ACL changed. Reload required.",
          });
        }

        return {
          cards: projection.data,
          nextCursor: projection.nextCursor,
          aclVersion: projection.aclVersion,
          projectionSequence: projection.currentSequence,
        };
      }),

  // ==========================================================================
  // ➕ CREATE CARD
  // ==========================================================================

  create:
    protectedProcedure
      .input(
        z.object({
          listId: EntityIdSchema,
          title: TitleSchema,
          mutationId: MutationIdSchema,
        })
      )
      .mutation(async ({ input, ctx }): Promise<ClientCardMutationResult> => {
        try {
          const result =
            await ctx.services.commands.createCard.execute({
              listId: input.listId,
              title: input.title,
              mutationId: input.mutationId,
              tenantId: ctx.session.tenantId,
              userId: ctx.session.user.id,
              correlationId: ctx.metadata.requestId,
              traceId: ctx.metadata.traceId,
              spanId: ctx.metadata.spanId,
            });

          if (result.success) {
            return {
              success: true,
              cardId: result.cardId,
              listRevision: result.listRevision,
              boardSequence: result.boardSequence,
              projectionSequence: result.projectionSequence,
              aclVersion: result.aclVersion,
            };
          }

          return mapDomainErrorToClient(result.reason);
        } catch {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Could not create card.",
          });
        }
      }),

  // ==========================================================================
  // ✏️ UPDATE CARD
  // ==========================================================================

  update:
    protectedProcedure
      .input(
        z
          .object({
            id: EntityIdSchema,
            title: TitleSchema.optional(),
            description: DescriptionSchema.optional(),
            expectedRevision: z.number().int().positive().optional(),
            mutationId: MutationIdSchema,
          })
          .refine(
            (value) =>
              value.title !== undefined || value.description !== undefined,
            { message: "No fields to update." }
          )
      )
      .mutation(async ({ input, ctx }): Promise<ClientCardMutationResult> => {
        try {
          const result =
            await ctx.services.commands.updateCard.execute({
              cardId: input.id,
              title: input.title,
              description: input.description,
              expectedRevision: input.expectedRevision,
              mutationId: input.mutationId,
              tenantId: ctx.session.tenantId,
              userId: ctx.session.user.id,
              correlationId: ctx.metadata.requestId,
              traceId: ctx.metadata.traceId,
              spanId: ctx.metadata.spanId,
            });

          if (result.success) {
            return {
              success: true,
              cardId: input.id,
              listRevision: result.listRevision,
              boardSequence: result.boardSequence,
              projectionSequence: result.projectionSequence,
              aclVersion: result.aclVersion,
            };
          }

          return mapDomainErrorToClient(result.reason);
        } catch {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Could not update card.",
          });
        }
      }),

  // ==========================================================================
  // 🗑 DELETE CARD
  // ==========================================================================

  delete:
    protectedProcedure
      .input(
        z.object({
          id: EntityIdSchema,
          mutationId: MutationIdSchema,
        })
      )
      .mutation(async ({ input, ctx }): Promise<ClientCardMutationResult> => {
        try {
          const result =
            await ctx.services.commands.deleteCard.execute({
              cardId: input.id,
              mutationId: input.mutationId,
              tenantId: ctx.session.tenantId,
              userId: ctx.session.user.id,
              correlationId: ctx.metadata.requestId,
              traceId: ctx.metadata.traceId,
              spanId: ctx.metadata.spanId,
            });

          if (result.success) {
            return {
              success: true,
              cardId: input.id,
              listRevision: result.listRevision,
              boardSequence: result.boardSequence,
              projectionSequence: result.projectionSequence,
              aclVersion: result.aclVersion,
            };
          }

          return mapDomainErrorToClient(result.reason);
        } catch {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Could not delete card.",
          });
        }
      }),
});

// ============================================================================
// 🧠 Domain Error Mapper
// ============================================================================

function mapDomainErrorToClient(
  reason: DomainErrorReason,
): ClientCardMutationResult {
  switch (reason) {
    case "STALE_REVISION":
    case "COMMAND_EXPIRED":
    case "CARD_LOCKED":
      return {
        success: false,
        reason: "SYNC_CONFLICT",
        retryable: true,
        message: "State changed. Sync required.",
      };

    case "ACL_MISMATCH":
      return {
        success: false,
        reason: "RELOAD_REQUIRED",
        retryable: false,
        message: "Permissions changed.",
      };

    case "NOT_FOUND":
      return {
        success: false,
        reason: "NOT_FOUND",
        retryable: false,
        message: "Target not found.",
      };

    case "UNAUTHORIZED":
    case "FORBIDDEN":
      return {
        success: false,
        reason: "UNAUTHORIZED",
        retryable: false,
        message: "Access denied.",
      };

    case "DEADLOCK_DETECTED":
    case "OUTBOX_LAGGING":
      return {
        success: false,
        reason: "SERVER_ERROR",
        retryable: true,
        message: "Temporary contention.",
      };

    case "INVALID_CHAIN":
    case "CORRUPTED_CHAIN":
    case "TOPOLOGY_MISMATCH":
    case "CROSS_BOARD_VIOLATION":
    case "BOARD_ARCHIVED":
    case "LIST_LIMIT_REACHED":
    case "INVALID_REQUEST_PAYLOAD":
      return {
        success: false,
        reason: "SERVER_ERROR",
        retryable: false,
        message: "Invalid operation.",
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
      return {
        success: false,
        reason: "SERVER_ERROR",
        retryable: false,
        message: "Unknown error.",
      };
    }
  }
}