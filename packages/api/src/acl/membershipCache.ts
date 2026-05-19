// packages/api/src/acl/membershipCache.ts
//
// ============================================================================
// ⚡ MembershipCache — Redis-backed ACL Cache with TTL + Pub/Sub Invalidation
// ============================================================================
//
// Architecture:
//   Hot path  — Redis hash keyed by "mbr:{tenantId}:{userId}:{boardId}"
//               Contains role, aclVersion, and board-level roles array.
//               TTL = MEMBERSHIP_TTL_SECONDS (30 min).
//               Redis returns within ~0.1 ms; DB fallback ~5–20 ms.
//
//   Warm path — User-level key "mbr:{tenantId}:{userId}" stores a JSON map of
//               boardId → MembershipEntry so a single key holds all boards
//               the user has access to.  Used by session propagation to check
//               ACL drift without knowing which board is being accessed.
//
//   Invalidation — On member add/remove/role-change:
//     1. Delete the per-board key in Redis (or update it)
//     2. Delete the per-user key so next lookup re-fetches from DB
//     3. Publish "acl:invalidate" event on Redis pub/sub so OTHER cluster
//        nodes can evict their local in-process caches (if any)
//
//   DB fallback — On any Redis miss, load from DB and repopulate cache.
//               Cache is write-through: DB writes also update Redis.
//
// Multi-node safety:
//   Each API pod subscribes to the "acl:invalidate" pub/sub channel on
//   startup.  On receiving an event, it deletes the local entry from any
//   in-process Map cache (not implemented here — hook point provided).
//
// ============================================================================

import type { Redis } from "ioredis";
import type { BoardRole } from "./aclEngine";
import { AclEngine }     from "./aclEngine";

// ============================================================================
// Types
// ============================================================================

export interface MembershipEntry {
  /** The user's role on this board */
  role:       BoardRole;
  /** Monotonically increasing counter; bumped on every ACL mutation */
  aclVersion: number;
  /** All roles the user has (for multi-board context) */
  roles:      string[];
  /** When this entry was cached (ms epoch) */
  cachedAt:   number;
}

export interface UserMembershipMap {
  /** boardId → entry */
  boards:     Record<string, MembershipEntry>;
  aclVersion: number;
  roles:      string[];
  cachedAt:   number;
}

// ============================================================================
// Config
// ============================================================================

const BOARD_MEMBERSHIP_TTL = 30 * 60;   // 30 min — per-board entry
const USER_MEMBERSHIP_TTL  = 30 * 60;   // 30 min — user-level map
const INVALIDATE_CHANNEL   = "acl:invalidate";

const boardKey = (tenantId: string, boardId: string, userId: string) =>
  `mbr:${tenantId}:b:${boardId}:${userId}`;

const userKey = (tenantId: string, userId: string) =>
  `mbr:${tenantId}:u:${userId}`;

// ============================================================================
// DB Provider interface
// ============================================================================

export interface MembershipDbProvider {
  /**
   * Load a single board membership row.
   * Returns null if the user is not a member or the board doesn't exist.
   */
  getRole(opts: {
    tenantId: string;
    boardId:  string;
    userId:   string;
  }): Promise<{ role: string; aclVersion: number } | null>;

  /**
   * Load all active board memberships for a user within a tenant.
   * Returns boardId → role map.
   */
  getAllForUser(opts: {
    tenantId: string;
    userId:   string;
  }): Promise<Array<{ boardId: string; role: string; aclVersion: number }>>;
}

// ============================================================================
// MembershipCache
// ============================================================================

export class MembershipCache {
  private readonly acl = new AclEngine();

  constructor(
    private readonly redis:  Redis,
    /** Separate connection for pub/sub publish */
    private readonly pub:    Redis,
    private readonly db:     MembershipDbProvider,
  ) {}

  // ==========================================================================
  // 🔍 getRole — per-board lookup (hot path for every mutation)
  // ==========================================================================

  async getRole(
    tenantId: string,
    boardId:  string,
    userId:   string,
  ): Promise<BoardRole> {
    const key = boardKey(tenantId, boardId, userId);

    // ── 1. Redis hot path ───────────────────────────────────────────────────
    const raw = await this.redis.get(key);
    if (raw) {
      const entry = JSON.parse(raw) as MembershipEntry;
      return entry.role;
    }

    // ── 2. DB fallback ──────────────────────────────────────────────────────
    const row = await this.db.getRole({ tenantId, boardId, userId });
    const role = this.acl.parseRole(row?.role ?? null);
    const aclVersion = row?.aclVersion ?? 1;

    // ── 3. Populate cache ───────────────────────────────────────────────────
    const entry: MembershipEntry = {
      role,
      aclVersion,
      roles:    [role],
      cachedAt: Date.now(),
    };
    await this.redis.setex(key, BOARD_MEMBERSHIP_TTL, JSON.stringify(entry));

    return role;
  }

  // ==========================================================================
  // 🔍 getEntry — full entry for a board (includes aclVersion)
  // ==========================================================================

  async getEntry(
    tenantId: string,
    boardId:  string,
    userId:   string,
  ): Promise<MembershipEntry | null> {
    const key = boardKey(tenantId, boardId, userId);
    const raw = await this.redis.get(key);
    if (raw) return JSON.parse(raw) as MembershipEntry;

    const row = await this.db.getRole({ tenantId, boardId, userId });
    if (!row) return null;

    const entry: MembershipEntry = {
      role:       this.acl.parseRole(row.role),
      aclVersion: row.aclVersion,
      roles:      [this.acl.parseRole(row.role)],
      cachedAt:   Date.now(),
    };
    await this.redis.setex(key, BOARD_MEMBERSHIP_TTL, JSON.stringify(entry));
    return entry;
  }

  // ==========================================================================
  // 🔍 getByUser — user-level ACL map (for session propagation / ACL drift)
  // ==========================================================================

  async getByUser(
    tenantId: string,
    userId:   string,
  ): Promise<UserMembershipMap | null> {
    const key = userKey(tenantId, userId);
    const raw = await this.redis.get(key);
    if (raw) return JSON.parse(raw) as UserMembershipMap;

    // DB fallback
    const rows = await this.db.getAllForUser({ tenantId, userId });
    if (rows.length === 0) return null;

    const boards: Record<string, MembershipEntry> = {};
    let maxAclVersion = 1;
    const allRoles: string[] = [];

    for (const row of rows) {
      const role = this.acl.parseRole(row.role);
      boards[row.boardId] = {
        role,
        aclVersion: row.aclVersion,
        roles:      [role],
        cachedAt:   Date.now(),
      };
      if (row.aclVersion > maxAclVersion) maxAclVersion = row.aclVersion;
      if (!allRoles.includes(role)) allRoles.push(role);
    }

    const map: UserMembershipMap = {
      boards,
      aclVersion: maxAclVersion,
      roles:      allRoles,
      cachedAt:   Date.now(),
    };
    await this.redis.setex(key, USER_MEMBERSHIP_TTL, JSON.stringify(map));
    return map;
  }

  // ==========================================================================
  // 🔄 upsert — write-through on member add/role change
  // ==========================================================================

  async upsert(opts: {
    tenantId:   string;
    boardId:    string;
    userId:     string;
    role:       BoardRole;
    aclVersion: number;
  }): Promise<void> {
    const entry: MembershipEntry = {
      role:       opts.role,
      aclVersion: opts.aclVersion,
      roles:      [opts.role],
      cachedAt:   Date.now(),
    };
    const key = boardKey(opts.tenantId, opts.boardId, opts.userId);
    await this.redis.setex(key, BOARD_MEMBERSHIP_TTL, JSON.stringify(entry));

    // Invalidate user-level map so next read re-fetches
    await this.redis.del(userKey(opts.tenantId, opts.userId));

    await this._publishInvalidation({
      type:      "upsert",
      tenantId:  opts.tenantId,
      boardId:   opts.boardId,
      userId:    opts.userId,
    });
  }

  // ==========================================================================
  // ❌ invalidate — on member remove or board archive/delete
  // ==========================================================================

  async invalidate(opts: {
    tenantId: string;
    boardId:  string;
    userId?:  string;
  }): Promise<void> {
    if (opts.userId) {
      // Single user
      const key = boardKey(opts.tenantId, opts.boardId, opts.userId);
      await this.redis.del(key);
      await this.redis.del(userKey(opts.tenantId, opts.userId));
    } else {
      // All members of the board — use scan to find all matching keys
      await this._scanAndDelete(`mbr:${opts.tenantId}:b:${opts.boardId}:*`);
    }

    await this._publishInvalidation({
      type:     "invalidate",
      tenantId: opts.tenantId,
      boardId:  opts.boardId,
      userId:   opts.userId,
    });
  }

  // ==========================================================================
  // 📡 subscribe — receive invalidations from other cluster nodes
  // ==========================================================================

  /**
   * Subscribe to the invalidation channel.
   * Call this once per process on startup.
   *
   * @param onInvalidate — callback invoked with each invalidation event.
   *   Use this to evict in-process caches if you layer one on top of Redis.
   */
  subscribeToInvalidations(
    subscriber: Redis,
    onInvalidate: (event: AclInvalidationEvent) => void,
  ): void {
    subscriber.subscribe(INVALIDATE_CHANNEL, (err) => {
      if (err) console.error("[MembershipCache] subscribe error", err);
    });

    subscriber.on("message", (_channel: string, message: string) => {
      try {
        const event = JSON.parse(message) as AclInvalidationEvent;
        onInvalidate(event);
      } catch {
        // ignore malformed messages
      }
    });
  }

  // ==========================================================================
  // 🔧 Internal helpers
  // ==========================================================================

  private async _publishInvalidation(event: AclInvalidationEvent): Promise<void> {
    await this.pub.publish(INVALIDATE_CHANNEL, JSON.stringify(event));
  }

  private async _scanAndDelete(pattern: string): Promise<void> {
    let cursor = "0";
    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor, "MATCH", pattern, "COUNT", 100,
      );
      cursor = nextCursor;
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } while (cursor !== "0");
  }
}

export interface AclInvalidationEvent {
  type:      "upsert" | "invalidate";
  tenantId:  string;
  boardId:   string;
  userId?:   string;
}
