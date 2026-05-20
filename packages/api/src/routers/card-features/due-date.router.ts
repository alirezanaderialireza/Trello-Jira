// packages/api/src/routers/card-features/due-date.router.ts
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, isNull } from "drizzle-orm";
import { router, protectedProcedure } from "../../trpc";
import { cards } from "@repo/db";

const IdSchema = z.string().uuid();
const DateSchema = z.string().datetime().nullable();

export const dueDateRouter = router({
  // Set or clear due date on a card
  set: protectedProcedure
    .input(z.object({ cardId: IdSchema, dueDate: DateSchema }))
    .mutation(async ({ input, ctx }) => {
      const card = await ctx.infra.db.query.cards.findFirst({
        where: and(eq(cards.id, input.cardId), eq(cards.tenantId, ctx.session.tenantId), isNull(cards.deletedAt)),
      });

      if (!card) throw new TRPCError({ code: "NOT_FOUND", message: "Card not found." });

      // Store due date in the card's accountingData JSONB field (MVP approach)
      // In a full implementation, this would be a dedicated column.
      const currentData = (card.accountingData as Record<string, unknown>) ?? {};
      const updatedData = { ...currentData, dueDate: input.dueDate };

      await ctx.infra.db.update(cards).set({
        accountingData: updatedData,
        updatedAt: new Date(),
      }).where(eq(cards.id, input.cardId));

      return { success: true, dueDate: input.dueDate };
    }),

  // Get due date for a card
  get: protectedProcedure
    .input(z.object({ cardId: IdSchema }))
    .query(async ({ input, ctx }) => {
      const card = await ctx.infra.db.query.cards.findFirst({
        where: and(eq(cards.id, input.cardId), eq(cards.tenantId, ctx.session.tenantId), isNull(cards.deletedAt)),
      });

      if (!card) throw new TRPCError({ code: "NOT_FOUND" });

      const data = (card.accountingData as Record<string, unknown>) ?? {};
      return { dueDate: (data.dueDate as string | null) ?? null };
    }),
});
