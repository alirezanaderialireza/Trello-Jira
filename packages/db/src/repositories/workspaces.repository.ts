// packages/db/src/repositories/workspaces.repository.ts
import { eq, and, inArray, count as drizzleCount, asc } from "drizzle-orm";
import { workspaces, workspaceMembers, boards, users } from "../schema";
import type {
  WorkspaceRepository,
  WorkspaceEntity,
  WorkspaceMemberEntity,
  WorkspaceSlug,
  WorkspaceRole,
} from "@repo/domain/workspaces";
import type { Workspace as WorkspaceRow, WorkspaceVisibility } from "../schema/workspaces";
import { notDeleted } from "../lib/softDeleteFilter";

// ─── F3a.1 read-side projections ──────────────────────────────────────────
//
// `WorkspaceListItem` is the shape returned by `listForUser` — one row per
// membership, with the role and count metadata the sidebar needs. Counts are
// derived via SQL aggregates (no N+1).
//
// `WorkspaceDetail` is the shape returned by `getBySlugWithCounts` — a
// single workspace plus its counts, but WITHOUT the caller's role (the
// router enforces membership separately and stamps the role into the
// response).

export type WorkspaceListItem = {
  workspace: WorkspaceRow;
  role: WorkspaceRole;
  memberCount: number;
  boardCount: number;
};

export type WorkspaceDetail = {
  workspace: WorkspaceRow;
  memberCount: number;
  boardCount: number;
};

// ─── F3a.2 read-side projection ─────────────────────────────────────────────
//
// `WorkspaceMemberWithUser` is the shape returned by `listMembersWithUserInfo`
// — one row per member with the public user fields the members tab needs
// (display name, avatar, last-active). The join is a LEFT JOIN so a member
// row whose `users` row is missing (shouldn't happen in normal flow because
// of the FK, but defence in depth) still surfaces as `user: null`.

export type WorkspaceMemberWithUser = {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  joinedAt: Date;
  invitedBy: string | null;
  user: {
    id: string;
    email: string;
    displayName: string;
    avatarUrl: string | null;
    lastSeenAt: Date | null;
  } | null;
};

export class DrizzleWorkspaceRepository implements WorkspaceRepository {
  constructor(private readonly db: any) {}

  async findById(id: string): Promise<WorkspaceEntity | null> {
    const rows = await this.db
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.id, id), notDeleted(workspaces)))
      .limit(1);
    return rows[0] ? this.mapWs(rows[0]) : null;
  }

  async findBySlug(slug: WorkspaceSlug): Promise<WorkspaceEntity | null> {
    const rows = await this.db
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.slug, slug), notDeleted(workspaces)))
      .limit(1);
    return rows[0] ? this.mapWs(rows[0]) : null;
  }

  async create(ws: WorkspaceEntity, tx?: any): Promise<void> {
    const db = tx ?? this.db;
    await db.insert(workspaces).values({
      id: ws.id, name: ws.name, slug: ws.slug, tier: ws.tier, ownerId: ws.ownerId,
      personalForUserId: ws.personalForUserId, revision: ws.revision,
      createdAt: ws.createdAt, updatedAt: ws.updatedAt, deletedAt: ws.deletedAt,
    });
  }

  async update(ws: WorkspaceEntity, tx?: any): Promise<void> {
    const db = tx ?? this.db;
    await db.update(workspaces).set({
      name: ws.name, slug: ws.slug, tier: ws.tier, ownerId: ws.ownerId,
      revision: ws.revision, updatedAt: new Date(), deletedAt: ws.deletedAt,
    }).where(eq(workspaces.id, ws.id));
  }

  async getMemberCount(workspaceId: string, role?: WorkspaceRole): Promise<number> {
    const conditions = [eq(workspaceMembers.workspaceId, workspaceId)];
    if (role) conditions.push(eq(workspaceMembers.role, role));
    const rows = await this.db.select().from(workspaceMembers).where(and(...conditions));
    return rows.length;
  }

  async getMembers(workspaceId: string): Promise<WorkspaceMemberEntity[]> {
    const rows = await this.db.select().from(workspaceMembers).where(eq(workspaceMembers.workspaceId, workspaceId));
    return rows.map(this.mapMember);
  }

  // ────────────────────────────────────────────────────────────────────────
  // F3a.2 members-tab helper (with user JOIN)
  // ────────────────────────────────────────────────────────────────────────

  /**
   * List every member of a workspace with the public user fields the
   * members tab needs: displayName, avatarUrl, email (admin-visible),
   * lastSeenAt (presence proxy — see steering A4 in F3a Plan).
   *
   * `lastSeenAt` is the source of truth for "X روز پیش" displays. It is
   * updated on every presence heartbeat by the realtime presence router
   * (packages/api/src/routers/realtime/presence.router.ts) and indexed
   * for sort-by-recency.
   *
   * Ordering: ascending by `joinedAt` so the workspace creator (joined
   * earliest) sits at the top — matches the Trello/Notion convention.
   */
  async listMembersWithUserInfo(
    workspaceId: string,
  ): Promise<WorkspaceMemberWithUser[]> {
    const rows = await this.db
      .select({
        workspaceId: workspaceMembers.workspaceId,
        userId: workspaceMembers.userId,
        role: workspaceMembers.role,
        joinedAt: workspaceMembers.joinedAt,
        invitedBy: workspaceMembers.invitedBy,
        userIdJoined: users.id,
        userEmail: users.email,
        userDisplayName: users.displayName,
        userAvatarUrl: users.avatarUrl,
        userLastSeenAt: users.lastSeenAt,
      })
      .from(workspaceMembers)
      .leftJoin(users, eq(users.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, workspaceId))
      .orderBy(asc(workspaceMembers.joinedAt));

    return rows.map(
      (r: any): WorkspaceMemberWithUser => ({
        workspaceId: r.workspaceId,
        userId: r.userId,
        role: r.role as WorkspaceRole,
        joinedAt: r.joinedAt,
        invitedBy: r.invitedBy,
        user: r.userIdJoined
          ? {
              id: r.userIdJoined,
              email: r.userEmail,
              displayName: r.userDisplayName,
              avatarUrl: r.userAvatarUrl,
              lastSeenAt: r.userLastSeenAt,
            }
          : null,
      }),
    );
  }

  // ────────────────────────────────────────────────────────────────────────
  // F3a.1 list/detail helpers (with member + board counts)
  // ────────────────────────────────────────────────────────────────────────
  //
  // Why these live in the repository (not in a service or in the router):
  //   • They are pure DB shape — no business logic. The router stays thin.
  //   • The counts are computed via SQL aggregates (count(*) / GROUP BY)
  //     in a single round-trip per call instead of N+1 queries from JS.
  //   • Keeping the join here means RLS gates apply uniformly: the router
  //     calls these inside ctx.runInTenantTx, so workspace_members /
  //     boards filters by current_tenant_id in production, while tests
  //     can use a non-RLS db handle.

  /**
   * List every workspace the given user is a member of, with the member's
   * role inside each one and a fresh count of total members + non-deleted
   * boards. Soft-deleted workspaces are excluded.
   *
   * Used by `workspaces.list` (sidebar/landing).
   *
   * Note: the count subqueries do NOT filter by RLS — they aggregate over
   * workspace_members and boards tables that the same RLS context already
   * scopes to the caller's tenant. Since this query is invoked by F3a.1's
   * `protectedProcedure`, it runs inside the tenantContextMiddleware tx
   * with `app.current_tenant_id` set.
   */
  async listForUser(userId: string): Promise<WorkspaceListItem[]> {
    // Two-step instead of one heavy SQL string: keeps Drizzle query-builder
    // typing intact and is easier to maintain than a hand-written sql\`...\`.
    const memberships = await this.db
      .select({
        workspaceId: workspaceMembers.workspaceId,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, userId));

    if (memberships.length === 0) return [];

    const wsIds = memberships.map((m: { workspaceId: string }) => m.workspaceId);
    const wsRows = await this.db
      .select()
      .from(workspaces)
      .where(and(inArray(workspaces.id, wsIds), notDeleted(workspaces)));

    // Counts: single query each, grouped.
    const memberCounts = await this.db
      .select({
        workspaceId: workspaceMembers.workspaceId,
        count: drizzleCount(workspaceMembers.userId),
      })
      .from(workspaceMembers)
      .where(inArray(workspaceMembers.workspaceId, wsIds))
      .groupBy(workspaceMembers.workspaceId);

    const boardCounts = await this.db
      .select({
        tenantId: boards.tenantId,
        count: drizzleCount(boards.id),
      })
      .from(boards)
      .where(and(inArray(boards.tenantId, wsIds), notDeleted(boards)))
      .groupBy(boards.tenantId);

    const memberCountMap = new Map<string, number>(
      memberCounts.map((r: { workspaceId: string; count: number }) => [
        r.workspaceId,
        Number(r.count),
      ]),
    );
    const boardCountMap = new Map<string, number>(
      boardCounts.map((r: { tenantId: string; count: number }) => [
        r.tenantId,
        Number(r.count),
      ]),
    );
    const roleByWs = new Map<string, WorkspaceRole>(
      memberships.map((m: { workspaceId: string; role: string }) => [
        m.workspaceId,
        m.role as WorkspaceRole,
      ]),
    );

    return wsRows.map((row: WorkspaceRow) => ({
      workspace: row,
      role: roleByWs.get(row.id) ?? "VIEWER",
      memberCount: memberCountMap.get(row.id) ?? 0,
      boardCount: boardCountMap.get(row.id) ?? 0,
    }));
  }

  /**
   * Fetch a single workspace by slug along with member + non-deleted-board
   * counts. Returns `null` if the slug doesn't resolve to a live workspace.
   *
   * Used by `workspaces.getBySlug` (workspace home page header).
   */
  async getBySlugWithCounts(slug: string): Promise<WorkspaceDetail | null> {
    const wsRow = await this.db
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.slug, slug), notDeleted(workspaces)))
      .limit(1);

    if (!wsRow[0]) return null;
    const workspace = wsRow[0] as WorkspaceRow;

    const [memberCountRow, boardCountRow] = await Promise.all([
      this.db
        .select({ count: drizzleCount(workspaceMembers.userId) })
        .from(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, workspace.id)),
      this.db
        .select({ count: drizzleCount(boards.id) })
        .from(boards)
        .where(and(eq(boards.tenantId, workspace.id), notDeleted(boards))),
    ]);

    return {
      workspace,
      memberCount: Number((memberCountRow[0] as { count: number })?.count ?? 0),
      boardCount: Number((boardCountRow[0] as { count: number })?.count ?? 0),
    };
  }

  /**
   * Update workspace metadata fields (name / description / slug). Only the
   * supplied keys are written — undefined keys are ignored. Always bumps
   * `updatedAt`. Caller is responsible for slug-uniqueness checks (the
   * partial unique index on `slug WHERE deleted_at IS NULL` will surface a
   * conflict as a Postgres unique-violation otherwise).
   */
  async updateMetadata(
    id: string,
    fields: Partial<{ name: string; description: string | null; slug: string }>,
    tx?: any,
  ): Promise<void> {
    const db = tx ?? this.db;
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (fields.name !== undefined) set.name = fields.name;
    if (fields.description !== undefined) set.description = fields.description;
    if (fields.slug !== undefined) set.slug = fields.slug;
    await db
      .update(workspaces)
      .set(set)
      .where(and(eq(workspaces.id, id), notDeleted(workspaces)));
  }

  async addMember(member: WorkspaceMemberEntity, tx?: any): Promise<void> {
    const db = tx ?? this.db;
    await db.insert(workspaceMembers).values({
      workspaceId: member.workspaceId, userId: member.userId, role: member.role,
      joinedAt: member.joinedAt, invitedBy: member.invitedBy,
    });
  }

  async removeMember(workspaceId: string, userId: string, tx?: any): Promise<void> {
    const db = tx ?? this.db;
    await db.delete(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
  }

  async updateMemberRole(workspaceId: string, userId: string, role: WorkspaceRole, tx?: any): Promise<void> {
    const db = tx ?? this.db;
    await db.update(workspaceMembers).set({ role }).where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));
  }

  // ────────────────────────────────────────────────────────────────────────
  // Phase 1.1 (F1) lifecycle helpers
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Soft-delete a workspace. Sets `deleted_at = now()`. Idempotent:
   * re-soft-deleting a row updates `deleted_at` again, which is fine for
   * the 30-day grace window because the janitor reads
   * `deleted_at < now() - interval '30 days'`.
   */
  async softDelete(id: string, tx?: any): Promise<void> {
    const db = tx ?? this.db;
    await db
      .update(workspaces)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(workspaces.id, id));
  }

  /**
   * Restore a soft-deleted workspace. Caller is responsible for enforcing
   * the 30-day undo window — this method just clears `deleted_at`.
   */
  async restore(id: string, tx?: any): Promise<void> {
    const db = tx ?? this.db;
    await db
      .update(workspaces)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(eq(workspaces.id, id));
  }

  /**
   * Set or clear the workspace background. `data === null` clears it.
   * Shape validation lives in domain (Zod) — DB only enforces
   * `jsonb_typeof = 'object'`.
   */
  async setBackground(
    id: string,
    data: Record<string, unknown> | null,
    tx?: any,
  ): Promise<void> {
    const db = tx ?? this.db;
    await db
      .update(workspaces)
      .set({ backgroundData: data, updatedAt: new Date() })
      .where(and(eq(workspaces.id, id), notDeleted(workspaces)));
  }

  /**
   * Update the visibility flag. The CHECK constraint guards the value at
   * the DB level; the WorkspaceVisibility type guards it at the type level.
   */
  async updateVisibility(
    id: string,
    visibility: WorkspaceVisibility,
    tx?: any,
  ): Promise<void> {
    const db = tx ?? this.db;
    await db
      .update(workspaces)
      .set({ visibility, updatedAt: new Date() })
      .where(and(eq(workspaces.id, id), notDeleted(workspaces)));
  }

  private mapWs(row: any): WorkspaceEntity {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug as WorkspaceSlug,
      tier: row.tier,
      ownerId: row.ownerId,
      personalForUserId: row.personalForUserId,
      revision: row.revision,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    };
  }

  private mapMember(row: any): WorkspaceMemberEntity {
    return {
      workspaceId: row.workspaceId,
      userId: row.userId,
      role: row.role as WorkspaceRole,
      joinedAt: row.joinedAt,
      invitedBy: row.invitedBy,
    };
  }
}
