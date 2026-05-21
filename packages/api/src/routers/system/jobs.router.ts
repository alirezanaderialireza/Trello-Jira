import crypto from "node:crypto";
import { performance } from "node:perf_hooks";

import { z } from "zod";
import { TRPCError } from "@trpc/server";

import { router, protectedProcedure } from "../../trpc";

// ============================================================================
// 🧩 Constants
// ============================================================================

const MAX_REASON_LENGTH = 512;

const JOB_TYPES = {
  LEXORANK_REBALANCE:
    "LEXORANK_REBALANCE",
} as const;

const JOB_PRIORITIES = {
  LOW: "LOW",
  NORMAL: "NORMAL",
  HIGH: "HIGH",
} as const;

// ============================================================================
// 🛡️ Validation Schemas
// ============================================================================

const IdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(
    /^[a-zA-Z0-9_-]+$/,
    "Invalid identifier format"
  );

const TriggerLexoRankRebalanceSchema =
  z.object({
    listId: IdSchema,

    priority: z
      .enum([
        JOB_PRIORITIES.LOW,
        JOB_PRIORITIES.NORMAL,
        JOB_PRIORITIES.HIGH,
      ])
      .default(
        JOB_PRIORITIES.NORMAL
      ),

    reason: z
      .string()
      .trim()
      .max(MAX_REASON_LENGTH)
      .optional(),

    force: z
      .boolean()
      .default(false),
  });

// ============================================================================
// 🧠 Types
// ============================================================================

type QueueJobResponse = {
  success: true;

  jobId: string;

  queuedAt: string;

  queue: string;

  deduplicated: boolean;

  estimatedStartInMs?: number;
};

// ============================================================================
// 🛠️ Helpers
// ============================================================================

function generateJobId(): string {
  return crypto.randomUUID();
}

// ============================================================================
// 🚀 Enterprise Jobs Router
// ============================================================================

export const jobsRouter = router({
  // ==========================================================================
  // 🔄 Trigger LexoRank Rebalance
  // ==========================================================================

  triggerLexoRankRebalance:
    protectedProcedure

      .input(
        TriggerLexoRankRebalanceSchema
      )

      .mutation(
        async ({
          input,
          ctx,
        }): Promise<QueueJobResponse> => {
          const startedAt =
            performance.now();

          const trace = {
            traceId:
              ctx.metadata?.traceId,

            correlationId:
              ctx.metadata
                ?.requestId,

            operation:
              "trigger_lexorank_rebalance",

            userId:
              ctx.session.user.id,

            tenantId:
              ctx.session
                .tenantId,

            listId:
              input.listId,
          };

          // ================================================================
          // 🔐 1. Authorization Boundary
          // ================================================================

          const roles =
            ctx.session.roles ??
            [];

          const hasAdminAccess =
            roles.includes(
              "ADMIN"
            ) ||
            roles.includes(
              "SUPER_ADMIN"
            );

          if (
            !hasAdminAccess
          ) {
            ctx.infra.logger.warn({
              event:
                "jobs_lexorank_rebalance_forbidden",

              classification:
                "SENSITIVE",

              ...trace,
            });

            throw new TRPCError({
              code:
                "FORBIDDEN",

              message:
                "Admin access required.",
            });
          }

          try {
            // ================================================================
            // 📋 2. Validate List Existence
            // ================================================================

            const list =
              await ctx.repos.list.findById(
                input.listId
              );

            if (
              !list ||
              list.deletedAt
            ) {
              throw new TRPCError({
                code:
                  "NOT_FOUND",

                message:
                  "List not found.",
              });
            }

            // ================================================================
            // 🔒 3. Tenant Isolation
            // ================================================================

            if (
              list.tenantId !==
              ctx.session
                .tenantId
            ) {
              ctx.infra.logger.warn({
                event:
                  "jobs_cross_tenant_attempt",

                classification:
                  "SENSITIVE",

                targetTenantId:
                  list.tenantId,

                ...trace,
              });

              throw new TRPCError({
                code:
                  "FORBIDDEN",

                message:
                  "Cross-tenant access denied.",
              });
            }

            // ================================================================
            // 🧠 4. Deduplication Guard
            // ================================================================

            const dedupeKey = [
              JOB_TYPES.LEXORANK_REBALANCE,
              list.id,
            ].join(":");

            let deduplicated =
              false;

            const infra: any =
              ctx.infra;

            if (
              infra.jobQueue
                ?.hasPendingJob
            ) {
              const exists =
                await infra.jobQueue.hasPendingJob(
                  dedupeKey
                );

              if (
                exists &&
                !input.force
              ) {
                deduplicated =
                  true;
              }
            }

            // ================================================================
            // ⚡ 5. Queue Background Job
            // ================================================================

            const queuedAt =
              new Date();

            const jobId =
              generateJobId();

            if (
              !deduplicated
            ) {
              const payload = {
                jobId,

                type:
                  JOB_TYPES.LEXORANK_REBALANCE,

                tenantId:
                  ctx.session
                    .tenantId,

                listId:
                  list.id,

                boardId:
                  list.boardId,

                triggeredBy:
                  ctx.session
                    .user.id,

                priority:
                  input.priority,

                requestedAt:
                  queuedAt.toISOString(),

                metadata: {
                  reason:
                    input.reason,

                  manual:
                    true,

                  force:
                    input.force,
                },
              };

              if (
                infra.jobQueue
                  ?.enqueue
              ) {
                await infra.jobQueue.enqueue(
                  {
                    queue:
                      "lexorank-rebalance",

                    dedupeKey,

                    payload,

                    priority:
                      input.priority,
                  }
                );
              }

              // ============================================================
              // 📤 6. Outbox Event (Optional)
              // ============================================================

              if (
                infra.outbox
                  ?.publish
              ) {
                await infra.outbox.publish(
                  {
                    type:
                      "LEXORANK_REBALANCE_REQUESTED",

                    aggregateId:
                      list.boardId,

                    payload: {
                      listId:
                        list.id,

                      boardId:
                        list.boardId,

                      triggeredBy:
                        ctx.session
                          .user.id,

                      priority:
                        input.priority,
                    },
                  }
                );
              }
            }

            // ================================================================
            // 📊 7. Structured Observability
            // ================================================================

            ctx.infra.logger.info({
              event:
                "manual_lexorank_rebalance_triggered",

              classification:
                "INTERNAL",

              priority:
                input.priority,

              deduplicated,

              forced:
                input.force,

              durationMs:
                Math.round(
                  performance.now() -
                    startedAt
                ),

              ...trace,
            });

            // ================================================================
            // ✅ 8. Response
            // ================================================================

            return {
              success: true,

              jobId,

              queuedAt:
                queuedAt.toISOString(),

              queue:
                "lexorank-rebalance",

              deduplicated,

              estimatedStartInMs:
                input.priority ===
                JOB_PRIORITIES.HIGH
                  ? 500
                  : input.priority ===
                      JOB_PRIORITIES.NORMAL
                    ? 2_000
                    : 10_000,
            };
          } catch (error: any) {
            // ================================================================
            // 🚨 Failure Observability
            // ================================================================

            ctx.infra.logger.error({
              event:
                "jobs_lexorank_rebalance_failed",

              classification:
                "INTERNAL",

              safeErrorCode:
                error?.code ||
                error?.name ||
                "UNKNOWN_JOB_ERROR",

              durationMs:
                Math.round(
                  performance.now() -
                    startedAt
                ),

              ...trace,
            });

            if (
              error instanceof
              TRPCError
            ) {
              throw error;
            }

            throw new TRPCError({
              code:
                "INTERNAL_SERVER_ERROR",

              message:
                "Failed to queue rebalance job.",
            });
          }
        }
      ),
});