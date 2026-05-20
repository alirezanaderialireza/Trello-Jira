// packages/domain/src/workspaces/index.ts
// Workspace bounded context — entities, value objects, services, errors.

// ── Slug Value Object ────────────────────────────────────────────────────────

export type WorkspaceSlug = string & { readonly __brand: "WorkspaceSlug" };

const SLUG_REGEX = /^[a-z0-9][a-z0-9-]{0,58}[a-z0-9]$/;

export function validateSlug(slug: string): boolean {
  return SLUG_REGEX.test(slug) && slug.length >= 2 && slug.length <= 60;
}

export function generateSlugFromName(name: string): WorkspaceSlug {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "") // remove non-ASCII
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 58);

  // If slug is empty (e.g. Persian-only name), generate random
  const slug = base.length >= 2
    ? base
    : `ws-${Math.random().toString(36).slice(2, 10)}`;

  return slug as WorkspaceSlug;
}

// ── Role Enum ────────────────────────────────────────────────────────────────

export type WorkspaceRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

export const WORKSPACE_ROLES: readonly WorkspaceRole[] = ["OWNER", "ADMIN", "MEMBER", "VIEWER"];

export function isValidRole(role: string): role is WorkspaceRole {
  return WORKSPACE_ROLES.includes(role as WorkspaceRole);
}

// ── Entity ───────────────────────────────────────────────────────────────────

export interface WorkspaceEntity {
  id: string;
  name: string;
  slug: WorkspaceSlug;
  tier: "free" | "pro" | "enterprise";
  ownerId: string;
  personalForUserId: string | null;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

export interface WorkspaceMemberEntity {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  joinedAt: Date;
  invitedBy: string | null;
}

// ── Ports ────────────────────────────────────────────────────────────────────

export interface WorkspaceRepository<TTx = unknown> {
  findById(id: string): Promise<WorkspaceEntity | null>;
  findBySlug(slug: WorkspaceSlug): Promise<WorkspaceEntity | null>;
  create(workspace: WorkspaceEntity, tx?: TTx): Promise<void>;
  update(workspace: WorkspaceEntity, tx?: TTx): Promise<void>;
  getMemberCount(workspaceId: string, role?: WorkspaceRole): Promise<number>;
  getMembers(workspaceId: string): Promise<WorkspaceMemberEntity[]>;
  addMember(member: WorkspaceMemberEntity, tx?: TTx): Promise<void>;
  removeMember(workspaceId: string, userId: string, tx?: TTx): Promise<void>;
  updateMemberRole(workspaceId: string, userId: string, role: WorkspaceRole, tx?: TTx): Promise<void>;
}

// ── Service: Workspace Creation ──────────────────────────────────────────────

export function createPersonalWorkspace(userId: string, displayName: string): {
  workspace: Omit<WorkspaceEntity, "createdAt" | "updatedAt" | "deletedAt">;
  member: Omit<WorkspaceMemberEntity, "joinedAt">;
} {
  const name = `${displayName || "User"}'s Workspace`;
  const slug = generateSlugFromName(name);

  return {
    workspace: {
      id: crypto.randomUUID(),
      name,
      slug,
      tier: "free",
      ownerId: userId,
      personalForUserId: userId,
      revision: 1,
    },
    member: {
      workspaceId: "", // filled after workspace creation with actual ID
      userId,
      role: "OWNER",
      invitedBy: null,
    },
  };
}

// ── Errors ───────────────────────────────────────────────────────────────────

export class SlugAlreadyTakenError extends Error {
  constructor(slug: string) { super(`SLUG_TAKEN: ${slug}`); this.name = "SlugAlreadyTakenError"; }
}

export class LastOwnerCannotLeaveError extends Error {
  constructor() { super("LAST_OWNER_CANNOT_LEAVE"); this.name = "LastOwnerCannotLeaveError"; }
}

export class NotMemberError extends Error {
  constructor() { super("NOT_MEMBER"); this.name = "NotMemberError"; }
}

export class InsufficientRoleError extends Error {
  constructor(required: WorkspaceRole) { super(`INSUFFICIENT_ROLE: needs ${required}`); this.name = "InsufficientRoleError"; }
}

export class PersonalWorkspaceCannotBeDeletedError extends Error {
  constructor() { super("PERSONAL_WORKSPACE_CANNOT_BE_DELETED"); this.name = "PersonalWorkspaceCannotBeDeletedError"; }
}
