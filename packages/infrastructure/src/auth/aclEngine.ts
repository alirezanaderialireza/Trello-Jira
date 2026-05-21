// packages/infrastructure/src/auth/aclEngine.ts
// -----------------------------------------------------------------------------
// Board-level ACL engine.
//
// Role hierarchy (descending privilege):
//   OWNER > ADMIN > EDITOR > VIEWER > NONE
//
// Every permission check is:
//   1. Cache-first (Redis membership cache, 30-min TTL)
//   2. DB fallback on cache miss
//   3. Tenant-isolated (tenantId always included in every query)
//
// No business logic here — pure enforcement of stored roles.
// -----------------------------------------------------------------------------

import { eq, and, isNull } from "drizzle-orm";
import type { Redis } from "ioredis";

// ============================================================================
// Role Hierarchy
// ============================================================================

export type BoardRole = "OWNER" | "ADMIN" | "EDITOR" | "VIEWER" | "NONE";

const ROLE_RANK: Record<BoardRole, number> = {
  OWNER: 50,
  ADMIN: 40,
  EDITOR: 30,
  VIEWER: 10,
  NONE: 0,
};

export function roleAtLeast(role: BoardRole, minimum: BoardRole): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[minimum];
}

// ============================================================================
// Permission Matrix
// ============================================================================

export type BoardPermission =
  | "board:read"
  | "board:update"
  | "board:archive"
  | "board:delete"
  | "board:manage_members"
  | "list:create"
  | "list:update"
  | "list:delete"
  | "list:move"
  | "card:create"
  | "card:read"
  | "card:update"
  | "card:delete"
  | "card:move";

const PERMISSION_MATRIX: Record<BoardPermission, BoardRole> = {
  "board:read":           "VIEWER",
  "board:update":         "EDITOR",
  "board:archive":        "ADMIN",
  "board:delete":         "OWNER",
  "board:manage_members": "ADMIN",
  "list:create":          "EDITOR",
  "list:update":          "EDITOR",
  "list:delete":          "ADMIN",
  "list:move":            "EDITOR",
  "card:create":          "EDITOR",
  "card:read":            "VIEWER",
  "card:update":          "EDITOR",
  "card:delete":          "EDITOR",
  "card:move":            "EDITOR",
};

export function hasPermission(role: BoardRole, permission: BoardPermission): boolean {
  return roleAtLeast(role, PERMISSION_MATRIX[permission]);
}

// ============================================================================
// Membership Cache Key Strategy
// Tenant-namespaced to prevent cross-tenant collisions.
// ============================================================================

const membershipCacheKey = (tenantId: string, boardId: string, userId: string) =>
  `acl:${tenantId}:${boardId}:${userId}`;

const CACHE_TTL_SEC = 30 * 60; // 30 minutes

// ============================================================================
// AclEngine
// ============================================================================

export interface AclCheckResult {
  allowed: boolean;
  role: BoardRole;
  aclVersion: number;
  /** true when result came from cache */
  fromCache: boolean;
}

export class AclEngine {
  constructor(
    private readonly db: any,       // Drizzle
    private readonly redis: Redis,
  ) {}

  // ==========================================================================
  // Primary check: can userId perform permission on boardId?
  // Tenant-isolated: tenantId from verified session, never from client input.
  // ==========================================================================

  async check(params: {
    userId: string;
    tenantId: string;
    boardId: string;
    permission: BoardPermission;
    expectedAclVersion?: number;
  }): Promise<AclCheckResult> {
    const { userId, tenantId, boardId, permission, expectedAclVersion } = params;

    // ------------------------------------------------------------------
    // 1. Cache-first membership lookup
    // ------------------------------------------------------------------
    const cacheKey = membershipCacheKey(tenantId, boardId, userId);
    const cached = await this.redis.get(cacheKey);

    let role: BoardRole;
    let aclVersion: number;
    let fromCache = false;

    if (cached) {
      const parsed = JSON.parse(cached) as { role: BoardRole; aclVersion: number };
      role = parsed.role;
      aclVersion = parsed.aclVersion;
      fromCache = true;
    } else {
      // ------------------------------------------------------------------
      // 2. DB fallback — always tenant-filtered
      // ------------------------------------------------------------------
      const result = await this.loadFromDb(userId, tenantId, boardId);
      role = result.role;
      aclVersion = result.aclVersion;

      // Populate cache
      await this.redis.set(
        cacheKey,
        JSON.stringify({ role, aclVersion }),
        "EX",
        CACHE_TTL_SEC,
      );
    }

    // ------------------------------------------------------------------
    // 3. ACL version drift guard — detect stale client state
    // ------------------------------------------------------------------
    if (expectedAclVersion !== undefined && aclVersion !== expectedAclVersion) {
      return { allowed: false, role, aclVersion, fromCache };
    }

    const allowed = hasPermission(role, permission);
    return { allowed, role, aclVersion, fromCache };
  }

  // ==========================================================================
  // Invalidate cache for a user+board (called on role change, member removal)
  // ==========================================================================

  async invalidateMembership(params: {
    tenantId: string;
    boardId: string;
    userId: string;
  }): Promise<void> {
    const key = membershipCacheKey(params.tenantId, params.boardId, params.userId);
    await this.redis.del(key);

    // Publish cluster-wide invalidation via pub/sub
    // All API nodes subscribed to this channel will evict their local state
    await this.redis.publish(
      "acl:membership_invalidated",
      JSON.stringify({
        tenantId: params.tenantId,
        boardId: params.boardId,
        userId: params.userId,
      }),
    );
  }

  // ==========================================================================
  // Invalidate all cache entries for a board (e.g., board archived, ACL reset)
  // ==========================================================================

  async invalidateBoardMemberships(params: {
    tenantId: string;
    boardId: string;
  }): Promise<void> {
    // Pattern scan — use with care on large datasets
    // In production, maintain a board→members set in Redis for O(1) invalidation
    const pattern = `acl:${params.tenantId}:${params.boardId}:*`;
    let cursor = "0";

    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor,
        "MATCH",
        pattern,
        "COUNT",
        "100",
      );
      cursor = nextCursor;
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } while (cursor !== "0");

    await this.redis.publish(
      "acl:board_invalidated",
      JSON.stringify({ tenantId: params.tenantId, boardId: params.boardId }),
    );
  }

  // ==========================================================================
  // Private: load membership + board ACL version from DB
  // ==========================================================================

  private async loadFromDb(
    userId: string,
    tenantId: string,
    boardId: string,
  ): Promise<{ role: BoardRole; aclVersion: number }> {
    // Both queries are tenant-filtered — cross-tenant leaks impossible
    const [memberResult, boardResult] = await Promise.all([
      this.db.query.boardMembers?.findFirst?.({
        where: (bm: any, { eq, and, isNull }: any) =>
          and(
            eq(bm.userId, userId),
            eq(bm.boardId, boardId),
            eq(bm.tenantId, tenantId),
            isNull(bm.removedAt),
          ),
        columns: { role: true },
      }),
      this.db.query.boards?.findFirst?.({
        where: (b: any, { eq, and, isNull }: any) =>
          and(
            eq(b.id, boardId),
            eq(b.tenantId, tenantId),
            isNull(b.deletedAt),
          ),
        columns: { aclVersion: true },
      }),
    ]);

    const role = (memberResult?.role as BoardRole | undefined) ?? "NONE";
    const aclVersion = boardResult?.aclVersion ?? 1;

    return { role, aclVersion };
  }
}
