// packages/db/src/repositories/workspaces.repository.ts
import { eq, and } from "drizzle-orm";
import { workspaces, workspaceMembers } from "../schema";
import type {
  WorkspaceRepository,
  WorkspaceEntity,
  WorkspaceMemberEntity,
  WorkspaceSlug,
  WorkspaceRole,
} from "@repo/domain/workspaces";
import type { WorkspaceVisibility } from "../schema/workspaces";
import { notDeleted } from "../lib/softDeleteFilter";

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
