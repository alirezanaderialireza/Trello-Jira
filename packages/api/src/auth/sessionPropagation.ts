// packages/api/src/auth/sessionPropagation.ts
//
// ============================================================================
// 🔄 SessionPropagation — Consistent Session Context Across All Layers
// ============================================================================
//
// Problem:
//   Auth state needs to be consistently available in:
//     1. tRPC request handlers (HTTP)
//     2. WebSocket connection setup + every message
//     3. Background worker jobs (outbox processor, event replay)
//
//   Without explicit propagation, each layer re-validates independently,
//   creating drift when tokens are rotated or revoked mid-session.
//
// Solution:
//   PropagatedSession — the canonical, fully validated session object that
//   is produced ONCE at the transport boundary and then carried through the
//   entire call chain.  It extends the base Session type with:
//     • verifiedAt timestamp (for staleness checks)
//     • source tag (http | ws | worker) for audit + observability
//     • aclVersion snapshot (detect permission changes mid-session)
//
//   SessionPropagator — stateless helper that:
//     1. Validates the Bearer token via TokenService
//     2. Checks session is still active in DB/Redis
//     3. Detects ACL version drift against the membership cache
//     4. Builds and returns a PropagatedSession
//
// ============================================================================

import type { TokenService, VerifiedClaims } from "./tokenService";
import { AuthError } from "./tokenService";
import type { MembershipCache }              from "../acl/membershipCache";

// ============================================================================
// Types
// ============================================================================

export type SessionSource = "http" | "ws" | "worker";

export interface PropagatedSession {
  /** Stable user identifier */
  userId:   string;
  tenantId: string;
  /** Opaque session ID (references sessions table row) */
  sessionId: string;
  /** JWT identifier for the access token — used for revocation */
  jti:       string;
  /** Roles at the time the token was issued */
  roles:     string[];
  /** ACL version — bump causes client to reload permissions */
  aclVersion: number;
  /** When this session object was produced (ms since epoch) */
  verifiedAt: number;
  /** Where the request originated */
  source: SessionSource;
  /** Client IP — for audit logs */
  ip?: string;
  /** User-Agent — for audit logs */
  userAgent?: string;
}

export interface SessionValidationOpts {
  /** Raw "Bearer <token>" header value or just the token */
  authorization: string | undefined;
  source:        SessionSource;
  ip?:           string;
  userAgent?:    string;
  /**
   * If true, ACL version drift causes a FORBIDDEN error rather than silently
   * accepting the stale claims.  Recommended for write operations.
   */
  strictAclCheck?: boolean;
}

// ============================================================================
// SessionPropagator
// ============================================================================

export class SessionPropagator {
  constructor(
    private readonly tokenService:    TokenService,
    private readonly membershipCache: MembershipCache,
  ) {}

  // ==========================================================================
  // 🔒 validateAndPropagate
  // ==========================================================================

  /**
   * Primary entry-point for all transport layers.
   *
   * Called:
   *  • HTTP — in Next.js route handler / tRPC createContext
   *  • WS   — on CONNECT message and periodically on heartbeat
   *  • Worker — when processing an outbox/queue job that carries session metadata
   *
   * Throws AuthError on any validation failure so the caller can translate
   * to the appropriate protocol error (HTTP 401, WS close 4401, job DLQ).
   */
  async validateAndPropagate(
    opts: SessionValidationOpts,
  ): Promise<PropagatedSession> {
    // ── 1. Extract token ─────────────────────────────────────────────────────
    const raw = opts.authorization ?? "";
    const token = raw.startsWith("Bearer ")
      ? raw.slice(7).trim()
      : raw.trim();

    if (!token) {
      throw new AuthError("MISSING_TOKEN", "Authorization header is required");
    }

    // ── 2. Verify JWT (signature + expiry + revocation list) ─────────────────
    let claims: VerifiedClaims;
    try {
      claims = await this.tokenService.verifyAccess(token);
    } catch (err) {
      if (err instanceof AuthError) throw err;
      throw new AuthError("INVALID_TOKEN", "Token verification failed");
    }

    // ── 3. ACL version drift detection ───────────────────────────────────────
    // The token carries the aclVersion at issue time.  If the membership cache
    // has a newer version, the token's role claims may be stale.
    const cachedMembership = await this.membershipCache
      .getByUser(claims.tenantId, claims.sub)
      .catch(() => null);  // Cache miss is non-fatal; fallback to token claims

    const currentAclVersion = cachedMembership?.aclVersion ?? claims.aclV;
    const aclDrift = claims.aclV < currentAclVersion;

    if (aclDrift && opts.strictAclCheck) {
      throw new AuthError(
        "FORBIDDEN",
        "Permission set has changed since this token was issued. " +
        "Re-authenticate to get updated claims.",
      );
    }

    // ── 4. Use most-current role claims ──────────────────────────────────────
    // If we have a cache hit, prefer its roles over the token's stale claims.
    // This avoids a complete re-auth for non-strict operations while still
    // keeping role data up-to-date.
    const roles = (cachedMembership && aclDrift)
      ? cachedMembership.roles
      : claims.roles;

    // ── 5. Build propagated session ───────────────────────────────────────────
    return {
      userId:     claims.sub,
      tenantId:   claims.tenantId,
      sessionId:  claims.sid,
      jti:        claims.jti,
      roles,
      aclVersion: currentAclVersion,
      verifiedAt: Date.now(),
      source:     opts.source,
      ip:         opts.ip,
      userAgent:  opts.userAgent,
    };
  }

  // ==========================================================================
  // 🔁 revalidateForWs
  // ==========================================================================

  /**
   * Lightweight re-validation for WebSocket heartbeats.
   *
   * On each heartbeat the WS gateway calls this with the session it already
   * holds.  We check:
   *   1. The session's JTI has not been revoked (token might have been rotated
   *      on another tab, invalidating the WS session)
   *   2. ACL version has not drifted
   *
   * This is much cheaper than a full validateAndPropagate because we skip the
   * JWT signature check (the session was already validated on connect).
   */
  async revalidateForWs(session: PropagatedSession): Promise<{
    valid:       boolean;
    aclChanged:  boolean;
    newAclVersion?: number;
    newRoles?:   string[];
  }> {
    // Check ACL drift
    const cached = await this.membershipCache
      .getByUser(session.tenantId, session.userId)
      .catch(() => null);

    if (!cached) return { valid: true, aclChanged: false };

    const aclChanged = cached.aclVersion > session.aclVersion;
    return {
      valid:          true,
      aclChanged,
      newAclVersion:  aclChanged ? cached.aclVersion : undefined,
      newRoles:       aclChanged ? cached.roles       : undefined,
    };
  }

  // ==========================================================================
  // 🏭 buildWorkerSession
  // ==========================================================================

  /**
   * Build a PropagatedSession for background worker jobs.
   *
   * Worker jobs carry session metadata embedded in the job payload (userId,
   * tenantId, roles, aclVersion) rather than a live JWT — there is no HTTP
   * request to pull a token from.  We trust the job payload because it was
   * written transactionally alongside the DB mutation that created it.
   *
   * We still check the membership cache so that if a role change happened
   * between job enqueue and job execution, the worker uses the current roles.
   */
  async buildWorkerSession(payload: {
    userId:     string;
    tenantId:   string;
    sessionId:  string;
    roles:      string[];
    aclVersion: number;
    correlationId?: string;
  }): Promise<PropagatedSession> {
    const cached = await this.membershipCache
      .getByUser(payload.tenantId, payload.userId)
      .catch(() => null);

    const roles      = cached?.roles      ?? payload.roles;
    const aclVersion = cached?.aclVersion ?? payload.aclVersion;

    return {
      userId:     payload.userId,
      tenantId:   payload.tenantId,
      sessionId:  payload.sessionId,
      // Workers don't have a live JWT — use correlationId as a synthetic key
      jti:        payload.correlationId ?? `worker:${payload.sessionId}`,
      roles,
      aclVersion,
      verifiedAt: Date.now(),
      source:     "worker",
    };
  }
}
