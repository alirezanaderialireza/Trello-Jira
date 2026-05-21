// apps/web/src/auth/getServerSession.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// Server-side session resolver — bridges Auth.js v5 (database strategy) into
// the shape expected by the tRPC `Session` type defined in @repo/api.
//
// Why this file exists:
//   • @repo/api/trpc.ts ships with `getSessionFromRequest()` which expects an
//     HMAC JWT in a "trello_session" cookie. That works for stateless clients
//     (WebSocket, mobile API clients) but does NOT work for the Next.js web
//     app, which uses Auth.js v5 with database sessions (cookie name varies:
//     "authjs.session-token" or "next-auth.session-token").
//
//   • Auth.js gives us only { user.id }. tRPC needs { user, tenantId, roles,
//     aclVersion }. tenantId is per-request (which workspace are we touching?)
//     so it must be supplied alongside the user — never inferred globally.
//
// Resolution order for tenantId:
//   1. Explicit `tenantId` argument passed by the caller (preferred — board/
//      list/card actions know which board they touch and can pass through the
//      board's tenantId).
//   2. The user's personal workspace (fallback for SSR pages that don't yet
//      know which workspace they're in, e.g. /workspaces).
//   3. null — tRPC's tenantGuard middleware will then reject the request.
//
// Resolution order for roles:
//   • Currently we read the user's role from workspaceMembers for the chosen
//     tenantId. If the user is not a member, we deny by returning null.
// ─────────────────────────────────────────────────────────────────────────────

// 📦 Domain types — keep role narrowing aligned with the Zod RoleSchema in
//    workspaces.router and the DB CHECK constraint in migration 0003.
import { isValidRole as isValidWorkspaceRole, type WorkspaceRole } from "@repo/domain/workspaces";

import { auth } from "./index";
import { db, workspaces, workspaceMembers } from "@repo/db";
import { and, eq, isNull } from "drizzle-orm";

/**
 * The shape consumed by @repo/api/trpc.ts `Session` type.
 * Keep this in sync with `Session` in packages/api/src/trpc.ts.
 */
export interface WebSession {
  user: { id: string };
  tenantId: string;
  aclVersion: number;
  roles: string[];
}

/**
 * Resolve the current authenticated session for server-side use (Server
 * Actions, route handlers, server components).
 *
 * @param tenantId  Optional explicit workspace id. When the caller already
 *                  knows which board/workspace it is acting on, pass it here
 *                  so we can verify membership without an extra round-trip.
 *                  When omitted, falls back to the user's personal workspace.
 *
 * @returns         A populated WebSession, or `null` if the user is not
 *                  authenticated, or is not a member of the requested tenant.
 */
export async function getWebSession(
  tenantId?: string,
): Promise<WebSession | null> {
  const authSession = await auth();
  if (!authSession?.user?.id) return null;

  const userId = authSession.user.id;

  // ── 1. Resolve tenantId (explicit > personal workspace > deny) ────────────
  let resolvedTenantId = tenantId ?? null;
  if (!resolvedTenantId) {
    const personal = await (db as any)
      .select()
      .from(workspaces)
      .where(
        and(
          eq(workspaces.personalForUserId, userId),
          isNull(workspaces.deletedAt),
        ),
      )
      .limit(1)
      .then((r: any[]) => r[0] ?? null);

    if (personal) resolvedTenantId = personal.id as string;
  }

  if (!resolvedTenantId) return null;

  // ── 2. Verify the user is a member of this workspace and load their role ──
  const membership = await (db as any)
    .select()
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, resolvedTenantId),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .limit(1)
    .then((r: any[]) => r[0] ?? null);

  if (!membership) return null;

  // Defensive narrowing: the DB CHECK constraint (0003) keeps `role` in the
  // four-value enum, but if a stale row ever held a stranger value we'd
  // rather refuse to mint a session than silently propagate `string` into
  // tRPC's typed roles array.
  const rawRole = membership.role as string;
  if (!isValidWorkspaceRole(rawRole)) return null;
  const role: WorkspaceRole = rawRole;

  return {
    user: { id: userId },
    tenantId: resolvedTenantId,
    aclVersion: 1, // bumped when tenant ACL changes — not yet wired
    roles: [role],
  };
}

/**
 * Extract a tenant hint from a Request, used by route handlers that already
 * accept a tenantId via header or query string. Pure parser — no DB calls.
 */
export function tenantHintFromRequest(req: Request): string | undefined {
  const headerHint = req.headers.get("x-workspace-id");
  if (headerHint) return headerHint;

  try {
    const url = new URL(req.url);
    const queryHint = url.searchParams.get("tenantId");
    if (queryHint) return queryHint;
  } catch {
    // Ignore malformed URLs — caller will fall back to personal workspace.
  }

  return undefined;
}
