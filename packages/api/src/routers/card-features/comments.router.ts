// packages/api/src/routers/card-features/comments.router.ts
import crypto from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, isNull, desc } from "drizzle-orm";
import { router, protectedProcedure } from "../../trpc";
import { comments } from "@repo/db";

const IdSchema = z.string().uuid();

export const commentsRouter = router({
  // Get comments for a card (newest first)
  getByCard: protectedProcedure
    .input(z.object({
      cardId: IdSchema,
      limit: z.number().int().min(1).max(100).default(50),
      cursor: IdSchema.optional(),
    }))
    .query(async ({ input, ctx }) => {
      const rows = await ctx.infra.db.query.comments.findMany({
        where: and(
          eq(comments.cardId, input.cardId),
          eq(comments.tenantId, ctx.session.tenantId),
          isNull(comments.deletedAt),
        ),
        orderBy: [desc(comments.createdAt)],
        limit: input.limit + 1,
      });

      const hasMore = rows.length > input.limit;
      const data = hasMore ? rows.slice(0, input.limit) : rows;
      const nextCursor = hasMore ? data[data.length - 1]?.id : undefined;

      return { comments: data, nextCursor };
    }),

  // Add comment
  create: protectedProcedure
    .input(z.object({
      cardId: IdSchema,
      boardId: IdSchema,
      body: z.string().trim().min(1).max(10000),
    }))
    .mutation(async ({ input, ctx }) => {
      const id = crypto.randomUUID();
      await ctx.infra.db.insert(comments).values({
        id,
        tenantId: ctx.session.tenantId,
        cardId: input.cardId,
        boardId: input.boardId,
        authorId: ctx.session.user.id,
        body: input.body,
      });

      return {
        id,
        authorId: ctx.session.user.id,
        body: input.body,
        createdAt: new Date().toISOString(),
      };
    }),

  // Edit comment (only author)
  update: protectedProcedure
    .input(z.object({ commentId: IdSchema, body: z.string().trim().min(1).max(10000) }))
    .mutation(async ({ input, ctx }) => {
      const comment = await ctx.infra.db.query.comments.findFirst({
        where: and(eq(comments.id, input.commentId), isNull(comments.deletedAt)),
      });

      if (!comment) throw new TRPCError({ code: "NOT_FOUND" });
      if (comment.authorId !== ctx.session.user.id) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the author can edit." });
      }

      await ctx.infra.db.update(comments).set({
        body: input.body,
        editedAt: new Date(),
      }).where(eq(comments.id, input.commentId));

      return { success: true };
    }),

  // Delete comment (soft — only author or admin)
  delete: protectedProcedure
    .input(z.object({ commentId: IdSchema }))
    .mutation(async ({ input, ctx }) => {
      const comment = await ctx.infra.db.query.comments.findFirst({
        where: and(eq(comments.id, input.commentId), isNull(comments.deletedAt)),
      });

      if (!comment) throw new TRPCError({ code: "NOT_FOUND" });

      // Only author or tenant admin can delete
      const isAuthor = comment.authorId === ctx.session.user.id;
      const isAdmin = ctx.session.roles?.includes("ADMIN") || ctx.session.roles?.includes("OWNER");

      if (!isAuthor && !isAdmin) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Cannot delete this comment." });
      }

      await ctx.infra.db.update(comments).set({ deletedAt: new Date() }).where(
        eq(comments.id, input.commentId)
      );
      return { success: true };
    }),
});
