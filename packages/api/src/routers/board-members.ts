// packages/api/src/routers/board-members.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// Board membership router (F3b refactor).
//
// F3b changes:
//   • All four procedures migrated from the legacy assertBoardAdminOrOwner
//     helper to F2 role-aware procedure builders (boardMemberProcedure for
//     reads, boardAdminProcedure for writes). The previous inline role
//     check is now performed by the procedure pipeline.
//   • inviteMember now enforces the workspace-member-first invariant:
//     a user cannot be invited to a board until they are a member of the
//     board's parent workspace. This blocks the "stranger in board" class
//     of bugs where a user has board access but cannot navigate the
//     workspace context. Validation lives in domain/board/use-cases/
//     addBoardMember.ts so the rule can be unit-tested without a tRPC
//     pipeline.
//   • Every mutation emits a board.member.* outbox event in the same RLS-
//     enforced transaction as the write.
//   • Every mutation accepts an optional idempotencyKey and is wrapped in
//     withIdempotency() for replay safety.
//   • Redundant `eq(boardMembers.tenantId, ctx.session.tenantId)` filters
//     removed — tenantContextMiddleware sets the RLS GUC, and the F2
//     boardMemberGuard already established the board's tenant context.
//
// Public surface (procedure names) preserved unchanged:
//   getMembers / inviteMember / removeMember / changeRole.
//
// `inviteMember` keeps its name (not renamed to addMember) per D10 from
// the F3b plan: BoardMembersPanel.tsx in the existing frontend already
// calls trpc.v1.public.boardMembers.inviteMember.useMutation(), and a
// rename would be a breaking change. A future namespace migration phase
// can rename + add a Trello-faithful invitation flow.
//
// `userId` is validated as `z.string().min(1).max(128)` (NOT uuid) per
// D9 in the F3b plan: the underlying schema (boardMembers.user_id) is
// `varchar(128)` deliberately — the plain-uuid contract is owned by the
// application layer in F3c. Tightening to `.uuid()` here would diverge
// from the DB schema authority.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, isNull } from "drizzle-orm";

import { router } from "../trpc";
import { boardMemberProcedure, boardAdminProcedure } from "../middleware/boardRoleProcedures";
import { throwAddBoardMemberError } from "../middleware/invariants/boardInvariants";
import { withIdempotency } from "../utils/idempotency";
import { boardMembers, boards, workspaceMembers, users } from "@repo/db";
import { addBoardMember, type BoardMemberRole } from "@repo/domain";

// ─── Schemas ────────────────────────────────────────────────────────────────

const BoardIdSchema = z.string().uuid();
/**
 * userId is varchar(128) at the DB schema layer, not strictly UUID, per
 * D9 from the F3b plan. Keep this contract until a separate phase
 * migrates the column to uuid + FK on users.id.
 */
const UserIdSchema = z.string().min(1).max(128);
const RoleSchema = z.enum(["ADMIN", "MEMBER"]);
const IdempotencyKeySchema = z.string().uuid().optional();

// ─── Router ─────────────────────────────────────────────────────────────────

export const boardMembersRouter = router({
  // ── getMembers (any active member can read) ──────────────────────────────
  //
  // boardMemberProcedure (= boardProtectedProcedure) verifies the caller
  // has an active membership row before this resolver runs and exposes
  // ctx.boardMembership.role for the response.
  getMembers: boardMemberProcedure
    .input(z.object({ boardId: BoardIdSchema }))
    .query(async ({ input, ctx }) => {
      // F5b refactor — JOIN users so the settings drawer can render
      // avatars + display names without a second round-trip. The
      // pre-F5b shape (id, userId, role, joinedAt) is preserved and
      // EXTENDED with an optional `user` projection. The existing
      // BoardMembersPanel consumer (which only reads id/userId/role)
      // is structurally compatible with the widened shape.
      //
      // LEFT JOIN — defence-in-depth for the (rare) case where a
      // board_members row points at a deleted user. Surfaces as
      // `user: null` on the client, which the UI renders as
      // "کاربر حذف‌شده".
      const rows = await ctx.infra.db
        .select({
          id: boardMembers.id,
          userId: boardMembers.userId,
          role: boardMembers.role,
          createdAt: boardMembers.createdAt,
          userIdJoined: users.id,
          userEmail: users.email,
          userDisplayName: users.displayName,
          userAvatarUrl: users.avatarUrl,
        })
        .from(boardMembers)
        .leftJoin(users, eq(users.id, boardMembers.userId))
        .where(
          and(
            eq(boardMembers.boardId, input.boardId),
            isNull(boardMembers.removedAt),
          ),
        );

      return {
        members: rows.map((r: any) => ({
          id: r.id,
          userId: r.userId,
          role: r.role,
          joinedAt: r.createdAt.toISOString(),
          user: r.userIdJoined
            ? {
                email: r.userEmail as string,
                displayName: r.userDisplayName as string,
                avatarUrl: (r.userAvatarUrl as string | null) ?? null,
              }
            : null,
        })),
        currentUserRole: (ctx as any).boardMembership.role,
      };
    }),

  // ── inviteMember (admin) ─────────────────────────────────────────────────
  //
  // F3b changes:
  //   • F2 boardAdminProcedure replaces inline assertBoardAdminOrOwner.
  //   • workspace-member-first invariant enforced via the addBoardMember
  //     domain use case. The router does the workspace membership lookup
  //     and passes the boolean into the use case.
  //   • Outbox event board.member.added emitted with wasReactivated flag
  //     so subscribers can distinguish a fresh add from a re-add.
  inviteMember: boardAdminProcedure
    .input(
      z.object({
        boardId: BoardIdSchema,
        userId: UserIdSchema,
        role: RoleSchema.default("MEMBER"),
        idempotencyKey: IdempotencyKeySchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return withIdempotency(ctx, input.idempotencyKey, "v1", async () => {
        // Resolve the board's tenant (= workspace) for the invariant check.
        // boardMemberGuard already loaded the board into the request, so
        // we need its tenantId here.
        const board = await ctx.infra.db.query.boards.findFirst({
          where: and(eq(boards.id, input.boardId), isNull(boards.deletedAt)),
        });
        if (!board) {
          throw new TRPCError({ code: "NOT_FOUND", message: "بورد یافت نشد." });
        }

        // Workspace-member-first lookup. The user must already be a
        // member of the parent workspace.
        const workspaceMembership =
          await ctx.infra.db.query.workspaceMembers.findFirst({
            where: and(
              eq(workspaceMembers.workspaceId, board.tenantId),
              eq(workspaceMembers.userId, input.userId),
            ),
          });

        // Existing board membership state (active or soft-removed).
        const existing = await ctx.infra.db.query.boardMembers.findFirst({
          where: and(
            eq(boardMembers.boardId, input.boardId),
            eq(boardMembers.userId, input.userId),
          ),
        });

        // Domain use case — pure validation + state-machine decision.
        const result = addBoardMember({
          callerUserId: ctx.session.user.id,
          targetUserId: input.userId,
          targetIsWorkspaceMember: Boolean(workspaceMembership),
          existingMembership: existing
            ? { id: existing.id, removedAt: existing.removedAt ?? null }
            : null,
        });

        if (!result.success) {
          throwAddBoardMemberError(result.reason);
        }

        const now = new Date();

        // Branch on the action the use case decided.
        switch (result.action) {
          case "ALREADY_ACTIVE_MEMBER":
            // Idempotent — return success without write or event.
            return {
              success: true,
              alreadyMember: true,
              memberId: existing!.id,
            };

          case "REACTIVATE_REMOVED_ROW": {
            await ctx.infra.db
              .update(boardMembers)
              .set({
                removedAt: null,
                role: input.role,
                updatedAt: now,
              })
              .where(eq(boardMembers.id, existing!.id));

            await ctx.repos.outbox.append(ctx.infra.db, {
              eventId: crypto.randomUUID(),
              eventVersion: "v1",
              aggregateId: input.boardId,
              aggregateType: "board",
              type: "board.member.added",
              occurredAt: now,
              correlationId: input.idempotencyKey ?? undefined,
              payload: {
                boardId: input.boardId,
                tenantId: board.tenantId,
                userId: input.userId,
                role: input.role as BoardMemberRole,
                addedBy: ctx.session.user.id,
                wasReactivated: true,
              },
            });

            return {
              success: true,
              alreadyMember: false,
              memberId: existing!.id,
            };
          }

          case "INSERT_NEW_ROW": {
            const memberId = crypto.randomUUID();
            await ctx.infra.db.insert(boardMembers).values({
              id: memberId,
              tenantId: board.tenantId,
              boardId: input.boardId,
              userId: input.userId,
              role: input.role,
              revision: 1,
              createdAt: now,
              updatedAt: now,
            });

            await ctx.repos.outbox.append(ctx.infra.db, {
              eventId: crypto.randomUUID(),
              eventVersion: "v1",
              aggregateId: input.boardId,
              aggregateType: "board",
              type: "board.member.added",
              occurredAt: now,
              correlationId: input.idempotencyKey ?? undefined,
              payload: {
                boardId: input.boardId,
                tenantId: board.tenantId,
                userId: input.userId,
                role: input.role as BoardMemberRole,
                addedBy: ctx.session.user.id,
                wasReactivated: false,
              },
            });

            return { success: true, alreadyMember: false, memberId };
          }
        }
      });
    }),

  // ── removeMember (admin) ─────────────────────────────────────────────────
  //
  // Cannot remove self (use leave-board flow when added in a future phase).
  // ADMIN cannot remove an OWNER.
  removeMember: boardAdminProcedure
    .input(
      z.object({
        boardId: BoardIdSchema,
        userId: UserIdSchema,
        idempotencyKey: IdempotencyKeySchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return withIdempotency(ctx, input.idempotencyKey, "v1", async () => {
        const callerRole = (ctx as any).boardMembership.role as string;

        if (input.userId === ctx.session.user.id) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "نمی‌توانید خودتان را حذف کنید. ابتدا مالکیت را منتقل کنید یا از بورد خارج شوید.",
          });
        }

        const target = await ctx.infra.db.query.boardMembers.findFirst({
          where: and(
            eq(boardMembers.boardId, input.boardId),
            eq(boardMembers.userId, input.userId),
            isNull(boardMembers.removedAt),
          ),
        });

        if (!target) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "این کاربر عضو بورد نیست.",
          });
        }

        if (target.role === "OWNER" && callerRole !== "OWNER") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "تنها مالک می‌تواند مالک دیگری را حذف کند.",
          });
        }

        const now = new Date();

        await ctx.infra.db
          .update(boardMembers)
          .set({ removedAt: now, updatedAt: now })
          .where(eq(boardMembers.id, target.id));

        await ctx.repos.outbox.append(ctx.infra.db, {
          eventId: crypto.randomUUID(),
          eventVersion: "v1",
          aggregateId: input.boardId,
          aggregateType: "board",
          type: "board.member.removed",
          occurredAt: now,
          correlationId: input.idempotencyKey ?? undefined,
          payload: {
            boardId: input.boardId,
            userId: input.userId,
            removedBy: ctx.session.user.id,
          },
        });

        return { success: true };
      });
    }),

  // ── changeRole (admin) ───────────────────────────────────────────────────
  //
  // Only OWNER can promote to ADMIN. OWNER role cannot be changed
  // through this procedure (would require an ownership-transfer flow,
  // out of F3b scope).
  changeRole: boardAdminProcedure
    .input(
      z.object({
        boardId: BoardIdSchema,
        userId: UserIdSchema,
        newRole: RoleSchema,
        idempotencyKey: IdempotencyKeySchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return withIdempotency(ctx, input.idempotencyKey, "v1", async () => {
        const callerRole = (ctx as any).boardMembership.role as string;

        if (input.newRole === "ADMIN" && callerRole !== "OWNER") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "تنها مالک می‌تواند کاربر را به مدیر ارتقا دهد.",
          });
        }

        const target = await ctx.infra.db.query.boardMembers.findFirst({
          where: and(
            eq(boardMembers.boardId, input.boardId),
            eq(boardMembers.userId, input.userId),
            isNull(boardMembers.removedAt),
          ),
        });

        if (!target) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "این کاربر عضو بورد نیست.",
          });
        }

        if (target.role === "OWNER") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "نقش مالک از این مسیر قابل تغییر نیست.",
          });
        }

        // No-op short-circuit — silent success, no event.
        if (target.role === input.newRole) {
          return {
            success: true,
            unchanged: true,
            role: input.newRole,
          };
        }

        const fromRole = target.role as BoardMemberRole;
        const now = new Date();

        await ctx.infra.db
          .update(boardMembers)
          .set({ role: input.newRole, updatedAt: now })
          .where(eq(boardMembers.id, target.id));

        await ctx.repos.outbox.append(ctx.infra.db, {
          eventId: crypto.randomUUID(),
          eventVersion: "v1",
          aggregateId: input.boardId,
          aggregateType: "board",
          type: "board.member.role_changed",
          occurredAt: now,
          correlationId: input.idempotencyKey ?? undefined,
          payload: {
            boardId: input.boardId,
            userId: input.userId,
            fromRole,
            toRole: input.newRole as BoardMemberRole,
            changedBy: ctx.session.user.id,
          },
        });

        return { success: true, unchanged: false, role: input.newRole };
      });
    }),
});
