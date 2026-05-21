// packages/infrastructure/src/auth/serviceAuth/serviceTokenService.ts
// ─────────────────────────────────────────────────────────────────────────────
// Service Token Service — issues, rotates, and revokes internal service JWTs.
//
// Each microservice (web, worker, realtime, scheduler) receives a signed JWT
// identifying itself + its permitted scopes. These tokens are:
//   - Short-lived (5 min TTL) to limit blast radius on leak
//   - Rotated automatically before expiry by the owning service
//   - Validated by InternalAuthMiddleware on every internal request
//
// Token claims:
//   sub:   "service:<name>"    (e.g. "service:worker")
//   scope: string[]            (e.g. ["events:publish", "replay:read"])
//   aud:   string              (target service, e.g. "api")
//   iat, exp, jti              (standard JWT time + ID claims)
// ─────────────────────────────────────────────────────────────────────────────

import crypto from "node:crypto";

// ============================================================================
// Types
// ============================================================================

export type ServiceName = "web" | "worker" | "realtime" | "scheduler" | "api";

export interface ServiceTokenClaims {
  sub:   string;        // "service:<name>"
  scope: string[];      // permissions
  aud:   string;        // target service
  jti:   string;
  iat:   number;
  exp:   number;
}

export interface ServiceTokenConfig {
  /** Shared signing secret (HMAC-SHA256) for internal tokens */
  signingSecret: string;
  /** Token TTL in seconds (default: 300 = 5 min) */
  ttlSec?: number;
}

// ============================================================================
// ServiceTokenService
// ============================================================================

const DEFAULT_TTL_SEC = 300; // 5 minutes

export class ServiceTokenService {
  private readonly secret: string;
  private readonly ttlSec: number;
  private readonly revokedJtis = new Set<string>(); // in-memory; production → Redis

  constructor(config: ServiceTokenConfig) {
    this.secret = config.signingSecret;
    this.ttlSec = config.ttlSec ?? DEFAULT_TTL_SEC;
  }

  // ==========================================================================
  // Issue a service token
  // ==========================================================================

  issue(params: {
    service: ServiceName;
    scopes:  string[];
    audience: ServiceName | string;
  }): { token: string; claims: ServiceTokenClaims } {
    const now = Math.floor(Date.now() / 1000);
    const claims: ServiceTokenClaims = {
      sub:   `service:${params.service}`,
      scope: params.scopes,
      aud:   params.audience,
      jti:   crypto.randomUUID(),
      iat:   now,
      exp:   now + this.ttlSec,
    };

    const token = this.sign(claims);
    return { token, claims };
  }

  // ==========================================================================
  // Verify a service token
  // ==========================================================================

  verify(token: string, expectedAudience?: string): ServiceTokenClaims {
    const claims = this.decodeAndVerify(token);

    // Expiry check
    const now = Math.floor(Date.now() / 1000);
    if (claims.exp < now) {
      throw new ServiceAuthError("TOKEN_EXPIRED", `Token expired at ${claims.exp}`);
    }

    // Audience check
    if (expectedAudience && claims.aud !== expectedAudience) {
      throw new ServiceAuthError("AUDIENCE_MISMATCH",
        `Expected aud=${expectedAudience}, got ${claims.aud}`);
    }

    // Revocation check
    if (this.revokedJtis.has(claims.jti)) {
      throw new ServiceAuthError("TOKEN_REVOKED", `JTI ${claims.jti} has been revoked`);
    }

    return claims;
  }

  // ==========================================================================
  // Revoke a token (e.g. on service restart, key rotation)
  // ==========================================================================

  revoke(jti: string): void {
    this.revokedJtis.add(jti);
    // Limit set size (ring buffer style)
    if (this.revokedJtis.size > 10_000) {
      const first = this.revokedJtis.values().next().value;
      if (first) this.revokedJtis.delete(first);
    }
  }

  // ==========================================================================
  // Rotate — issue new token for the same service (call before expiry)
  // ==========================================================================

  rotate(currentToken: string): { token: string; claims: ServiceTokenClaims } {
    const current = this.verify(currentToken);
    // Revoke old JTI
    this.revoke(current.jti);
    // Issue new with same sub/scope/aud
    const serviceName = current.sub.replace("service:", "") as ServiceName;
    return this.issue({
      service:  serviceName,
      scopes:   current.scope,
      audience: current.aud,
    });
  }

  // ── Private: HMAC-SHA256 signing ──────────────────────────────────────────

  private sign(claims: ServiceTokenClaims): string {
    const header  = this.b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const payload = this.b64url(JSON.stringify(claims));
    const data    = `${header}.${payload}`;
    const sig     = crypto.createHmac("sha256", this.secret).update(data).digest("base64url");
    return `${data}.${sig}`;
  }

  private decodeAndVerify(token: string): ServiceTokenClaims {
    const parts = token.split(".");
    if (parts.length !== 3) throw new ServiceAuthError("MALFORMED_TOKEN", "Invalid JWT structure");

    const [header, payload, signature] = parts as [string, string, string];
    const data = `${header}.${payload}`;

    // Verify signature
    const expected = crypto.createHmac("sha256", this.secret).update(data).digest("base64url");
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      throw new ServiceAuthError("INVALID_SIGNATURE", "HMAC verification failed");
    }

    // Decode payload
    try {
      return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as ServiceTokenClaims;
    } catch {
      throw new ServiceAuthError("MALFORMED_TOKEN", "Cannot decode payload");
    }
  }

  private b64url(str: string): string {
    return Buffer.from(str).toString("base64url");
  }
}

// ============================================================================
// ServiceAuthError
// ============================================================================

export class ServiceAuthError extends Error {
  constructor(
    public readonly code:
      | "TOKEN_EXPIRED"
      | "AUDIENCE_MISMATCH"
      | "TOKEN_REVOKED"
      | "MALFORMED_TOKEN"
      | "INVALID_SIGNATURE"
      | "SCOPE_DENIED"
      | "SERVICE_NOT_REGISTERED",
    message: string,
  ) {
    super(message);
    this.name = "ServiceAuthError";
  }
}
