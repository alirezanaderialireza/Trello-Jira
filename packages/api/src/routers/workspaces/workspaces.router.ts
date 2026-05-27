// packages/api/src/routers/workspaces/workspaces.router.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// Workspaces tRPC router (F3a.1 — workspace lifecycle)
//
// F3a.1 introduces the full workspace lifecycle: list, getBySlug, create,
// update, setBackground, updateVisibility, delete (soft), restore. The four
// pre-F3 procedures (list, getBySlug, create, delete) are refactored to:
//   • Use the F2 role-aware procedure builders
//     (workspaceAdminProcedure / workspaceOwnerProcedure) for authorization,
//     and the new repository helpers (listForUser / getBySlugWithCounts /
//     updateMetadata) for read/write shape.
//   • Use the domain use cases (softDeleteWorkspace / restoreWorkspace) for
//     state-transition invariants instead of inline conditionals.
//   • Emit `workspace.*` outbox events inside the same RLS-enforced tx,
//     using the topic naming agreed in the F3a plan.
//   • Accept an optional `idempotencyKey` and de-duplicate via the
//     existing `idempotency_keys` table through `withIdempotency()`.
//
// Procedures still using the legacy `requireMembership` helper:
//
//     listBoards, inviteMember
//
// — `listBoards` lands in F3b (board-level router); `inviteMember` is
// deprecated by F3a.3 in favour of the email/token-based invitations
// flow. Members lifecycle (updateRole / remove / leave / transferOwnership)
// has moved to the F3a.2 sub-router below — see `./members.router.ts`.
//
// Type-safety contract:
//   • Roles come from `WORKSPACE_ROLES` (single source of truth — domain).
//   • `getBySlug` resolves slug → workspaceId in-router because the F2
//     builders are workspaceId-keyed; mirroring that shape inside a
//     slug-keyed builder would be a separate refactor.
// ─────────────────────────────────────────────────────────────────────────────

import crypto from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, isNull, desc } from "drizzle-orm";

import { router, protectedProcedure } from "../../trpc";
import {
  workspaceAdminProcedure,
  workspaceOwnerProcedure,
} from "../../middleware/workspaceRoleProcedures";
import { withIdempotency } from "../../utils/idempotency";
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
  generateSlugFromName,
  validateSlug,
  softDeleteWorkspace,
  restoreWorkspace,
  type WorkspaceRole,
  type WorkspaceSlug,
} from "@repo/domain/workspaces";

import { workspaceMembersRouter } from "./members.router";

// ─── Shared schemas ─────────────────────────────────────────────────────────

const IdSchema = z.string().uuid();
const NameSchema = z.string().trim().min(1).max(100);
const DescriptionSchema = z.string().trim().max(500).nullable();
const SlugSchema = z
  .string()
  .trim()
  .min(2)
  .max(60)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
const VisibilitySchema = z.enum(["private", "public"]);
const IdempotencyKeySchema = z.string().uuid().optional();

/**
 * Free-form JSONB shape for workspace background. We intentionally accept
 * any object here (no `.strict()`) and let the UI evolve background
 * presets without a schema bump. The DB-level CHECK constraint guards
 * `jsonb_typeof = 'object'`, and the column is nullable.
 */
const BackgroundDataSchema = z
  .record(z.string(), z.unknown())
  .nullable();

/**
 * Role schema for INPUT validation. OWNER is intentionally excluded —
 * ownership transfer is a separate, intentional flow (transferOwnership)
 * that mutates two member rows atomically.
 */
const AssignableRoleSchema = z.enum(["ADMIN", "MEMBER", "VIEWER"]);

// ─── Membership helper (legacy — replaced by F2 builders in F3a.2) ──────────

/**
 * Legacy helper used by procedures that still ship with the pre-F2 pattern
 * (listBoards, inviteMember, updateMemberRole, removeMember,
 * transferOwnership). Will be replaced in F3a.2 with the F2
 * `loadWorkspaceMembership` helper, alongside the bug fixes flagged on
 * PR #50.
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
      message: "شما عضو این فضای کاری نیستید.",
    });
  }
  if (!isValidRole(row.role)) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Invalid role on membership row: ${row.role}`,
    });
  }
  return { role: row.role };
}

// ─── Router ─────────────────────────────────────────────────────────────────

export const workspacesRouter = router({
  // ── F3a.2: workspace members sub-router ───────────────────────────────────
  //
  // Mounted as `v1.public.workspace.members.*`. See ./members.router.ts
  // for the five procedures (list / updateRole / remove / leave /
  // transferOwnership) and the row-lock-based fixes for the PR #50
  // bugs in the legacy implementation.
  members: workspaceMembersRouter,

  // ── F3a.1: list workspaces the caller belongs to ──────────────────────────
  //
  // Refactored to use `repo.listForUser()` (single round-trip with counts)
  // instead of the previous in-router fetch-then-filter loop.
  list: protectedProcedure.query(async ({ ctx }) => {
    const items = await ctx.repos.workspace.listForUser(ctx.session.user.id);
    return items.map((item) => ({
      id: item.workspace.id,
      name: item.workspace.name,
      slug: item.workspace.slug,
      tier: item.workspace.tier,
      visibility: item.workspace.visibility,
      description: item.workspace.description,
      backgroundData: item.workspace.backgroundData,
      ownerId: item.workspace.ownerId,
      personalForUserId: item.workspace.personalForUserId,
      revision: item.workspace.revision,
      createdAt: item.workspace.createdAt,
      updatedAt: item.workspace.updatedAt,
      role: item.role,
      memberCount: item.memberCount,
      boardCount: item.boardCount,
    }));
  }),

  // ── F3a.1: fetch a workspace by slug (gated to members) ───────────────────
  //
  // Slug-keyed, so the F2 builders (which are workspaceId-keyed) don't fit
  // — we resolve slug → id in the procedure and check membership inline.
  getBySlug: protectedProcedure
    .input(z.object({ slug: SlugSchema }))
    .query(async ({ input, ctx }) => {
      const detail = await ctx.repos.workspace.getBySlugWithCounts(input.slug);
      if (!detail) {
        throw new TRPCError({ code: "NOT_FOUND", message: "فضای کاری یافت نشد." });
      }

      const member = await ctx.infra.db.query.workspaceMembers.findFirst({
        where: and(
          eq(workspaceMembers.workspaceId, detail.workspace.id),
          eq(workspaceMembers.userId, ctx.session.user.id),
        ),
      });
      if (!member) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "شما عضو این فضای کاری نیستید.",
        });
      }
      if (!isValidRole(member.role)) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Invalid role on membership row: ${member.role}`,
        });
      }

      return {
        id: detail.workspace.id,
        name: detail.workspace.name,
        slug: detail.workspace.slug,
        tier: detail.workspace.tier,
        visibility: detail.workspace.visibility,
        description: detail.workspace.description,
        backgroundData: detail.workspace.backgroundData,
        ownerId: detail.workspace.ownerId,
        personalForUserId: detail.workspace.personalForUserId,
        revision: detail.workspace.revision,
        createdAt: detail.workspace.createdAt,
        updatedAt: detail.workspace.updatedAt,
        role: member.role as WorkspaceRole,
        memberCount: detail.memberCount,
        boardCount: detail.boardCount,
      };
    }),

  // ── F3a.1: create a workspace ─────────────────────────────────────────────
  //
  // Refactored to use the domain `generateSlugFromName` helper (which
  // returns `ws-${random}` for empty/Persian-only names) instead of the
  // previous inline regex. Idempotency is honoured via `withIdempotency`,
  // and a `workspace.created` outbox event is appended inside the same tx.
  create: protectedProcedure
    .input(
      z.object({
        name: NameSchema,
        slug: SlugSchema.optional(),
        description: DescriptionSchema.optional(),
        idempotencyKey: IdempotencyKeySchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return withIdempotency(ctx, input.idempotencyKey, "v1", async () => {
        const slug = input.slug ?? generateSlugFromName(input.name);

        // Slug-conflict guard. The partial unique index on
        // (slug WHERE deleted_at IS NULL) would also surface a violation,
        // but we want the friendlier Persian message.
        const existing = await ctx.infra.db.query.workspaces.findFirst({
          where: and(eq(workspaces.slug, slug), isNull(workspaces.deletedAt)),
        });
        if (existing) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "این آدرس (slug) قبلاً انتخاب شده است.",
          });
        }

        const wsId = crypto.randomUUID();
        const now = new Date();

        await ctx.infra.db.insert(workspaces).values({
          id: wsId,
          name: input.name,
          slug,
          tier: "free",
          ownerId: ctx.session.user.id,
          description: input.description ?? null,
          revision: 1,
          createdAt: now,
          updatedAt: now,
        });

        // Creator becomes OWNER. This is the one and only path that mints
        // an OWNER bypassing AssignableRoleSchema.
        await ctx.infra.db.insert(workspaceMembers).values({
          workspaceId: wsId,
          userId: ctx.session.user.id,
          role: "OWNER" satisfies WorkspaceRole,
          joinedAt: now,
        });

        await ctx.repos.outbox.append(ctx.infra.db, {
          eventId: crypto.randomUUID(),
          eventVersion: "v1",
          aggregateId: wsId,
          aggregateType: "workspace",
          type: "workspace.created",
          occurredAt: now,
          correlationId: input.idempotencyKey ?? undefined,
          payload: {
            workspaceId: wsId,
            slug,
            name: input.name,
            ownerId: ctx.session.user.id,
            tier: "free",
          },
        });

        return { id: wsId, name: input.name, slug };
      });
    }),

  // ── F3a.1: update workspace metadata (admin) ──────────────────────────────
  update: workspaceAdminProcedure
    .input(
      z.object({
        workspaceId: IdSchema,
        name: NameSchema.optional(),
        description: DescriptionSchema.optional(),
        slug: SlugSchema.optional(),
        idempotencyKey: IdempotencyKeySchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return withIdempotency(ctx, input.idempotencyKey, "v1", async () => {
        // At least one updatable field must be present.
        const fieldsChanged: Array<"name" | "description" | "slug"> = [];
        if (input.name !== undefined) fieldsChanged.push("name");
        if (input.description !== undefined) fieldsChanged.push("description");
        if (input.slug !== undefined) fieldsChanged.push("slug");
        if (fieldsChanged.length === 0) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "حداقل یک فیلد برای ویرایش لازم است.",
          });
        }

        // Slug uniqueness pre-check (friendlier than DB unique-violation).
        if (input.slug !== undefined && validateSlug(input.slug)) {
          const collision = await ctx.infra.db.query.workspaces.findFirst({
            where: and(
              eq(workspaces.slug, input.slug),
              isNull(workspaces.deletedAt),
            ),
          });
          if (collision && collision.id !== input.workspaceId) {
            throw new TRPCError({
              code: "CONFLICT",
              message: "این آدرس (slug) قبلاً انتخاب شده است.",
            });
          }
        }

        await ctx.repos.workspace.updateMetadata(
          input.workspaceId,
          {
            name: input.name,
            description: input.description ?? undefined,
            slug: input.slug,
          },
          ctx.infra.db,
        );

        await ctx.repos.outbox.append(ctx.infra.db, {
          eventId: crypto.randomUUID(),
          eventVersion: "v1",
          aggregateId: input.workspaceId,
          aggregateType: "workspace",
          type: "workspace.updated",
          occurredAt: new Date(),
          correlationId: input.idempotencyKey ?? undefined,
          payload: {
            workspaceId: input.workspaceId,
            fieldsChanged,
            updatedBy: ctx.session.user.id,
          },
        });

        return { success: true, workspaceId: input.workspaceId, fieldsChanged };
      });
    }),

  // ── F3a.1: change workspace background (admin) ────────────────────────────
  setBackground: workspaceAdminProcedure
    .input(
      z.object({
        workspaceId: IdSchema,
        backgroundData: BackgroundDataSchema,
        idempotencyKey: IdempotencyKeySchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return withIdempotency(ctx, input.idempotencyKey, "v1", async () => {
        await ctx.repos.workspace.setBackground(
          input.workspaceId,
          input.backgroundData,
          ctx.infra.db,
        );

        await ctx.repos.outbox.append(ctx.infra.db, {
          eventId: crypto.randomUUID(),
          eventVersion: "v1",
          aggregateId: input.workspaceId,
          aggregateType: "workspace",
          type: "workspace.background_changed",
          occurredAt: new Date(),
          correlationId: input.idempotencyKey ?? undefined,
          payload: {
            workspaceId: input.workspaceId,
            changedBy: ctx.session.user.id,
          },
        });

        return { success: true, workspaceId: input.workspaceId };
      });
    }),

  // ── F3a.1: change workspace visibility (owner) ────────────────────────────
  updateVisibility: workspaceOwnerProcedure
    .input(
      z.object({
        workspaceId: IdSchema,
        visibility: VisibilitySchema,
        idempotencyKey: IdempotencyKeySchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return withIdempotency(ctx, input.idempotencyKey, "v1", async () => {
        const ws = await ctx.infra.db.query.workspaces.findFirst({
          where: eq(workspaces.id, input.workspaceId),
        });
        if (!ws) {
          throw new TRPCError({ code: "NOT_FOUND", message: "فضای کاری یافت نشد." });
        }

        // No-op short-circuit: don't write or emit if visibility is unchanged.
        if (ws.visibility === input.visibility) {
          return {
            success: true,
            workspaceId: input.workspaceId,
            visibility: input.visibility,
            unchanged: true,
          };
        }

        const previousVisibility = ws.visibility;

        await ctx.repos.workspace.updateVisibility(
          input.workspaceId,
          input.visibility,
          ctx.infra.db,
        );

        await ctx.repos.outbox.append(ctx.infra.db, {
          eventId: crypto.randomUUID(),
          eventVersion: "v1",
          aggregateId: input.workspaceId,
          aggregateType: "workspace",
          type: "workspace.visibility_changed",
          occurredAt: new Date(),
          correlationId: input.idempotencyKey ?? undefined,
          payload: {
            workspaceId: input.workspaceId,
            from: previousVisibility,
            to: input.visibility,
            changedBy: ctx.session.user.id,
          },
        });

        return {
          success: true,
          workspaceId: input.workspaceId,
          visibility: input.visibility,
          unchanged: false,
        };
      });
    }),

  // ── F3a.1: soft-delete a workspace (owner) ────────────────────────────────
  //
  // Refactored to delegate the invariants (already-deleted, personal
  // workspace) to the domain `softDeleteWorkspace` use case. Emits
  // `workspace.soft_deleted` and supports idempotency.
  delete: workspaceOwnerProcedure
    .input(
      z.object({
        workspaceId: IdSchema,
        idempotencyKey: IdempotencyKeySchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return withIdempotency(ctx, input.idempotencyKey, "v1", async () => {
        // Load the workspace as a domain entity.
        const ws = await ctx.repos.workspace.findById(input.workspaceId);
        if (!ws) {
          throw new TRPCError({ code: "NOT_FOUND", message: "فضای کاری یافت نشد." });
        }

        const now = new Date();
        const result = softDeleteWorkspace({
          workspace: ws,
          actorUserId: ctx.session.user.id,
          now,
        });
        if (!result.success) {
          if (result.reason === "PERSONAL_WORKSPACE") {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "فضای کاری شخصی قابل حذف نیست.",
            });
          }
          // ALREADY_DELETED — surface as NOT_FOUND so a deleted workspace is
          // indistinguishable from a missing one (avoids leaking existence).
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "فضای کاری یافت نشد.",
          });
        }

        await ctx.repos.workspace.softDelete(input.workspaceId, ctx.infra.db);

        await ctx.repos.outbox.append(ctx.infra.db, {
          eventId: crypto.randomUUID(),
          eventVersion: "v1",
          aggregateId: input.workspaceId,
          aggregateType: "workspace",
          type: "workspace.soft_deleted",
          occurredAt: now,
          correlationId: input.idempotencyKey ?? undefined,
          payload: {
            workspaceId: input.workspaceId,
            deletedAt: now.toISOString(),
            deletedBy: ctx.session.user.id,
          },
        });

        return { success: true, workspaceId: input.workspaceId };
      });
    }),

  // ── F3a.1: restore a soft-deleted workspace (owner, within 30 days) ───────
  //
  // The F2 `workspaceOwnerProcedure` enforces ownership via the
  // `workspace_members` table — which is unaffected by the workspace's
  // own `deleted_at` (members rows persist for the recovery window).
  // The 30-day window check lives in the `restoreWorkspace` use case.
  restore: workspaceOwnerProcedure
    .input(
      z.object({
        workspaceId: IdSchema,
        idempotencyKey: IdempotencyKeySchema,
      }),
    )
    .mutation(async ({ input, ctx }) => {
      return withIdempotency(ctx, input.idempotencyKey, "v1", async () => {
        // Direct row read (bypassing repo.findById which filters out
        // soft-deleted rows). We need the soft-deleted entity to test the
        // window.
        const row = await ctx.infra.db.query.workspaces.findFirst({
          where: eq(workspaces.id, input.workspaceId),
        });
        if (!row) {
          throw new TRPCError({ code: "NOT_FOUND", message: "فضای کاری یافت نشد." });
        }

        const now = new Date();
        const result = restoreWorkspace({
          workspace: {
            id: row.id,
            name: row.name,
            slug: row.slug as WorkspaceSlug,
            tier: row.tier as "free" | "pro" | "enterprise",
            ownerId: row.ownerId,
            personalForUserId: row.personalForUserId,
            revision: row.revision,
            createdAt: row.createdAt,
            updatedAt: row.updatedAt,
            deletedAt: row.deletedAt,
          },
          actorUserId: ctx.session.user.id,
          now,
        });
        if (!result.success) {
          if (result.reason === "NOT_DELETED") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "این فضای کاری حذف نشده است.",
            });
          }
          // RESTORE_WINDOW_EXPIRED
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "بازه ۳۰ روزه برای بازگردانی این فضای کاری تمام شده است.",
          });
        }

        await ctx.repos.workspace.restore(input.workspaceId, ctx.infra.db);

        await ctx.repos.outbox.append(ctx.infra.db, {
          eventId: crypto.randomUUID(),
          eventVersion: "v1",
          aggregateId: input.workspaceId,
          aggregateType: "workspace",
          type: "workspace.restored",
          occurredAt: now,
          correlationId: input.idempotencyKey ?? undefined,
          payload: {
            workspaceId: input.workspaceId,
            restoredAt: now.toISOString(),
            restoredBy: ctx.session.user.id,
          },
        });

        return { success: true, workspaceId: input.workspaceId };
      });
    }),

  // ════════════════════════════════════════════════════════════════════════
  // BELOW: legacy procedures (out of F3a scope, refactored in later sub-PRs)
  // ════════════════════════════════════════════════════════════════════════

  // ── list boards in a workspace the caller can see ─────────────────────────
  // F3b will move this to a board-level router. F3a.x leaves it untouched.
  listBoards: protectedProcedure
    .input(z.object({ workspaceId: IdSchema, includeArchived: z.boolean().default(false) }))
    .query(async ({ input, ctx }) => {
      await requireMembership(ctx, input.workspaceId);

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

  // ── invite an existing user as a member (F3a.3 will deprecate) ────────────
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
});

// Re-export for tests / docs.
export { WORKSPACE_ROLES };
