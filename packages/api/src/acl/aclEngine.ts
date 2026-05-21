// packages/api/src/acl/aclEngine.ts
//
// ============================================================================
// 🔐 ACL Engine — Role Hierarchy + Board/Card Permission Enforcement
// ============================================================================
//
// Role Hierarchy (descending privilege):
//
//   OWNER   — full control: archive, delete, manage members, all writes
//   ADMIN   — manage members, all writes, cannot delete/archive board
//   EDITOR  — create / update / move / delete cards and lists
//   VIEWER  — read-only access to board, lists and cards
//   NONE    — no access (default when not a member)
//
// Permission model:
//   • Every action is described as a BoardAction or CardAction.
//   • The ACL engine takes (role, action) and returns a boolean.
//   • Card-level overrides are not yet implemented (design placeholder exists).
//   • Multi-tenant isolation: enforced separately; the ACL engine assumes
//     tenantId has already been verified by the caller.
//
// Usage:
//   const acl = new AclEngine();
//   const role = await membershipCache.getRole(tenantId, boardId, userId);
//   acl.assertBoard(role, "MOVE_CARD");  // throws AclError if denied
//
// ============================================================================

// ============================================================================
// Role Types
// ============================================================================

export const ROLE_HIERARCHY = [
  "OWNER",
  "ADMIN",
  "EDITOR",
  "VIEWER",
  "NONE",
] as const;

export type BoardRole = typeof ROLE_HIERARCHY[number];

// Numeric privilege levels — higher number = more privilege
const PRIVILEGE: Record<BoardRole, number> = {
  OWNER:  100,
  ADMIN:   80,
  EDITOR:  50,
  VIEWER:  10,
  NONE:     0,
};

// ============================================================================
// Action Types
// ============================================================================

// Board-level actions
export type BoardAction =
  | "VIEW_BOARD"
  | "CREATE_LIST"
  | "UPDATE_LIST"
  | "DELETE_LIST"
  | "MOVE_LIST"
  | "REORDER_LIST"
  | "CREATE_CARD"
  | "UPDATE_CARD"
  | "DELETE_CARD"
  | "MOVE_CARD"
  | "MANAGE_MEMBERS"
  | "UPDATE_BOARD"
  | "ARCHIVE_BOARD"
  | "DELETE_BOARD";

// Card-level actions (for future fine-grained overrides)
export type CardAction =
  | "VIEW_CARD"
  | "UPDATE_CARD"
  | "DELETE_CARD"
  | "MOVE_CARD";

// ============================================================================
// Permission Tables
// ============================================================================

/**
 * Minimum role required for each board action.
 * Actions not listed here are OWNER-only by default.
 */
const BOARD_ACTION_MIN_ROLE: Record<BoardAction, BoardRole> = {
  VIEW_BOARD:     "VIEWER",
  CREATE_LIST:    "EDITOR",
  UPDATE_LIST:    "EDITOR",
  DELETE_LIST:    "EDITOR",
  MOVE_LIST:      "EDITOR",
  REORDER_LIST:   "EDITOR",
  CREATE_CARD:    "EDITOR",
  UPDATE_CARD:    "EDITOR",
  DELETE_CARD:    "EDITOR",
  MOVE_CARD:      "EDITOR",
  MANAGE_MEMBERS: "ADMIN",
  UPDATE_BOARD:   "ADMIN",
  ARCHIVE_BOARD:  "OWNER",
  DELETE_BOARD:   "OWNER",
};

const CARD_ACTION_MIN_ROLE: Record<CardAction, BoardRole> = {
  VIEW_CARD:   "VIEWER",
  UPDATE_CARD: "EDITOR",
  DELETE_CARD: "EDITOR",
  MOVE_CARD:   "EDITOR",
};

// ============================================================================
// AclError
// ============================================================================

export class AclError extends Error {
  constructor(
    public readonly code: "FORBIDDEN" | "UNAUTHORIZED",
    message: string,
    public readonly context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AclError";
  }
}

// ============================================================================
// AclEngine
// ============================================================================

export class AclEngine {
  // ==========================================================================
  // Board Checks
  // ==========================================================================

  /**
   * Returns true if the role has permission for the action.
   * Never throws — use assertBoard for throwing behaviour.
   */
  canBoard(role: BoardRole, action: BoardAction): boolean {
    const required = BOARD_ACTION_MIN_ROLE[action] ?? "OWNER";
    return PRIVILEGE[role] >= PRIVILEGE[required];
  }

  /**
   * Throws AclError if the role does NOT have permission.
   * Use this in command handlers / tRPC procedures.
   */
  assertBoard(
    role: BoardRole,
    action: BoardAction,
    context?: Record<string, unknown>,
  ): void {
    if (!this.canBoard(role, action)) {
      throw new AclError(
        role === "NONE" ? "UNAUTHORIZED" : "FORBIDDEN",
        `Role '${role}' is not allowed to perform '${action}'.`,
        context,
      );
    }
  }

  // ==========================================================================
  // Card Checks
  // ==========================================================================

  canCard(role: BoardRole, action: CardAction): boolean {
    const required = CARD_ACTION_MIN_ROLE[action] ?? "OWNER";
    return PRIVILEGE[role] >= PRIVILEGE[required];
  }

  assertCard(
    role: BoardRole,
    action: CardAction,
    context?: Record<string, unknown>,
  ): void {
    if (!this.canCard(role, action)) {
      throw new AclError(
        role === "NONE" ? "UNAUTHORIZED" : "FORBIDDEN",
        `Role '${role}' is not allowed to perform '${action}' on card.`,
        context,
      );
    }
  }

  // ==========================================================================
  // Tenant Isolation
  // ==========================================================================

  /**
   * Hard tenant isolation check — always runs regardless of role.
   * Throws AclError if the resource tenantId does not match the session tenantId.
   *
   * This is a defense-in-depth check; primary isolation happens at the DB layer
   * via the tenantId column on every query.
   */
  assertTenantMatch(
    sessionTenantId: string,
    resourceTenantId: string,
    resource?: string,
  ): void {
    if (sessionTenantId !== resourceTenantId) {
      throw new AclError(
        "FORBIDDEN",
        `Cross-tenant access denied${resource ? ` on ${resource}` : ""}.`,
        { sessionTenantId, resourceTenantId },
      );
    }
  }

  // ==========================================================================
  // Role Utilities
  // ==========================================================================

  /**
   * Parse a raw role string from DB / JWT into a BoardRole.
   * Defaults to "NONE" for unrecognised values.
   */
  parseRole(raw: string | null | undefined): BoardRole {
    if (!raw) return "NONE";
    const upper = raw.toUpperCase() as BoardRole;
    return ROLE_HIERARCHY.includes(upper) ? upper : "NONE";
  }

  /**
   * Returns true if roleA is at least as privileged as roleB.
   */
  atLeast(roleA: BoardRole, roleB: BoardRole): boolean {
    return PRIVILEGE[roleA] >= PRIVILEGE[roleB];
  }

  /**
   * Returns the minimum role required for a board action.
   */
  minimumRoleFor(action: BoardAction): BoardRole {
    return BOARD_ACTION_MIN_ROLE[action] ?? "OWNER";
  }
}

// Singleton instance — re-use everywhere (stateless)
export const aclEngine = new AclEngine();
