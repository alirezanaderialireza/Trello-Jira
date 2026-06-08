// apps/web/src/auth/authAuditLogger.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// Lightweight bridge from Auth.js v5 lifecycle events to the existing
// `audit_logs` table.
//
// Why this lives here (and not in @repo/api):
//   • The Auth.js handler is a Next.js route handler, not a tRPC procedure.
//     It has no `ctx.services.auditLogger` to lean on.
//   • We want auth audit events recorded even when the rest of the app is
//     down — so this writes directly to Drizzle with a tiny try/catch and
//     never throws back into the caller.
//
// Tenant resolution:
//   The `audit_logs` table requires `tenantId NOT NULL`. Auth events don't
//   have a workspace context of their own, so we use the user's personal
//   workspace as a stable home — that workspace is created at signup and
//   cannot be deleted (see workspaces.delete in workspaces.router.ts).
//
//   If no personal workspace can be found (legacy users, edge case, or DB
//   blip), we silently skip the write. We do NOT bring down the auth flow
//   over a missing audit row — the goal is forensics, not blocking.
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db, auditLogs, workspaces, workspaceMembers } from "@repo/db";

export type AuthAction =
  | "auth.signUp"
  | "auth.signIn"
  | "auth.signInFailed"
  | "auth.signOut";

interface RecordAuthEventArgs {
  /** The user id, when known. Pass null for failed sign-ins by unknown email. */
  userId: string | null;
  action: AuthAction;
  /** Optional client metadata captured at the route boundary. */
  ip?: string | null;
  userAgent?: string | null;
  /** Free-form details added to `afterState` for downstream debugging. */
  details?: Record<string, unknown>;
}

/**
 * Best-effort write of an auth event. Never throws — auth flows must keep
 * working even when audit storage is unavailable.
 */
export async function recordAuthEvent(args: RecordAuthEventArgs): Promise<void> {
  try {
    const tenantId = await resolveTenantForAudit(args.userId);
    if (!tenantId) return; // unknown user / no personal workspace → skip silently

    await (db as any).insert(auditLogs).values({
      id: randomUUID(),
      // `actorId` is `not null uuid`. For unknown actors we substitute a
      // sentinel UUID — the action label still says "signInFailed" so the
      // record is interpretable.
      actorId: args.userId ?? UNKNOWN_ACTOR,
      tenantId,
      action: args.action,
      entityId: args.userId ?? UNKNOWN_ACTOR,
      entityType: "user",
      correlationId: randomUUID(),
      beforeState: {},
      afterState: {
        ip: args.ip ?? null,
        userAgent: args.userAgent ?? null,
        ...(args.details ?? {}),
      },
      createdAt: new Date(),
    });
  } catch (err) {
    // Swallow but log so a logging outage doesn't kill auth.
    console.warn("[authAuditLogger] failed to record event", args.action, err);
  }
}

const UNKNOWN_ACTOR = "00000000-0000-0000-0000-000000000000";

/**
 * Find a workspace this audit row can be attributed to. Order:
 *   1. The user's personal workspace (created at signup).
 *   2. Any workspace where the user is OWNER (covers legacy accounts).
 *   3. null — caller skips the insert.
 *
 * Returns null when `userId` is null (failed sign-in by unknown email).
 */
async function resolveTenantForAudit(userId: string | null): Promise<string | null> {
  if (!userId) return null;

  // 1. Personal workspace.
  const personal = await (db as any)
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(
      and(
        eq(workspaces.personalForUserId, userId),
        isNull(workspaces.deletedAt),
      ),
    )
    .limit(1)
    .then((r: any[]) => r[0] ?? null);
  if (personal?.id) return personal.id as string;

  // 2. Any workspace where the user is OWNER.
  const owned = await (db as any)
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.userId, userId),
        eq(workspaceMembers.role, "OWNER"),
      ),
    )
    .limit(1)
    .then((r: any[]) => r[0] ?? null);
  if (owned?.workspaceId) return owned.workspaceId as string;

  return null;
}
