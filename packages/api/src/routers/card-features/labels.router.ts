// packages/api/src/routers/card-features/labels.router.ts
import crypto from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, isNull } from "drizzle-orm";
import { router, protectedProcedure } from "../../trpc";
import { labels, cardLabels } from "@repo/db";

const IdSchema = z.string().uuid();
const ColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/);
const NameSchema = z.string().trim().min(1).max(64);

export const labelsRouter = router({
  // Get all labels for a board
  getByBoard: protectedProcedure
    .input(z.object({ boardId: IdSchema }))
    .query(async ({ input, ctx }) => {
      const rows = await ctx.infra.db.query.labels.findMany({
        where: and(
          eq(labels.boardId, input.boardId),
          eq(labels.tenantId, ctx.session.tenantId),
          isNull(labels.deletedAt),
        ),
      });
      return rows;
    }),

  // Create a new label
  create: protectedProcedure
    .input(z.object({ boardId: IdSchema, name: NameSchema, color: ColorSchema }))
    .mutation(async ({ input, ctx }) => {
      const id = crypto.randomUUID();
      await ctx.infra.db.insert(labels).values({
        id,
        tenantId: ctx.session.tenantId,
        boardId: input.boardId,
        name: input.name,
        color: input.color,
      });
      return { id, name: input.name, color: input.color };
    }),

  // Update label name/color
  update: protectedProcedure
    .input(z.object({ labelId: IdSchema, name: NameSchema.optional(), color: ColorSchema.optional() }))
    .mutation(async ({ input, ctx }) => {
      const updates: Record<string, unknown> = {};
      if (input.name) updates.name = input.name;
      if (input.color) updates.color = input.color;
      if (Object.keys(updates).length === 0) return { success: true };

      await ctx.infra.db.update(labels).set(updates).where(
        and(eq(labels.id, input.labelId), eq(labels.tenantId, ctx.session.tenantId), isNull(labels.deletedAt))
      );
      return { success: true };
    }),

  // Delete label (soft)
  delete: protectedProcedure
    .input(z.object({ labelId: IdSchema }))
    .mutation(async ({ input, ctx }) => {
      await ctx.infra.db.update(labels).set({ deletedAt: new Date() }).where(
        and(eq(labels.id, input.labelId), eq(labels.tenantId, ctx.session.tenantId))
      );
      return { success: true };
    }),

  // Add label to card
  addToCard: protectedProcedure
    .input(z.object({ cardId: IdSchema, labelId: IdSchema }))
    .mutation(async ({ input, ctx }) => {
      // Check if already exists
      const existing = await ctx.infra.db.query.cardLabels.findFirst({
        where: and(eq(cardLabels.cardId, input.cardId), eq(cardLabels.labelId, input.labelId)),
      });
      if (existing) return { success: true, alreadyExists: true };

      await ctx.infra.db.insert(cardLabels).values({
        id: crypto.randomUUID(),
        cardId: input.cardId,
        labelId: input.labelId,
      });
      return { success: true, alreadyExists: false };
    }),

  // Remove label from card
  removeFromCard: protectedProcedure
    .input(z.object({ cardId: IdSchema, labelId: IdSchema }))
    .mutation(async ({ input, ctx }) => {
      await ctx.infra.db.delete(cardLabels).where(
        and(eq(cardLabels.cardId, input.cardId), eq(cardLabels.labelId, input.labelId))
      );
      return { success: true };
    }),

  // Get labels for a specific card
  getByCard: protectedProcedure
    .input(z.object({ cardId: IdSchema }))
    .query(async ({ input, ctx }) => {
      const rows = await ctx.infra.db.query.cardLabels.findMany({
        where: eq(cardLabels.cardId, input.cardId),
        with: { label: true },
      });
      return rows.map((r: any) => r.label).filter(Boolean);
    }),
});
