// packages/infrastructure/src/redis/membershipCache.ts
// -----------------------------------------------------------------------------
// Board membership cache — dedicated layer on top of AclEngine.
//
// Responsibilities:
//   - Write-through cache: every role change writes to DB then invalidates cache
//   - DB fallback: if Redis is unavailable, reads go straight to DB
//   - Multi-node consistency: pub/sub invalidation via "acl:membership_invalidated"
//   - Cluster-wide: all API instances subscribe to invalidation channel
//
// Key schema:
//   acl:{tenantId}:{boardId}:{userId}  →  { role, aclVersion }  TTL 30min
// -----------------------------------------------------------------------------

import type { Redis } from "ioredis";

// ============================================================================
// Types
// ============================================================================

export interface MembershipEntry {
  role: string;
  aclVersion: number;
  cachedAt: number; // unix ms — for age-based refresh
}

// ============================================================================
// MembershipCache
// ============================================================================

const CACHE_TTL_SEC = 30 * 60; // 30 minutes
const CACHE_KEY = (tenantId: string, boardId: string, userId: string) =>
  `acl:${tenantId}:${boardId}:${userId}`;

export class MembershipCache {
  private readonly subClient: Redis;

  constructor(
    private readonly redis: Redis,
    subRedis: Redis, // separate connection for SUBSCRIBE
    private readonly db: any,
  ) {
    this.subClient = subRedis;
    this.startInvalidationListener();
  }

  // ==========================================================================
  // Get — cache-first, DB fallback
  // ==========================================================================

  async get(params: {
    tenantId: string;
    boardId: string;
    userId: string;
  }): Promise<MembershipEntry | null> {
    const key = CACHE_KEY(params.tenantId, params.boardId, params.userId);

    try {
      const cached = await this.redis.get(key);
      if (cached) {
        return JSON.parse(cached) as MembershipEntry;
      }
    } catch {
      // Redis unavailable — fall through to DB
    }

    return this.loadFromDbAndCache(params);
  }

  // ==========================================================================
  // Invalidate a single membership (e.g., role updated)
  // ==========================================================================

  async invalidate(params: {
    tenantId: string;
    boardId: string;
    userId: string;
  }): Promise<void> {
    const key = CACHE_KEY(params.tenantId, params.boardId, params.userId);

    try {
      await this.redis.del(key);
      // Publish so other nodes also evict
      await this.redis.publish(
        "acl:membership_invalidated",
        JSON.stringify(params),
      );
    } catch {
      // Best-effort — cache will expire naturally via TTL
    }
  }

  // ==========================================================================
  // Write-through: update role → DB → invalidate cache
  // Caller is responsible for the DB write; this method handles cache coherence.
  // ==========================================================================

  async writeThrough(params: {
    tenantId: string;
    boardId: string;
    userId: string;
    role: string;
    aclVersion: number;
  }): Promise<void> {
    const key = CACHE_KEY(params.tenantId, params.boardId, params.userId);
    const entry: MembershipEntry = {
      role: params.role,
      aclVersion: params.aclVersion,
      cachedAt: Date.now(),
    };

    try {
      await this.redis.set(key, JSON.stringify(entry), "EX", CACHE_TTL_SEC);
    } catch {
      // Redis unavailable — next read will rebuild from DB
    }
  }

  // ==========================================================================
  // Private: load from DB and populate cache
  // ==========================================================================

  private async loadFromDbAndCache(params: {
    tenantId: string;
    boardId: string;
    userId: string;
  }): Promise<MembershipEntry | null> {
    try {
      const [member, board] = await Promise.all([
        this.db.query.boardMembers?.findFirst?.({
          where: (bm: any, { eq, and, isNull }: any) =>
            and(
              eq(bm.userId, params.userId),
              eq(bm.boardId, params.boardId),
              eq(bm.tenantId, params.tenantId),
              isNull(bm.removedAt),
            ),
          columns: { role: true },
        }),
        this.db.query.boards?.findFirst?.({
          where: (b: any, { eq, and, isNull }: any) =>
            and(
              eq(b.id, params.boardId),
              eq(b.tenantId, params.tenantId),
              isNull(b.deletedAt),
            ),
          columns: { aclVersion: true },
        }),
      ]);

      if (!board) return null; // Board doesn't exist or wrong tenant

      const entry: MembershipEntry = {
        role: member?.role ?? "NONE",
        aclVersion: board.aclVersion ?? 1,
        cachedAt: Date.now(),
      };

      const key = CACHE_KEY(params.tenantId, params.boardId, params.userId);
      try {
        await this.redis.set(key, JSON.stringify(entry), "EX", CACHE_TTL_SEC);
      } catch {
        // Cache population failure is non-fatal
      }

      return entry;
    } catch {
      return null;
    }
  }

  // ==========================================================================
  // Cluster-wide invalidation listener
  // Subscribes to Redis pub/sub channel and evicts local cache entries.
  // All API nodes run this — ensures multi-node consistency.
  // ==========================================================================

  private startInvalidationListener(): void {
    this.subClient
      .subscribe("acl:membership_invalidated", "acl:board_invalidated")
      .catch(() => {
        // Log but don't crash — cache will expire naturally
      });

    this.subClient.on("message", (channel, message) => {
      if (channel === "acl:membership_invalidated") {
        try {
          const { tenantId, boardId, userId } = JSON.parse(message) as {
            tenantId: string;
            boardId: string;
            userId: string;
          };
          const key = CACHE_KEY(tenantId, boardId, userId);
          this.redis.del(key).catch(() => undefined);
        } catch {
          // Malformed message — ignore
        }
      }

      if (channel === "acl:board_invalidated") {
        try {
          const { tenantId, boardId } = JSON.parse(message) as {
            tenantId: string;
            boardId: string;
          };
          // Pattern delete all entries for this board
          const pattern = `acl:${tenantId}:${boardId}:*`;
          this.scanAndDelete(pattern).catch(() => undefined);
        } catch {
          // Malformed message — ignore
        }
      }
    });
  }

  private async scanAndDelete(pattern: string): Promise<void> {
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
  }
}
