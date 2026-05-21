// packages/api/src/auth/tokenService.ts
//
// ============================================================================
// 🔑 TokenService — JWT Access + Refresh Token + Revocation
// ============================================================================
//
// Design:
//   AccessToken  — short-lived (15 min), signed with RS256, carries session
//                  claims.  Never stored in DB; verified only from signature.
//
//   RefreshToken — long-lived (7 days), opaque random string, stored in DB
//                  (sessions table).  One active refresh token per session.
//                  Rotation on every use — old token is immediately revoked.
//
//   Revocation   — Redis Set keyed by "revoked:{jti}" for access tokens.
//                  Refresh tokens are revoked by deleting the session row.
//                  Redis TTL matches the access token TTL so entries self-clean.
//
//   Token Rotation — on refresh:
//     1. Validate incoming refresh token (DB lookup)
//     2. Check revocation list for the access jti bound to that session
//     3. Issue new access + refresh tokens
//     4. Atomically revoke old refresh token in DB + insert new one
//     5. Add old access jti to revocation list (Redis) for the remaining TTL
//
// ============================================================================

import * as jose from "jose";
import type { Redis } from "ioredis";

// ============================================================================
// Types
// ============================================================================

export interface TokenClaims {
  /** stable user ID */
  sub:      string;
  /** tenant that owns this session */
  tenantId: string;
  /** opaque session identifier (DB row) */
  sid:      string;
  /** roles at time of issue */
  roles:    string[];
  /** ACL version at time of issue — used for cache-bust detection */
  aclV:     number;
}

export interface IssuedTokens {
  accessToken:           string;
  refreshToken:          string;
  /** epoch seconds */
  accessTokenExpiresAt:  number;
  /** epoch seconds */
  refreshTokenExpiresAt: number;
}

export interface VerifiedClaims extends TokenClaims {
  /** JWT ID — used as revocation key */
  jti: string;
  /** issued-at epoch seconds */
  iat: number;
  /** expiry epoch seconds */
  exp: number;
}

// ============================================================================
// Config
// ============================================================================

const ACCESS_TOKEN_TTL_SECONDS  = 15 * 60;         // 15 min
const REFRESH_TOKEN_TTL_SECONDS = 7  * 24 * 60 * 60; // 7 days

/** Redis key prefix for revoked JTIs */
const REVOKE_PREFIX = "revoked:jti:";

/** Redis pub/sub channel for cluster-wide revocation broadcast */
const REVOKE_CHANNEL = "auth:revoke";

// ============================================================================
// TokenService
// ============================================================================

export class TokenService {
  private readonly privateKey: Promise<jose.KeyLike>;
  private readonly publicKey:  Promise<jose.KeyLike>;

  constructor(
    /** PEM-encoded PKCS8 private key (RS256) */
    private readonly privateKeyPem: string,
    /** PEM-encoded SPKI public key (RS256) */
    private readonly publicKeyPem:  string,
    private readonly redis:         Redis,
    /** Used to broadcast revocations to other cluster nodes */
    private readonly redisPub:      Redis,
  ) {
    this.privateKey = jose.importPKCS8(privateKeyPem, "RS256");
    this.publicKey  = jose.importSPKI(publicKeyPem,  "RS256");
  }

  // ==========================================================================
  // 🎟️ Issue
  // ==========================================================================

  /**
   * Issue a new access + refresh token pair.
   * Does NOT persist to DB — caller must store the refresh token in DB.
   */
  async issue(claims: TokenClaims): Promise<IssuedTokens> {
    const now              = Math.floor(Date.now() / 1000);
    const accessExpiresAt  = now + ACCESS_TOKEN_TTL_SECONDS;
    const refreshExpiresAt = now + REFRESH_TOKEN_TTL_SECONDS;
    const jti              = crypto.randomUUID();

    const accessToken = await new jose.SignJWT({
      tenantId: claims.tenantId,
      sid:      claims.sid,
      roles:    claims.roles,
      aclV:     claims.aclV,
    })
      .setProtectedHeader({ alg: "RS256" })
      .setSubject(claims.sub)
      .setJti(jti)
      .setIssuedAt(now)
      .setExpirationTime(accessExpiresAt)
      .sign(await this.privateKey);

    // Refresh token is an opaque random string — nothing sensitive inside
    const refreshToken = this._randomToken(64);

    return {
      accessToken,
      refreshToken,
      accessTokenExpiresAt:  accessExpiresAt,
      refreshTokenExpiresAt: refreshExpiresAt,
    };
  }

  // ==========================================================================
  // ✅ Verify Access Token
  // ==========================================================================

  /**
   * Verify signature + expiry + revocation.
   * Throws if invalid, expired, or revoked.
   */
  async verifyAccess(token: string): Promise<VerifiedClaims> {
    let payload: jose.JWTPayload;

    try {
      const result = await jose.jwtVerify(token, await this.publicKey, {
        algorithms: ["RS256"],
      });
      payload = result.payload;
    } catch (err: any) {
      throw new AuthError("INVALID_TOKEN", `JWT verification failed: ${err.message}`);
    }

    const jti = payload.jti;
    if (!jti) throw new AuthError("INVALID_TOKEN", "Missing jti claim");

    // Revocation check — O(1) Redis lookup
    const revoked = await this.redis.exists(`${REVOKE_PREFIX}${jti}`);
    if (revoked) throw new AuthError("REVOKED_TOKEN", "Access token has been revoked");

    return {
      sub:      payload.sub!,
      tenantId: payload["tenantId"] as string,
      sid:      payload["sid"]      as string,
      roles:    payload["roles"]    as string[],
      aclV:     payload["aclV"]     as number,
      jti,
      iat: payload.iat!,
      exp: payload.exp!,
    };
  }

  // ==========================================================================
  // 🔄 Rotate (Refresh)
  // ==========================================================================

  /**
   * Rotate a refresh token.
   *
   * @param oldRefreshToken  — token from the client
   * @param sessionRow       — DB row previously loaded by caller
   * @param oldAccessJti     — jti of the access token being replaced (to revoke)
   * @returns new token pair
   *
   * The caller is responsible for atomically updating the session row in DB
   * (old refresh token → new refresh token) before calling this method.
   * This service only handles token crypto + revocation list.
   */
  async rotate(opts: {
    sessionRow:    {
      id:       string;
      userId:   string;
      tenantId: string;
      roles:    string[];
      aclV:     number;
      /** The stored refresh token to validate against */
      refreshToken:         string;
      refreshTokenExpiresAt: Date;
    };
    incomingRefreshToken: string;
    oldAccessJti:         string | null;
  }): Promise<IssuedTokens> {
    const { sessionRow, incomingRefreshToken, oldAccessJti } = opts;

    // Constant-time comparison to prevent timing attacks
    if (!this._safeEqual(sessionRow.refreshToken, incomingRefreshToken)) {
      throw new AuthError("INVALID_TOKEN", "Refresh token mismatch");
    }

    if (sessionRow.refreshTokenExpiresAt < new Date()) {
      throw new AuthError("EXPIRED_TOKEN", "Refresh token has expired");
    }

    // Revoke old access token if we know its JTI
    if (oldAccessJti) {
      await this._revokeJti(oldAccessJti);
    }

    const newTokens = await this.issue({
      sub:      sessionRow.userId,
      tenantId: sessionRow.tenantId,
      sid:      sessionRow.id,
      roles:    sessionRow.roles,
      aclV:     sessionRow.aclV,
    });

    return newTokens;
  }

  // ==========================================================================
  // ❌ Revoke Access Token
  // ==========================================================================

  /**
   * Add a JTI to the revocation list.
   * TTL is set to the remaining lifetime of the token so the entry self-cleans.
   */
  async revokeAccessToken(jti: string, expiresAt: number): Promise<void> {
    await this._revokeJti(jti, expiresAt);
  }

  // ==========================================================================
  // 🔑 Public Key (for WS gateway / edge verification)
  // ==========================================================================

  async getPublicKeyJwk(): Promise<jose.JWK> {
    return await jose.exportJWK(await this.publicKey);
  }

  // ==========================================================================
  // 🔐 Internal helpers
  // ==========================================================================

  private async _revokeJti(jti: string, expiresAt?: number): Promise<void> {
    const ttl = expiresAt
      ? Math.max(0, expiresAt - Math.floor(Date.now() / 1000))
      : ACCESS_TOKEN_TTL_SECONDS;

    if (ttl > 0) {
      await this.redis.setex(`${REVOKE_PREFIX}${jti}`, ttl, "1");
      // Broadcast to other nodes so their local caches can be invalidated
      await this.redisPub.publish(REVOKE_CHANNEL, JSON.stringify({ jti, ttl }));
    }
  }

  private _randomToken(bytes: number): string {
    const arr = new Uint8Array(bytes);
    crypto.getRandomValues(arr);
    return Buffer.from(arr).toString("base64url");
  }

  /**
   * Constant-time string comparison to prevent timing attacks on token
   * comparison.
   */
  private _safeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    const aB = Buffer.from(a, "utf8");
    const bB = Buffer.from(b, "utf8");
    return aB.byteLength === bB.byteLength && 
           crypto.subtle !== undefined
      // Use timingSafeEqual if available (Node.js >= 20)
      ? require("crypto").timingSafeEqual(aB, bB)
      : a === b;
  }
}

// ============================================================================
// Error
// ============================================================================

export type AuthErrorCode =
  | "INVALID_TOKEN"
  | "EXPIRED_TOKEN"
  | "REVOKED_TOKEN"
  | "MISSING_TOKEN"
  | "UNAUTHORIZED"
  | "FORBIDDEN";

export class AuthError extends Error {
  constructor(
    public readonly code: AuthErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}
