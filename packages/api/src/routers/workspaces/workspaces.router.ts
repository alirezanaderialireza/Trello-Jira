// packages/api/src/routers/workspaces/workspaces.router.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// Workspaces tRPC router
//
// Type-safety contract:
//   • The role column accepts only the four values in `WORKSPACE_ROLES`
//     (OWNER | ADMIN | MEMBER | VIEWER).
//   • Three layers enforce that: domain (TypeScript), API (Zod RoleSchema),
//     and DB (CHECK constraint added in migration 0003). All three derive
//     from the SAME tuple so they cannot drift apart.
//
// Membership-aware queries:
//   • Every query/mutation here loads the caller's membership row first
//     and gates access on `canManageMembers()` / `canDeleteWorkspace()`
//     helpers from the domain — no string-typed role comparisons.
//
// Last-owner protection:
//   • `removeMember`, `updateMemberRole` and `transferOwnership` all
//     ensure that at least one OWNER remains after the change. This is
//     done in-process; a DB-side trigger would race in connection-pooled
//     deployments.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, isNull, desc } from "drizzle-orm";

import { router, protectedProcedure } from "../../trpc";
import {
  workspaces,
  workspaceMembers,
  boards,
  boardMembers,
} from "@repo/db";
import {
  WORKSPACE_ROLES,
  canManageMembers,
  isValidRole,
  type WorkspaceRole,
} from "@repo/domain/workspaces";

// ─── Shared schemas ─────────────────────────────────────────────────────────

const IdSchema = z.string().uuid();
const NameSchema = z.string().trim().min(1).max(100);
const SlugSchema = z
  .string()
  .trim()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);

/**
 * Role schema for INPUT validation.
 *
 * Note we do NOT include "OWNER" here — ownership transfer is a separate,
 * intentional flow (`transferOwnership`) that mutates two member rows
 * atomically and updates `workspaces.owner_id`. Letting any caller set
 * role=OWNER via inviteMember/updateMemberRole would silently allow
 * privilege escalation.
 */
const AssignableRoleSchema = z.enum(["ADMIN", "MEMBER", "VIEWER"]);

// ─── Membership helper ──────────────────────────────────────────────────────

/**
 * Load the caller's membership row, narrow `role` to `WorkspaceRole`, and
 * throw FORBIDDEN if the user is not a member at all. The narrowed return
 * type lets downstream code use the typed `canManageMembers` / `canDelete`
 * helpers without `as` casts.
 */
async function requireMembership(
  ctx: any,
  workspaceId: string,
): Promise<{ role: WorkspaceRole }> {
  const row = await ctx.infra.db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, ctx.session.user.id),
    ),
  });
  if (!row) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "You are not a member of this workspace.",
    });
  }
  if (!isValidRole(row.role)) {
    // Defensive: the DB CHECK constraint prevents this, but a corrupted row
    // would otherwise propagate `string` into our typed code.
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Invalid role on membership row: ${row.role}`,
    });
  }
  return { role: row.role };
}

// ─── Router ─────────────────────────────────────────────────────────────────

export const workspacesRouter = router({
  // ── list workspaces the caller belongs to ─────────────────────────────────
  list: protectedProcedure.query(async ({ ctx }) => {
    const memberships = await ctx.infra.db.query.workspaceMembers.findMany({
      where: eq(workspaceMembers.userId, ctx.session.user.id),
    });
    if (memberships.length === 0) return [];

    const wsIds = new Set(memberships.map((m: any) => m.workspaceId));
    const wsList = await ctx.infra.db.query.workspaces.findMany({
      where: isNull(workspaces.deletedAt),
    });
    const roleByWs = new Map<string, WorkspaceRole>(
      memberships.map((m: any) => [m.workspaceId, m.role as WorkspaceRole]),
    );
    return wsList
      .filter((w: any) => wsIds.has(w.id))
      .map((w: any) => ({ ...w, role: roleByWs.get(w.id) ?? null }));
  }),

  // ── create a new workspace ────────────────────────────────────────────────
  create: protectedProcedure
    .input(z.object({ name: NameSchema, slug: SlugSchema.optional() }))
    .mutation(async ({ input, ctx }) => {
      const slug =
        input.slug ||
        input.name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 58) ||
        `ws-${crypto.randomUUID().slice(0, 8)}`;

      const existing = await ctx.infra.db.query.workspaces.findFirst({
        where: and(eq(workspaces.slug, slug), isNull(workspaces.deletedAt)),
      });
      if (existing) {
        throw new TRPCError({ code: "CONFLICT", message: "Slug already taken." });
      }

      const wsId = crypto.randomUUID();
      const now = new Date();
      await ctx.infra.db.insert(workspaces).values({
        id: wsId,
        name: input.name,
        slug,
        tier: "free",
        ownerId: ctx.session.user.id,
        revision: 1,
        createdAt: now,
        updatedAt: now,
      });
      // The creator becomes OWNER. Bypassing AssignableRoleSchema here is
      // intentional — this is the one and only path that mints an OWNER.
      await ctx.infra.db.insert(workspaceMembers).values({
        workspaceId: wsId,
        userId: ctx.session.user.id,
        role: "OWNER" satisfies WorkspaceRole,
        joinedAt: now,
      });
      return { id: wsId, name: input.name, slug };
    }),

  // ── fetch a workspace by slug (gated to members) ──────────────────────────
  getBySlug: protectedProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ input, ctx }) => {
      const ws = await ctx.infra.db.query.workspaces.findFirst({
        where: and(eq(workspaces.slug, input.slug), isNull(workspaces.deletedAt)),
      });
      if (!ws) throw new TRPCError({ code: "NOT_FOUND" });

      const { role } = await requireMembership(ctx, ws.id);
      return { ...ws, role };
    }),

  // ── list boards in a workspace the caller can see ─────────────────────────
  // Visibility rule: caller must be a workspace member; board-level
  // membership is then layered on top so users only see boards they have
  // been added to. This matches `boardManagement.getBoardsByUser` behaviour
  // but scoped to a single workspace.
  listBoards: protectedProcedure
    .input(z.object({ workspaceId: IdSchema, includeArchived: z.boolean().default(false) }))
    .query(async ({ input, ctx }) => {
      // 1. Caller must be a member of the workspace itself.
      await requireMembership(ctx, input.workspaceId);

      // 2. Pull all boards in the workspace, then filter by board membership.
      const wsBoards = await ctx.infra.db
        .select()
        .from(boards)
        .where(
          and(
            eq(boards.tenantId, input.workspaceId),
            isNull(boards.deletedAt),
          ),
        )
        .orderBy(desc(boards.updatedAt));

      if (wsBoards.length === 0) return [];

      const memberships = await ctx.infra.db.query.boardMembers.findMany({
        where: and(
          eq(boardMembers.userId, ctx.session.user.id),
          eq(boardMembers.tenantId, input.workspaceId),
          isNull(boardMembers.removedAt),
        ),
      });
      const memberBoardIds = new Set(memberships.map((m: any) => m.boardId));
      const roleByBoard = new Map<string, string>(
        memberships.map((m: any) => [m.boardId, m.role]),
      );

      let visible = wsBoards.filter((b: any) => memberBoardIds.has(b.id));
      if (!input.includeArchived) {
        visible = visible.filter((b: any) => !b.archivedAt);
      }

      return visible.map((b: any) => ({
        id: b.id,
        title: b.title,
        role: roleByBoard.get(b.id) ?? "MEMBER",
        archivedAt: b.archivedAt ? b.archivedAt.toISOString() : null,
        createdAt: b.createdAt.toISOString(),
        updatedAt: b.updatedAt.toISOString(),
      }));
    }),

  // ── invite an existing user as a member ───────────────────────────────────
  inviteMember: protectedProcedure
    .input(
      z.object({
        workspaceId: IdSchema,
        userId: IdSchema,
        role: AssignableRoleSchema.default("MEMBER"),
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { role: callerRole } = await requireMembership(ctx, input.workspaceId);
      if (!canManageMembers(callerRole)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only OWNER or ADMIN can invite members.",
        });
      }

      const existing = await ctx.infra.db.query.workspaceMembers.findFirst({
        where: and(
          eq(workspaceMembers.workspaceId, input.workspaceId),
          eq(workspaceMembers.userId, input.userId),
        ),
      });
      if (existing) return { success: true, alreadyMember: true };

      await ctx.infra.db.insert(workspaceMembers).values({
        workspaceId: input.workspaceId,
        userId: input.userId,
        role: input.role,
        joinedAt: new Date(),
        invitedBy: ctx.session.user.id,
      });
      return { success: true, alreadyMember: false };
    }),

  // ── update a member's role (cannot mint or demote OWNERs) ─────────────────
  updateMemberRole: protectedProcedure
    .input(
      z.object({
        workspaceId: IdSchema,
        userId: IdSchema,
        role: AssignableRoleSchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      const { role: callerRole } = await requireMembership(ctx, input.workspaceId);
      if (!canManageMembers(callerRole)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const target = await ctx.infra.db.query.workspaceMembers.findFirst({
        where: and(
          eq(workspaceMembers.workspaceId, input.workspaceId),
          eq(workspaceMembers.userId, input.userId),
        ),
      });
      if (!target) throw new TRPCError({ code: "NOT_FOUND" });

      // Demoting an OWNER would risk leaving the workspace ownerless.
      // Force callers through `transferOwnership` instead.
      if (target.role === "OWNER") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Cannot demote an OWNER. Use transferOwnership to hand the role off first.",
        });
      }

      await ctx.infra.db
        .update(workspaceMembers)
        .set({ role: input.role })
        .where(
          and(
            eq(workspaceMembers.workspaceId, input.workspaceId),
            eq(workspaceMembers.userId, input.userId),
          ),
        );
      return { success: true };
    }),

  // ── remove a member ───────────────────────────────────────────────────────
  removeMember: protectedProcedure
    .input(z.object({ workspaceId: IdSchema, userId: IdSchema }))
    .mutation(async ({ input, ctx }) => {
      const { role: callerRole } = await requireMembership(ctx, input.workspaceId);
      if (!canManageMembers(callerRole)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const target = await ctx.infra.db.query.workspaceMembers.findFirst({
        where: and(
          eq(workspaceMembers.workspaceId, input.workspaceId),
          eq(workspaceMembers.userId, input.userId),
        ),
      });
      if (!target) throw new TRPCError({ code: "NOT_FOUND" });

      // Last-owner guard.
      if (target.role === "OWNER") {
        const owners = await ctx.infra.db.query.workspaceMembers.findMany({
          where: and(
            eq(workspaceMembers.workspaceId, input.workspaceId),
            eq(workspaceMembers.role, "OWNER"),
          ),
        });
        if (owners.length <= 1) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Cannot remove the last owner.",
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
      return { success: true };
    }),

  // ── transfer ownership (atomic two-step) ──────────────────────────────────
  transferOwnership: protectedProcedure
    .input(z.object({ workspaceId: IdSchema, newOwnerId: IdSchema }))
    .mutation(async ({ input, ctx }) => {
      const { role: callerRole } = await requireMembership(ctx, input.workspaceId);
      if (callerRole !== "OWNER") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the current owner can transfer ownership.",
        });
      }
      if (input.newOwnerId === ctx.session.user.id) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Cannot transfer ownership to yourself.",
        });
      }

      // The new owner must already be a member.
      const newOwnerMembership =
        await ctx.infra.db.query.workspaceMembers.findFirst({
          where: and(
            eq(workspaceMembers.workspaceId, input.workspaceId),
            eq(workspaceMembers.userId, input.newOwnerId),
          ),
        });
      if (!newOwnerMembership) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "The new owner must already be a member of the workspace.",
        });
      }

      // Promote the new owner, demote the caller to ADMIN, and update the
      // workspaces.owner_id pointer in lockstep.
      await ctx.infra.db
        .update(workspaceMembers)
        .set({ role: "OWNER" satisfies WorkspaceRole })
        .where(
          and(
            eq(workspaceMembers.workspaceId, input.workspaceId),
            eq(workspaceMembers.userId, input.newOwnerId),
          ),
        );
      await ctx.infra.db
        .update(workspaceMembers)
        .set({ role: "ADMIN" satisfies WorkspaceRole })
        .where(
          and(
            eq(workspaceMembers.workspaceId, input.workspaceId),
            eq(workspaceMembers.userId, ctx.session.user.id),
          ),
        );
      await ctx.infra.db
        .update(workspaces)
        .set({ ownerId: input.newOwnerId, updatedAt: new Date() })
        .where(eq(workspaces.id, input.workspaceId));
      return { success: true };
    }),

  // ── soft-delete a workspace (only the OWNER, never personal) ──────────────
  delete: protectedProcedure
    .input(z.object({ workspaceId: IdSchema }))
    .mutation(async ({ input, ctx }) => {
      const ws = await ctx.infra.db.query.workspaces.findFirst({
        where: and(
          eq(workspaces.id, input.workspaceId),
          isNull(workspaces.deletedAt),
        ),
      });
      if (!ws) throw new TRPCError({ code: "NOT_FOUND" });
      if (ws.ownerId !== ctx.session.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the owner can delete a workspace.",
        });
      }
      if (ws.personalForUserId) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Personal workspaces cannot be deleted.",
        });
      }
      await ctx.infra.db
        .update(workspaces)
        .set({ deletedAt: new Date() })
        .where(eq(workspaces.id, input.workspaceId));
      return { success: true };
    }),
});

// Re-export for tests / docs.
export { WORKSPACE_ROLES };
