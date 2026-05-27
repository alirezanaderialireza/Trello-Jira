// packages/api/src/routers/workspaces/members.router.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// Workspace members sub-router (F3a.2)
//
// Mounted at v1.public.workspace.members (singular `workspace.`, plural
// `members.`) inside workspacesRouter. The F2 role-aware builders
// (workspaceMemberProcedure / workspaceAdminProcedure /
// workspaceOwnerProcedure) provide all authorization; this file only
// implements the five lifecycle procedures and the bug-fixes flagged on
// PR #50 (transferOwnership tx wrap, removeMember last-owner race).
//
// Race-condition story (the bug F3a.1 promised to fix in F3a.2):
//
//   The pre-F3a.2 procedures read membership state, decided whether a
//   write was safe, then wrote — without a row-level lock. Under
//   concurrent calls (two admins racing to remove the last OWNER, or
//   two transferOwnership calls landing simultaneously) Postgres's
//   default READ COMMITTED isolation lets both transactions see the
//   same pre-write snapshot and proceed with conflicting writes,
//   leaving the workspace ownerless.
//
//   F3a.2 fixes this by acquiring row-level locks on every membership
//   row the procedure inspects (`SELECT ... FOR UPDATE` via Drizzle's
//   `.for("update")`). Concurrent transactions then queue at the lock
//   acquisition step, the second one re-reads the locked rows after
//   the first commits, and its invariant check correctly rejects the
//   no-longer-safe write.
//
//   Tx scope: the F2 builders all run inside ctx.runInTenantTx via the
//   tenantContextMiddleware, so `ctx.infra.db` IS the request's tx.
//   No additional wrapping is needed — we just have to keep all SELECTs
//   and writes on `ctx.infra.db` (not on the original `db` instance).
//
// Idempotency: every mutation accepts `idempotencyKey?: string` and is
// wrapped in `withIdempotency()`. See utils/idempotency.ts for the
// contract.
//
// Outbox topics emitted (all under aggregateType: "workspace"):
//   workspace.member.role_updated
//   workspace.member.removed
//   workspace.member.left
//   workspace.member.ownership_transferred
// ─────────────────────────────────────────────────────────────────────────────

import crypto from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and } from "drizzle-orm";

import { router } from "../../trpc";
import {
  workspaceMemberProcedure,
  workspaceAdminProcedure,
  workspaceOwnerProcedure,
} from "../../middleware/workspaceRoleProcedures";
import { withIdempotency } from "../../utils/idempotency";
import { workspaces, workspaceMembers } from "@repo/db";
import {
  transferOwnership,
  type WorkspaceRole,
} from "@repo/domain/workspaces";

// ─── Shared schemas ─────────────────────────────────────────────────────────

const IdSchema = z.string().uuid();
const IdempotencyKeySchema = z.string().uuid().optional();

/**
 * Role schema for INPUT validation. OWNER is intentionally excluded —
 * promoting to OWNER goes exclusively through `transferOwnership`,
 * which atomically demotes the previous OWNER in the same tx.
 */
const AssignableRoleSchema = z.enum(["ADMIN", "MEMBER", "VIEWER"]);

// ─── Router ─────────────────────────────────────────────────────────────────

export const workspaceMembersRouter = router({
  // ── members.list (any active member) ──────────────────────────────────────
  //
  // Returns every member of the workspace plus the public user fields the
  // members tab needs (displayName, avatarUrl, email, lastSeenAt). Order:
  // earliest-joined first.
  list: workspaceMemberProcedure
    .input(z.object({ workspaceId: IdSchema }))
    .query(async ({ input, ctx }) => {
      const members = await ctx.repos.workspace.listMembersWithUserInfo(
        input.workspaceId,
      );
      return members.map((m) => ({
        userId: m.userId,
        role: m.role,
        joinedAt: m.joinedAt,
        invitedBy: m.invitedBy,
        user: m.user,
      }));
    }),

  // ── members.updateRole (admin) ────────────────────────────────────────────
  //
  // Cannot mint or demote OWNERs — `AssignableRoleSchema` excludes OWNER,
  // and demoting an existing OWNER is rejected with a Persian message
  // pointing to transferOwnership. No-op short-circuit when the new role
  // matches the current role.
  updateRole: workspaceAdminProcedure
    .input(
      z.object({
        workspaceId: IdSchema,
        userId: IdSchema,
        role: AssignableRoleSchema,
        idempotencyKey: IdempotencyKeySchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return withIdempotency(ctx, input.idempotencyKey, "v1", async () => {
        const target = await ctx.infra.db.query.workspaceMembers.findFirst({
          where: and(
            eq(workspaceMembers.workspaceId, input.workspaceId),
            eq(workspaceMembers.userId, input.userId),
          ),
        });
        if (!target) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "این کاربر عضو فضای کاری نیست.",
          });
        }
        if (target.role === "OWNER") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "کاهش نقش مالک ممکن نیست — ابتدا مالکیت را منتقل کنید.",
          });
        }
        if (target.role === input.role) {
          return {
            success: true,
            workspaceId: input.workspaceId,
            userId: input.userId,
            role: input.role,
            unchanged: true,
          };
        }

        const fromRole = target.role as WorkspaceRole;

        await ctx.infra.db
          .update(workspaceMembers)
          .set({ role: input.role })
          .where(
            and(
              eq(workspaceMembers.workspaceId, input.workspaceId),
              eq(workspaceMembers.userId, input.userId),
            ),
          );

        await ctx.repos.outbox.append(ctx.infra.db, {
          eventId: crypto.randomUUID(),
          eventVersion: "v1",
          aggregateId: input.workspaceId,
          aggregateType: "workspace",
          type: "workspace.member.role_updated",
          occurredAt: new Date(),
          correlationId: input.idempotencyKey ?? undefined,
          payload: {
            workspaceId: input.workspaceId,
            userId: input.userId,
            fromRole,
            toRole: input.role as WorkspaceRole,
            changedBy: ctx.session.user.id,
          },
        });

        return {
          success: true,
          workspaceId: input.workspaceId,
          userId: input.userId,
          role: input.role,
          unchanged: false,
        };
      });
    }),

  // ── members.remove (admin) ────────────────────────────────────────────────
  //
  // Bug fix from PR #50: pre-F3a.2 the legacy procedure read owners.length
  // then deleted — race-condition under concurrent removeMember(lastOwner).
  // F3a.2 acquires a row-level lock on the target row AND on every OWNER
  // row before validating + deleting, all inside the request tx.
  remove: workspaceAdminProcedure
    .input(
      z.object({
        workspaceId: IdSchema,
        userId: IdSchema,
        idempotencyKey: IdempotencyKeySchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return withIdempotency(ctx, input.idempotencyKey, "v1", async () => {
        const targetRows = await ctx.infra.db
          .select()
          .from(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, input.workspaceId),
              eq(workspaceMembers.userId, input.userId),
            ),
          )
          .for("update");

        const target = targetRows[0];
        if (!target) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "این کاربر عضو فضای کاری نیست.",
          });
        }

        // Last-owner guard with row locks.
        if (target.role === "OWNER") {
          const owners = await ctx.infra.db
            .select()
            .from(workspaceMembers)
            .where(
              and(
                eq(workspaceMembers.workspaceId, input.workspaceId),
                eq(workspaceMembers.role, "OWNER"),
              ),
            )
            .for("update");
          if (owners.length <= 1) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message:
                "حذف آخرین مالک ممکن نیست — ابتدا مالکیت را منتقل کنید.",
            });
          }
        }

        await ctx.infra.db
          .delete(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, input.workspaceId),
              eq(workspaceMembers.userId, input.userId),
            ),
          );

        await ctx.repos.outbox.append(ctx.infra.db, {
          eventId: crypto.randomUUID(),
          eventVersion: "v1",
          aggregateId: input.workspaceId,
          aggregateType: "workspace",
          type: "workspace.member.removed",
          occurredAt: new Date(),
          correlationId: input.idempotencyKey ?? undefined,
          payload: {
            workspaceId: input.workspaceId,
            userId: input.userId,
            removedBy: ctx.session.user.id,
          },
        });

        return {
          success: true,
          workspaceId: input.workspaceId,
          userId: input.userId,
        };
      });
    }),

  // ── members.leave (any active member) ─────────────────────────────────────
  //
  // Self-removal. Same last-owner guard as `remove` — if the only OWNER
  // tries to leave, they must `transferOwnership` first.
  leave: workspaceMemberProcedure
    .input(
      z.object({
        workspaceId: IdSchema,
        idempotencyKey: IdempotencyKeySchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return withIdempotency(ctx, input.idempotencyKey, "v1", async () => {
        const userId = ctx.session.user.id;

        const targetRows = await ctx.infra.db
          .select()
          .from(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, input.workspaceId),
              eq(workspaceMembers.userId, userId),
            ),
          )
          .for("update");

        const target = targetRows[0];
        if (!target) {
          // workspaceMemberProcedure already validated membership; defensive.
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "شما عضو این فضای کاری نیستید.",
          });
        }

        if (target.role === "OWNER") {
          const owners = await ctx.infra.db
            .select()
            .from(workspaceMembers)
            .where(
              and(
                eq(workspaceMembers.workspaceId, input.workspaceId),
                eq(workspaceMembers.role, "OWNER"),
              ),
            )
            .for("update");
          if (owners.length <= 1) {
            throw new TRPCError({
              code: "FORBIDDEN",
              message:
                "آخرین مالک نمی‌تواند فضای کاری را ترک کند — ابتدا مالکیت را منتقل کنید.",
            });
          }
        }

        await ctx.infra.db
          .delete(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, input.workspaceId),
              eq(workspaceMembers.userId, userId),
            ),
          );

        await ctx.repos.outbox.append(ctx.infra.db, {
          eventId: crypto.randomUUID(),
          eventVersion: "v1",
          aggregateId: input.workspaceId,
          aggregateType: "workspace",
          type: "workspace.member.left",
          occurredAt: new Date(),
          correlationId: input.idempotencyKey ?? undefined,
          payload: {
            workspaceId: input.workspaceId,
            userId,
          },
        });

        return { success: true, workspaceId: input.workspaceId };
      });
    }),

  // ── members.transferOwnership (owner) ─────────────────────────────────────
  //
  // Bug fix from PR #50: three updates now atomic. The F2
  // workspaceOwnerProcedure already runs the procedure inside
  // tenantContextMiddleware's tx (= ctx.infra.db), so no additional wrap
  // is needed — we just acquire row locks on caller and target rows
  // before reading/writing, and use the pure `transferOwnership` use case
  // for the validation rules.
  transferOwnership: workspaceOwnerProcedure
    .input(
      z.object({
        workspaceId: IdSchema,
        newOwnerId: IdSchema,
        idempotencyKey: IdempotencyKeySchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return withIdempotency(ctx, input.idempotencyKey, "v1", async () => {
        const currentOwnerUserId = ctx.session.user.id;

        // Acquire row locks on both membership rows. Concurrent
        // transferOwnership calls now serialise instead of racing.
        const callerRows = await ctx.infra.db
          .select()
          .from(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, input.workspaceId),
              eq(workspaceMembers.userId, currentOwnerUserId),
            ),
          )
          .for("update");

        const newOwnerRows = await ctx.infra.db
          .select()
          .from(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, input.workspaceId),
              eq(workspaceMembers.userId, input.newOwnerId),
            ),
          )
          .for("update");

        const newOwnerCurrentRole: WorkspaceRole | null = newOwnerRows[0]
          ? (newOwnerRows[0].role as WorkspaceRole)
          : null;

        const result = transferOwnership({
          currentOwnerUserId,
          newOwnerUserId: input.newOwnerId,
          newOwnerCurrentRole,
        });

        if (!result.success) {
          if (result.reason === "SELF_TRANSFER") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "نمی‌توانید مالکیت را به خودتان منتقل کنید.",
            });
          }
          if (result.reason === "NEW_OWNER_NOT_MEMBER") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "مالک جدید باید پیش از انتقال، عضو فضای کاری باشد.",
            });
          }
          // NEW_OWNER_ALREADY_OWNER — defensive guard against drifted data.
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "وضعیت مالکیت ناسازگار است.",
          });
        }

        // Re-verify the caller is still OWNER after acquiring the lock.
        // F2's workspaceOwnerProcedure read membership BEFORE the lock,
        // so there's a (tiny) window where another transferOwnership
        // could have demoted us. We catch it explicitly here.
        if (!callerRows[0] || callerRows[0].role !== "OWNER") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "شما دیگر مالک این فضای کاری نیستید.",
          });
        }

        const now = new Date();

        await ctx.infra.db
          .update(workspaceMembers)
          .set({ role: result.newOwnerNextRole })
          .where(
            and(
              eq(workspaceMembers.workspaceId, input.workspaceId),
              eq(workspaceMembers.userId, input.newOwnerId),
            ),
          );

        await ctx.infra.db
          .update(workspaceMembers)
          .set({ role: result.currentOwnerNextRole })
          .where(
            and(
              eq(workspaceMembers.workspaceId, input.workspaceId),
              eq(workspaceMembers.userId, currentOwnerUserId),
            ),
          );

        await ctx.infra.db
          .update(workspaces)
          .set({ ownerId: input.newOwnerId, updatedAt: now })
          .where(eq(workspaces.id, input.workspaceId));

        await ctx.repos.outbox.append(ctx.infra.db, {
          eventId: crypto.randomUUID(),
          eventVersion: "v1",
          aggregateId: input.workspaceId,
          aggregateType: "workspace",
          type: "workspace.member.ownership_transferred",
          occurredAt: now,
          correlationId: input.idempotencyKey ?? undefined,
          payload: {
            workspaceId: input.workspaceId,
            fromUserId: currentOwnerUserId,
            toUserId: input.newOwnerId,
          },
        });

        return {
          success: true,
          workspaceId: input.workspaceId,
          newOwnerId: input.newOwnerId,
        };
      });
    }),
});
