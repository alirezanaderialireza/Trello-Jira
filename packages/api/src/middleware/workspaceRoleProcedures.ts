// packages/api/src/middleware/workspaceRoleProcedures.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// Three workspace-scoped tRPC procedure builders:
//
//   workspaceMemberProcedure  — caller must be any active member.
//   workspaceAdminProcedure   — caller must be OWNER or ADMIN.
//   workspaceOwnerProcedure   — caller must be OWNER.
//
// All three:
//   • require `input.workspaceId: string` (uuid). The middleware extracts
//     it via `getRawInput()` (tRPC v11). If a router uses a slug instead,
//     it must resolve to uuid before this middleware runs — F2 spec is
//     explicit on this point.
//   • run AFTER `protectedProcedure`, so they inherit the full
//     load-shedding → ALS → observability → timeout → auth → tenantGuard
//     → tenantContextMiddleware pipeline. The DB query they issue against
//     `workspace_members` is therefore RLS-enforced by the same GUC.
//   • populate `ctx.workspaceMembership = { workspaceId, role, userId }`
//     for the procedure body.
//
// Decomposing the middleware into small named helpers (`loadWorkspaceMembership`,
// `requireWorkspaceManagerRole`, …) keeps each piece independently
// testable without having to wire a fake tRPC pipeline.
// ─────────────────────────────────────────────────────────────────────────────

import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { workspaceMembers } from "@repo/db";
import type { WorkspaceRole } from "@repo/domain/workspaces";
import { protectedProcedure } from "../trpc";

// ─── Public shape of `ctx.workspaceMembership` ──────────────────────────────

export interface WorkspaceMembershipContext {
  workspaceId: string;
  role: WorkspaceRole;
  userId: string;
}

// ─── Internal helpers (exported for tests) ──────────────────────────────────

/**
 * Reads workspaceId from `input` (raw, pre-Zod), confirms membership,
 * returns the membership context. Throws TRPCError on invalid input or
 * non-membership.
 *
 * Public-but-internal: exported so unit tests can exercise it without
 * wiring a fake tRPC procedure builder. Not part of the documented
 * public surface — F3 routers should use the builders below.
 */
export async function loadWorkspaceMembership(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  getRawInput: () => Promise<unknown>,
): Promise<WorkspaceMembershipContext> {
  const rawInput = await getRawInput();
  const input = rawInput as Record<string, unknown> | null;
  const workspaceId = (input?.workspaceId as string) ?? null;

  if (!workspaceId || typeof workspaceId !== "string") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "شناسه فضای کاری در ورودی الزامی است.",
    });
  }

  const userId = ctx.session?.user?.id as string | undefined;
  if (!userId) {
    // Defensive — protectedProcedure's isAuthed should have caught this.
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "احراز هویت لازم است.",
    });
  }

  const row = await ctx.infra.db.query.workspaceMembers.findFirst({
    where: and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, userId),
    ),
  });

  if (!row) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "شما عضو این فضای کاری نیستید.",
    });
  }

  return {
    workspaceId,
    role: row.role as WorkspaceRole,
    userId,
  };
}

/** Throws FORBIDDEN unless role is OWNER or ADMIN. */
export function requireWorkspaceManagerRole(role: WorkspaceRole): void {
  if (role !== "OWNER" && role !== "ADMIN") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "این عملیات فقط برای مدیر یا مالک فضای کاری مجاز است.",
    });
  }
}

/** Throws FORBIDDEN unless role is OWNER. */
export function requireWorkspaceOwnerRole(role: WorkspaceRole): void {
  if (role !== "OWNER") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "این عملیات فقط برای مالک فضای کاری مجاز است.",
    });
  }
}

// ─── Procedure builders ─────────────────────────────────────────────────────

export const workspaceMemberProcedure = protectedProcedure.use(
  async ({ ctx, next, getRawInput }) => {
    const m = await loadWorkspaceMembership(ctx, getRawInput);
    return next({ ctx: { ...ctx, workspaceMembership: m } });
  },
);

export const workspaceAdminProcedure = protectedProcedure.use(
  async ({ ctx, next, getRawInput }) => {
    const m = await loadWorkspaceMembership(ctx, getRawInput);
    requireWorkspaceManagerRole(m.role);
    return next({ ctx: { ...ctx, workspaceMembership: m } });
  },
);

export const workspaceOwnerProcedure = protectedProcedure.use(
  async ({ ctx, next, getRawInput }) => {
    const m = await loadWorkspaceMembership(ctx, getRawInput);
    requireWorkspaceOwnerRole(m.role);
    return next({ ctx: { ...ctx, workspaceMembership: m } });
  },
);
