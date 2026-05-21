// packages/api/src/routers/card-features/checklists.router.ts
import crypto from "node:crypto";
import { z } from "zod";
import { eq, and, isNull, asc } from "drizzle-orm";
import { router, protectedProcedure } from "../../trpc";
import { checklists, checklistItems } from "@repo/db";

const IdSchema = z.string().uuid();

export const checklistsRouter = router({
  // Get checklists for a card (with items)
  getByCard: protectedProcedure
    .input(z.object({ cardId: IdSchema }))
    .query(async ({ input, ctx }) => {
      const rows = await ctx.infra.db.query.checklists.findMany({
        where: and(eq(checklists.cardId, input.cardId), isNull(checklists.deletedAt)),
        orderBy: [asc(checklists.position)],
        with: { items: { orderBy: [asc(checklistItems.position)] } },
      });
      return rows;
    }),

  // Create checklist
  create: protectedProcedure
    .input(z.object({ cardId: IdSchema, boardId: IdSchema, name: z.string().trim().min(1).max(128) }))
    .mutation(async ({ input, ctx }) => {
      const id = crypto.randomUUID();
      await ctx.infra.db.insert(checklists).values({
        id,
        tenantId: ctx.session.tenantId,
        cardId: input.cardId,
        boardId: input.boardId,
        name: input.name,
        position: 0,
      });
      return { id, name: input.name };
    }),

  // Delete checklist (soft)
  delete: protectedProcedure
    .input(z.object({ checklistId: IdSchema }))
    .mutation(async ({ input, ctx }) => {
      await ctx.infra.db.update(checklists).set({ deletedAt: new Date() }).where(
        and(eq(checklists.id, input.checklistId), eq(checklists.tenantId, ctx.session.tenantId))
      );
      return { success: true };
    }),

  // Add item to checklist
  addItem: protectedProcedure
    .input(z.object({ checklistId: IdSchema, title: z.string().trim().min(1).max(255) }))
    .mutation(async ({ input, ctx }) => {
      const id = crypto.randomUUID();
      await ctx.infra.db.insert(checklistItems).values({
        id,
        checklistId: input.checklistId,
        title: input.title,
        completed: false,
        position: 0,
      });
      return { id, title: input.title, completed: false };
    }),

  // Update item (toggle completed, rename)
  updateItem: protectedProcedure
    .input(z.object({
      checklistId: IdSchema,
      itemId: IdSchema,
      title: z.string().trim().min(1).max(255).optional(),
      completed: z.boolean().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (input.title !== undefined) updates.title = input.title;
      if (input.completed !== undefined) updates.completed = input.completed;

      await ctx.infra.db.update(checklistItems).set(updates).where(
        eq(checklistItems.id, input.itemId)
      );
      return { success: true };
    }),

  // Remove item
  removeItem: protectedProcedure
    .input(z.object({ checklistId: IdSchema, itemId: IdSchema }))
    .mutation(async ({ input, ctx }) => {
      await ctx.infra.db.delete(checklistItems).where(eq(checklistItems.id, input.itemId));
      return { success: true };
    }),
});
