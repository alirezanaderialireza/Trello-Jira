// packages/api/src/routers/board-management.ts
//
// Board lifecycle management: list boards, create, rename, archive, delete.
// All mutations are tenant-isolated and role-checked.

import crypto from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, isNull, desc } from "drizzle-orm";

import { router, protectedProcedure } from "../trpc";
import { boards, boardMembers } from "@repo/db";

// ============================================================================
// Shared schemas
// ============================================================================

const BoardIdSchema = z.string().uuid();
const TitleSchema = z.string().trim().min(1).max(128);

// ============================================================================
// Helpers
// ============================================================================

async function assertBoardAdmin(ctx: any, boardId: string) {
  const membership = await ctx.infra.db.query.boardMembers.findFirst({
    where: and(
      eq(boardMembers.boardId, boardId),
      eq(boardMembers.userId, ctx.session.user.id),
      eq(boardMembers.tenantId, ctx.session.tenantId),
      isNull(boardMembers.removedAt),
    ),
  });

  if (!membership) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Board not found." });
  }

  if (membership.role !== "OWNER" && membership.role !== "ADMIN") {
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required." });
  }

  return membership;
}

async function getBoard(ctx: any, boardId: string) {
  const board = await ctx.infra.db.query.boards.findFirst({
    where: and(
      eq(boards.id, boardId),
      eq(boards.tenantId, ctx.session.tenantId),
      isNull(boards.deletedAt),
    ),
  });

  if (!board) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Board not found." });
  }

  return board;
}

// ============================================================================
// Router
// ============================================================================

export const boardManagementRouter = router({
  // ==========================================================================
  // GET BOARDS BY USER
  // ==========================================================================

  getBoardsByUser: protectedProcedure
    .input(
      z.object({
        cursor: z.string().uuid().optional(),
        limit: z.number().int().min(1).max(50).default(20),
        includeArchived: z.boolean().default(false),
      }).optional(),
    )
    .query(async ({ input, ctx }) => {
      const limit = input?.limit ?? 20;
      const includeArchived = input?.includeArchived ?? false;

      // Step 1: Get all board IDs the user is a member of
      const memberships = await ctx.infra.db.query.boardMembers.findMany({
        where: and(
          eq(boardMembers.userId, ctx.session.user.id),
          eq(boardMembers.tenantId, ctx.session.tenantId),
          isNull(boardMembers.removedAt),
        ),
        orderBy: [desc(boardMembers.createdAt)],
      });

      if (memberships.length === 0) {
        return { boards: [], nextCursor: undefined };
      }

      const boardIds = memberships.map((m: any) => m.boardId);
      const roleMap = new Map(memberships.map((m: any) => [m.boardId, m.role]));

      // Step 2: Fetch board details
      const allBoards = await ctx.infra.db
        .select()
        .from(boards)
        .where(
          and(
            eq(boards.tenantId, ctx.session.tenantId),
            isNull(boards.deletedAt),
          ),
        )
        .orderBy(desc(boards.updatedAt));

      // Filter to boards user is member of + archive filter
      let filtered = allBoards.filter((b: any) => boardIds.includes(b.id));
      if (!includeArchived) {
        filtered = filtered.filter((b: any) => !b.archivedAt);
      }

      // Cursor-based pagination
      let startIdx = 0;
      if (input?.cursor) {
        const cursorIdx = filtered.findIndex((b: any) => b.id === input.cursor);
        if (cursorIdx !== -1) startIdx = cursorIdx + 1;
      }

      const page = filtered.slice(startIdx, startIdx + limit);
      const nextCursor = page.length === limit ? page[page.length - 1]?.id : undefined;

      return {
        boards: page.map((b: any) => ({
          id: b.id,
          title: b.title,
          role: roleMap.get(b.id) ?? "MEMBER",
          archivedAt: b.archivedAt?.toISOString() ?? null,
          createdAt: b.createdAt.toISOString(),
          updatedAt: b.updatedAt.toISOString(),
        })),
        nextCursor,
      };
    }),

  // ==========================================================================
  // CREATE BOARD
  // ==========================================================================

  createBoard: protectedProcedure
    .input(z.object({ title: TitleSchema }))
    .mutation(async ({ input, ctx }) => {
      const boardId = crypto.randomUUID();
      const now = new Date();

      await ctx.infra.db.insert(boards).values({
        id: boardId,
        tenantId: ctx.session.tenantId,
        title: input.title,
        revision: 1,
        aclVersion: 1,
        currentSequence: 0,
        createdAt: now,
        updatedAt: now,
      });

      // Auto-add creator as OWNER
      await ctx.infra.db.insert(boardMembers).values({
        id: crypto.randomUUID(),
        tenantId: ctx.session.tenantId,
        boardId,
        userId: ctx.session.user.id,
        role: "OWNER",
        revision: 1,
        createdAt: now,
        updatedAt: now,
      });

      ctx.infra.logger.info({
        event: "board_created",
        boardId,
        userId: ctx.session.user.id,
        tenantId: ctx.session.tenantId,
      });

      return { id: boardId, title: input.title };
    }),

  // ==========================================================================
  // RENAME BOARD
  // ==========================================================================

  renameBoard: protectedProcedure
    .input(z.object({ boardId: BoardIdSchema, title: TitleSchema }))
    .mutation(async ({ input, ctx }) => {
      await assertBoardAdmin(ctx, input.boardId);
      const board = await getBoard(ctx, input.boardId);

      await ctx.infra.db
        .update(boards)
        .set({ title: input.title, updatedAt: new Date() })
        .where(eq(boards.id, input.boardId));

      ctx.infra.logger.info({
        event: "board_renamed",
        boardId: input.boardId,
        oldTitle: board.title,
        newTitle: input.title,
        userId: ctx.session.user.id,
      });

      return { success: true };
    }),

  // ==========================================================================
  // ARCHIVE BOARD
  // ==========================================================================

  archiveBoard: protectedProcedure
    .input(z.object({ boardId: BoardIdSchema }))
    .mutation(async ({ input, ctx }) => {
      await assertBoardAdmin(ctx, input.boardId);
      await getBoard(ctx, input.boardId);

      await ctx.infra.db
        .update(boards)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(eq(boards.id, input.boardId));

      ctx.infra.logger.info({
        event: "board_archived",
        boardId: input.boardId,
        userId: ctx.session.user.id,
      });

      return { success: true };
    }),

  // ==========================================================================
  // UNARCHIVE BOARD
  // ==========================================================================

  unarchiveBoard: protectedProcedure
    .input(z.object({ boardId: BoardIdSchema }))
    .mutation(async ({ input, ctx }) => {
      await assertBoardAdmin(ctx, input.boardId);

      await ctx.infra.db
        .update(boards)
        .set({ archivedAt: null, updatedAt: new Date() })
        .where(eq(boards.id, input.boardId));

      ctx.infra.logger.info({
        event: "board_unarchived",
        boardId: input.boardId,
        userId: ctx.session.user.id,
      });

      return { success: true };
    }),

  // ==========================================================================
  // DELETE BOARD (soft delete)
  // ==========================================================================

  deleteBoard: protectedProcedure
    .input(z.object({ boardId: BoardIdSchema }))
    .mutation(async ({ input, ctx }) => {
      const membership = await assertBoardAdmin(ctx, input.boardId);

      // Only OWNER can delete
      if (membership.role !== "OWNER") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the board owner can delete." });
      }

      await getBoard(ctx, input.boardId);

      await ctx.infra.db
        .update(boards)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(boards.id, input.boardId));

      ctx.infra.logger.info({
        event: "board_deleted",
        boardId: input.boardId,
        userId: ctx.session.user.id,
      });

      return { success: true };
    }),
});
