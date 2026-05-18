// packages/api/src/routers/realtime/presence.ts

import { performance } from "node:perf_hooks";

import { z } from "zod";
import { TRPCError } from "@trpc/server";

// ✅ ارور ۱: مسیر اشتباه — realtime/presence.ts دو سطح از trpc.ts فاصله دارد
import { router, protectedProcedure } from "../../trpc";

// ============================================================================
// Constants
// ============================================================================

const MAX_CURSOR_COORDINATE = 20_000;
const PRESENCE_TTL_MS = 15_000;
const HEARTBEAT_RATE_LIMIT_WINDOW_MS = 10_000;
const HEARTBEAT_RATE_LIMIT_MAX = 120;

const ACTIVE_STATUSES = ["ACTIVE", "IDLE", "VIEWING_SETTINGS"] as const;

// ============================================================================
// Validation Schemas
// ============================================================================

const IdSchema = z.string().uuid("Invalid UUID format");

const CursorSchema = z.object({
  x: z.number().finite().int().min(0).max(MAX_CURSOR_COORDINATE),
  y: z.number().finite().int().min(0).max(MAX_CURSOR_COORDINATE),
  cardId: IdSchema.optional(),
});

const HeartbeatInputSchema = z.object({
  boardId: IdSchema,
  status: z.enum(ACTIVE_STATUSES).default("ACTIVE"),
  cursor: CursorSchema.optional(),
  clientTimestamp: z.number().int().positive().optional(),
  sessionInstanceId: IdSchema.optional(),
});

// ============================================================================
// Types
// ============================================================================

type PresenceState = {
  userId: string;
  tenantId: string;
  boardId: string;
  status: (typeof ACTIVE_STATUSES)[number];
  cursor?: { x: number; y: number; cardId?: string };
  lastSeenAt: number;
  expiresAt: number;
  sessionInstanceId?: string;
};

type PresenceResponse = {
  success: true;
  acknowledged: true;
  serverTime: string;
  expiresInMs: number;
  reconnectRecommended: boolean;
};

// ============================================================================
// Presence Router
// ============================================================================

export const presenceRouter = router({
  // ✅ ارور ۲+۳: با fix مسیر import، input و ctx نوع صحیح می‌گیرند
  heartbeat: protectedProcedure
    .input(HeartbeatInputSchema)
    .mutation(async ({ input, ctx }): Promise<PresenceResponse> => {
      const startedAt = performance.now();

      const trace = {
        traceId: ctx.metadata?.traceId,
        correlationId: ctx.metadata?.requestId,
        operation: "presence_heartbeat",
        userId: ctx.session.user.id,
        tenantId: ctx.session.tenantId,
        boardId: input.boardId,
      };

      try {
        // ----------------------------------------------------------------
        // 1. Rate Limit
        // ----------------------------------------------------------------
        if (ctx.infra.rateLimiter?.consume) {
          const rateLimitKey = [
            "presence",
            ctx.session.tenantId,
            ctx.session.user.id,
            input.boardId,
          ].join(":");

          const allowed = await ctx.infra.rateLimiter.consume({
            key: rateLimitKey,
            windowMs: HEARTBEAT_RATE_LIMIT_WINDOW_MS,
            max: HEARTBEAT_RATE_LIMIT_MAX,
          });

          if (!allowed) {
            throw new TRPCError({
              code: "TOO_MANY_REQUESTS",
              message: "Presence heartbeat rate exceeded.",
            });
          }
        }

        // ----------------------------------------------------------------
        // 2. Cursor Sanitization
        // ----------------------------------------------------------------
        const sanitizedCursor = input.cursor
          ? {
              x: Math.round(input.cursor.x),
              y: Math.round(input.cursor.y),
              cardId: input.cursor.cardId,
            }
          : undefined;

        // ----------------------------------------------------------------
        // 3. Presence State
        // ----------------------------------------------------------------
        const now = Date.now();

        const presenceState: PresenceState = {
          userId: ctx.session.user.id,
          tenantId: ctx.session.tenantId,
          boardId: input.boardId,
          status: input.status,
          cursor: sanitizedCursor,
          lastSeenAt: now,
          expiresAt: now + PRESENCE_TTL_MS,
          sessionInstanceId: input.sessionInstanceId,
        };

        const presenceKey = ["presence", input.boardId, ctx.session.user.id].join(":");

        // ----------------------------------------------------------------
        // 4. Presence Store
        // ----------------------------------------------------------------
        if (ctx.infra.presenceStore?.set) {
          await ctx.infra.presenceStore.set(presenceKey, presenceState, PRESENCE_TTL_MS);
        }

        // ----------------------------------------------------------------
        // 5. Broadcast
        // ----------------------------------------------------------------
        const broadcastPayload = {
          type: "PRESENCE_UPDATED",
          boardId: input.boardId,
          user: { id: ctx.session.user.id },
          status: input.status,
          cursor: sanitizedCursor,
          observedAt: now,
        };

        if (ctx.infra.pubsub?.publish) {
          await ctx.infra.pubsub.publish(
            `board:${input.boardId}:presence`,
            broadcastPayload,
          );
        }

        // ----------------------------------------------------------------
        // 6. Opportunistic Cleanup
        // ----------------------------------------------------------------
        if (Math.random() < 0.01) {
          try {
            await ctx.infra.presenceStore?.cleanupExpired?.();
          } catch {
            // intentionally ignored
          }
        }

        // ----------------------------------------------------------------
        // 7. Observability
        // ----------------------------------------------------------------
        ctx.infra.logger.debug({
          event: "presence_heartbeat_received",
          classification: "INTERNAL",
          status: input.status,
          hasCursor: !!input.cursor,
          reconnectRecommended: false,
          durationMs: Math.round(performance.now() - startedAt),
          ...trace,
        });

        return {
          success: true,
          acknowledged: true,
          serverTime: new Date(now).toISOString(),
          expiresInMs: PRESENCE_TTL_MS,
          reconnectRecommended: false,
        };
      } catch (error: unknown) {
        const safeError = error as { code?: string; name?: string } | null;

        ctx.infra.logger.error({
          event: "presence_heartbeat_failed",
          classification: "INTERNAL",
          safeErrorCode: safeError?.code ?? safeError?.name ?? "UNKNOWN_PRESENCE_ERROR",
          durationMs: Math.round(performance.now() - startedAt),
          ...trace,
        });

        if (error instanceof TRPCError) throw error;

        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Presence heartbeat dropped.",
        });
      }
    }),
});