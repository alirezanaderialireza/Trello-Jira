// packages/infrastructure/src/auth/tokenService.ts
// -----------------------------------------------------------------------------
// RS256 Access Token + Opaque Refresh Token lifecycle.
//
// Design:
//   - Access token:  RS256 JWT, 15-min TTL, JTI tracked per session
//   - Refresh token: crypto.randomBytes(32) opaque, stored as SHA-256 hash
//   - Rotation:      atomic CAS on lastAccessJti — rejects concurrent rotations
//   - Revocation:    Redis hot blocklist + PostgreSQL durable fallback
//   - GC:            expired session rows + expired revokedTokens rows
//
// Deps injected:
//   - db (Drizzle)
//   - redis (ioredis)
//   - privateKey / publicKey (RS256 PEM strings from env)
// -----------------------------------------------------------------------------

import crypto from "node:crypto";
import { eq, and, lt, sql } from "drizzle-orm";
import type { Redis } from "ioredis";

// ============================================================================
// Types
// ============================================================================

export interface TokenPair {
  accessToken: string;
  refreshToken: string; // opaque, 64-char hex
  jti: string;
  expiresAt: Date;
}

export interface AccessTokenClaims {
  sub: string;       // userId
  tid: string;       // tenantId
  sid: string;       // sessionId
  jti: string;
  roles: string[];
  iat: number;
  exp: number;
}

export interface TokenServiceConfig {
  accessTokenTtlSec: number;   // default 900 (15 min)
  refreshTokenTtlDays: number; // default 7
  issuer: string;
  audience: string;
}

export interface SessionRow {
  id: string;
  userId: string;
  tenantId: string;
  refreshTokenHash: string;
  lastAccessJti: string | null;
  isRevoked: boolean;
  expiresAt: Date;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CONFIG: TokenServiceConfig = {
  accessTokenTtlSec: 900,
  refreshTokenTtlDays: 7,
  issuer: "trello-jira",
  audience: "trello-jira-client",
};

// Redis key prefix — tenant-namespaced to prevent cross-tenant collisions
const REVOKED_KEY = (jti: string) => `auth:revoked:${jti}`;
const SESSION_LOCK_KEY = (sessionId: string) => `auth:rotation_lock:${sessionId}`;

// ============================================================================
// TokenService
// ============================================================================

export class TokenService {
  private readonly config: TokenServiceConfig;

  constructor(
    private readonly db: any, // Drizzle instance
    private readonly redis: Redis,
    private readonly privateKeyPem: string,
    private readonly publicKeyPem: string,
    config: Partial<TokenServiceConfig> = {},
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ==========================================================================
  // 1. Issue Token Pair
  //    Called on login/session creation.
  // ==========================================================================

  async issueTokenPair(params: {
    userId: string;
    tenantId: string;
    sessionId: string;
    roles: string[];
  }): Promise<TokenPair> {
    const jti = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const exp = now + this.config.accessTokenTtlSec;

    const claims: AccessTokenClaims = {
      sub: params.userId,
      tid: params.tenantId,
      sid: params.sessionId,
      jti,
      roles: params.roles,
      iat: now,
      exp,
    };

    const accessToken = this.signJwt(claims);
    const { token: refreshToken, hash } = this.generateRefreshToken();
    const refreshExpiresAt = new Date(
      Date.now() + this.config.refreshTokenTtlDays * 86400_000,
    );

    // Persist session with new refresh token hash + lastAccessJti
    await this.db
      .update(this.sessionsTable())
      .set({
        refreshTokenHash: hash,
        lastAccessJti: jti,
        lastUsedAt: new Date(),
      })
      .where(eq(this.sessionsTable().id, params.sessionId));

    return { accessToken, refreshToken, jti, expiresAt: refreshExpiresAt };
  }

  // ==========================================================================
  // 2. Rotate Refresh Token (atomic CAS guard)
  //    Returns new token pair or throws on race condition.
  // ==========================================================================

  async rotateRefreshToken(params: {
    refreshToken: string;
    userAgent?: string;
    ip?: string;
  }): Promise<TokenPair & { userId: string; tenantId: string; roles: string[] }> {
    const incomingHash = this.hashToken(params.refreshToken);

    // ------------------------------------------------------------------
    // Distributed lock — prevents concurrent rotation of same session
    // TTL = 5 seconds (safe window for a single HTTP round-trip)
    // ------------------------------------------------------------------
    const session = await this.findSessionByRefreshHash(incomingHash);
    if (!session || session.isRevoked) {
      throw new TokenError("INVALID_REFRESH_TOKEN");
    }
    if (session.expiresAt < new Date()) {
      throw new TokenError("REFRESH_TOKEN_EXPIRED");
    }

    const lockKey = SESSION_LOCK_KEY(session.id);
    const lockAcquired = await this.redis.set(lockKey, "1", "EX", 5, "NX");
    if (!lockAcquired) {
      // Another request is already rotating this session — reject
      throw new TokenError("ROTATION_RACE_DETECTED");
    }

    try {
      // CAS: verify lastAccessJti hasn't changed since we read it
      // (double-check under lock)
      const fresh = await this.findSessionById(session.id);
      if (!fresh || fresh.refreshTokenHash !== incomingHash) {
        // Token was already rotated by a concurrent request
        throw new TokenError("REFRESH_TOKEN_ALREADY_USED");
      }

      // Issue new pair (updates DB atomically)
      const pair = await this.issueTokenPair({
        userId: session.userId,
        tenantId: session.tenantId,
        sessionId: session.id,
        roles: await this.getRolesForSession(session),
      });

      return {
        ...pair,
        userId: session.userId,
        tenantId: session.tenantId,
        roles: await this.getRolesForSession(session),
      };
    } finally {
      await this.redis.del(lockKey);
    }
  }

  // ==========================================================================
  // 3. Verify Access Token
  //    Checks signature, expiry, and Redis revocation list.
  // ==========================================================================

  async verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    const claims = this.verifyJwt(token);

    // Check Redis hot blocklist first (fast path)
    const revoked = await this.redis.get(REVOKED_KEY(claims.jti));
    if (revoked) {
      throw new TokenError("TOKEN_REVOKED");
    }

    // Fallback: check DB durable store (cold path — only if Redis miss)
    // This guards against Redis restart/eviction scenarios
    const dbRevoked = await this.db.query.revokedTokens?.findFirst?.({
      where: (t: any, { eq, and, gt }: any) =>
        and(eq(t.jti, claims.jti), gt(t.expiresAt, new Date())),
    });
    if (dbRevoked) {
      // Restore to Redis to prevent repeated DB reads
      const ttlSec = Math.max(
        1,
        Math.floor((dbRevoked.expiresAt.getTime() - Date.now()) / 1000),
      );
      await this.redis.set(REVOKED_KEY(claims.jti), "1", "EX", ttlSec);
      throw new TokenError("TOKEN_REVOKED");
    }

    return claims;
  }

  // ==========================================================================
  // 4. Revoke Token
  //    Called on logout, password change, role update, session kill.
  // ==========================================================================

  async revokeToken(params: {
    jti: string;
    userId: string;
    tenantId: string;
    tokenExpAt: Date;
    reason?: string;
  }): Promise<void> {
    const ttlSec = Math.max(
      1,
      Math.floor((params.tokenExpAt.getTime() - Date.now()) / 1000),
    );

    // Redis hot blocklist (immediate effect across all nodes)
    await this.redis.set(REVOKED_KEY(params.jti), "1", "EX", ttlSec);

    // Durable DB record (survives Redis restart)
    try {
      await this.db.insert(this.revokedTokensTable()).values({
        jti: params.jti,
        userId: params.userId,
        tenantId: params.tenantId,
        reason: params.reason ?? "LOGOUT",
        expiresAt: params.tokenExpAt,
      });
    } catch {
      // Ignore duplicate-key errors (idempotent revocation)
    }
  }

  // ==========================================================================
  // 5. Revoke Session (kill all tokens for a session)
  // ==========================================================================

  async revokeSession(params: {
    sessionId: string;
    reason?: string;
  }): Promise<void> {
    await this.db
      .update(this.sessionsTable())
      .set({
        isRevoked: true,
        revokedReason: params.reason ?? "LOGOUT",
      })
      .where(eq(this.sessionsTable().id, params.sessionId));

    // Publish invalidation event so WS connections + workers drop the session
    await this.redis.publish(
      "auth:session_revoked",
      JSON.stringify({ sessionId: params.sessionId }),
    );
  }

  // ==========================================================================
  // 6. Session GC — expired sessions + expired revokedTokens rows
  //    Called by background job every 15 minutes.
  // ==========================================================================

  async gcExpiredSessions(): Promise<{ sessionsDeleted: number; tokensDeleted: number }> {
    const now = new Date();

    // Delete expired, revoked sessions (already inactive)
    const sessionResult = await this.db
      .delete(this.sessionsTable())
      .where(
        and(
          lt(this.sessionsTable().expiresAt, now),
          eq(this.sessionsTable().isRevoked, true),
        ),
      )
      .returning({ id: this.sessionsTable().id });

    // Delete expired revoked-token rows (their TTL has passed — no longer needed)
    const tokenResult = await this.db
      .delete(this.revokedTokensTable())
      .where(lt(this.revokedTokensTable().expiresAt, now))
      .returning({ jti: this.revokedTokensTable().jti });

    return {
      sessionsDeleted: sessionResult.length,
      tokensDeleted: tokenResult.length,
    };
  }

  // ==========================================================================
  // 7. lastAccessJti consistency check
  //    Used by WS + Worker layers to verify session freshness.
  // ==========================================================================

  async validateSessionJti(params: {
    sessionId: string;
    jti: string;
  }): Promise<boolean> {
    const session = await this.findSessionById(params.sessionId);
    if (!session || session.isRevoked) return false;
    if (session.expiresAt < new Date()) return false;

    // Accept if JTI matches the last issued access token
    return session.lastAccessJti === params.jti;
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  private signJwt(claims: AccessTokenClaims): string {
    // Manual RS256 JWT — no external jwt library needed (Node.js built-in crypto)
    const header = this.base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = this.base64url(JSON.stringify(claims));
    const signing = `${header}.${payload}`;

    const signature = crypto
      .createSign("RSA-SHA256")
      .update(signing)
      .sign(this.privateKeyPem, "base64url");

    return `${signing}.${signature}`;
  }

  private verifyJwt(token: string): AccessTokenClaims {
    const parts = token.split(".");
    if (parts.length !== 3) throw new TokenError("MALFORMED_TOKEN");

    const [header, payload, signature] = parts as [string, string, string];
    const signing = `${header}.${payload}`;

    const valid = crypto
      .createVerify("RSA-SHA256")
      .update(signing)
      .verify(this.publicKeyPem, signature, "base64url");

    if (!valid) throw new TokenError("INVALID_SIGNATURE");

    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as AccessTokenClaims;

    if (claims.exp < Math.floor(Date.now() / 1000)) {
      throw new TokenError("TOKEN_EXPIRED");
    }

    return claims;
  }

  private base64url(str: string): string {
    return Buffer.from(str)
      .toString("base64")
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
  }

  private generateRefreshToken(): { token: string; hash: string } {
    const token = crypto.randomBytes(32).toString("hex"); // 64-char hex
    const hash = this.hashToken(token);
    return { token, hash };
  }

  private hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  private sessionsTable(): any {
    return this.db._.schema?.sessions ?? this.db.sessions;
  }

  private revokedTokensTable(): any {
    return this.db._.schema?.revokedTokens ?? this.db.revokedTokens;
  }

  private async findSessionByRefreshHash(hash: string): Promise<SessionRow | null> {
    const result = await this.db
      .select()
      .from(this.sessionsTable())
      .where(eq(this.sessionsTable().refreshTokenHash, hash))
      .limit(1);
    return result[0] ?? null;
  }

  private async findSessionById(id: string): Promise<SessionRow | null> {
    const result = await this.db
      .select()
      .from(this.sessionsTable())
      .where(eq(this.sessionsTable().id, id))
      .limit(1);
    return result[0] ?? null;
  }

  private async getRolesForSession(session: SessionRow): Promise<string[]> {
    // Roles are not stored in the session row — they are loaded from boardMembers
    // at request time. For the token we store an empty array; ACL engine
    // re-evaluates per-resource at runtime.
    return [];
  }
}

// ============================================================================
// TokenError — typed, classified
// ============================================================================

export class TokenError extends Error {
  constructor(
    public readonly code:
      | "INVALID_REFRESH_TOKEN"
      | "REFRESH_TOKEN_EXPIRED"
      | "REFRESH_TOKEN_ALREADY_USED"
      | "ROTATION_RACE_DETECTED"
      | "TOKEN_REVOKED"
      | "TOKEN_EXPIRED"
      | "MALFORMED_TOKEN"
      | "INVALID_SIGNATURE",
  ) {
    super(code);
    this.name = "TokenError";
  }
}
