// packages/infrastructure/src/auth/liveAcl/sessionRevoker.ts
// ─────────────────────────────────────────────────────────────────────────────
// SessionRevoker — forces session revalidation or hard eviction.
//
// Three revocation modes:
//   HARD_REVOKE    — session is immediately invalid; next request → 401
//   SOFT_REVALIDATE — client is told to refresh their token on next request
//   PERMISSION_DOWNGRADE — ACL version bumped; client re-checks permissions
//
// Uses a Redis set "revoked_sessions:{tenantId}" for O(1) checks without
// a DB roundtrip on the hot path (token verification).
// ─────────────────────────────────────────────────────────────────────────────

import type { Redis } from "ioredis";
import type { AclInvalidationBus } from "./aclInvalidationBus";

const SESSION_REVOKE_KEY = (tenantId: string) => `revoked_sessions:${tenantId}`;
const SESSION_REVOKE_TTL_SEC = 24 * 60 * 60; // 24 hours

export type RevocationMode = "HARD_REVOKE" | "SOFT_REVALIDATE" | "PERMISSION_DOWNGRADE";

export interface RevocationRecord {
  sessionId:  string;
  userId:     string;
  tenantId:   string;
  mode:       RevocationMode;
  reason:     string;
  revokedAt:  number;
  expiresAt:  number;
}

export class SessionRevoker {
  constructor(
    private readonly redis:       Redis,
    private readonly bus:         AclInvalidationBus,
    private readonly db:          any,
  ) {}

  // ==========================================================================
  // Revoke a specific session immediately (hard eviction)
  // ==========================================================================

  async revokeSession(params: {
    sessionId: string;
    userId:    string;
    tenantId:  string;
    reason:    string;
  }): Promise<void> {
    const { sessionId, userId, tenantId, reason } = params;

    // 1. Redis hot set (O(1) check on every subsequent request)
    const key = SESSION_REVOKE_KEY(tenantId);
    await this.redis.sadd(key, sessionId);
    await this.redis.expire(key, SESSION_REVOKE_TTL_SEC);

    // 2. DB mark-as-revoked
    await this.db.execute(
      `UPDATE sessions SET is_revoked = true, revoked_reason = $1, updated_at = now()
       WHERE id = $2 AND tenant_id = $3`,
      [reason, sessionId, tenantId],
    ).catch(() => undefined);

    // 3. Publish so WS servers disconnect live connections
    await this.bus.publishSessionRevoke({ tenantId, sessionId, userId });
  }

  // ==========================================================================
  // Revoke all sessions for a user on a board (role removal)
  // ==========================================================================

  async revokeUserBoardSessions(params: {
    userId:   string;
    tenantId: string;
    boardId:  string;
    reason:   string;
  }): Promise<void> {
    const { userId, tenantId, boardId, reason } = params;

    // Load user's active sessions
    const rows = await this.db.query.sessions?.findMany?.({
      where: (s: any, { eq, and }: any) =>
        and(eq(s.userId, userId), eq(s.tenantId, tenantId), eq(s.isRevoked, false)),
      columns: { id: true },
    }) ?? [];

    // Revoke each one
    for (const row of rows) {
      await this.revokeSession({ sessionId: row.id, userId, tenantId, reason });
    }

    // Also notify ACL bus for WS enforcement
    await this.bus.publishMemberRemoved({ tenantId, boardId, userId });
  }

  // ==========================================================================
  // Fast check: is a session in the revoked set? (O(1), no DB)
  // ==========================================================================

  async isRevoked(tenantId: string, sessionId: string): Promise<boolean> {
    const key = SESSION_REVOKE_KEY(tenantId);
    return (await this.redis.sismember(key, sessionId)) === 1;
  }

  // ==========================================================================
  // Bump ACL version for a board (forces permission re-check on next request)
  // ==========================================================================

  async bumpBoardAclVersion(params: {
    tenantId: string;
    boardId:  string;
    userId:   string;
    newRole:  string;
  }): Promise<void> {
    // Increment aclVersion on the board row
    await this.db.execute(
      `UPDATE boards SET acl_version = acl_version + 1, updated_at = now()
       WHERE id = $1 AND tenant_id = $2`,
      [params.boardId, params.tenantId],
    ).catch(() => undefined);

    // Publish member-changed event so all nodes invalidate their membership cache
    await this.bus.publishMemberChanged({
      tenantId: params.tenantId,
      boardId:  params.boardId,
      userId:   params.userId,
      newRole:  params.newRole,
    });
  }
}
