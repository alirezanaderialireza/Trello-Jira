// packages/api/src/routers/system/jobs.router.ts
//
// Fixes applied:
// ✅ #J-01: ctx.repos.list.findById(input.listId) — ListId branded type cast added.
//           findById expects ListId (branded string), not plain string.
//           Without the cast, strict TypeScript would fail; at runtime it's a no-op
//           but keeping it explicit preserves the branded-type invariant.
// ✅ #J-02: list.deletedAt guard: List.deletedAt is `Date | null` not boolean —
//           old code: `if (!list || list.deletedAt)` is correct JS truthy check
//           but needs explicit null check to satisfy strict TypeScript.
// ✅ #J-03: Removed `const infra: any = ctx.infra` cast that leaked everywhere.
//           Optional-chained access on ctx.infra with `as any` per-call is cleaner.

import crypto        from "node:crypto";
import { performance } from "node:perf_hooks";

import { z }         from "zod";
import { TRPCError } from "@trpc/server";

import { router, protectedProcedure } from "../../trpc";
import type { ListId } from "@repo/domain";

// ============================================================================
// Constants
// ============================================================================

const MAX_REASON_LENGTH = 512;

const JOB_TYPES = {
  LEXORANK_REBALANCE: "LEXORANK_REBALANCE",
} as const;

const JOB_PRIORITIES = {
  LOW:    "LOW",
  NORMAL: "NORMAL",
  HIGH:   "HIGH",
} as const;

// ============================================================================
// Validation Schemas
// ============================================================================

const IdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/, "Invalid identifier format");

const TriggerLexoRankRebalanceSchema = z.object({
  listId:   IdSchema,
  priority: z.enum([JOB_PRIORITIES.LOW, JOB_PRIORITIES.NORMAL, JOB_PRIORITIES.HIGH])
              .default(JOB_PRIORITIES.NORMAL),
  reason:   z.string().trim().max(MAX_REASON_LENGTH).optional(),
  force:    z.boolean().default(false),
});

// ============================================================================
// Types
// ============================================================================

type QueueJobResponse = {
  success:              true;
  jobId:                string;
  queuedAt:             string;
  queue:                string;
  deduplicated:         boolean;
  estimatedStartInMs?:  number;
};

// ============================================================================
// Router
// ============================================================================

export const jobsRouter = router({
  triggerLexoRankRebalance: protectedProcedure
    .input(TriggerLexoRankRebalanceSchema)
    .mutation(async ({ input, ctx }): Promise<QueueJobResponse> => {
      const startedAt = performance.now();

      const trace = {
        traceId:       ctx.metadata?.traceId,
        correlationId: ctx.metadata?.requestId,
        operation:     "trigger_lexorank_rebalance",
        userId:        ctx.session.user.id,
        tenantId:      ctx.session.tenantId,
        listId:        input.listId,
      };

      // ── 1. Authorization ─────────────────────────────────────────────────
      const roles = ctx.session.roles ?? [];
      const hasAdminAccess =
        roles.includes("ADMIN") || roles.includes("SUPER_ADMIN");

      if (!hasAdminAccess) {
        ctx.infra.logger.warn({
          event:          "jobs_lexorank_rebalance_forbidden",
          classification: "SENSITIVE",
          ...trace,
        });
        throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required." });
      }

      try {
        // ── 2. Validate List ───────────────────────────────────────────────
        // ✅ #J-01: cast to ListId branded type
        const list = await ctx.repos.list.findById(input.listId as ListId);

        // ✅ #J-02: explicit null check for Date | null
        if (!list || list.deletedAt !== null && list.deletedAt !== undefined) {
          throw new TRPCError({ code: "NOT_FOUND", message: "List not found." });
        }

        // ── 3. Tenant Isolation ────────────────────────────────────────────
        if (list.tenantId !== ctx.session.tenantId) {
          ctx.infra.logger.warn({
            event:          "jobs_cross_tenant_attempt",
            classification: "SENSITIVE",
            targetTenantId: list.tenantId,
            ...trace,
          });
          throw new TRPCError({ code: "FORBIDDEN", message: "Cross-tenant access denied." });
        }

        // ── 4. Deduplication ───────────────────────────────────────────────
        const dedupeKey = `${JOB_TYPES.LEXORANK_REBALANCE}:${list.id}`;
        let deduplicated = false;

        // ✅ #J-03: per-call any cast instead of global infra cast
        const jobQueue = (ctx.infra as any).jobQueue as
          | { hasPendingJob?: (key: string) => Promise<boolean>;
              enqueue?:       (p: { queue: string; dedupeKey: string; payload: unknown; priority: string }) => Promise<void> }
          | undefined;

        if (jobQueue?.hasPendingJob) {
          const exists = await jobQueue.hasPendingJob(dedupeKey);
          if (exists && !input.force) deduplicated = true;
        }

        // ── 5. Enqueue ─────────────────────────────────────────────────────
        const queuedAt = new Date();
        const jobId    = crypto.randomUUID();

        if (!deduplicated && jobQueue?.enqueue) {
          await jobQueue.enqueue({
            queue:     "lexorank-rebalance",
            dedupeKey,
            payload: {
              jobId,
              type:        JOB_TYPES.LEXORANK_REBALANCE,
              tenantId:    ctx.session.tenantId,
              listId:      list.id,
              boardId:     list.boardId,
              triggeredBy: ctx.session.user.id,
              priority:    input.priority,
              requestedAt: queuedAt.toISOString(),
              metadata:    { reason: input.reason, manual: true, force: input.force },
            },
            priority: input.priority,
          });
        }

        // ── 6. Observability ───────────────────────────────────────────────
        ctx.infra.logger.info({
          event:          "manual_lexorank_rebalance_triggered",
          classification: "INTERNAL",
          priority:       input.priority,
          deduplicated,
          forced:         input.force,
          durationMs:     Math.round(performance.now() - startedAt),
          ...trace,
        });

        return {
          success:      true,
          jobId,
          queuedAt:     queuedAt.toISOString(),
          queue:        "lexorank-rebalance",
          deduplicated,
          estimatedStartInMs:
            input.priority === JOB_PRIORITIES.HIGH   ? 500 :
            input.priority === JOB_PRIORITIES.NORMAL ? 2_000 :
            10_000,
        };
      } catch (error: unknown) {
        const safeError = error as { code?: string; name?: string } | null;

        ctx.infra.logger.error({
          event:          "jobs_lexorank_rebalance_failed",
          classification: "INTERNAL",
          safeErrorCode:  safeError?.code ?? safeError?.name ?? "UNKNOWN_JOB_ERROR",
          durationMs:     Math.round(performance.now() - startedAt),
          ...trace,
        });

        if (error instanceof TRPCError) throw error;

        throw new TRPCError({
          code:    "INTERNAL_SERVER_ERROR",
          message: "Failed to queue rebalance job.",
        });
      }
    }),
});
