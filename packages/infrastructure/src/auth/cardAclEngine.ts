// packages/infrastructure/src/auth/cardAclEngine.ts
// ─────────────────────────────────────────────────────────────────────────────
// Card-Level ACL Engine — fine-grained per-card permissions.
//
// Architecture:
//   Card ACL is derived from:
//   1. Board-level role (inherited from AclEngine)
//   2. Card-level overrides (card_acl table rows)
//   3. Card visibility rules (public/private/assignees-only)
//
// Resolution order (highest wins):
//   card_acl row (explicit grant/deny) > card visibility > board role
//
// Permissions:
//   card:read          — see the card and its content
//   card:update        — edit title / description
//   card:move          — drag to another list or board
//   card:delete        — delete the card
//   card:comment       — add comments
//   card:assign        — add/remove assignees
//   card:lock          — lock card (prevent edits by non-owners)
//   card:field:*       — field-level: card:field:title, card:field:description
// ─────────────────────────────────────────────────────────────────────────────

import type { Redis } from "ioredis";
import type { AclEngine, BoardRole } from "./aclEngine";
import { roleAtLeast } from "./aclEngine";

// ============================================================================
// Types
// ============================================================================

export type CardPermission =
  | "card:read"
  | "card:update"
  | "card:move"
  | "card:delete"
  | "card:comment"
  | "card:assign"
  | "card:lock"
  | "card:field:title"
  | "card:field:description"
  | "card:field:position";

export type CardVisibility =
  | "board_members" // all board members can see (default)
  | "assignees_only" // only assignees + ADMIN/OWNER
  | "private";       // only creator + ADMIN/OWNER

export interface CardAclRow {
  cardId:     string;
  userId:     string;
  tenantId:   string;
  grantedPermissions: CardPermission[];
  deniedPermissions:  CardPermission[];
  isLocked:   boolean;
  visibility: CardVisibility;
  isAssignee: boolean;
}

export interface CardAclCheckResult {
  allowed:    boolean;
  reason:     "board_role" | "card_acl" | "visibility" | "locked" | "inherited";
  boardRole:  BoardRole;
  fromCache:  boolean;
}

// ============================================================================
// Permission matrix — minimum board role required by default
// ============================================================================

const CARD_PERMISSION_MATRIX: Record<CardPermission, BoardRole> = {
  "card:read":              "VIEWER",
  "card:comment":           "VIEWER",
  "card:update":            "EDITOR",
  "card:field:title":       "EDITOR",
  "card:field:description": "EDITOR",
  "card:field:position":    "EDITOR",
  "card:move":              "EDITOR",
  "card:assign":            "EDITOR",
  "card:delete":            "ADMIN",
  "card:lock":              "ADMIN",
};

// ============================================================================
// CardAclEngine
// ============================================================================

const CARD_CACHE_TTL_SEC = 10 * 60; // 10 min (shorter than board — more volatile)
const CARD_CACHE_KEY = (tenantId: string, cardId: string, userId: string) =>
  `card_acl:${tenantId}:${cardId}:${userId}`;

export class CardAclEngine {
  constructor(
    private readonly boardAcl: AclEngine,
    private readonly db: any,
    private readonly redis: Redis,
  ) {}

  // ==========================================================================
  // Primary check: can userId perform permission on cardId?
  // ==========================================================================

  async check(params: {
    userId:     string;
    tenantId:   string;
    boardId:    string;
    cardId:     string;
    permission: CardPermission;
  }): Promise<CardAclCheckResult> {
    const { userId, tenantId, boardId, cardId, permission } = params;

    // ── 1. Board-level role (inherited baseline) ───────────────────────────
    const boardResult = await this.boardAcl.check({
      userId, tenantId, boardId, permission: "card:read",
    });
    const boardRole = boardResult.role;

    // ── 2. Load card-level ACL row (cache-first) ──────────────────────────
    const cardAcl = await this.loadCardAcl(tenantId, cardId, userId, boardResult.fromCache);

    // ── 3. Visibility check ────────────────────────────────────────────────
    if (!this.checkVisibility(cardAcl, boardRole)) {
      return { allowed: false, reason: "visibility", boardRole, fromCache: boardResult.fromCache };
    }

    // ── 4. Lock check (blocks edits from non-admin when locked) ───────────
    if (cardAcl?.isLocked && this.isEditPermission(permission) && !roleAtLeast(boardRole, "ADMIN")) {
      return { allowed: false, reason: "locked", boardRole, fromCache: boardResult.fromCache };
    }

    // ── 5. Explicit card-level deny (highest priority) ────────────────────
    if (cardAcl?.deniedPermissions?.includes(permission)) {
      return { allowed: false, reason: "card_acl", boardRole, fromCache: boardResult.fromCache };
    }

    // ── 6. Explicit card-level grant ──────────────────────────────────────
    if (cardAcl?.grantedPermissions?.includes(permission)) {
      return { allowed: true, reason: "card_acl", boardRole, fromCache: boardResult.fromCache };
    }

    // ── 7. Fall back to board role against card permission matrix ─────────
    const minimumRole = CARD_PERMISSION_MATRIX[permission];
    const allowed = roleAtLeast(boardRole, minimumRole);
    return { allowed, reason: "board_role", boardRole, fromCache: boardResult.fromCache };
  }

  // ==========================================================================
  // Field-level permission: is this specific field editable?
  // ==========================================================================

  async checkField(params: {
    userId:   string;
    tenantId: string;
    boardId:  string;
    cardId:   string;
    field:    "title" | "description" | "position";
  }): Promise<CardAclCheckResult> {
    return this.check({
      ...params,
      permission: `card:field:${params.field}` as CardPermission,
    });
  }

  // ==========================================================================
  // Invalidate card ACL cache (call when card membership / lock changes)
  // ==========================================================================

  async invalidateCard(tenantId: string, cardId: string, userId?: string): Promise<void> {
    if (userId) {
      await this.redis.del(CARD_CACHE_KEY(tenantId, cardId, userId));
    } else {
      // Pattern scan to evict all users for this card
      let cursor = "0";
      do {
        const [next, keys] = await this.redis.scan(
          cursor, "MATCH", `card_acl:${tenantId}:${cardId}:*`, "COUNT", "100",
        );
        cursor = next;
        if (keys.length > 0) await this.redis.del(...keys);
      } while (cursor !== "0");
    }

    await this.redis.publish(
      "acl:card_invalidated",
      JSON.stringify({ tenantId, cardId }),
    );
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private async loadCardAcl(
    tenantId: string,
    cardId: string,
    userId: string,
    _parentFromCache: boolean,
  ): Promise<CardAclRow | null> {
    const key = CARD_CACHE_KEY(tenantId, cardId, userId);

    try {
      const cached = await this.redis.get(key);
      if (cached) return JSON.parse(cached) as CardAclRow;
    } catch { /* Redis unavailable */ }

    // DB lookup — join card_acl + card_assignees
    const row = await this.db.query.cardAcl?.findFirst?.({
      where: (ca: any, { eq, and }: any) =>
        and(eq(ca.cardId, cardId), eq(ca.userId, userId), eq(ca.tenantId, tenantId)),
    });

    if (!row) return null;

    const result: CardAclRow = {
      cardId, userId, tenantId,
      grantedPermissions: row.grantedPermissions ?? [],
      deniedPermissions:  row.deniedPermissions  ?? [],
      isLocked:           row.isLocked           ?? false,
      visibility:         row.visibility         ?? "board_members",
      isAssignee:         row.isAssignee          ?? false,
    };

    try {
      await this.redis.set(key, JSON.stringify(result), "EX", CARD_CACHE_TTL_SEC);
    } catch { /* best-effort */ }

    return result;
  }

  private checkVisibility(acl: CardAclRow | null, boardRole: BoardRole): boolean {
    const visibility = acl?.visibility ?? "board_members";
    switch (visibility) {
      case "board_members":  return true;
      case "assignees_only": return (acl?.isAssignee ?? false) || roleAtLeast(boardRole, "ADMIN");
      case "private":        return roleAtLeast(boardRole, "ADMIN");
    }
  }

  private isEditPermission(p: CardPermission): boolean {
    return p !== "card:read" && p !== "card:comment";
  }
}
