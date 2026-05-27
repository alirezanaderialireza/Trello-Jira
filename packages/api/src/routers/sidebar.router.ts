// packages/api/src/routers/sidebar.router.ts
//
// ─────────────────────────────────────────────────────────────────────────────
// Sidebar bootstrap router (F3b).
//
// Single query that hydrates the entire app-shell sidebar in one round
// trip from the client. Bundles five independent reads:
//
//   1. workspaces       — every workspace the caller belongs to (id, name,
//                         slug, caller's role).
//   2. starredBoards    — every starred board across workspaces, with the
//                         parent workspace's slug for link construction.
//   3. recentBoards     — top-5 most recently viewed boards.
//   4. pendingInvitationsCount  — total active invitations addressed to
//                         the caller's email, across all workspaces.
//   5. currentUser      — minimal profile (id, displayName, avatarUrl,
//                         locale, timezone) the TopNav and ProfileDropdown
//                         need.
//
// Two transactions:
//   • Tx 1 — tenantContextMiddleware's RLS-enforced tx. Runs queries 1, 2,
//            3, and 5 in parallel (Promise.all). All four operate on rows
//            the caller already has visibility into.
//   • Tx 2 — withServiceRoleConnection (BYPASSRLS). Runs query 4 only.
//            The caller is by definition NOT a member of the workspace
//            an invitation belongs to, so RLS would hide those rows.
//            Mirrors the F3a.3 invitations.getMyPending pattern.
//
// Performance budget (F3b plan): p95 < 200ms. The four parallel queries
// run on the same connection within tx 1 (single round-trip group); the
// pending-count query is a fifth round trip on the service-role
// connection. With sub-10ms per query under realistic load, the
// budget has comfortable headroom.
//
// Caching: the client (F4) wraps this in `useQuery` with
// `staleTime: 60_000` (1 minute) and invalidates on workspace.create,
// userBoardMetadata.toggleStar, workspace.invitations.* mutations.
// ─────────────────────────────────────────────────────────────────────────────

import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";

import { router, protectedProcedure } from "../trpc";
import { withServiceRoleConnection } from "../services/serviceRoleConnection";
import {
  DrizzleUserBoardMetadataRepository,
  DrizzleWorkspaceInvitationsRepository,
  users,
} from "@repo/db";
import type { WorkspaceRole } from "@repo/domain/workspaces";

// ─── Response shape ─────────────────────────────────────────────────────────

export interface SidebarBootstrapResponse {
  workspaces: Array<{
    id: string;
    name: string;
    slug: string;
    role: WorkspaceRole;
  }>;
  starredBoards: Array<{
    boardId: string;
    boardTitle: string;
    workspaceId: string;
    workspaceSlug: string;
  }>;
  recentBoards: Array<{
    boardId: string;
    boardTitle: string;
    workspaceId: string;
    workspaceSlug: string;
    lastViewedAt: string;
  }>;
  pendingInvitationsCount: number;
  currentUser: {
    id: string;
    displayName: string;
    avatarUrl: string | null;
    locale: string;
    timezone: string;
  };
}

// ─── Router ─────────────────────────────────────────────────────────────────

export const sidebarRouter = router({
  bootstrap: protectedProcedure.query(async ({ ctx }): Promise<SidebarBootstrapResponse> => {
    const userId = ctx.session.user.id;
    const userMetaRepo = new DrizzleUserBoardMetadataRepository(ctx.infra.db);

    // ── Tx 1: 4 RLS-enforced queries in parallel ──────────────────────────
    //
    // ctx.infra.db is the request's tenantContextMiddleware tx. All four
    // queries inherit the GUC and are RLS-correct.

    const [workspacesRaw, starredRaw, recentRaw, userRow] = await Promise.all([
      ctx.repos.workspace.listForUser(userId),
      userMetaRepo.listStarred(userId),
      userMetaRepo.listRecent(userId, 5),
      ctx.infra.db.query.users.findFirst({
        where: eq(users.id, userId),
      }),
    ]);

    if (!userRow) {
      // The session JWT carries a userId that no longer resolves to a
      // user row. Almost certainly means the account was deleted in
      // another session — surface a clean error.
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "کاربر یافت نشد.",
      });
    }

    // ── Workspace slug lookup map ─────────────────────────────────────────
    //
    // The userBoardMetadata repo's listStarred/listRecent return
    // `workspaceId` but not `workspaceSlug` (F1 schema choice). Rather
    // than modifying the F1 repo (out of F3b scope), we enrich in the
    // router using the already-fetched workspaces list. O(N) cost,
    // negligible — the user typically belongs to a handful of workspaces.

    const slugByWorkspaceId = new Map<string, string>(
      workspacesRaw.map((item: any) => [item.workspace.id, item.workspace.slug as string]),
    );

    // ── Tx 2: pending-invitation count via BYPASSRLS ──────────────────────

    const pendingInvitationsCount = await withServiceRoleConnection(
      ctx.infra.db,
      {
        procedure: "sidebar.bootstrap (invitation count)",
        userId,
        reason: "Pending invitations are not visible to non-members under RLS",
      },
      async (tx) => {
        const repo = new DrizzleWorkspaceInvitationsRepository(tx);
        const list = await repo.findActiveByEmail(userRow.emailNormalized);
        return list.length;
      },
    );

    // ── Shape the response ────────────────────────────────────────────────

    return {
      workspaces: workspacesRaw.map((item: any) => ({
        id: item.workspace.id,
        name: item.workspace.name,
        slug: item.workspace.slug,
        role: item.role as WorkspaceRole,
      })),
      starredBoards: starredRaw
        .map((row) => {
          const slug = slugByWorkspaceId.get(row.workspaceId);
          // Defensive: a starred board whose workspace isn't in the
          // user's workspaces list anymore (extremely unlikely — would
          // mean the user lost workspace membership but kept the star
          // row). Skip rather than expose a broken link.
          if (!slug) return null;
          return {
            boardId: row.boardId,
            boardTitle: row.boardTitle,
            workspaceId: row.workspaceId,
            workspaceSlug: slug,
          };
        })
        .filter((b): b is NonNullable<typeof b> => b !== null),
      recentBoards: recentRaw
        .map((row) => {
          const slug = slugByWorkspaceId.get(row.workspaceId);
          if (!slug) return null;
          return {
            boardId: row.boardId,
            boardTitle: row.boardTitle,
            workspaceId: row.workspaceId,
            workspaceSlug: slug,
            // last_viewed_at is timestamptz so always a Date here; serialize
            // for transit. Nullable in repo type but not in practice (recordView
            // sets it on every view).
            lastViewedAt: (row.lastViewedAt ?? new Date()).toISOString(),
          };
        })
        .filter((b): b is NonNullable<typeof b> => b !== null),
      pendingInvitationsCount,
      currentUser: {
        id: userRow.id,
        displayName: userRow.displayName,
        avatarUrl: userRow.avatarUrl ?? null,
        locale: userRow.locale,
        timezone: userRow.timezone,
      },
    };
  }),
});
