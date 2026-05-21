// packages/api/src/routers/card-features/activity.router.ts
import { z } from "zod";
import { eq, and, desc } from "drizzle-orm";
import { router, protectedProcedure } from "../../trpc";
import { sql } from "drizzle-orm";

const IdSchema = z.string().uuid();

export const activityRouter = router({
  // Get activity timeline for a card (from audit_logs)
  getByCard: protectedProcedure
    .input(z.object({
      cardId: IdSchema,
      limit: z.number().int().min(1).max(100).default(30),
    }))
    .query(async ({ input, ctx }) => {
      // Query audit_logs table for this card's activity
      const rows = await ctx.infra.db.execute(sql`
        SELECT id, actor_id, action, entity_id, entity_type,
               correlation_id, before_state, after_state, created_at
        FROM audit_logs
        WHERE entity_id = ${input.cardId}
          AND tenant_id = ${ctx.session.tenantId}
        ORDER BY created_at DESC
        LIMIT ${input.limit}
      `);

      return {
        events: (rows as any[]).map((row: any) => ({
          id: row.id,
          actorId: row.actor_id,
          action: row.action,
          entityId: row.entity_id,
          entityType: row.entity_type,
          correlationId: row.correlation_id,
          beforeState: row.before_state,
          afterState: row.after_state,
          createdAt: row.created_at,
        })),
      };
    }),

  // Get activity timeline for a board
  getByBoard: protectedProcedure
    .input(z.object({
      boardId: IdSchema,
      limit: z.number().int().min(1).max(100).default(50),
    }))
    .query(async ({ input, ctx }) => {
      const rows = await ctx.infra.db.execute(sql`
        SELECT id, actor_id, action, entity_id, entity_type,
               correlation_id, before_state, after_state, created_at
        FROM audit_logs
        WHERE tenant_id = ${ctx.session.tenantId}
          AND (
            entity_id = ${input.boardId}
            OR correlation_id IN (
              SELECT correlation_id FROM audit_logs
              WHERE entity_id = ${input.boardId}
            )
          )
        ORDER BY created_at DESC
        LIMIT ${input.limit}
      `);

      return {
        events: (rows as any[]).map((row: any) => ({
          id: row.id,
          actorId: row.actor_id,
          action: row.action,
          entityId: row.entity_id,
          entityType: row.entity_type,
          beforeState: row.before_state,
          afterState: row.after_state,
          createdAt: row.created_at,
        })),
      };
    }),
});
