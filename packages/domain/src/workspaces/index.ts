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
//
// Single source of truth for workspace roles. Used by:
//   • The Drizzle schema (`workspaceMembers.role` is `.$type<WorkspaceRole>()`).
//   • The Postgres CHECK constraint added in migration 0003 — keep these
//     four values in sync there.
//   • The Zod RoleSchema in workspaces.router.ts (z.enum(WORKSPACE_ROLES)).
//
// If you ever add or remove a role you MUST update all three places, plus
// the helper functions below.

export type WorkspaceRole = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

/**
 * All valid workspace roles, ordered from highest to lowest privilege.
 * Typed as a readonly tuple so it can be passed directly to `z.enum(...)`.
 */
export const WORKSPACE_ROLES = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const satisfies readonly WorkspaceRole[];

/** Mutable copy for places that demand a plain string array (e.g. SQL CHECK). */
export const WORKSPACE_ROLES_ARRAY: readonly string[] = WORKSPACE_ROLES;

/** Type-narrowing guard. Prefer this over `as WorkspaceRole` casts. */
export function isValidRole(role: string): role is WorkspaceRole {
  return (WORKSPACE_ROLES as readonly string[]).includes(role);
}

/**
 * Roles that may invite, remove, or change the role of other members.
 * Mirrors the application-layer `["OWNER","ADMIN"].includes(role)` checks.
 */
export function canManageMembers(role: WorkspaceRole): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** Only the OWNER can transfer ownership or delete the workspace. */
export function canDeleteWorkspace(role: WorkspaceRole): boolean {
  return role === "OWNER";
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
