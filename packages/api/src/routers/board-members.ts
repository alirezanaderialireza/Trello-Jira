// packages/api/src/routers/board-members.ts
//
// Board membership management: list members, invite, remove, change role.
// All mutations require OWNER or ADMIN role on the target board.

import crypto from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, isNull } from "drizzle-orm";

import { router, protectedProcedure } from "../trpc";
import { boardMembers, boards } from "@repo/db";

// ============================================================================
// Schemas
// ============================================================================

const BoardIdSchema = z.string().uuid();
const UserIdSchema = z.string().min(1).max(128);
const RoleSchema = z.enum(["ADMIN", "MEMBER"]);

// ============================================================================
// Helpers
// ============================================================================

async function assertBoardAdminOrOwner(ctx: any, boardId: string) {
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
    throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required to manage members." });
  }

  return membership;
}

async function assertBoardExists(ctx: any, boardId: string) {
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

export const boardMembersRouter = router({
  // ==========================================================================
  // GET BOARD MEMBERS
  // ==========================================================================

  getMembers: protectedProcedure
    .input(z.object({ boardId: BoardIdSchema }))
    .query(async ({ input, ctx }) => {
      // Any member of the board can view other members
      const selfMembership = await ctx.infra.db.query.boardMembers.findFirst({
        where: and(
          eq(boardMembers.boardId, input.boardId),
          eq(boardMembers.userId, ctx.session.user.id),
          eq(boardMembers.tenantId, ctx.session.tenantId),
          isNull(boardMembers.removedAt),
        ),
      });

      if (!selfMembership) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Board not found." });
      }

      const members = await ctx.infra.db.query.boardMembers.findMany({
        where: and(
          eq(boardMembers.boardId, input.boardId),
          eq(boardMembers.tenantId, ctx.session.tenantId),
          isNull(boardMembers.removedAt),
        ),
      });

      return {
        members: members.map((m: any) => ({
          id: m.id,
          userId: m.userId,
          role: m.role,
          joinedAt: m.createdAt.toISOString(),
        })),
        currentUserRole: selfMembership.role,
      };
    }),

  // ==========================================================================
  // INVITE MEMBER (add user to board)
  // ==========================================================================

  inviteMember: protectedProcedure
    .input(
      z.object({
        boardId: BoardIdSchema,
        userId: UserIdSchema,
        role: RoleSchema.default("MEMBER"),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      await assertBoardAdminOrOwner(ctx, input.boardId);
      await assertBoardExists(ctx, input.boardId);

      // Cannot invite yourself
      if (input.userId === ctx.session.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot invite yourself." });
      }

      // Check if already a member (not removed)
      const existing = await ctx.infra.db.query.boardMembers.findFirst({
        where: and(
          eq(boardMembers.boardId, input.boardId),
          eq(boardMembers.userId, input.userId),
          eq(boardMembers.tenantId, ctx.session.tenantId),
          isNull(boardMembers.removedAt),
        ),
      });

      if (existing) {
        // Already a member — idempotent, return success without duplicate
        return { success: true, alreadyMember: true, memberId: existing.id };
      }

      // Check if previously removed — reactivate instead of creating new row
      const previouslyRemoved = await ctx.infra.db.query.boardMembers.findFirst({
        where: and(
          eq(boardMembers.boardId, input.boardId),
          eq(boardMembers.userId, input.userId),
          eq(boardMembers.tenantId, ctx.session.tenantId),
        ),
      });

      const now = new Date();

      if (previouslyRemoved) {
        // Reactivate
        await ctx.infra.db
          .update(boardMembers)
          .set({
            removedAt: null,
            role: input.role,
            updatedAt: now,
          })
          .where(eq(boardMembers.id, previouslyRemoved.id));

        ctx.infra.logger.info({
          event: "board_member_reactivated",
          boardId: input.boardId,
          userId: input.userId,
          role: input.role,
          invitedBy: ctx.session.user.id,
        });

        return { success: true, alreadyMember: false, memberId: previouslyRemoved.id };
      }

      // Create new membership
      const memberId = crypto.randomUUID();
      await ctx.infra.db.insert(boardMembers).values({
        id: memberId,
        tenantId: ctx.session.tenantId,
        boardId: input.boardId,
        userId: input.userId,
        role: input.role,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      });

      ctx.infra.logger.info({
        event: "board_member_invited",
        boardId: input.boardId,
        userId: input.userId,
        role: input.role,
        invitedBy: ctx.session.user.id,
      });

      return { success: true, alreadyMember: false, memberId };
    }),

  // ==========================================================================
  // REMOVE MEMBER (soft delete — sets removedAt)
  // ==========================================================================

  removeMember: protectedProcedure
    .input(
      z.object({
        boardId: BoardIdSchema,
        userId: UserIdSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const adminMembership = await assertBoardAdminOrOwner(ctx, input.boardId);

      // Cannot remove yourself (use "leave board" instead, or transfer ownership)
      if (input.userId === ctx.session.user.id) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot remove yourself. Transfer ownership first." });
      }

      // Cannot remove OWNER unless you are also OWNER
      const targetMembership = await ctx.infra.db.query.boardMembers.findFirst({
        where: and(
          eq(boardMembers.boardId, input.boardId),
          eq(boardMembers.userId, input.userId),
          eq(boardMembers.tenantId, ctx.session.tenantId),
          isNull(boardMembers.removedAt),
        ),
      });

      if (!targetMembership) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Member not found." });
      }

      if (targetMembership.role === "OWNER" && adminMembership.role !== "OWNER") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only an owner can remove another owner." });
      }

      await ctx.infra.db
        .update(boardMembers)
        .set({ removedAt: new Date(), updatedAt: new Date() })
        .where(eq(boardMembers.id, targetMembership.id));

      ctx.infra.logger.info({
        event: "board_member_removed",
        boardId: input.boardId,
        userId: input.userId,
        removedBy: ctx.session.user.id,
      });

      return { success: true };
    }),

  // ==========================================================================
  // CHANGE MEMBER ROLE
  // ==========================================================================

  changeRole: protectedProcedure
    .input(
      z.object({
        boardId: BoardIdSchema,
        userId: UserIdSchema,
        newRole: RoleSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const adminMembership = await assertBoardAdminOrOwner(ctx, input.boardId);

      // Only OWNER can promote/demote to ADMIN
      if (input.newRole === "ADMIN" && adminMembership.role !== "OWNER") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner can promote to admin." });
      }

      const targetMembership = await ctx.infra.db.query.boardMembers.findFirst({
        where: and(
          eq(boardMembers.boardId, input.boardId),
          eq(boardMembers.userId, input.userId),
          eq(boardMembers.tenantId, ctx.session.tenantId),
          isNull(boardMembers.removedAt),
        ),
      });

      if (!targetMembership) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Member not found." });
      }

      if (targetMembership.role === "OWNER") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Cannot change the owner's role." });
      }

      await ctx.infra.db
        .update(boardMembers)
        .set({ role: input.newRole, updatedAt: new Date() })
        .where(eq(boardMembers.id, targetMembership.id));

      ctx.infra.logger.info({
        event: "board_member_role_changed",
        boardId: input.boardId,
        userId: input.userId,
        oldRole: targetMembership.role,
        newRole: input.newRole,
        changedBy: ctx.session.user.id,
      });

      return { success: true };
    }),
});
